# KMO

KMO keeps the configuration of Kubernetes workloads in step with env files held in an object store. When a file changes,
the matching ConfigMap or Secret is updated within seconds and the workloads that use it pick up the new values through
a rolling update.

KMO has two parts: an operator that syncs and rolls the workloads, and a receiver that notices a changed file at once.
Both run end to end on a local cluster. See the [documentation](docs/index.md) for how it works.

## Layout

- `packages/` holds the TypeScript packages. `core` is the shared logic, `operator` is the Pepr module that runs in the
  cluster, and `receiver` is the HTTP service that takes the change events of the store.
- `crds/` holds the definitions of the three KMO resource kinds.
- `dev/` holds the manifests for the local environment, with two sample tenants, and the demo.
- `test/e2e/` holds the suites that run against the local cluster, and the scripts for the proof on AWS.
- `docs/` holds the documentation, starting at [docs/index.md](docs/index.md).
- `mise.toml` pins the tools and defines the tasks.

## Installing

KMO has no supported installation for a real cluster yet. [Installing](docs/installing.md) says what a cluster needs
today. To try KMO on a local cluster, follow [Getting started](docs/getting-started.md).
