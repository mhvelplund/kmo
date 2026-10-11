#!/usr/bin/env -S usage bash
#USAGE about "End-to-end test of the five workload kinds"
#USAGE long_about #"""
#USAGE End-to-end test of the five workload kinds: one ConfigSync stamps and rolls
#USAGE one workload of each kind. Then the two warnings about wiring that the smoke
#USAGE suite does not cover. It needs Argo Rollouts.
#USAGE """#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
NS=kmo-e2e-kinds
# The kind as kubectl names it, and the name of the workload of that kind.
WORKLOADS=("deployment web" "statefulset db" "daemonset agent" "cronjob report" "rollout canary")

# pod_template <app>: the pod template of a sample workload, indented for a workload's spec.
pod_template() {
  cat <<EOF
  template:
    metadata: { labels: { app: $1 } }
    spec:
      terminationGracePeriodSeconds: 1
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c", "while true; do sleep 3600; done"]
          envFrom: [{ configMapRef: { name: app-kmo } }]
EOF
}
# all_stamped <hash>: true when every workload carries the hash on its pod template.
all_stamped() {
  local workload
  for workload in "${WORKLOADS[@]}"; do
    # shellcheck disable=SC2086
    [ "$(hash_on "$NS" $workload)" = "$1" ] || return 1
  done
}
status_hash() { kubectl get csync app -n "$NS" -o jsonpath='{.status.configHash}' 2>/dev/null || true; }

cleanup() {
  kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  store s3 rm --recursive "s3://$BUCKET/$NS/" >/dev/null 2>&1 || true
}

ensure_environment
trap cleanup EXIT
cleanup
kubectl wait --for=delete "namespace/$NS" --timeout=90s >/dev/null 2>&1 || true

echo "Setup: one ConfigSync with a workload of each kind as its targets"
put "$NS/app/config.env" 'COLOR=green\n'
put "$NS/loose/config.env" 'UNUSED=yes\n'
{
  cat <<EOF
apiVersion: v1
kind: Namespace
metadata: { name: $NS }
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: app, namespace: $NS }
spec:
  sources: [{ storeRef: { kind: ClusterConfigStore, name: default }, common: false }]
  targets:
    - { kind: Deployment, name: web }
    - { kind: StatefulSet, name: db }
    - { kind: DaemonSet, name: agent }
    - { kind: CronJob, name: report }
    - { kind: Rollout, name: canary }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: web, namespace: $NS }
spec:
  replicas: 2
  selector: { matchLabels: { app: web } }
$(pod_template web)
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: db, namespace: $NS }
spec:
  serviceName: db
  replicas: 1
  selector: { matchLabels: { app: db } }
$(pod_template db)
---
apiVersion: apps/v1
kind: DaemonSet
metadata: { name: agent, namespace: $NS }
spec:
  selector: { matchLabels: { app: agent } }
$(pod_template agent)
---
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: canary, namespace: $NS }
spec:
  replicas: 2
  strategy: { canary: {} }
  selector: { matchLabels: { app: canary } }
$(pod_template canary)
---
apiVersion: batch/v1
kind: CronJob
metadata: { name: report, namespace: $NS }
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        metadata: { labels: { app: report } }
        spec:
          restartPolicy: Never
          containers:
            - name: app
              image: busybox:1.37.0
              command: ["sh", "-c", "echo \$COLOR"]
              envFrom: [{ configMapRef: { name: app-kmo } }]
EOF
} | kubectl apply -f - >/dev/null

echo "Check 1: every kind gets the same hash"
wait_for "the ConfigSync is ready" '[ "$(condition_of "$NS" app Ready status)" = "True" ]'
[ "$FAILED" = "0" ] || {
  echo "Nothing was synced, so the other checks cannot pass. Stopping."
  exit 1
}
wait_for "all five workloads carry the hash of the status" 'all_stamped "$(status_hash)"' 30
wait_for "every target is wired, though none uses the empty Secret" \
  '[ "$(condition_of "$NS" app TargetsWired status)" = "True" ]' 30
for app in web db agent canary; do
  wait_for "the pods of $app run on that hash" "pods_on $NS $app \"\$(status_hash)\"" 180
done

echo "Check 2: a changed value rolls every kind"
BEFORE=$(status_hash)
put "$NS/app/config.env" 'COLOR=blue\n'
wait_for "the hash of the status changed" '[ -n "$(status_hash)" ] && [ "$(status_hash)" != "$BEFORE" ]' 30
wait_for "all five workloads carry the new hash" 'all_stamped "$(status_hash)"' 30
for app in web db agent canary; do
  wait_for "the pods of $app were replaced" "pods_on $NS $app \"\$(status_hash)\"" 180
done
check "a pod of the Deployment has the new value" \
  '[ "$(kubectl exec -n "$NS" deployment/web -- printenv COLOR 2>/dev/null)" = "blue" ]'
check "the pod of the StatefulSet has the new value" \
  '[ "$(kubectl exec -n "$NS" db-0 -- printenv COLOR 2>/dev/null)" = "blue" ]'
kubectl create job once -n "$NS" --from=cronjob/report >/dev/null
check "a run of the CronJob records the config that it used" \
  '[ "$(hash_on "$NS" job once)" = "$(status_hash)" ]'
wait_for "and prints the new value" '[ "$(kubectl logs -n "$NS" job/once 2>/dev/null)" = "blue" ]' 60

echo "Check 3: a Rollout that takes its pod template from a Deployment"
kubectl apply -f - >/dev/null <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: borrower, namespace: $NS }
spec:
  replicas: 0
  strategy: { canary: {} }
  workloadRef: { apiVersion: apps/v1, kind: Deployment, name: web }
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: borrower, namespace: $NS }
spec:
  targets: [{ kind: Rollout, name: borrower }]
EOF
wait_for "the ConfigSync warns, and says which target to name" \
  '[[ "$(condition_of "$NS" borrower TargetsWired message)" == *"takes its pod template from a Deployment"* ]]' 30
check "it is still ready" '[ "$(condition_of "$NS" borrower Ready status)" = "True" ]'
check "the warning is an Event" 'event_on "$NS" borrower Warning NotWired'

echo "Check 4: an output that holds values and that the target does not use"
{
  cat <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: loose, namespace: $NS }
---
EOF
  deployment "$NS" loose
} | kubectl apply -f - >/dev/null
wait_for "the ConfigSync warns, and names the ConfigMap" \
  '[[ "$(condition_of "$NS" loose TargetsWired message)" == *"does not use ConfigMap \"loose-kmo\""* ]]' 30
check "the workload is stamped all the same" '[ "$(hash_on "$NS" deployment loose | wc -c)" = "64" ]'
check "the warning is an Event" 'event_on "$NS" loose Warning NotWired'

finish
