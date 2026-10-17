include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules//ingress"
}

dependency "network" {
  config_path = "../network"
  mock_outputs = {
    vpc_id          = "vpc-00000000000000000"
    private_subnets = ["subnet-00000000000000000", "subnet-11111111111111111"]
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

dependency "eks" {
  config_path                             = "../eks"
  mock_outputs                            = { node_security_group_id = "sg-00000000000000000" }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

inputs = {
  vpc_id                 = dependency.network.outputs.vpc_id
  subnet_ids             = dependency.network.outputs.private_subnets
  node_security_group_id = dependency.eks.outputs.node_security_group_id
}
