#!/usr/bin/env bash
# Removes everything that issuer.sh and setup.sh created, in the cluster and in AWS.
set -euo pipefail
: "${AWS_REGION:?set AWS_REGION}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
OIDC_BUCKET="kmo-oidc-$ACCOUNT-$AWS_REGION"
CONFIG_BUCKET="kmo-aws-demo-$ACCOUNT-$AWS_REGION"
ROLE=kmo-aws-demo
PROVIDER_ARN="arn:aws:iam::$ACCOUNT:oidc-provider/$OIDC_BUCKET.s3.$AWS_REGION.amazonaws.com"

kubectl delete namespace aws-demo --ignore-not-found
aws iam delete-role-policy --role-name "$ROLE" --policy-name read-config 2>/dev/null || true
aws iam delete-role --role-name "$ROLE" 2>/dev/null || true
aws iam delete-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" 2>/dev/null || true
aws s3 rm "s3://$OIDC_BUCKET" --recursive 2>/dev/null || true
aws s3api delete-bucket --bucket "$OIDC_BUCKET" 2>/dev/null || true
for kind in Versions DeleteMarkers; do
  aws s3api list-object-versions --bucket "$CONFIG_BUCKET" --query "$kind[].[Key,VersionId]" --output text 2>/dev/null |
    while read -r key version; do
      [ "$key" = "None" ] ||
        aws s3api delete-object --bucket "$CONFIG_BUCKET" --key "$key" --version-id "$version" >/dev/null
    done
done
aws s3api delete-bucket --bucket "$CONFIG_BUCKET" 2>/dev/null || true
echo "Removed. Take KMO_OIDC_ISSUER out of mise.local.toml and recreate the cluster to return to the default issuer."
