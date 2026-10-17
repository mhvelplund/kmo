output "cluster_name" {
  description = "The name of the cluster."
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "The address of the API server."
  value       = module.eks.cluster_endpoint
}

output "cluster_certificate_authority_data" {
  description = "The authority of the API server's certificate, in base64."
  value       = module.eks.cluster_certificate_authority_data
}

output "oidc_provider" {
  description = "The cluster's issuer, without https://."
  value       = module.eks.oidc_provider
}

output "oidc_provider_arn" {
  description = "The OIDC provider in IAM that trusts the cluster's issuer."
  value       = module.eks.oidc_provider_arn
}

output "node_security_group_id" {
  description = "The security group of the nodes, and so of the pods."
  value       = module.eks.node_security_group_id
}

output "lb_controller_role_arn" {
  description = "The role of the AWS Load Balancer Controller."
  value       = module.lb_controller_role.arn
}

output "external_secrets_role_arn" {
  description = "The role of External Secrets Operator, which may read the secrets of the demo."
  value       = aws_iam_role.external_secrets.arn
}
