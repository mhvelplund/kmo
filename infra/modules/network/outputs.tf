output "vpc_id" {
  description = "The VPC."
  value       = module.vpc.vpc_id
}

output "vpc_cidr_block" {
  description = "The address range of the VPC."
  value       = module.vpc.vpc_cidr_block
}

output "private_subnets" {
  description = "The private subnets, one in each of two zones."
  value       = module.vpc.private_subnets
}
