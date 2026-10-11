#!/usr/bin/env -S usage bash
#USAGE about "End-to-end smoke test of the operator and the receiver on the local cluster"
#USAGE long_about #"""
#USAGE End-to-end smoke test of the operator and the receiver on the local cluster.
#USAGE It needs Docker. It creates the cluster and installs the local environment
#USAGE when they are missing, and always installs the operator and the receiver from
#USAGE the working tree. It uses its own namespace, store and files, and removes them
#USAGE when it ends.
#USAGE """#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
NS=kmo-smoke
OVERLAY=smoke-overlay
LATE=smoke-late
CLOSED=smoke-closed
HASH='{.spec.template.metadata.annotations.kmo\.isntall\.net/config-hash}'

request_sync() {
  kubectl annotate csync app -n "$NS" kmo.isntall.net/sync-requested-at="$(date -u +%FT%T.%3NZ)" --overwrite >/dev/null
}
set_sources() { kubectl patch csync app -n "$NS" --type merge -p "{\"spec\":{\"sources\":$1}}" >/dev/null; }

config() { kubectl get configmap app-kmo -n "$NS" -o jsonpath="{.data.$1}" 2>/dev/null || true; }
config_data() { kubectl get configmap app-kmo -n "$NS" -o jsonpath='{.data}' 2>/dev/null || true; }
config_meta() { kubectl get configmap app-kmo -n "$NS" -o jsonpath="$1" 2>/dev/null || true; }
secret() { kubectl get secret app-kmo -n "$NS" -o jsonpath="{.data.$1}" 2>/dev/null | base64 -d 2>/dev/null || true; }
stamp() { kubectl get deployment "${1:-app}" -n "$NS" -o jsonpath="$HASH" 2>/dev/null || true; }
pod_env() { kubectl exec -n "$NS" deployment/app -- printenv "$1" 2>/dev/null || true; }
pods() { kubectl get pods -n "$NS" -l app=smoke -o name 2>/dev/null | sort; }
one_pod() { [ "$(pods | wc -l)" = "1" ] && kubectl rollout status deployment/app -n "$NS" --timeout=1s >/dev/null 2>&1; }
# rolled_from <hash>: true when the Deployment has another hash than the given one and its rollout is finished.
rolled_from() { [ -n "$(stamp)" ] && [ "$(stamp)" != "$1" ] && one_pod; }
# condition <ConfigSync> <type> <field>: one field of one condition in the status.
condition() {
  kubectl get csync "$1" -n "$NS" -o jsonpath="{.status.conditions[?(@.type==\"$2\")].$3}" 2>/dev/null || true
}
status() { kubectl get csync app -n "$NS" -o jsonpath="{.status.$1}" 2>/dev/null || true; }
# has_event <ConfigSync> <type> <reason>: true when such an Event is recorded on the ConfigSync.
has_event() {
  local selector="involvedObject.kind=ConfigSync,involvedObject.name=$1,type=$2,reason=$3"
  [ -n "$(kubectl get events -n "$NS" --field-selector "$selector" -o name 2>/dev/null)" ]
}
reconciles() {
  kubectl logs -n pepr-system "$WATCHER" --since=10m | grep "KMO reconciled" | grep -c "\"namespace\":\"$NS\"" || true
}
# receiver_saw <key> <time>: true when the receiver logged an event for the file after that time.
receiver_saw() {
  kubectl logs -n kmo-system deployment/kmo-receiver --since-time="$2" 2>/dev/null | grep -q "\"$BUCKET/$1\""
}
store_ready() {
  kubectl get clusterconfigstore "$1" -o jsonpath="{.status.conditions[?(@.type==\"Ready\")].$2}" 2>/dev/null || true
}
# refused <spec> <message>: true when a ConfigSync named second with that spec is denied with that message.
refused() {
  local output
  output=$(printf 'apiVersion: kmo.isntall.net/v1alpha1\nkind: ConfigSync\nmetadata: { name: second, namespace: %s }\nspec: %s\n' \
    "$NS" "$1" | kubectl apply -f - 2>&1) && return 1
  [[ "$output" == *"$2"* ]]
}
cleanup() {
  kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  kubectl delete clusterconfigstore "$OVERLAY" "$LATE" "$CLOSED" --ignore-not-found >/dev/null 2>&1 || true
  store s3 rm --recursive "s3://$BUCKET/$NS/" >/dev/null 2>&1 || true
  store s3 rm --recursive "s3://$BUCKET/$OVERLAY/" >/dev/null 2>&1 || true
}

