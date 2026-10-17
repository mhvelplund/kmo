output "token_secret_name" {
  description = "The secret in Secrets Manager that holds the receiver's token."
  value       = aws_secretsmanager_secret.token.name
}

output "dead_letter_queue_name" {
  description = "The queue that keeps the events that could not be delivered."
  value       = aws_sqs_queue.dead_letters.name
}

output "log_group_name" {
  description = "The log group that keeps each raw event."
  value       = aws_cloudwatch_log_group.events.name
}
