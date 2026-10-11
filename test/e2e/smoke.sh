#!/usr/bin/env bash
# End-to-end smoke test of the operator on the local cluster. It needs Docker. It creates the cluster and installs
# the local environment when they are missing, and always installs the operator from the working tree.
# It uses its own namespace, store and files, and removes them when it ends.
set -euo pipefail

cd "$(dirname "$0")/../.."
CLUSTER=kmo
NS=kmo-smoke
OVERLAY=smoke-overlay
BUCKET=kmo-config
WATCHER=deployment/pepr-kmo-watcher
HASH='{.spec.template.metadata.annotations.kmo\.isntall\.net/config-hash}'
FAILED=0

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=1; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
# wait_for <description> <condition> [seconds]: passes as soon as the condition holds.
wait_for() {
  local end=$((SECONDS + ${3:-60}))
  until eval "$2"; do
    if [ "$SECONDS" -ge "$end" ]; then fail "$1"; return; fi
    sleep 2
  done
  pass "$1"
}

store() {
  AWS_CONFIG_FILE=dev/aws-config AWS_PROFILE=default AWS_ACCESS_KEY_ID=kmoadmin \
    AWS_SECRET_ACCESS_KEY=kmo-local-secret aws "$@"
}
put() { printf '%b' "$2" | store s3 cp - "s3://$BUCKET/$1" >/dev/null; }
request_sync() {
  kubectl annotate csync app -n "$NS" kmo.isntall.net/sync-requested-at="$(date -u +%FT%T.%3NZ)" --overwrite >/dev/null
}
set_sources() { kubectl patch csync app -n "$NS" --type merge -p "{\"spec\":{\"sources\":$1}}" >/dev/null; }

config() { kubectl get configmap app-kmo -n "$NS" -o jsonpath="{.data.$1}" 2>/dev/null || true; }
config_data() { kubectl get configmap app-kmo -n "$NS" -o jsonpath='{.data}' 2>/dev/null || true; }
config_meta() { kubectl get configmap app-kmo -n "$NS" -o jsonpath="$1" 2>/dev/null || true; }
secret() { kubectl get secret app-kmo -n "$NS" -o jsonpath="{.data.$1}" 2>/dev/null | base64 -d 2>/dev/null || true; }
stamp() { kubectl get deployment app -n "$NS" -o jsonpath="$HASH" 2>/dev/null || true; }
pod_env() { kubectl exec -n "$NS" deployment/app -- printenv "$1" 2>/dev/null || true; }
pods() { kubectl get pods -n "$NS" -l app=smoke -o name 2>/dev/null | sort; }
one_pod() { [ "$(pods | wc -l)" = "1" ] && kubectl rollout status deployment/app -n "$NS" --timeout=1s >/dev/null 2>&1; }
# rolled_from <hash>: true when the Deployment has another hash than the given one and its rollout is finished.
rolled_from() { [ -n "$(stamp)" ] && [ "$(stamp)" != "$1" ] && one_pod; }
watcher_restarts() {
  kubectl get pods -n pepr-system -l pepr.dev/controller=watcher \
    -o jsonpath='{range .items[*]}{.status.containerStatuses[0].restartCount}{"\n"}{end}' | sort -n | tail -1
}

cleanup() {
  kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  kubectl delete clusterconfigstore "$OVERLAY" --ignore-not-found >/dev/null 2>&1 || true
  store s3 rm --recursive "s3://$BUCKET/$NS/" >/dev/null 2>&1 || true
  store s3 rm --recursive "s3://$BUCKET/$OVERLAY/" >/dev/null 2>&1 || true
}
# quietly <command...>: runs a setup command, and shows its output only when it fails.
quietly() {
  local output
  output=$("$@" 2>&1) || { echo "$output" | tail -30; echo "Setup failed: $*"; exit 1; }
}

timeout 10 docker info >/dev/null 2>&1 || { echo "Docker is not available. Start Docker and run the test again."; exit 1; }

