#!/usr/bin/env -S usage bash
#USAGE about "Checks the demo on AWS: a changed file in S3 rolls a workload in EKS through EventBridge"
#USAGE long_about #"""
#USAGE Checks the demo that aws:up made. It writes files in the config bucket and
#USAGE changes nothing else in AWS, so it can run many times on one cluster. It
#USAGE needs AWS_REGION, and KUBECONFIG for the cluster of the demo.
#USAGE """#
set -uo pipefail
: "${AWS_REGION:?set AWS_REGION}"

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

NS=aws-demo
SERVICE_KEY=$NS/hello/config.env
PROBE_KEY="probe/a b+c.env"
LOG_GROUP=/aws/events/kmo-demo

synced() {
  [ "$(kubectl get application "$1" -n argocd -o jsonpath='{.status.sync.status}/{.status.health.status}' 2>/dev/null)" = "Synced/Healthy" ]
}
all_synced() {
  local app
  for app in root aws-load-balancer-controller external-secrets kmo-secrets kmo demo; do synced "$app" || return 1; done
}
store_field() { kubectl get configstore default -n "$NS" -o jsonpath="{$1}" 2>/dev/null || true; }
store_ready() {
  [ "$(kubectl get configstore default -n "$NS" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = True ]
}
greeting_in_bucket() { aws s3 cp "s3://$BUCKET/$SERVICE_KEY" - 2>/dev/null | sed -n 's/^GREETING=//p'; }
greeting_in_pod() { kubectl exec -n "$NS" deployment/hello -- printenv GREETING 2>/dev/null || true; }
# received <key>: true when the receiver logged an event for the key since START.
received() { kubectl logs -n kmo-system deployment/kmo-receiver --since-time="$START" 2>/dev/null | grep -F 'handled an event' | grep -F "\"$BUCKET/$1\"" >/dev/null; }
rolled_to() {
  local hash
  hash=$(hash_on "$NS" deployment hello)
  [ "$hash" != "$2" ] && [ "$(value_in "$NS" hello-kmo GREETING)" = "$1" ] && pods_on "$NS" hello "$hash" &&
    [ "$(greeting_in_pod)" = "$1" ]
}
target_healthy() {
  [ "$(aws elbv2 describe-target-health --target-group-arn "$TARGET_GROUP" \
    --query "TargetHealthDescriptions[?Target.Id=='$1'].TargetHealth.State" --output text 2>/dev/null)" = "healthy" ]
}
# change <value> <description>: writes GREETING=<value> and waits for hello to roll to it.
change() {
  local before
  before=$(hash_on "$NS" deployment hello)
  START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf 'GREETING=%s\n' "$1" | aws s3 cp - "s3://$BUCKET/$SERVICE_KEY" >/dev/null
  wait_for "$2" "rolled_to '$1' '$before'" 60
}
logged_key() {
  aws logs filter-log-events --log-group-name "$LOG_GROUP" --start-time "$SINCE" --output json \
    --query 'events[].message' 2>/dev/null | jq -r '.[] | fromjson | .detail.object.key' | grep -Fx "$PROBE_KEY" >/dev/null
}
# dead_letters: the number of messages in the dead-letter queue, visible or not.
dead_letters() {
  local url
  url=$(aws sqs get-queue-url --queue-name kmo-demo-dead-letters --query QueueUrl --output text)
  aws sqs get-queue-attributes --queue-url "$url" \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
    --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible]' --output text |
    awk '{print $1 + $2}'
}
refreshed() { [ -z "$(kubectl get application demo -n argocd -o jsonpath='{.metadata.annotations.argocd\.argoproj\.io/refresh}' 2>/dev/null)" ]; }
cleanup() {
  kubectl delete namespace kmo-webhook-check --ignore-not-found --wait=false >/dev/null 2>&1
  [ -n "${BUCKET:-}" ] && aws s3 rm "s3://$BUCKET/$PROBE_KEY" >/dev/null 2>&1
}
trap cleanup EXIT

wait_for "every ArgoCD Application is Synced and Healthy" all_synced 300
BUCKET=$(store_field .spec.s3.bucket)
TARGET_GROUP=$(kubectl get targetgroupbinding kmo-receiver -n kmo-system -o jsonpath='{.spec.targetGroupARN}')

check "the store names a ServiceAccount and no Secret" \
  '[ "$(store_field .spec.s3.serviceAccountRef.name)" = kmo-store ] && [ -z "$(store_field .spec.s3.credentialsSecretRef)" ]'
check "the store is Ready" store_ready
check "hello runs with the value in the bucket" \
  '[ "$(greeting_in_pod)" = "$(greeting_in_bucket)" ] && pods_on "$NS" hello "$(hash_on "$NS" deployment hello)"'

kubectl create namespace kmo-webhook-check >/dev/null
check "the webhook refuses a second ConfigSync on the same target" "webhook_refuses kmo-webhook-check"
kubectl delete namespace kmo-webhook-check --ignore-not-found --wait=false >/dev/null
DEAD_BEFORE=$(dead_letters)

change "hello at $(date +%s)" "a changed file rolls hello within 60 seconds, which only an event explains"
check "the receiver logged the event" "received '$SERVICE_KEY'"

HASH=$(hash_on "$NS" deployment hello)
kubectl annotate application demo -n argocd argocd.argoproj.io/refresh=hard --overwrite >/dev/null
wait_for "ArgoCD finishes a hard refresh of the demo" refreshed 120
check "after the roll, the demo is still Synced and the hash stays" \
  'synced demo && [ "$(hash_on "$NS" deployment hello)" = "$HASH" ]'

OLD_POD=$(kubectl get pods -n kmo-system -l app=kmo-receiver -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod "$OLD_POD" -n kmo-system --wait=true >/dev/null
new_pod() {
  kubectl get pods -n kmo-system -l app=kmo-receiver -o json |
    jq -r --arg old "$OLD_POD" '.items[] | select(.metadata.name != $old and .metadata.deletionTimestamp == null and
      any(.status.conditions[]?; .type == "Ready" and .status == "True")) | .status.podIP' | head -1
}
wait_for "a new receiver pod is Ready" '[ -n "$(new_pod)" ]' 120
NEW_IP=$(new_pod)
wait_for "the NLB sends to the new receiver pod" "target_healthy '$NEW_IP'" 120
change "hello again at $(date +%s)" "after the receiver pod is replaced, a change still rolls hello"

SINCE=$(($(date +%s) * 1000))
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf 'X=1\n' | aws s3 cp - "s3://$BUCKET/$PROBE_KEY" >/dev/null
wait_for "a key with a space and a plus sign arrives in EventBridge as it was written" logged_key 120
wait_for "the receiver logged that key as it was written" "received '$PROBE_KEY'" 60
aws s3 rm "s3://$BUCKET/$PROBE_KEY" >/dev/null

sleep 60
check "no event of this run went to the dead-letter queue" '[ "$(dead_letters)" -le "$DEAD_BEFORE" ]'

finish
