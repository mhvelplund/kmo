provider "helm" {
  kubernetes = {
    host                   = var.cluster_endpoint
    cluster_ca_certificate = base64decode(var.cluster_certificate_authority_data)
    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", var.cluster_name, "--region", var.region]
    }
  }
}

locals {
  repo_parts = regex("github\\.com[/:]([^/]+)/([^/]+?)(?:\\.git)?/?$", var.repo_url)
  owner      = lower(local.repo_parts[0])
  repo_url   = "https://github.com/${local.repo_parts[0]}/${local.repo_parts[1]}.git"

  application_health = <<-EOT
    hs = {}
    hs.status = "Progressing"
    hs.message = ""
    if obj.status ~= nil and obj.status.health ~= nil then
      hs.status = obj.status.health.status
      if obj.status.health.message ~= nil then
        hs.message = obj.status.health.message
      end
    end
    return hs
  EOT

  root_values = {
    repoURL        = local.repo_url
    revision       = var.revision
    owner          = local.owner
    region         = var.region
    clusterName    = var.cluster_name
    vpcId          = var.vpc_id
    bucket         = var.bucket
    tokenSecret    = var.token_secret_name
    targetGroupArn = var.target_group_arn
    roles = {
      lbController    = var.lb_controller_role_arn
      externalSecrets = var.external_secrets_role_arn
      store           = var.store_role_arn
    }
  }

  root_application = {
    namespace = "argocd"
    project   = "default"
    source = {
      repoURL        = local.repo_url
      targetRevision = var.revision
      path           = "infra/argocd/root"
      helm           = { valuesObject = local.root_values }
    }
    destination = { server = "https://kubernetes.default.svc", namespace = "argocd" }
    syncPolicy = {
      automated = { prune = true, selfHeal = true }
      retry     = { limit = 10, backoff = { duration = "10s", factor = 2, maxDuration = "3m" } }
    }
  }
}

resource "helm_release" "argocd" {
  name             = "argocd"
  namespace        = "argocd"
  create_namespace = true
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = "10.9.6"
  wait             = true

  values = [yamlencode({
    dex           = { enabled = false }
    notifications = { enabled = false }
    configs = {
      cm = {
        "resource.customizations.health.argoproj.io_Application" = local.application_health
      }
      params = {
        "controller.sync.timeout.seconds" = 300
      }
      repositories = {
        kmo-charts = {
          name      = "kmo-charts"
          type      = "helm"
          url       = "ghcr.io/${local.owner}/charts"
          enableOCI = "true"
        }
      }
    }
  })]
}

resource "helm_release" "root" {
  name       = "root"
  namespace  = "argocd"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argocd-apps"
  version    = "2.0.6"

  values = [yamlencode({ applications = { root = local.root_application } })]

  depends_on = [helm_release.argocd]
}
