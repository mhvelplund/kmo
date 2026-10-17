locals {
  region  = get_env("AWS_REGION")
  account = get_aws_account_id()
}

remote_state {
  backend = "s3"
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    bucket       = "kmo-demo-tfstate-${local.account}-${local.region}"
    key          = "${path_relative_to_include()}/terraform.tfstate"
    region       = local.region
    encrypt      = true
    use_lockfile = true
  }
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<-EOF
    provider "aws" {
      region = "${local.region}"
      default_tags {
        tags = { Project = "kmo-demo" }
      }
    }
  EOF
}

inputs = {
  name   = "kmo-demo"
  region = local.region
}
