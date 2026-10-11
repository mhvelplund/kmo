# The local environment

This directory holds everything that is used only on the local k3d cluster. Nothing here is installed into a real
cluster. [Getting started](../docs/getting-started.md) explains how to run it.

## Contents

- `k3d.yaml` defines the cluster `kmo`: one server, one agent, an image registry, and the object store's port published
  on the host as `localhost:9000`.
- `aws-config` is the AWS command line profile for the local store. The `store` task uses it.
- `kustomization.yaml` is what the `deploy` task applies. It lists the manifests in `store/`, `workloads/` and `kmo/`,
  and generates one ConfigMap, the seed files that the seed Job uploads, from the files in `store-files/`.
- `argo-rollouts/` installs Argo Rollouts, so that a Rollout can be a target. The `deploy` task applies it separately.
- `store/` holds the namespace `kmo-dev`, the RustFS object store, and the seed Job. The Job creates the buckets
  `kmo-config` and `kmo-tenant`, turns on versioning and notifications, and uploads the sample files.
- `store-files/` holds the sample env files, in the same layout as in the bucket: one folder for each workload under its
  namespace, and the `_common` folder.
- `workloads/` holds the namespace `shop` and five sample workloads, one of each kind that KMO supports. Each prints its
  environment when it starts. It also holds a ConfigSync for each workload.
- `kmo/` holds the namespace `kmo-system`, and the cluster-wide store `default` with the credentials of the local object
  store.