if ! k3d cluster list "$CLUSTER" >/dev/null 2>&1; then
  echo "Setup: the cluster $CLUSTER is missing; creating it"
  quietly mise run cluster:up
elif ! kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
  echo "Setup: the cluster $CLUSTER is stopped; starting it"
  quietly k3d cluster start "$CLUSTER"
  quietly kubectl wait --for=condition=Ready nodes --all --timeout=120s
fi
if ! kubectl get clusterconfigstore default >/dev/null 2>&1; then
  echo "Setup: installing the local environment"
  quietly mise run deploy
fi
echo "Setup: installing the operator from the working tree"
quietly mise run operator:deploy
trap cleanup EXIT
cleanup
kubectl wait --for=delete "namespace/$NS" --timeout=60s >/dev/null 2>&1 || true

echo "Setup: a service with its files, its ConfigSync and its Deployment"
put "$NS/app/config.env" 'GREETING=one\nLOG_LEVEL=debug\n'
put "$NS/app/secrets.env" 'PASSWORD=pässwörd\n'
kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Namespace
metadata: { name: $NS }
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: app, namespace: $NS }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: app, namespace: $NS }
spec:
  replicas: 1
  selector: { matchLabels: { app: smoke } }
  template:
    metadata: { labels: { app: smoke } }
    spec:
      terminationGracePeriodSeconds: 1
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c", "while true; do sleep 3600; done"]
          envFrom:
            - configMapRef: { name: app-kmo }
            - secretRef: { name: app-kmo }
EOF

echo "Check 1: the operator writes the ConfigMap and the Secret"
wait_for "the ConfigMap holds the service's value" '[ "$(config GREETING)" = "one" ]'
[ "$FAILED" = "0" ] || { echo "The operator writes nothing, so the other checks cannot pass. Stopping."; exit 1; }
check "the common values are merged in" '[ -n "$(config REGION)" ]'
check "the Secret holds the secret value, non-ASCII characters included" '[ "$(secret PASSWORD)" = "pässwörd" ]'
check "the ConfigMap carries the label of KMO" \
  '[ "$(config_meta "{.metadata.labels.app\.kubernetes\.io/managed-by}")" = "kmo" ]'
check "the ConfigMap tells Stakater Reloader to ignore it" \
  '[ "$(config_meta "{.metadata.annotations.reloader\.stakater\.com/ignore}")" = "true" ]'
check "the ConfigMap is owned by its ConfigSync" \
  '[ "$(config_meta "{.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}")" = "ConfigSync/app" ]'

echo "Check 2: the config hash is on the pod template, and the pod has the values"
wait_for "the Deployment carries a config hash" '[ "$(stamp | wc -c)" = "64" ]'
wait_for "the pod runs with the value" '[ "$(pod_env GREETING)" = "one" ]' 120
[ "$FAILED" = "0" ] || { echo "The workload did not get its values, so the other checks cannot pass. Stopping."; exit 1; }

echo "Check 3: a changed value rolls the workload"
BEFORE=$(stamp)
put "$NS/app/config.env" 'GREETING=two\nLOG_LEVEL=debug\n'
request_sync
wait_for "the hash changed" '[ -n "$(stamp)" ] && [ "$(stamp)" != "$BEFORE" ]'
wait_for "the new pod runs with the new value" '[ "$(pod_env GREETING)" = "two" ]' 120

echo "Check 4: a changed file with the same effective values replaces no pod"
wait_for "the rollout is finished" one_pod 120
BEFORE=$(stamp); PODS=$(pods)
put "$NS/app/config.env" '# a comment only\nGREETING=two\nLOG_LEVEL=debug\n'
request_sync
sleep 10
check "the hash is the same" '[ "$(stamp)" = "$BEFORE" ]'
check "no pod was replaced" '[ "$(pods)" = "$PODS" ]'

