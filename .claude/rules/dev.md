---
paths:
  - "dev/**"
  - "crds/**"
---

# Work on the local environment and the definitions

The local environment is a k3d cluster named `kmo` with Argo Rollouts, RustFS in the namespace `kmo-dev` with the bucket
`kmo-config`, and the sample workloads in `shop`.

- `crds/` holds the definitions of ConfigSync, ConfigStore and ClusterConfigStore. The `deploy` and `operator:deploy`
  tasks apply them first, so the kinds exist before anything watches them.
- `dev/kmo/` holds the namespace `kmo-system` and the local cluster-wide store `default`.
- `dev/workloads/configsyncs.yaml` holds one ConfigSync for each sample workload.
- `dev/tenants/` holds the trusted tenant `payments`, with its own store, and the untrusted tenant `partners`, on a
  cluster-wide store.
- `dev/receiver/` holds the receiver's manifests, and `dev/demo.sh` is the demo.
- The operator writes the `<name>-kmo` ConfigMaps and Secrets of the sample workloads, so their pods start only after
  `mise run operator:deploy`.

`dev/README.md` has one line for each entry in `dev/`, saying what it is for. Update it in the same change that adds,
removes or repurposes an entry.
