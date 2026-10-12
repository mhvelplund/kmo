#!/usr/bin/env -S usage bash
#USAGE about "Changes one value in the local store and shows what KMO does with it, step by step"
set -euo pipefail

HERE=$(dirname "${BASH_SOURCE[0]}")
FILE=s3://kmo-config/shop/orders-api/config.env
HASH='{.spec.template.metadata.annotations.kmo\.isntall\.net/config-hash}'

store() {
  AWS_CONFIG_FILE="$HERE/aws-config" AWS_PROFILE=default AWS_ACCESS_KEY_ID=kmoadmin \
    AWS_SECRET_ACCESS_KEY=kmo-local-secret aws "$@"
}
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
stamp() { kubectl get deployment orders-api -n shop -o jsonpath="$HASH"; }
newest_pod() { kubectl get pods -n shop -l app=orders-api --sort-by=.metadata.creationTimestamp -o name | tail -1; }
greeting() { kubectl logs -n shop "$(newest_pod)" 2>/dev/null | grep '^GREETING=' || true; }

if ! kubectl get deployment kmo-receiver -n kmo-system >/dev/null 2>&1; then
  echo "The local environment is not complete. Run these first, in order:"
  echo "  mise run cluster:up && mise run kmo:deploy && mise run deploy"
  exit 1
fi

GREETING="hello at $(date +%T)"
BEFORE=$(stamp)

say "1. The value that a pod of orders-api runs with now"
greeting

say "2. Change GREETING in $FILE to: $GREETING"
CONTENT=$(store s3 cp "$FILE" -)
printf '%s\n' "$CONTENT" | sed "s|^GREETING=.*|GREETING=$GREETING|" | store s3 cp - "$FILE" >/dev/null
echo "The file is changed. Nothing else is done by hand from here on."

say "3. The store tells the receiver, and the receiver asks for a sync"
for _ in $(seq 1 15); do
  [ "$(stamp)" != "$BEFORE" ] && break
  sleep 2
done
kubectl logs -n kmo-system deployment/kmo-receiver --since=1m | grep "handled an event" | tail -1

say "4. The operator writes the ConfigMap and puts a new hash on the pod template"
echo "ConfigMap orders-api-kmo: GREETING=$(kubectl get configmap orders-api-kmo -n shop -o jsonpath='{.data.GREETING}')"
echo "config hash before: $BEFORE"
echo "config hash now:    $(stamp)"
if [ "$(stamp)" = "$BEFORE" ]; then
  echo "The hash did not change. Look at: kubectl describe csync orders-api -n shop"
  exit 1
fi

say "5. Kubernetes sees a changed pod template and replaces the pods"
kubectl rollout status deployment/orders-api -n shop --timeout=120s

say "6. The value that a new pod runs with"
greeting

say "7. What the ConfigSync reports"
kubectl get csync orders-api -n shop
kubectl get events -n shop --field-selector involvedObject.kind=ConfigSync,involvedObject.name=orders-api 2>/dev/null | tail -3

printf '\nRun it again to see another change. mise run deploy puts the sample files back.\n'
