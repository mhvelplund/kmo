#!/usr/bin/env -S usage bash
#USAGE about "End-to-end test of the Helm chart when ArgoCD installs it"
#USAGE long_about #"""
#USAGE End-to-end test of the Helm chart when ArgoCD installs it. It removes the
#USAGE release that Helm made, installs ArgoCD, and lets it install the chart from
#USAGE the local registry with the example application. At the end it removes
#USAGE ArgoCD and installs KMO with Helm again.
#USAGE """#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
NS=kmo-e2e-argocd
CHART=$ROOT/dist/chart/kmo
REGISTRY=kmo-registry.localhost:5000/charts
FILE=s3://kmo-config/shop/orders-api/config.env
KEPT=(crd/configsyncs.kmo.isntall.net crd/configstores.kmo.isntall.net crd/clusterconfigstores.kmo.isntall.net namespace/kmo-system)

app() { kubectl get application kmo -n argocd -o jsonpath="{$1}" 2>/dev/null || true; }
fingerprint() { kubectl get secret pepr-kmo-tls -n pepr-system -o jsonpath='{.data.tls\.crt}' | sha256sum; }
fresh_namespace() {
  kubectl delete namespace "$NS" --ignore-not-found >/dev/null 2>&1 || true
  kubectl create namespace "$NS" >/dev/null
}
restore() {
  echo "Restore: removing ArgoCD and installing KMO with Helm again"
  kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  [ -n "${ORIGINAL:-}" ] && printf '%s' "$ORIGINAL" | store s3 cp - "$FILE" >/dev/null 2>&1 || true
  kubectl delete application kmo -n argocd --ignore-not-found --timeout=180s >/dev/null 2>&1 || true
  kubectl delete -k "$ROOT/dev/argocd" --ignore-not-found >/dev/null 2>&1 || true
  kubectl delete namespace pepr-system --ignore-not-found >/dev/null 2>&1 || true
  # Helm takes over an object only when it carries the marks of the release.
  for object in "${KEPT[@]}"; do
    kubectl annotate --overwrite "$object" meta.helm.sh/release-name=kmo meta.helm.sh/release-namespace=pepr-system >/dev/null 2>&1 || true
    kubectl label --overwrite "$object" app.kubernetes.io/managed-by=Helm >/dev/null 2>&1 || true
  done
  mise -C "$ROOT" run kmo:deploy >/dev/null 2>&1 || echo "Restore failed. Run: mise run kmo:deploy"
}

ensure_environment
trap restore EXIT
VERSION=$(yq '.version' "$CHART/Chart.yaml")

echo "Setup: the chart in the local registry, and no KMO in the cluster"
quietly helm package "$CHART" --destination "$ROOT/dist"
quietly helm push "$ROOT/dist/kmo-$VERSION.tgz" oci://localhost:5111/charts --plain-http
quietly helm uninstall kmo --namespace pepr-system --wait
quietly kubectl delete namespace pepr-system

echo "Setup: ArgoCD"
quietly kubectl apply --server-side -k "$ROOT/dev/argocd"
quietly kubectl wait --for=condition=Available deployment --all -n argocd --timeout=300s
quietly kubectl rollout status statefulset/argocd-application-controller -n argocd --timeout=300s
kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: kmo-local-registry
  namespace: argocd
  labels: { argocd.argoproj.io/secret-type: repository }
stringData:
  type: helm
  name: kmo-local
  url: $REGISTRY
  enableOCI: "true"
  insecureOCIForceHttp: "true"
EOF

echo "Check 1: ArgoCD installs the chart with the example application"
REGISTRY=$REGISTRY VERSION=$VERSION VALUES=$ROOT/dev/kmo/values.yaml yq '
  .spec.source.repoURL = strenv(REGISTRY) |
  .spec.source.targetRevision = strenv(VERSION) |
  .spec.source.helm.valuesObject = load(strenv(VALUES)) |
  .metadata.finalizers = ["resources-finalizer.argocd.argoproj.io"] |
  .spec.syncPolicy.automated = {}
' "$ROOT/charts/argocd-application.yaml" | kubectl apply -f - >/dev/null 2>&1
wait_for "the application is synced" '[ "$(app .status.sync.status)" = "Synced" ]' 300
wait_for "the application is healthy" '[ "$(app .status.health.status)" = "Healthy" ]' 300
# The application is synced and healthy before the last phase, in which a Job fills in the webhook configuration.
wait_for "the sync is done, with its last phase" '[ "$(app .status.operationState.phase)" = "Succeeded" ]' 300
check "the operator and the receiver run" \
  'kubectl rollout status deployment/pepr-kmo-watcher -n pepr-system --timeout=120s >/dev/null && kubectl rollout status deployment/kmo-receiver -n kmo-system --timeout=120s >/dev/null'

echo "Check 2: the webhook answers with the key that the Job made"
fresh_namespace
check "a conflicting ConfigSync is refused" 'webhook_refuses "$NS"'

echo "Check 3: a changed file rolls a workload"
ORIGINAL=$(store s3 cp "$FILE" -)
STAMP=$(hash_on shop deployment orders-api)
MARK=argocd-$(date +%s)
printf '%s\nE2E_ARGOCD=%s\n' "$ORIGINAL" "$MARK" | store s3 cp - "$FILE" >/dev/null
wait_for "the new value is in the ConfigMap" '[ "$(value_in shop orders-api-kmo E2E_ARGOCD)" = "$MARK" ]' 60
wait_for "the workload has a new hash" '[ "$(hash_on shop deployment orders-api)" != "$STAMP" ]' 60

echo "Check 4: a second sync changes nothing"
BEFORE=$(fingerprint)
FINISHED=$(app .status.operationState.finishedAt)
kubectl patch application kmo -n argocd --type merge \
  -p '{"operation":{"initiatedBy":{"username":"e2e"},"sync":{"syncOptions":["RespectIgnoreDifferences=true"]}}}' >/dev/null
wait_for "the second sync is done" \
  '[ "$(app .status.operationState.finishedAt)" != "$FINISHED" ] && [ "$(app .status.operationState.phase)" = "Succeeded" ]' 300
check "the application is still synced" '[ "$(app .status.sync.status)" = "Synced" ]'
check "the certificate is the same" '[ "$(fingerprint)" = "$BEFORE" ]'
fresh_namespace
check "a conflicting ConfigSync is still refused" 'webhook_refuses "$NS"'

finish
