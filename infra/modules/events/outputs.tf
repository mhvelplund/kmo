output "token_secret_name" {
  description = "The secret in Secrets Manager that holds the receiver's token."
  value       = aws_secretsmanager_secret.token.name
}
