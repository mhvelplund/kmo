#!/usr/bin/env bash
# Proves a store without stored keys against a real AWS account, from the local cluster.
set -euo pipefail
: "${AWS_REGION:?set AWS_REGION}" "${KMO_OIDC_ISSUER:?set KMO_OIDC_ISSUER; see issuer.sh}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ISSUER_HOST=${KMO_OIDC_ISSUER#https://}
OIDC_BUCKET=${ISSUER_HOST%%.*}
CONFIG_BUCKET="kmo-aws-demo-$ACCOUNT-$AWS_REGION"
ROLE=kmo-aws-demo
PROVIDER_ARN="arn:aws:iam::$ACCOUNT:oidc-provider/$ISSUER_HOST"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

kubectl get --raw /.well-known/openid-configuration > "$TMP/discovery.json"
kubectl get --raw /openid/v1/jwks > "$TMP/jwks.json"
[ "$(jq -r .issuer "$TMP/discovery.json")" = "$KMO_OIDC_ISSUER" ] || {
  echo "The cluster does not sign tokens as $KMO_OIDC_ISSUER. Recreate it: mise run cluster:down && mise run cluster:up"
  exit 1
}

echo "1. Publish the cluster's public signing keys"
aws s3api put-public-access-block --bucket "$OIDC_BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false
aws s3api put-bucket-policy --bucket "$OIDC_BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{ \"Effect\": \"Allow\", \"Principal\": \"*\", \"Action\": \"s3:GetObject\",
                   \"Resource\": \"arn:aws:s3:::$OIDC_BUCKET/*\" }]}"
aws s3 cp "$TMP/discovery.json" "s3://$OIDC_BUCKET/.well-known/openid-configuration" --content-type application/json
aws s3 cp "$TMP/jwks.json" "s3://$OIDC_BUCKET/openid/v1/jwks" --content-type application/json

echo "2. Register the cluster in IAM"
aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" >/dev/null 2>&1 ||
  aws iam create-open-id-connect-provider --url "$KMO_OIDC_ISSUER" --client-id-list sts.amazonaws.com >/dev/null

echo "3. Create the private bucket with the env files"
if ! aws s3api head-bucket --bucket "$CONFIG_BUCKET" 2>/dev/null; then
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$CONFIG_BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$CONFIG_BUCKET" \
      --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
fi
aws s3api put-bucket-versioning --bucket "$CONFIG_BUCKET" --versioning-configuration Status=Enabled
printf 'GREETING=hello from a real S3 bucket, with no stored key\n' |
  aws s3 cp - "s3://$CONFIG_BUCKET/aws-demo/hello/config.env"
printf 'REGION=%s\n' "$AWS_REGION" | aws s3 cp - "s3://$CONFIG_BUCKET/_common/config.env"

echo "4. Create the role that trusts one ServiceAccount of this cluster"
cat > "$TMP/trust.json" <<EOF
{ "Version": "2012-10-17", "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "$PROVIDER_ARN" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": { "StringEquals": {
      "$ISSUER_HOST:sub": "system:serviceaccount:aws-demo:kmo-store",
      "$ISSUER_HOST:aud": "sts.amazonaws.com" } } }] }
EOF
cat > "$TMP/access.json" <<EOF
{ "Version": "2012-10-17", "Statement": [
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::$CONFIG_BUCKET" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion"],
      "Resource": "arn:aws:s3:::$CONFIG_BUCKET/*" }] }
EOF
aws iam get-role --role-name "$ROLE" >/dev/null 2>&1 ||
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document "file://$TMP/trust.json" >/dev/null
aws iam put-role-policy --role-name "$ROLE" --policy-name read-config --policy-document "file://$TMP/access.json"

echo "5. Create the demo namespace: a ServiceAccount, a store that names it, a ConfigSync and a workload"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata: { name: aws-demo }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kmo-store
  namespace: aws-demo
  annotations: { eks.amazonaws.com/role-arn: "arn:aws:iam::$ACCOUNT:role/$ROLE" }
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigStore
metadata: { name: default, namespace: aws-demo }
spec:
  s3:
    bucket: $CONFIG_BUCKET
    region: $AWS_REGION
    serviceAccountRef: { name: kmo-store }
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: hello, namespace: aws-demo }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: hello, namespace: aws-demo }
spec:
  replicas: 1
  selector: { matchLabels: { app: hello } }
  template:
    metadata: { labels: { app: hello } }
    spec:
      terminationGracePeriodSeconds: 2
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c", "env | grep -E '^(GREETING|REGION)=' | sort; while true; do sleep 3600; done"]
          envFrom:
            - configMapRef: { name: hello-kmo }
            - secretRef: { name: hello-kmo }
EOF
echo "Done. IAM can take up to a minute to accept the new role."
