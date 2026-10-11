#!/usr/bin/env -S usage bash
#USAGE about "End-to-end test of the failures that the smoke suite does not cover"
#USAGE long_about #"""
#USAGE End-to-end test of the failures that the smoke suite does not cover: an output
#USAGE name that is taken, a store listed twice, a bucket that cannot be read, and
#USAGE credentials that are missing, which heal by the timer alone, and a file that
#USAGE is too large.
#USAGE """#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
NS=kmo-e2e-failures

# local_store <name> <bucket> <credentials Secret>: prints a ConfigStore on the local object store.
local_store() {
  cat <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigStore
metadata: { name: $1, namespace: $NS }
spec:
  s3:
    bucket: $2
    region: us-east-1
    endpoint: http://rustfs.kmo-dev.svc:9000
    addressingStyle: Path
    credentialsSecretRef: { name: $3 }
EOF
}
# keys <name>: creates a Secret with the keys of the local object store.
keys() {
  kubectl create secret generic "$1" -n "$NS" \
    --from-literal=accessKeyId=kmoadmin --from-literal=secretAccessKey=kmo-local-secret >/dev/null
}
reason() { condition_of "$NS" "$1" Ready reason; }
message() { condition_of "$NS" "$1" Ready message; }

cleanup() {
  kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  store s3 rm --recursive "s3://$BUCKET/$NS/" >/dev/null 2>&1 || true
}

ensure_environment
trap cleanup EXIT
cleanup
kubectl wait --for=delete "namespace/$NS" --timeout=60s >/dev/null 2>&1 || true
kubectl create namespace "$NS" >/dev/null
put "$NS/taken/config.env" 'FROM=the store\n'
put "$NS/locked/config.env" 'HEALED=yes\n'

echo "Check 1: an output name that an object of someone else holds"
kubectl create configmap taken-kmo -n "$NS" --from-literal=FROM=someone-else >/dev/null
kubectl apply -f - >/dev/null <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: taken, namespace: $NS }
EOF
wait_for "the ConfigSync is not ready, with the reason" '[ "$(reason taken)" = "OutputTaken" ]' 30
check "the object of someone else is left as it was" '[ "$(value_in "$NS" taken-kmo FROM)" = "someone-else" ]'
check "the other output is not written, though its name is free" \
  '! kubectl get secret taken-kmo -n "$NS" >/dev/null 2>&1'
check "a Warning Event is recorded" 'event_on "$NS" taken Warning OutputTaken'

echo "Check 2: the same store listed twice"
kubectl apply -f - >/dev/null <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: twice, namespace: $NS }
spec:
  sources:
    - storeRef: { kind: ClusterConfigStore, name: default }
    - storeRef: { kind: ClusterConfigStore, name: default }
EOF
wait_for "the ConfigSync is not ready, with the reason" '[ "$(reason twice)" = "InvalidSpec" ]' 30
check "the message names the store" '[[ "$(message twice)" == *"ClusterConfigStore/default is listed more than once"* ]]'
check "nothing was written" '! kubectl get configmap twice-kmo -n "$NS" >/dev/null 2>&1'

echo "Check 3: a bucket that cannot be read"
keys store-keys
{
  local_store nowhere kmo-no-such-bucket store-keys
  cat <<EOF
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: lost, namespace: $NS }
spec:
  sources: [{ storeRef: { name: nowhere } }]
EOF
} | kubectl apply -f - >/dev/null
wait_for "the ConfigSync is not ready, with the reason" '[ "$(reason lost)" = "StoreUnreachable" ]' 30
check "the message names the bucket" '[[ "$(message lost)" == *"kmo-no-such-bucket"* ]]'
check "nothing was written" '! kubectl get configmap lost-kmo -n "$NS" >/dev/null 2>&1'
wait_for "the store says that it is not ready" \
  '[ "$(kubectl get cstore nowhere -n "$NS" -o jsonpath="{.status.conditions[0].reason}")" = "NotReachable" ]' 30
check "a Warning Event is recorded" 'event_on "$NS" lost Warning StoreUnreachable'

echo "Check 4: credentials that are missing, and the timer that tries again"
{
  local_store locked "$BUCKET" late-keys
  cat <<EOF
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: locked, namespace: $NS }
spec:
  sources: [{ storeRef: { name: locked } }]
EOF
} | kubectl apply -f - >/dev/null
wait_for "the ConfigSync is not ready, with the reason" '[ "$(reason locked)" = "CredentialsMissing" ]' 30
check "the message names the Secret" '[[ "$(message locked)" == *"Secret $NS/late-keys was not found"* ]]'
keys late-keys
wait_for "the timer tries the failed sync again, with no event and no request" \
  '[ "$(value_in "$NS" locked-kmo HEALED)" = "yes" ]' 100
wait_for "the ConfigSync is ready again" '[ "$(reason locked)" != "CredentialsMissing" ]' 20
check "the other ConfigSyncs kept their own failures" '[ "$(reason taken)" = "OutputTaken" ]'

echo "Check 5: a file that is too large for a ConfigMap"
{
  printf 'BIG='
  head -c 1100000 /dev/zero | tr '\0' x
} | store s3 cp - "s3://$BUCKET/$NS/big/config.env" >/dev/null
kubectl apply -f - >/dev/null <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: big, namespace: $NS }
EOF
wait_for "the ConfigSync is not ready, with the reason" '[ "$(reason big)" = "OutputTooLarge" ]' 30
check "the message names the file and the limit" \
  '[[ "$(message big)" == "\"$NS/big/config.env\" in bucket \"$BUCKET\" is "*" bytes; the limit is 1048576" ]]'
check "nothing was written" '! kubectl get configmap big-kmo -n "$NS" >/dev/null 2>&1'
check "a Warning Event is recorded" 'event_on "$NS" big Warning OutputTooLarge'

finish
