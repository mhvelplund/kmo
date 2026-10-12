#!/usr/bin/env -S usage bash
#USAGE about "End-to-end test of the Helm chart through the life of a release"
#USAGE long_about #"""
#USAGE End-to-end test of the Helm chart through the life of a release: an upgrade
#USAGE keeps the webhook's key, the renewal changes it with no gap, an uninstall keeps the definitions and the store
#USAGE credentials, and a new installation makes a new key. It uninstalls KMO and
#USAGE installs it again.
#USAGE """#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
NS=kmo-e2e-chart
CHART=$ROOT/dist/chart/kmo

fingerprint() { kubectl get secret pepr-kmo-tls -n pepr-system -o jsonpath='{.data.tls\.crt}' | sha256sum; }
# authority_matches: true when the webhook configuration holds the authority of the Secret.
authority_matches() {
  local path='{.webhooks[0].clientConfig.caBundle}'
  [ -n "$(kubectl get validatingwebhookconfiguration pepr-kmo -o jsonpath="$path")" ] &&
    [ "$(kubectl get validatingwebhookconfiguration pepr-kmo -o jsonpath="$path")" = \
      "$(kubectl get secret pepr-kmo-tls -n pepr-system -o jsonpath='{.data.ca\.crt}')" ]
}
hook_objects() {
  kubectl get job,serviceaccount,role,rolebinding -n pepr-system -o name | grep -E 'certgen-(create|patch)' || true
  kubectl get clusterrole,clusterrolebinding -o name | grep -E 'certgen-(create|patch)' || true
}
# renew <name>: runs the renewal once, now, and waits for its end.
renew() {
  quietly kubectl create job "$1" --from=cronjob/kmo-certgen-renew -n pepr-system
  quietly kubectl wait --for=condition=Complete "job/$1" -n pepr-system --timeout=300s
}
# stale_pods: the pods of the webhook that are older than the Secret with the key.
stale_pods() {
  local issued
  issued=$(kubectl get secret pepr-kmo-tls -n pepr-system -o jsonpath='{.metadata.creationTimestamp}')
  kubectl get pods -n pepr-system -l pepr.dev/controller=admission \
    -o jsonpath='{range .items[*]}{.metadata.creationTimestamp}{"\n"}{end}' | awk -v issued="$issued" '$1 < issued'
}
fresh_namespace() {
  kubectl delete namespace "$NS" --ignore-not-found >/dev/null 2>&1 || true
  kubectl create namespace "$NS" >/dev/null
}
cleanup() { kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true; }

ensure_environment
trap cleanup EXIT

echo "Check 1: the built chart holds nothing that is tied to one build"
check "no private key is in it" '! grep -rq "PRIVATE KEY" "$CHART"'
check "the webhook template names no authority" '! grep -q caBundle "$CHART/templates/validation-webhook.yaml"'

echo "Check 2: the installation made a key, and the webhook answers with it"
fresh_namespace
check "the webhook configuration holds the authority of the Secret" 'authority_matches'
check "a conflicting ConfigSync is refused" 'webhook_refuses "$NS"'
check "the Jobs left no object and no right behind" '[ -z "$(hook_objects)" ]'

echo "Check 3: an upgrade keeps the key"
BEFORE=$(fingerprint)
quietly helm upgrade kmo "$CHART" --namespace pepr-system --values "$ROOT/dev/kmo/values.yaml"
check "the certificate is the same" '[ "$(fingerprint)" = "$BEFORE" ]'
check "the webhook configuration still holds its authority" 'authority_matches'
fresh_namespace
check "a conflicting ConfigSync is still refused" 'webhook_refuses "$NS"'

echo "Check 4: the renewal changes the certificate while the webhook keeps answering"
renew renew-early
check "a certificate with more than 30 days left is not changed" '[ "$(fingerprint)" = "$BEFORE" ]'
quietly helm upgrade kmo "$CHART" --namespace pepr-system --values "$ROOT/dev/kmo/values.yaml" --set certgen.renewBeforeDays=3650
FAILURES=$(mktemp)
STOP=$(mktemp -u)
# Each annotation is an update of a ConfigSync, which the API server sends to the webhook.
while [ ! -e "$STOP" ]; do
  kubectl annotate --overwrite csync first -n "$NS" "kmo.isntall.net/e2e-probe=$(date +%s%N)" >/dev/null 2>&1 || echo x >>"$FAILURES"
  sleep 0.5
done &
renew renew-now
touch "$STOP"
wait
rm -f "$STOP"
check "the certificate is new" '[ "$(fingerprint)" != "$BEFORE" ]'
check "the API server trusts the old and the new authority" \
  '[ "$(kubectl get secret pepr-kmo-tls -n pepr-system -o jsonpath="{.data.ca\.crt}" | base64 -d | grep -c BEGIN)" = "2" ] && authority_matches'
check "every pod of the webhook runs the new certificate" '[ -z "$(stale_pods)" ]'
# One call can meet a pod at the moment it stops; more than that means that the webhook was not trusted.
check "the webhook answered during the renewal" '[ "$(wc -l <"$FAILURES")" -le 1 ]'
check "a conflicting ConfigSync is refused with the new certificate" 'webhook_refuses "$NS"'
quietly helm upgrade kmo "$CHART" --namespace pepr-system --values "$ROOT/dev/kmo/values.yaml"
RENEWED=$(fingerprint)
renew renew-again
check "a second run changes nothing" '[ "$(fingerprint)" = "$RENEWED" ]'
kubectl delete job renew-early renew-now renew-again -n pepr-system >/dev/null 2>&1 || true
BEFORE=$RENEWED

echo "Check 5: an uninstall keeps what the chart must not delete"
quietly helm uninstall kmo --namespace pepr-system --wait
check "the three definitions are still there" \
  'kubectl get crd configsyncs.kmo.isntall.net configstores.kmo.isntall.net clusterconfigstores.kmo.isntall.net >/dev/null 2>&1'
check "the ConfigSyncs are still there" 'kubectl get csync orders-api -n shop >/dev/null 2>&1'
check "the namespace kmo-system and the store credentials in it are still there" \
  '[ "$(kubectl get secrets -n kmo-system -o name | wc -l)" -ge 2 ]'
check "the operator and the receiver are gone" \
  '! kubectl get deployment pepr-kmo -n pepr-system >/dev/null 2>&1 && ! kubectl get deployment kmo-receiver -n kmo-system >/dev/null 2>&1'

echo "Check 6: a new installation makes a new key"
quietly kubectl delete namespace pepr-system
quietly mise -C "$ROOT" run kmo:deploy
check "the certificate is different" '[ "$(fingerprint)" != "$BEFORE" ]'
check "the webhook configuration holds the new authority" 'authority_matches'
fresh_namespace
check "a conflicting ConfigSync is refused with the new key" 'webhook_refuses "$NS"'
wait_for "the ConfigSyncs that were kept are ready again" '[ "$(condition_of shop orders-api Ready status)" = "True" ]' 120

finish
