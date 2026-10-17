module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "21.26.0"

  name               = var.name
  kubernetes_version = "1.36"
  vpc_id             = var.vpc_id
  subnet_ids         = var.subnet_ids

  endpoint_public_access                   = true
  enable_cluster_creator_admin_permissions = true

  enabled_log_types           = []
  create_cloudwatch_log_group = false

  addons = {
    coredns    = {}
    kube-proxy = {}
    vpc-cni    = { before_compute = true }
  }

  eks_managed_node_groups = {
    default = {
      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = ["t3.medium"]
      min_size       = 2
      max_size       = 2
      desired_size   = 2
    }
  }

  node_security_group_additional_rules = {
    kmo_webhook = {
      description                   = "The API server calls the admission webhook of KMO"
      protocol                      = "tcp"
      from_port                     = 3000
      to_port                       = 3000
      type                          = "ingress"
      source_cluster_security_group = true
    }
  }
}
