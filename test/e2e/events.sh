#!/usr/bin/env -S usage bash
#USAGE about "End-to-end test of the receiver"
#USAGE long_about #"""
#USAGE End-to-end test of the receiver: its answers, and changed files that reach the
#USAGE pods with no request by hand. It uses its own namespace and its own store,
#USAGE under a key prefix of the sample bucket.
#USAGE """#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
NS=kmo-e2e-events
STORE=e2e-events
URL=http://localhost:18080
TOKEN=kmo-local-token
FORWARD=""
REPLICAS=""

# answer <method> <path> [token] [body]: the status code of the receiver's answer.
answer() {
  local args=(-s -o /dev/null -w '%{http_code}' --max-time 15)
  if [ "$1" = "HEAD" ]; then args+=(--head); else args+=(-X "$1"); fi
  [ -n "${3:-}" ] && args+=(-H "Authorization: Bearer $3")
  [ -n "${4:-}" ] && args+=(-d "$4")
  curl "${args[@]}" "$URL$2" 2>/dev/null || true
}
s3_event() { printf '{"source":"aws.s3","detail":{"bucket":{"name":"%s"},"object":{"key":"%s"}}}' "$BUCKET" "$1"; }
requested_at() {
  kubectl get csync "$1" -n "$NS" -o jsonpath='{.metadata.annotations.kmo\.isntall\.net/sync-requested-at}'
}
pod_names() { kubectl get pods -n "$NS" -l "app=$1" -o name | sort; }
admission_pods() { kubectl get pods -n pepr-system -o name | grep pepr-kmo | grep -v watcher || true; }

cleanup() {
  [ -n "$FORWARD" ] && kill "$FORWARD" 2>/dev/null || true
  [ -n "$REPLICAS" ] && kubectl scale deployment/pepr-kmo -n pepr-system --replicas="$REPLICAS" >/dev/null 2>&1 || true
  kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  kubectl delete clusterconfigstore "$STORE" --ignore-not-found >/dev/null 2>&1 || true
  store s3 rm --recursive "s3://$BUCKET/$STORE/" >/dev/null 2>&1 || true
}

ensure_environment
trap cleanup EXIT
cleanup
kubectl wait --for=delete "namespace/$NS" --timeout=60s >/dev/null 2>&1 || true
kubectl port-forward -n kmo-system service/kmo-receiver 18080:8080 >/dev/null 2>&1 &
FORWARD=$!

echo "Setup: a store with two services, one of which sets a common key itself"
put "$STORE/_common/config.env" 'SHARED=common\nREGION=north\n'
put "$STORE/$NS/one/config.env" 'OWN=one\nSHARED=mine\n'
put "$STORE/$NS/two/config.env" 'OWN=two\n'
{
  cat <<EOF
apiVersion: v1
kind: Namespace
metadata: { name: $NS }
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ClusterConfigStore
metadata: { name: $STORE }
spec:
  s3:
    bucket: $BUCKET
    keyPrefix: $STORE
    region: us-east-1
    endpoint: http://rustfs.kmo-dev.svc:9000
    addressingStyle: Path
    credentialsSecretRef: { name: kmo-config-credentials, namespace: kmo-system }
  allowedNamespaces: [$NS]
EOF
  for name in one two; do
    cat <<EOF
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: $name, namespace: $NS }
spec:
  sources: [{ storeRef: { kind: ClusterConfigStore, name: $STORE } }]
---
EOF
    deployment "$NS" "$name" "$name-kmo"
  done
} | kubectl apply -f - >/dev/null

echo "Check 1: the receiver's answers"
wait_for "the receiver can be reached" '[ "$(answer GET /healthz)" = "200" ]' 20
[ "$FAILED" = "0" ] || {
  echo "The receiver cannot be reached, so the other checks cannot pass. Stopping."
  exit 1
}
check "HEAD / needs no token" '[ "$(answer HEAD /)" = "200" ]'
check "the lists of the cluster are filled" '[ "$(answer GET /readyz)" = "200" ]'
check "an event without a token is refused" '[ "$(answer POST /events/rustfs "" "{}")" = "401" ]'
check "an event with a wrong token is refused" '[ "$(answer POST /events/rustfs wrong "{}")" = "401" ]'
check "a body that is not JSON is refused" '[ "$(answer POST /events/rustfs "$TOKEN" "not json")" = "400" ]'
check "JSON that is not an event is refused" '[ "$(answer POST /events/eventbridge "$TOKEN" "{}")" = "400" ]'
check "an unknown path is not found" '[ "$(answer POST /events/other "$TOKEN" "{}")" = "404" ]'

echo "Check 2: the first sync"
wait_for "one has its own value" '[ "$(value_in "$NS" one-kmo OWN)" = "one" ]'
wait_for "two has the common value" '[ "$(value_in "$NS" two-kmo SHARED)" = "common" ]'
[ "$FAILED" = "0" ] || {
  echo "Nothing was synced, so the other checks cannot pass. Stopping."
  exit 1
}
wait_for "the pods of one run on its hash" 'pods_on "$NS" one "$(hash_on "$NS" deployment one)"' 120
wait_for "the pods of two run on its hash" 'pods_on "$NS" two "$(hash_on "$NS" deployment two)"' 120

echo "Check 3: a changed service file reaches its pods, with no request by hand"
ONE=$(hash_on "$NS" deployment one)
TWO=$(hash_on "$NS" deployment two)
put "$STORE/$NS/one/config.env" 'OWN=changed\nSHARED=mine\n'
wait_for "the ConfigMap has the new value" '[ "$(value_in "$NS" one-kmo OWN)" = "changed" ]' 30
wait_for "the hash changed" '[ "$(hash_on "$NS" deployment one)" != "$ONE" ]' 30
wait_for "the pods were replaced" 'pods_on "$NS" one "$(hash_on "$NS" deployment one)"' 120
check "the other service was not touched" '[ "$(hash_on "$NS" deployment two)" = "$TWO" ]'

