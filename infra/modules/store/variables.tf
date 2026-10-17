variable "name" {
  description = "The prefix of every name."
  type        = string
}

variable "region" {
  description = "The region of the demo."
  type        = string
}

variable "oidc_provider" {
  description = "The cluster's issuer, without https://."
  type        = string
}

variable "oidc_provider_arn" {
  description = "The OIDC provider in IAM that trusts the cluster's issuer."
  type        = string
}
