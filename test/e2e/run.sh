#!/usr/bin/env -S usage bash
#USAGE about "Runs the end-to-end suites on the local cluster, one after the other"
#USAGE long_about #"""
#USAGE Runs the end-to-end suites on the local cluster, one after the other. With
#USAGE arguments, runs only the suites named. rollout-guard is last, because it
#USAGE removes and reinstalls Argo Rollouts and restarts the operator.
#USAGE """#
#USAGE arg "[suite]..." help="The suites to run, in this order; all six when none is named" {
#USAGE   choices "smoke" "events" "kinds" "failures" "tenants" "rollout-guard"
#USAGE }
set -uo pipefail

HERE=$(dirname "${BASH_SOURCE[0]}")
source "$HERE/lib.sh"
read -ra SUITES <<<"${usage_suite:-smoke events kinds failures tenants rollout-guard}"

ensure_environment
RESULT=0
SUMMARY=()
for suite in "${SUITES[@]}"; do
  printf '\n=== %s\n' "$suite"
  started=$SECONDS
  if KMO_E2E_READY=1 "$HERE/$suite.sh"; then
    SUMMARY+=("PASS  $suite ($((SECONDS - started)) s)")
  else
    SUMMARY+=("FAIL  $suite ($((SECONDS - started)) s)")
    RESULT=1
  fi
done
printf '\n=== summary\n'
printf '%s\n' "${SUMMARY[@]}"
exit "$RESULT"
