#!/usr/bin/env -S usage bash
#USAGE about "Creates the bucket for the cluster's public signing keys and prints the issuer address"
set -euo pipefail
: "${AWS_REGION:?set AWS_REGION}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="kmo-oidc-$ACCOUNT-$AWS_REGION"

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" \
      --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
fi
echo "Put this in mise.local.toml under [env], then run: mise run cluster:down && mise run cluster:up"
echo "KMO_OIDC_ISSUER = \"https://$BUCKET.s3.$AWS_REGION.amazonaws.com\""