echo "Check 4: a changed common file reaches every service of the store"
ONE=$(hash_on "$NS" deployment one)
put "$STORE/_common/config.env" 'SHARED=common\nREGION=south\n'
wait_for "one has the new common value" '[ "$(value_in "$NS" one-kmo REGION)" = "south" ]' 30
wait_for "two has it too" '[ "$(value_in "$NS" two-kmo REGION)" = "south" ]' 30
wait_for "both hashes changed" \
  '[ "$(hash_on "$NS" deployment one)" != "$ONE" ] && [ "$(hash_on "$NS" deployment two)" != "$TWO" ]' 30
wait_for "the pods of one were replaced" 'pods_on "$NS" one "$(hash_on "$NS" deployment one)"' 120
wait_for "the pods of two were replaced" 'pods_on "$NS" two "$(hash_on "$NS" deployment two)"' 120

echo "Check 5: a common key that a service sets itself causes no restart of that service"
ONE=$(hash_on "$NS" deployment one)
TWO=$(hash_on "$NS" deployment two)
PODS=$(pod_names one)
HANDLED=$(handled "$NS" one)
put "$STORE/_common/config.env" 'SHARED=other\nREGION=south\n'
wait_for "the service without its own value gets the new one" '[ "$(value_in "$NS" two-kmo SHARED)" = "other" ]' 30
wait_for "and its hash changed" '[ "$(hash_on "$NS" deployment two)" != "$TWO" ]' 30
wait_for "the service with its own value was synced too" '[ "$(handled "$NS" one)" != "$HANDLED" ]' 30
check "it keeps its own value" '[ "$(value_in "$NS" one-kmo SHARED)" = "mine" ]'
check "its hash is the same" '[ "$(hash_on "$NS" deployment one)" = "$ONE" ]'
check "none of its pods was replaced" '[ "$(pod_names one)" = "$PODS" ]'

echo "Check 6: EventBridge events"
HANDLED=$(handled "$NS" two)
SSM='{"source":"aws.ssm","detail-type":"Parameter Store Change","detail":{"name":"x","operation":"Update"}}'
check "an event from another source is answered with 200" \
  '[ "$(answer POST /events/eventbridge "$TOKEN" "$SSM")" = "200" ]'
sleep 5
check "and starts no sync" '[ "$(handled "$NS" two)" = "$HANDLED" ]'
check "an S3 event for a file of a service is answered with 200" \
  '[ "$(answer POST /events/eventbridge "$TOKEN" "$(s3_event "$STORE/$NS/two/config.env")")" = "200" ]'
wait_for "and starts a sync of that service" '[ "$(handled "$NS" two)" != "$HANDLED" ]' 30

echo "Check 7: a deleted file, and a suspended ConfigSync"
store s3 rm "s3://$BUCKET/$STORE/$NS/one/config.env" >/dev/null
wait_for "the values of a deleted file are gone" '[ -z "$(value_in "$NS" one-kmo OWN)" ]' 30
check "and the common value takes the place of the service's own" '[ "$(value_in "$NS" one-kmo SHARED)" = "other" ]'
kubectl patch csync two -n "$NS" --type merge -p '{"spec":{"suspend":true}}' >/dev/null
wait_for "two says that it is suspended" '[ "$(condition_of "$NS" two Suspended status)" = "True" ]' 20
REQUESTED=$(requested_at two)
put "$STORE/$NS/two/config.env" 'OWN=while suspended\n'
sleep 8
check "the receiver asks for no sync of a suspended ConfigSync" '[ "$(requested_at two)" = "$REQUESTED" ]'
kubectl patch csync two -n "$NS" --type merge -p '{"spec":{"suspend":false}}' >/dev/null
wait_for "the change arrives when syncing is resumed" '[ "$(value_in "$NS" two-kmo OWN)" = "while suspended" ]' 30

echo "Check 8: what the receiver may do, and what it answers when a request for a sync is refused"
ACCOUNT=system:serviceaccount:kmo-system:kmo-receiver
check "it cannot read Secrets" '[ "$(kubectl auth can-i get secrets -A --as="$ACCOUNT" 2>/dev/null)" = "no" ]'
check "it cannot delete a ConfigSync" '[ "$(kubectl auth can-i delete configsyncs -A --as="$ACCOUNT" 2>/dev/null)" = "no" ]'
check "it can patch a ConfigSync" '[ "$(kubectl auth can-i patch configsyncs -A --as="$ACCOUNT" 2>/dev/null)" = "yes" ]'
REPLICAS=$(kubectl get deployment pepr-kmo -n pepr-system -o jsonpath='{.spec.replicas}')
kubectl scale deployment/pepr-kmo -n pepr-system --replicas=0 >/dev/null
wait_for "the admission pods are gone" '[ -z "$(admission_pods)" ]' 60
check "with admission down, the answer is 500, so that the sender tries again" \
  '[ "$(answer POST /events/eventbridge "$TOKEN" "$(s3_event "$STORE/$NS/two/config.env")")" = "500" ]'
kubectl scale deployment/pepr-kmo -n pepr-system --replicas="$REPLICAS" >/dev/null
quietly kubectl rollout status deployment/pepr-kmo -n pepr-system --timeout=180s
REPLICAS=""
check "with admission back, the same event is taken" \
  '[ "$(answer POST /events/eventbridge "$TOKEN" "$(s3_event "$STORE/$NS/two/config.env")")" = "200" ]'

finish
