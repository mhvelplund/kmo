# KMO

KMO keeps the configuration of Kubernetes workloads in step with env files held in an object store. When a file changes,
the matching ConfigMap or Secret is updated within seconds and the workloads that use it pick up the new values through
a rolling update.

The project is under construction. See the [documentation](docs/index.md) for what exists today.

## Layout

- `packages/` holds the TypeScript packages. `core` is the shared logic.
- `dev/` holds the manifests for the local environment.
- `docs/` holds the documentation, starting at [docs/index.md](docs/index.md).
- `mise.toml` pins the tools and defines the tasks.

## Installing

KMO cannot be installed into a real cluster yet. To try what exists on a local cluster, follow
[Getting started](docs/getting-started.md).
