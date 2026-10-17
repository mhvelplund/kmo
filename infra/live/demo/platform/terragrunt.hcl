include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules//platform"
}

dependency "network" {
  config_path                             = "../network"
  mock_outputs                            = { vpc_id = "vpc-00000000000000000" }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
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
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "store" {
  config_path = "../store"
  mock_outputs = {
    bucket         = "mock-bucket"
    store_role_arn = "arn:aws:iam::111122223333:role/mock"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "events" {
  config_path                             = "../events"
  mock_outputs                            = { token_secret_name = "kmo-demo/receiver-token" }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "ingress" {
  config_path = "../ingress"
  mock_outputs = {
    target_group_arn = "arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/mock/0000000000000000"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  cluster_name                       = dependency.eks.outputs.cluster_name
  cluster_endpoint                   = dependency.eks.outputs.cluster_endpoint
  cluster_certificate_authority_data = dependency.eks.outputs.cluster_certificate_authority_data
  vpc_id                             = dependency.network.outputs.vpc_id
  lb_controller_role_arn             = dependency.eks.outputs.lb_controller_role_arn
  external_secrets_role_arn          = dependency.eks.outputs.external_secrets_role_arn
  bucket                             = dependency.store.outputs.bucket
  store_role_arn                     = dependency.store.outputs.store_role_arn
  token_secret_name                  = dependency.events.outputs.token_secret_name
  target_group_arn                   = dependency.ingress.outputs.target_group_arn
  repo_url                           = get_env("KMO_REPO_URL")
  revision                           = get_env("KMO_DEMO_REVISION", "main")
}
