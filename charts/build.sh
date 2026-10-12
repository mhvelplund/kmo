#!/usr/bin/env -S usage bash
#USAGE about "Builds the Helm chart of KMO into dist/chart/kmo"
#USAGE long_about #"""
#USAGE Builds the Helm chart of KMO into dist/chart/kmo. It runs pepr build, takes
#USAGE the chart that Pepr generates, removes the webhook's key and address from
#USAGE it, and adds the definitions and the hand-written parts of charts/kmo. It
#USAGE stops when the output of Pepr is not what it expects, and when the result
#USAGE holds a private key or the address.
#USAGE """#
#USAGE flag "--image-registry <registry>" help="The registry and path in front of the two image names" default="kmo-registry.localhost:5111"
set -euo pipefail

ROOT=$(dirname "${BASH_SOURCE[0]}")/..
SOURCE=$ROOT/charts/kmo
PEPR=$ROOT/packages/operator/dist/kmo-chart
OUT=$ROOT/dist/chart/kmo
MAX_BYTES=700000

stop() {
  echo "charts/build.sh: $1" >&2
  exit 1
}

rm -rf "$PEPR"
npm run build --workspace @kmo/operator --prefix "$ROOT" >/dev/null

for file in tls-secret api-path-secret namespace validation-webhook; do
  [ -f "$PEPR/templates/$file.yaml" ] || stop "Pepr did not generate templates/$file.yaml. Its chart has changed."
done
ADDRESS=$(yq '.secrets.apiPath' "$PEPR/values.yaml")
[ "$ADDRESS" != "null" ] || stop "Pepr's values.yaml has no secrets.apiPath. Its chart has changed."

rm -rf "$OUT"
mkdir -p "$OUT/templates"
cp "$PEPR"/templates/*.yaml "$OUT/templates/"
rm "$OUT/templates/tls-secret.yaml" "$OUT/templates/api-path-secret.yaml" "$OUT/templates/namespace.yaml"

# Drops the two block values that are tied to one build, with the lines that continue them.
awk '
  skip && match($0, /^ */) && RLENGTH > indent { next }
  { skip = 0 }
  /^ *(caBundle|path): >-$/ { match($0, /^ */); indent = RLENGTH; skip = 1; removed++; next }
  { print }
  END { if (removed != 2) exit 1 }
' "$PEPR/templates/validation-webhook.yaml" >"$OUT/templates/validation-webhook.yaml" ||
  stop "templates/validation-webhook.yaml does not hold one caBundle and one path. Pepr's chart has changed."

yq eval-all 'select(fileIndex == 0) * select(fileIndex == 1) | del(.secrets)' \
  "$PEPR/values.yaml" "$SOURCE/values.yaml" |
  REGISTRY=${usage_image_registry:?} yq '.receiver.image.repository = strenv(REGISTRY) + "/kmo-receiver" |
    .certgen.image.repository = strenv(REGISTRY) + "/kmo-certgen"' >"$OUT/values.yaml"

for crd in "$ROOT"/crds/*.yaml; do
  grep -q '{{' "$crd" && stop "$(basename "$crd") holds {{, which Helm reads as a template."
  {
    echo '{{- if .Values.crds.install }}'
    yq '.metadata.annotations."helm.sh/resource-policy" = "keep" |
      .metadata.annotations."argocd.argoproj.io/sync-options" = "Delete=false"' "$crd"
    echo '{{- end }}'
  } >"$OUT/templates/crd-$(basename "$crd")"
done

cp "$SOURCE/Chart.yaml" "$OUT/"
cp "$SOURCE"/templates/* "$OUT/templates/"

if grep -rq 'PRIVATE KEY' "$OUT"; then stop "The built chart holds a private key."; fi
if grep -rqF -e "$ADDRESS" -e "$(echo "$ADDRESS" | base64 -d)" "$OUT"; then stop "The built chart holds the address."; fi
if grep -q 'caBundle' "$OUT/templates/validation-webhook.yaml"; then stop "The webhook template still holds a caBundle."; fi
helm lint "$OUT" --namespace pepr-system >/dev/null || stop "helm lint failed. Run: helm lint dist/chart/kmo --namespace pepr-system"
# A release holds the chart and the rendered objects, compressed and then in base64, in one Secret of 1 MiB.
BYTES=$(($(helm template kmo "$OUT" --namespace pepr-system | gzip | wc -c) + $(tar -czf - -C "$OUT" . | wc -c)))
[ "$BYTES" -le "$MAX_BYTES" ] || stop "The chart and its rendered objects are $BYTES bytes compressed. A Helm release holds about 780000."

echo "Built dist/chart/kmo, version $(yq '.version' "$OUT/Chart.yaml"), $BYTES bytes compressed"