ensure_environment
trap cleanup EXIT
cleanup
kubectl wait --for=delete "namespace/$NS" --timeout=60s >/dev/null 2>&1 || true

echo "Setup: a service with its files, its ConfigSync and its Deployment"
STARTED=$(date -u +%FT%TZ)
put "$NS/app/config.env" 'GREETING=one\nLOG_LEVEL=debug\n'
put "$NS/app/secrets.env" 'PASSWORD=pässwörd\n'
# A late event of these uploads would start a reconcile that Check 3 counts.
wait_for "the receiver saw the uploads" 'receiver_saw "$NS/app/secrets.env" "$STARTED"' 30
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
[ "$FAILED" = "0" ] || {
  echo "The operator writes nothing, so the other checks cannot pass. Stopping."
  exit 1
}
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
[ "$FAILED" = "0" ] || {
  echo "The workload did not get its values, so the other checks cannot pass. Stopping."
  exit 1
}

echo "Check 3: the ConfigSync reports what happened"
wait_for "the ConfigSync is ready" '[ "$(condition app Ready status)" = "True" ]'
check "it found source files and its target is wired" \
  '[ "$(condition app SourcesFound status)$(condition app TargetsWired status)" = "TrueTrue" ]'
check "the status names the store and the hash on the workload" \
  '[ "$(status stores)" = "[\"ClusterConfigStore/default\"]" ] && [ "$(status configHash)" = "$(stamp)" ]'
check "the status lists the four files that were asked for" '[ "$(status "sources[*].key" | wc -w)" = "4" ]'
COUNT=$(reconciles)
sleep 10
check "the status update started no further reconcile" '[ "$(reconciles)" = "$COUNT" ]'

echo "Check 4: a changed file rolls the workload, with no request by hand"
BEFORE=$(stamp)
put "$NS/app/config.env" 'GREETING=two\nLOG_LEVEL=debug\n'
wait_for "the hash changed" '[ -n "$(stamp)" ] && [ "$(stamp)" != "$BEFORE" ]'
wait_for "the new pod runs with the new value" '[ "$(pod_env GREETING)" = "two" ]' 120

echo "Check 5: a changed file with the same effective values replaces no pod"
wait_for "the rollout is finished" one_pod 120
BEFORE=$(stamp)
PODS=$(pods)
COUNT=$(reconciles)
put "$NS/app/config.env" '# a comment only\nGREETING=two\nLOG_LEVEL=debug\n'
sleep 10
check "the hash is the same" '[ "$(stamp)" = "$BEFORE" ]'
check "no pod was replaced" '[ "$(pods)" = "$PODS" ]'
check "one changed file started one reconcile" '[ "$(reconciles)" = "$((COUNT + 1))" ]'

echo "Check 6: a hand edit to an output is undone at once, with no request"
kubectl patch configmap app-kmo -n "$NS" --type merge -p '{"data":{"GREETING":"edited","EXTRA":"by hand"}}' >/dev/null
wait_for "the changed value is put back" '[ "$(config GREETING)" = "two" ]' 20
check "the key added by hand is removed" '[ -z "$(config EXTRA)" ]'
kubectl delete secret app-kmo -n "$NS" >/dev/null
wait_for "a deleted Secret is written again" '[ "$(secret PASSWORD)" = "pässwörd" ]' 20

echo "Check 7: a second source wins over the first, and can leave out its common files"
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

