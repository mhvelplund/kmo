# shellcheck shell=bash
# Helpers shared by the end-to-end suites.
ROOT=$(dirname "${BASH_SOURCE[0]}")/../..
CLUSTER=kmo
BUCKET=${BUCKET:-kmo-config}
WATCHER=deployment/pepr-kmo-watcher
FAILED=0

pass() { echo "PASS  $1"; }
fail() {
  echo "FAIL  $1"
  FAILED=1
}
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
# wait_for <description> <condition> [seconds]: passes as soon as the condition holds.
wait_for() {
  local end=$((SECONDS + ${3:-60}))
  until eval "$2"; do
    if [ "$SECONDS" -ge "$end" ]; then
      fail "$1"
      return
    fi
    sleep 2
  done
  pass "$1"
}
# quietly <command...>: runs a setup command, and shows its output only when it fails.
quietly() {
  local output
  output=$("$@" 2>&1) || {
    echo "$output" | tail -30
    echo "Setup failed: $*"
    exit 1
  }
}
finish() {
  if [ "$FAILED" = "0" ]; then echo "All checks passed."; else
    echo "At least one check failed."
    exit 1
  fi
}

store() {
  AWS_CONFIG_FILE="$ROOT/dev/aws-config" AWS_PROFILE=default AWS_ACCESS_KEY_ID=kmoadmin \
    AWS_SECRET_ACCESS_KEY=kmo-local-secret aws "$@"
}
# put <key> <content>: writes a file to the bucket named in BUCKET.
put() { printf '%b' "$2" | store s3 cp - "s3://$BUCKET/$1" >/dev/null; }

# value_in <namespace> <ConfigMap> <key>: one value of a ConfigMap.
value_in() { kubectl get configmap "$2" -n "$1" -o jsonpath="{.data.$3}" 2>/dev/null || true; }
# condition_of <namespace> <ConfigSync> <type> <field>: one field of one condition in the status.
condition_of() {
  kubectl get csync "$2" -n "$1" -o jsonpath="{.status.conditions[?(@.type==\"$3\")].$4}" 2>/dev/null || true
}
# event_on <namespace> <ConfigSync> <type> <reason>: true when such an Event is recorded on the ConfigSync.
event_on() {
  local selector="involvedObject.kind=ConfigSync,involvedObject.name=$2,type=$3,reason=$4"
  [ -n "$(kubectl get events -n "$1" --field-selector "$selector" -o name 2>/dev/null)" ]
}
# handled <namespace> <ConfigSync>: the sync request that the last reconcile handled.
handled() { kubectl get csync "$2" -n "$1" -o jsonpath='{.status.lastHandledSyncRequest}' 2>/dev/null || true; }
# hash_on <namespace> <kind> <name>: the config hash on the pod template of a workload.
hash_on() {
  local template='.spec.template'
  [ "$2" = "cronjob" ] && template='.spec.jobTemplate.spec.template'
  kubectl get "$2" "$3" -n "$1" \
    -o jsonpath="{$template.metadata.annotations.kmo\.isntall\.net/config-hash}" 2>/dev/null || true
}
# pods_on <namespace> <app> <hash>: true when the app has pods and every one of them carries the hash.
pods_on() {
  local hashes
  hashes=$(kubectl get pods -n "$1" -l "app=$2" \
    -o jsonpath='{range .items[*]}{.metadata.annotations.kmo\.isntall\.net/config-hash}{"\n"}{end}' 2>/dev/null | sort -u)
  [ -n "$3" ] && [ "$hashes" = "$3" ]
}
watcher_restarts() {
  kubectl get pods -n pepr-system -l pepr.dev/controller=watcher \
    -o jsonpath='{range .items[*]}{.status.containerStatuses[0].restartCount}{"\n"}{end}' | sort -n | tail -1
}
# webhook_refuses <namespace>: true when the admission webhook refuses a second ConfigSync on the same target.
webhook_refuses() {
  local sync='apiVersion: kmo.isntall.net/v1alpha1\nkind: ConfigSync\nmetadata: { name: %s, namespace: %s }\nspec: { targets: [{ name: app }] }\n'
  local output
  # shellcheck disable=SC2059
  printf "$sync" first "$1" | kubectl apply -f - >/dev/null 2>&1 || return 1
  # shellcheck disable=SC2059
  output=$(printf "$sync" second "$1" | kubectl apply -f - 2>&1) && return 1
  [[ "$output" == *"is already a target"* ]]
}

# deployment <namespace> <name> [ConfigMap]: prints a one-pod Deployment, which reads the ConfigMap when one is named.
deployment() {
  local env_from=""
  [ -n "${3:-}" ] && env_from="          envFrom: [{ configMapRef: { name: $3 } }]"
  cat <<EOF
apiVersion: apps/v1
kind: Deployment
metadata: { name: $2, namespace: $1 }
spec:
  replicas: 1
  selector: { matchLabels: { app: $2 } }
  template:
    metadata: { labels: { app: $2 } }
    spec:
      terminationGracePeriodSeconds: 1
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c", "while true; do sleep 3600; done"]
$env_from
EOF
}

# ensure_environment: the cluster, the local environment, and the operator and receiver of the working tree.
# The runner does this once and sets KMO_E2E_READY for the suites it starts.
ensure_environment() {
  [ "${KMO_E2E_READY:-}" = "1" ] && return
  timeout 10 docker info >/dev/null 2>&1 || {
    echo "Docker is not available. Start Docker and run the test again."
    exit 1
  }
  if ! k3d cluster list "$CLUSTER" >/dev/null 2>&1; then
    echo "Setup: the cluster $CLUSTER is missing; creating it"
    quietly mise -C "$ROOT" run cluster:up
  elif ! kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
    echo "Setup: the cluster $CLUSTER is stopped; starting it"
    quietly k3d cluster start "$CLUSTER"
    quietly kubectl wait --for=condition=Ready nodes --all --timeout=120s
  fi
  echo "Setup: installing KMO from the working tree, with the chart"
  quietly mise -C "$ROOT" run kmo:deploy
  if ! kubectl get clusterconfigstore default >/dev/null 2>&1; then
    echo "Setup: installing the local environment"
    quietly mise -C "$ROOT" run deploy
  fi
}
