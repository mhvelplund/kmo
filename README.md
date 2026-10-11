# KMO

KMO keeps the configuration of Kubernetes workloads in step with env files held in an object store. When a file changes,
the matching ConfigMap or Secret is updated within seconds and the workloads that use it pick up the new values through
a rolling update.

The project is under construction. The operator exists: it syncs, rolls the workloads, reports, and keeps tenants apart.
The receiver, which notices a changed file at once, does not exist yet. See the [documentation](docs/index.md) for what
exists today.

## Layout

- `packages/` holds the TypeScript packages. `core` is the shared logic and `operator` is the Pepr module that runs in
  the cluster.
- `crds/` holds the definitions of the three KMO resource kinds.
- `dev/` holds the manifests for the local environment, with two sample tenants.
- `test/e2e/` holds the checks that run against the local cluster, and the scripts for the proof on AWS.
- `docs/` holds the documentation, starting at [docs/index.md](docs/index.md).
- `mise.toml` pins the tools and defines the tasks.

## Installing

KMO cannot be installed into a real cluster yet. To try what exists on a local cluster, follow
[Getting started](docs/getting-started.md).
