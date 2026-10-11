#!/usr/bin/env -S usage bash
#USAGE about "Proves the guarded Rollout watch on the local cluster"
#USAGE long_about #"""
#USAGE Proves the guarded Rollout watch on the local cluster. Run it again after
#USAGE every Pepr upgrade.
#USAGE """#
set -euo pipefail

ROOT=$(dirname "${BASH_SOURCE[0]}")/../..
NS=pepr-system
WATCHER=deployment/pepr-kmo-watcher

logs() { kubectl logs -n "$NS" "$WATCHER" --since="$1" 2>/dev/null || true; }
restarts() {
  kubectl get pods -n "$NS" -l pepr.dev/controller=watcher \
    -o jsonpath='{range .items[*]}{.status.containerStatuses[0].restartCount}{"\n"}{end}' | sort -n | tail -1
}
restart_watcher() {
  kubectl rollout restart -n "$NS" "$WATCHER" >/dev/null
  kubectl rollout status -n "$NS" "$WATCHER" --timeout=180s >/dev/null
}
remove_rollouts() {
  kubectl delete -k "$ROOT/dev/argo-rollouts" --ignore-not-found --wait=true >/dev/null
  kubectl wait --for=delete crd/rollouts.argoproj.io --timeout=120s >/dev/null 2>&1 || true
}
install_rollouts() {
  kubectl apply --server-side -k "$ROOT/dev/argo-rollouts" >/dev/null
  kubectl wait --for=condition=Established crd/rollouts.argoproj.io --timeout=60s >/dev/null
  kubectl apply -f "$ROOT/dev/workloads/checkout.yaml" >/dev/null
}
pass() { echo "PASS  $1"; }
fail() {
  echo "FAIL  $1"
  FAILED=1
}
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
FAILED=0

echo "Check 1: without the Rollout kind the watcher stays up and the schedule ticks"
remove_rollouts
restart_watcher
sleep 150
check "the watcher did not restart" '[ "$(restarts)" = "0" ]'
check "the schedule ticked at least twice" '[ "$(logs 150s | grep -c "KMO tick")" -ge 2 ]'
check "no Rollout watch was started" '! logs 150s | grep -q "KMO guarded watch started"'

echo "Check 2: the watch starts when Argo Rollouts is installed"
install_rollouts
sleep 30
check "the guarded watch started" 'logs 60s | grep -q "KMO guarded watch started"'
# From Task 8 on, the watch asks for a sync instead of logging that it saw the Rollout.
check "the Rollout checkout was seen" 'logs 60s | grep -E "KMO saw rollout|Rollout changed" | grep -q checkout'
check "the watcher did not restart" '[ "$(restarts)" = "0" ]'

echo "Check 3: the watch stops when Argo Rollouts is removed"
remove_rollouts
sleep 90
check "the guarded watch stopped" 'logs 120s | grep -q "KMO guarded watch stopped"'
check "the watcher did not restart" '[ "$(restarts)" = "0" ]'
check "the schedule still ticks" '[ "$(logs 90s | grep -c "KMO tick")" -ge 1 ]'

echo "Check 4: with the setting off, the plain Pepr behavior returns"
kubectl set env -n "$NS" "$WATCHER" KMO_GUARD_ROLLOUT_WATCH=false >/dev/null
kubectl rollout status -n "$NS" "$WATCHER" --timeout=60s >/dev/null 2>&1 || true
sleep 90
check "the watcher gave up on the missing kind" \
  '[ "$(restarts)" -ge 1 ] || logs 120s | grep -q "WatchEvent GiveUp Error"'

echo "Restore: setting on, Argo Rollouts and the sample Rollout back"
kubectl set env -n "$NS" "$WATCHER" KMO_GUARD_ROLLOUT_WATCH=true >/dev/null
install_rollouts
kubectl rollout status -n "$NS" "$WATCHER" --timeout=180s >/dev/null

if [ "$FAILED" = "0" ]; then echo "All checks passed."; else
  echo "At least one check failed."
  exit 1
fi
