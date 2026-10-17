include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules//store"
}

dependency "eks" {
  config_path = "../eks"
  mock_outputs = {
    oidc_provider     = "oidc.eks.example.invalid/id/MOCK"
    oidc_provider_arn = "arn:aws:iam::111122223333:oidc-provider/oidc.eks.example.invalid/id/MOCK"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  oidc_provider     = dependency.eks.outputs.oidc_provider
  oidc_provider_arn = dependency.eks.outputs.oidc_provider_arn
}
