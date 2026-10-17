variable "name" {
  description = "The prefix of every name."
  type        = string
}

variable "vpc_id" {
  description = "The VPC of the cluster."
  type        = string
}

variable "subnet_ids" {
  description = "The private subnets for the NLB and the VPC link."
  type        = list(string)
}

variable "node_security_group_id" {
  description = "The security group of the nodes, and so of the receiver's pods."
  type        = string
}