echo "Check 8: a failure writes nothing, and is reported"
wait_for "the workload rolled to the new values" 'rolled_from "$BEFORE"' 120
DATA=$(config_data)
BEFORE=$(stamp)
put "$NS/app/config.env" 'this line is not an assignment\n'
wait_for "the ConfigSync is not ready, with the reason" '[ "$(condition app Ready reason)" = "SourceUnparsable" ]'
check "the message names the file and the line" '[[ "$(condition app Ready message)" == *"config, line 1:"* ]]'
check "a Warning Event is recorded" 'has_event app Warning SourceUnparsable'
check "an unparsable file leaves the ConfigMap as it was" '[ "$(config_data)" = "$DATA" ]'
set_sources "[$FIRST,$SECOND,\"common\":false},{\"storeRef\":{\"kind\":\"ClusterConfigStore\",\"name\":\"$LATE\"}}]"
wait_for "a missing store is the new reason" '[ "$(condition app Ready reason)" = "StoreNotFound" ]'
put "$NS/app/config.env" 'GREETING=two\nLOG_LEVEL=changed\n'
sleep 8
check "a missing store leaves the ConfigMap as it was, also for the stores that exist" '[ "$(config_data)" = "$DATA" ]'
check "the hash is the same" '[ "$(stamp)" = "$BEFORE" ]'
kubectl apply -f - >/dev/null <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ClusterConfigStore
metadata: { name: $LATE }
spec:
  s3:
    bucket: $BUCKET
    keyPrefix: $LATE
    region: us-east-1
    endpoint: http://rustfs.kmo-dev.svc:9000
    addressingStyle: Path
    credentialsSecretRef: { name: kmo-config-credentials, namespace: kmo-system }
  allowedNamespaces: [$NS]
EOF
wait_for "the ConfigSync syncs, with no request, when the store appears" '[ "$(config LOG_LEVEL)" = "changed" ]' 20
wait_for "it is ready again" '[ "$(condition app Ready status)" = "True" ]'
check "a Normal Event says so" 'has_event app Normal Synced'

echo "Check 9: warnings, and a spec that the rules refuse"
kubectl apply -f - >/dev/null <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: nobody, namespace: $NS }
spec:
  sources:
    - storeRef: { kind: ClusterConfigStore, name: default }
      common: false
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: hasty, namespace: $NS }
spec: { refreshInterval: 30s }
EOF
wait_for "a ConfigSync without files and without a workload is ready" '[ "$(condition nobody Ready status)" = "True" ]'
check "it warns that no source file holds values" '[ "$(condition nobody SourcesFound reason)" = "NoSources" ]'
check "it warns that its target does not exist" '[[ "$(condition nobody TargetsWired message)" == *"does not exist" ]]'
check "each warning is an Event" 'has_event nobody Warning NoSources && has_event nobody Warning NotWired'
wait_for "a refresh interval below one minute is refused" '[ "$(condition hasty Ready reason)" = "InvalidSpec" ]'
check "the other ConfigSyncs stay ready" '[ "$(condition app Ready status)" = "True" ]'
kubectl create deployment nobody -n "$NS" --image=busybox:1.37.0 -- sh -c 'sleep 3600' >/dev/null
wait_for "a workload created after its ConfigSync gets the hash" '[ "$(stamp nobody | wc -c)" = "64" ]' 20
wait_for "and the warning about the target is gone" '[ "$(condition nobody TargetsWired status)" = "True" ]' 20

echo "Check 10: a suspended ConfigSync is left alone"
kubectl patch csync app -n "$NS" --type merge -p '{"spec":{"suspend":true}}' >/dev/null
wait_for "the ConfigSync says that it is suspended" '[ "$(condition app Suspended status)" = "True" ]' 20
check "an Event records it" 'has_event app Normal Suspended'
VALUE=$(config GREETING)
kubectl patch configmap app-kmo -n "$NS" --type merge -p '{"data":{"GREETING":"edited"}}' >/dev/null
request_sync
sleep 10
check "a hand edit stays, also after a request for a sync" '[ "$(config GREETING)" = "edited" ]'
kubectl patch csync app -n "$NS" --type merge -p '{"spec":{"suspend":false}}' >/dev/null
wait_for "the edit is undone when syncing is resumed" '[ "$(config GREETING)" = "$VALUE" ]' 20
check "an Event records that too" 'has_event app Normal Resumed'

