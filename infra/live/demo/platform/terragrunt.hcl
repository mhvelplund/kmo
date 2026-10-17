include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules//platform"
}

dependency "network" {
  config_path                             = "../network"
  mock_outputs                            = { vpc_id = "vpc-00000000000000000" }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

dependency "eks" {
  config_path = "../eks"
  mock_outputs = {
    cluster_name                       = "kmo-demo"
    cluster_endpoint                   = "https://example.invalid"
    cluster_certificate_authority_data = "bW9jaw=="
    lb_controller_role_arn             = "arn:aws:iam::111122223333:role/mock"
    external_secrets_role_arn          = "arn:aws:iam::111122223333:role/mock"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

inputs = {
  cluster_name                       = dependency.eks.outputs.cluster_name
  cluster_endpoint                   = dependency.eks.outputs.cluster_endpoint
  cluster_certificate_authority_data = dependency.eks.outputs.cluster_certificate_authority_data
  vpc_id                             = dependency.network.outputs.vpc_id
  lb_controller_role_arn             = dependency.eks.outputs.lb_controller_role_arn
  external_secrets_role_arn          = dependency.eks.outputs.external_secrets_role_arn
  repo_url                           = get_env("KMO_REPO_URL")
  revision                           = get_env("KMO_DEMO_REVISION", "main")
}
