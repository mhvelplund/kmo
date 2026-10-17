variable "region" {
  description = "The region of the demo."
  type        = string
}

variable "cluster_name" {
  description = "The name of the cluster."
  type        = string
}

variable "cluster_endpoint" {
  description = "The address of the API server."
  type        = string
}

variable "cluster_certificate_authority_data" {
  description = "The authority of the API server's certificate, in base64."
  type        = string
}

variable "vpc_id" {
  description = "The VPC of the cluster."
  type        = string
}

variable "lb_controller_role_arn" {
  description = "The role of the AWS Load Balancer Controller."
  type        = string
}

variable "external_secrets_role_arn" {
  description = "The role of External Secrets Operator."
  type        = string
}

variable "repo_url" {
  description = "The HTTPS address of this repository, which ArgoCD reads."
  type        = string
}

variable "revision" {
  description = "The pushed branch or tag that ArgoCD reads."
  type        = string
}
