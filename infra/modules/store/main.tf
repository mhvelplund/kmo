data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "config" {
  bucket        = "${var.name}-config-${data.aws_caller_identity.current.account_id}-${var.region}"
  force_destroy = true
}

resource "aws_s3_bucket_versioning" "config" {
  bucket = aws_s3_bucket.config.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "config" {
  bucket                  = aws_s3_bucket.config.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_notification" "config" {
  bucket      = aws_s3_bucket.config.id
  eventbridge = true
}

resource "aws_s3_object" "service" {
  bucket  = aws_s3_bucket.config.id
  key     = "aws-demo/hello/config.env"
  content = "GREETING=hello from EKS, with no stored key\n"

  lifecycle {
    ignore_changes = [content]
  }
}

resource "aws_s3_object" "common" {
  bucket  = aws_s3_bucket.config.id
  key     = "_common/config.env"
  content = "REGION=${var.region}\n"

  lifecycle {
    ignore_changes = [content]
  }
}

data "aws_iam_policy_document" "store_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider}:sub"
      values   = ["system:serviceaccount:aws-demo:kmo-store"]
    }
    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "store_access" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.config.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${aws_s3_bucket.config.arn}/*"]
  }
}

resource "aws_iam_role" "store" {
  name               = "${var.name}-store"
  assume_role_policy = data.aws_iam_policy_document.store_trust.json
}

resource "aws_iam_role_policy" "store" {
  name   = "read-config"
  role   = aws_iam_role.store.id
  policy = data.aws_iam_policy_document.store_access.json
}
