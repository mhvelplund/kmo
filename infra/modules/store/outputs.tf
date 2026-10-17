output "bucket" {
  description = "The config bucket."
  value       = aws_s3_bucket.config.id
}

output "bucket_arn" {
  description = "The ARN of the config bucket."
  value       = aws_s3_bucket.config.arn
}

output "store_role_arn" {
  description = "The role that the ServiceAccount aws-demo/kmo-store may use."
  value       = aws_iam_role.store.arn
}