echo "Check 11: a ConfigSync that conflicts with another is refused"
check "a target that another ConfigSync has" \
  'refused "{ targets: [{ name: app }] }" "Deployment \"app\" is already a target of ConfigSync \"app\""'
check "an output name that another ConfigSync has" \
  'refused "{ targets: [{ name: free }], output: { secretName: app-kmo } }" "Secret \"app-kmo\" is already an output"'
kubectl patch csync app -n "$NS" --type merge -p '{"spec":{"suspend":true}}' >/dev/null
check "also when the other one is suspended" 'refused "{ targets: [{ name: app }] }" "is already a target"'
kubectl patch csync app -n "$NS" --type merge -p '{"spec":{"suspend":false}}' >/dev/null
check "nothing was stored" '! kubectl get csync second -n "$NS" >/dev/null 2>&1'
wait_for "the operator's own sync requests pass the check" '[ "$(condition app Suspended status)" = "False" ]' 20

echo "Check 12: stores report whether they can be reached, and keep namespaces apart"
check "a store whose bucket can be reached is ready" '[ "$(store_ready "$OVERLAY" status)" = "True" ]'
kubectl apply -f - >/dev/null <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ClusterConfigStore
metadata: { name: $CLOSED }
spec:
  s3:
    bucket: $BUCKET
    region: us-east-1
    endpoint: http://rustfs.kmo-dev.svc:9000
    addressingStyle: Path
    credentialsSecretRef: { name: smoke-no-such-secret, namespace: kmo-system }
  allowedNamespaces: [some-other-namespace]
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: intruder, namespace: $NS }
spec:
  sources:
    - storeRef: { kind: ClusterConfigStore, name: $CLOSED }
EOF
wait_for "a store without its credentials is not ready, and says why" \
  '[[ "$(store_ready "$CLOSED" message)" == "Secret kmo-system/smoke-no-such-secret was not found" ]]' 20
wait_for "a namespace that a store does not allow is refused" \
  '[[ "$(condition intruder Ready message)" == *"does not allow namespace"* ]]' 20
kubectl create serviceaccount no-role -n "$NS" >/dev/null
kubectl apply -f - >/dev/null <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigStore
metadata: { name: keyless, namespace: $NS }
spec: { s3: { bucket: anything, region: us-east-1, serviceAccountRef: { name: no-role } } }
EOF
wait_for "a store whose ServiceAccount names no role is not ready, and says why" \
  '[[ "$(kubectl get cstore keyless -n "$NS" -o jsonpath="{.status.conditions[0].message}")" == *"has no annotation"* ]]' 20
check "a ConfigSync cannot name a key" 'refused "{ source: { secrets: shop/orders-api/secrets.env } }" "unknown field"'
check "a cluster-wide store must keep each namespace in its own folder" \
  '! kubectl patch clusterconfigstore "$CLOSED" --type merge -p "{\"spec\":{\"s3\":{\"serviceFolder\":\"{name}\"}}}" >/dev/null 2>&1'

echo "Check 13: a restart of the operator replaces no pod"
wait_for "the workload rolled to the new values" 'rolled_from "$BEFORE"' 120
PODS=$(pods)
HANDLED=$(status lastHandledSyncRequest)
kubectl rollout restart -n pepr-system "$WATCHER" deployment/pepr-kmo >/dev/null
kubectl rollout status -n pepr-system "$WATCHER" --timeout=180s >/dev/null
wait_for "the operator syncs once when it starts, also while the admission pods start" \
  '[ "$(status lastHandledSyncRequest)" != "$HANDLED" ]' 90
sleep 15
check "no pod was replaced" '[ "$(pods)" = "$PODS" ]'
check "the operator did not crash" '[ "$(watcher_restarts)" = "0" ]'

echo "Check 14: deleting the ConfigSync deletes its objects"
kubectl delete csync app -n "$NS" >/dev/null
wait_for "the ConfigMap is gone" '! kubectl get configmap app-kmo -n "$NS" >/dev/null 2>&1'
wait_for "the Secret is gone" '! kubectl get secret app-kmo -n "$NS" >/dev/null 2>&1'

finish
