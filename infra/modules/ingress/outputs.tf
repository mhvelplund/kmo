output "api_endpoint" {
  description = "The public HTTPS address of the API."
  value       = aws_apigatewayv2_api.events.api_endpoint
}

output "target_group_arn" {
  description = "The target group that the TargetGroupBinding fills with the receiver's pods."
  value       = aws_lb_target_group.receiver.arn
}
