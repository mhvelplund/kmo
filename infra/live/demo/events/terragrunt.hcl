include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/modules//events"
}

dependency "store" {
  config_path                             = "../store"
  mock_outputs                            = { bucket = "mock-bucket" }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

dependency "ingress" {
  config_path                             = "../ingress"
  mock_outputs                            = { api_endpoint = "https://example.invalid" }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan"]
}

inputs = {
  bucket       = dependency.store.outputs.bucket
  api_endpoint = dependency.ingress.outputs.api_endpoint
}
