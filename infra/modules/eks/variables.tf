variable "name" {
  description = "The prefix of every name, and the name of the cluster."
  type        = string
}

variable "vpc_id" {
  description = "The VPC of the cluster."
  type        = string
}

variable "subnet_ids" {
  description = "The private subnets for the nodes and the control plane."
  type        = list(string)
}
