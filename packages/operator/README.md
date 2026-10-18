# @kmo/operator

The **operator** is a [Pepr](https://docs.pepr.dev) module that reconciles each ConfigSync. Most of the logic is in
`@kmo/core`. The **operator** contains only the code that talks to the cluster and to the store.

The **operator**:

- checks each ConfigSync when it is created or changed, and rejects it if it names the same target, ConfigMap or Secret
  as another ConfigSync in its namespace,
- reads the dotenv files from the store, and writes one ConfigMap and one Secret for each ConfigSync,
- puts a hash of the values on the pod template of each target, so that Kubernetes replaces the pods when a value
  changes,
- watches the ConfigMaps and Secrets that it manages, the targets and the stores, and starts a new sync when one of them
  changes,
- checks every minute for ConfigSyncs that are due for a periodic sync.

The **operator** is the only part of KMO that has store credentials, and the only part that writes the ConfigMaps and
Secrets. It runs in the namespace `pepr-system`.

- Entry point: `pepr.ts`. `src/capability.ts` registers every admission and watch rule.
- Pepr settings, including RBAC: the `pepr` block in `package.json`.
- Build: `npm run build --workspace @kmo/operator`. To build it and install it into the local cluster, run
  `mise run kmo:deploy`. The output in `dist/` is not committed.

Read [Upgrading Pepr](../../docs/upgrading-pepr.md) before you change the Pepr version. The
[architecture](../../docs/architecture.md) explains how the **operator** and the receiver divide the work.
