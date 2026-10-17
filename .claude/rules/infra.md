---
paths:
  - "infra/**"
---

# Work on the demo on AWS

- `infra/modules/<unit>/` holds the Terraform of a unit. `infra/live/demo/<unit>/terragrunt.hcl` holds its inputs and
  dependencies. `infra/live/root.hcl` holds the state, the provider and the tags that all units share.
- `infra/argocd/` holds the charts that ArgoCD syncs. ArgoCD reads them from a pushed branch, never from the working
  tree.
- Every AWS object is made by Terraform. Nothing in the cluster makes a load balancer or a security group rule.
- No account, region or owner in a file. They come from the environment and from `git remote get-url origin`.
- Pin every provider, module and chart to an exact version.
- `aws:up`, `aws:down` and `test:aws` create, delete or change AWS resources, so each needs a go-ahead in the session.
  The cluster costs about $0.30 an hour.
- Run `mise run infra:check` after a change. It needs no AWS account.
