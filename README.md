# KMO

KMO keeps the configuration of Kubernetes workloads in step with env files held in an object store. When a file changes,
the matching ConfigMap or Secret is updated within seconds and the workloads that use it pick up the new values through
a rolling update.

KMO has two parts: an operator that syncs and rolls the workloads, and a receiver that notices a changed file at once.
Both run end to end on a local cluster and in EKS. See the [documentation](docs/index.md) for how it works.

## Layout

- `packages/` holds the TypeScript packages. `core` is the shared logic, `operator` is the Pepr module that runs in the
  cluster, `receiver` is the HTTP service that takes the change events of the store, and `certgen` makes and renews the
  key of the admission webhook.
- `crds/` holds the definitions of the three KMO resource kinds.
- `charts/` holds the Helm chart, the script that builds it, and an example ArgoCD application.
- `dev/` holds the manifests for the local environment, with two sample tenants, and the demo.
- `infra/` holds the Terraform and Terragrunt of the demo on AWS, and the charts that ArgoCD installs there.
- `test/e2e/` holds the suites that run against the local cluster, and the scripts for the proof on AWS.
- `docs/` holds the documentation, starting at [docs/index.md](docs/index.md).
- `mise.toml` pins the tools and defines the tasks.

## Installing

KMO is installed with one Helm chart, by Helm or by ArgoCD. [Installing](docs/installing.md) has the steps. The chart is
proven on a local cluster and in EKS: see [the demo on AWS](docs/aws-demo.md). To try KMO on a local cluster, follow
[Getting started](docs/getting-started.md).