echo "Check 5: a hand edit to an output is undone"
kubectl patch configmap app-kmo -n "$NS" --type merge -p '{"data":{"GREETING":"edited","EXTRA":"by hand"}}' >/dev/null
request_sync
wait_for "the changed value is put back" '[ "$(config GREETING)" = "two" ]'
check "the key added by hand is removed" '[ -z "$(config EXTRA)" ]'

echo "Check 6: a second source wins over the first, and can leave out its common files"
put "$OVERLAY/$NS/app/config.env" 'GREETING=overlay\n'
put "$OVERLAY/_common/config.env" 'SMOKE_COMMON=yes\n'
kubectl apply -f - >/dev/null <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ClusterConfigStore
metadata: { name: $OVERLAY }
spec:
  s3:
    bucket: $BUCKET
    keyPrefix: $OVERLAY
    region: us-east-1
    endpoint: http://rustfs.kmo-dev.svc:9000
    addressingStyle: Path
    credentialsSecretRef: { name: kmo-config-credentials, namespace: kmo-system }
  allowedNamespaces: [$NS]
EOF
FIRST='{"storeRef":{"kind":"ClusterConfigStore","name":"default"}}'
SECOND="{\"storeRef\":{\"kind\":\"ClusterConfigStore\",\"name\":\"$OVERLAY\"}"
set_sources "[$FIRST,$SECOND}]"
wait_for "the later source's value wins" '[ "$(config GREETING)" = "overlay" ]'
check "the later source's common value is merged in" '[ "$(config SMOKE_COMMON)" = "yes" ]'
check "a value that only the first source has is kept" '[ "$(config LOG_LEVEL)" = "debug" ]'
BEFORE=$(stamp)
set_sources "[$FIRST,$SECOND,\"common\":false}]"
wait_for "with common false, its common value is gone" '[ -z "$(config SMOKE_COMMON)" ]'
check "and its service value still wins" '[ "$(config GREETING)" = "overlay" ]'

echo "Check 7: a failure writes nothing"
wait_for "the workload rolled to the new values" 'rolled_from "$BEFORE"' 120
DATA=$(config_data); BEFORE=$(stamp)
put "$NS/app/config.env" 'this line is not an assignment\n'
request_sync
sleep 10
check "an unparsable file leaves the ConfigMap as it was" '[ "$(config_data)" = "$DATA" ]'
put "$NS/app/config.env" 'GREETING=two\nLOG_LEVEL=changed\n'
set_sources "[$FIRST,$SECOND,\"common\":false},{\"storeRef\":{\"name\":\"gone\"}}]"
sleep 10
check "a missing store leaves the ConfigMap as it was, also for the stores that exist" '[ "$(config_data)" = "$DATA" ]'
check "the hash is the same" '[ "$(stamp)" = "$BEFORE" ]'
set_sources "[$FIRST]"
wait_for "the ConfigSync recovers when the problem is gone" '[ "$(config LOG_LEVEL)" = "changed" ]'

echo "Check 8: a restart of the operator replaces no pod"
wait_for "the workload rolled to the new values" 'rolled_from "$BEFORE"' 120
PODS=$(pods)
kubectl rollout restart -n pepr-system "$WATCHER" >/dev/null
kubectl rollout status -n pepr-system "$WATCHER" --timeout=180s >/dev/null
sleep 15
check "no pod was replaced" '[ "$(pods)" = "$PODS" ]'
check "the operator did not crash" '[ "$(watcher_restarts)" = "0" ]'

echo "Check 9: deleting the ConfigSync deletes its objects"
kubectl delete csync app -n "$NS" >/dev/null
wait_for "the ConfigMap is gone" '! kubectl get configmap app-kmo -n "$NS" >/dev/null 2>&1'
wait_for "the Secret is gone" '! kubectl get secret app-kmo -n "$NS" >/dev/null 2>&1'

[ "$FAILED" = "0" ] && echo "All checks passed." || { echo "At least one check failed."; exit 1; }
