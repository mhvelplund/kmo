#!/usr/bin/env -S usage bash
#USAGE about "End-to-end test of the rules that keep tenants apart"
#USAGE long_about #"""
#USAGE End-to-end test of the rules that keep tenants apart. It reads the two sample
#USAGE tenants, payments and partners, and adds one namespace of its own that tries
#USAGE to reach what belongs to others.
#USAGE """#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
NS=kmo-e2e-tenant
TENANT_FILE=s3://kmo-tenant/payments/ledger/config.env

stores_of() { kubectl get csync "$2" -n "$1" -o jsonpath='{.status.stores}' 2>/dev/null || true; }
keys_of() { kubectl get csync "$2" -n "$1" -o jsonpath='{.status.sources[*].key}' 2>/dev/null || true; }
# visitor <name> <spec>: creates a ConfigSync in the namespace of this suite.
visitor() {
  printf 'apiVersion: kmo.isntall.net/v1alpha1\nkind: ConfigSync\nmetadata: { name: %s, namespace: %s }\nspec: %s\n' \
    "$1" "$NS" "$2" | kubectl apply -f - >/dev/null
}

cleanup() { kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true; }

ensure_environment
trap cleanup EXIT
cleanup
kubectl wait --for=delete "namespace/$NS" --timeout=60s >/dev/null 2>&1 || true
kubectl create namespace "$NS" >/dev/null

echo "Check 1: a store in the namespace wins over the cluster-wide store of the same name"
wait_for "the ConfigSync of payments is ready" '[ "$(condition_of payments ledger Ready status)" = "True" ]'
check "it read the ConfigStore default, not the ClusterConfigStore default" \
  '[ "$(stores_of payments ledger)" = "[\"ConfigStore/default\"]" ]'
check "its values come from the bucket of the tenant" '[ "$(value_in payments ledger-kmo REGION)" = "eu-central-1" ]'
HANDLED=$(handled payments ledger)
store s3 cp "$TENANT_FILE" - | store s3 cp - "$TENANT_FILE" >/dev/null
wait_for "an event from the second bucket starts a sync of the tenant's ConfigSync" \
  '[ "$(handled payments ledger)" != "$HANDLED" ]' 30

echo "Check 2: two stores share a bucket, each under its own key prefix"
wait_for "the ConfigSync of partners is ready" '[ "$(condition_of partners portal Ready status)" = "True" ]'
check "its common value comes from its own common folder" '[ "$(value_in partners portal-kmo REGION)" = "partner-zone" ]'
check "every file it asked for is under the prefix of its store" \
  '[ "$(keys_of partners portal | tr " " "\n" | grep -vc "^partners-store/")" = "0" ]'

echo "Check 3: a ConfigSync reads only the folder of its own namespace"
visitor orders-api '{ sources: [{ storeRef: { kind: ClusterConfigStore, name: default } }] }'
wait_for "a ConfigSync named after a service of another namespace is ready" \
  '[ "$(condition_of "$NS" orders-api Ready status)" = "True" ]' 30
check "it has the common values" '[ -n "$(value_in "$NS" orders-api-kmo REGION)" ]'
check "it has none of the values of shop/orders-api" '[ -z "$(value_in "$NS" orders-api-kmo GREETING)" ]'
check "no file it asked for is in the folder of shop" '[[ " $(keys_of "$NS" orders-api)" != *" shop/"* ]]'
check "its Secret is empty" \
  '[ -z "$(kubectl get secret orders-api-kmo -n "$NS" -o jsonpath="{.data.DB_PASSWORD}" 2>/dev/null)" ]'

echo "Check 4: stores that do not allow the namespace"
visitor guest '{ sources: [{ storeRef: { kind: ClusterConfigStore, name: partners } }] }'
wait_for "a cluster-wide store that does not list the namespace is refused" \
  '[[ "$(condition_of "$NS" guest Ready message)" == *"does not allow namespace \"$NS\""* ]]' 30
check "nothing was written for it" '! kubectl get configmap guest-kmo -n "$NS" >/dev/null 2>&1'
visitor neighbour '{ sources: [{ storeRef: { kind: ConfigStore, name: default } }] }'
wait_for "the ConfigStore of another namespace cannot be named" \
  '[[ "$(condition_of "$NS" neighbour Ready message)" == *"was not found in namespace \"$NS\""* ]]' 30
check "a Warning Event says so" 'event_on "$NS" neighbour Warning StoreNotFound'

finish
