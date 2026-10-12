# The local environment

This directory holds everything that is used only on the local k3d cluster. Nothing here is installed into a real
cluster. [Getting started](../docs/getting-started.md) explains how to run it.

## Contents

- `k3d.yaml` defines the cluster `kmo`: one server, one agent, an image registry, and the object store's port published
  on the host as `localhost:9000`.
- `aws-config` is the AWS command line profile for the local store. The `store` task uses it.
- `demo.sh` changes one value of the sample service `orders-api` in the store and shows each step up to the new pods.
  The `demo` task runs it.
- `kustomization.yaml` is what the `deploy` task applies. It lists the manifests in `store/`, `workloads/`, `kmo/` and
  `tenants/`, and generates two ConfigMaps, the seed files that the seed Job uploads, from the files in `store-files/`
  and `store-files-tenant/`.
- `argocd/` installs a pinned ArgoCD. Only the end-to-end suite `argocd` applies it, and removes it at its end.
- `argo-rollouts/` installs Argo Rollouts, so that a Rollout can be a target. The `deploy` task applies it separately.
- `store/` holds the namespace `kmo-dev`, the RustFS object store, and the seed Job. The Job creates the buckets
  `kmo-config` and `kmo-tenant`, turns on versioning and notifications, and uploads the sample files.
- `store-files/` holds the sample env files of the bucket `kmo-config`, in the same layout as in the bucket: one folder
  for each workload under its namespace, and the `_common` folder. It also holds the folder `partners-store`, the key
  prefix of the partners store, with the same layout inside.
- `store-files-tenant/` holds the sample env files of the second bucket, `kmo-tenant`.
- `workloads/` holds the namespace `shop` and five sample workloads, one of each kind that KMO supports. Each prints its
  environment when it starts. It also holds a ConfigSync for each workload.
- `kmo/` holds the cluster-wide store `default` with the credentials of the local object store, the values of the local
  installation, and the Secret with the local token of the receiver. The chart creates the namespace `kmo-system`, so
  the `kmo:deploy` task runs before the `deploy` task.
- `tenants/` holds two sample tenants. `payments` is a trusted tenant: it has its own store and credentials in its own
  namespace. `partners` is an untrusted tenant: it uses a cluster-wide store that allows only that namespace and keeps
  its credentials in `kmo-system`. Both tenants use the root keys of the local store, because it gives out no keys that
  are limited to one tenant. Real keys for each tenant come with the AWS integration.
