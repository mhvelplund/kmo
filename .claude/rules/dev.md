---
paths:
  - "dev/**"
  - "crds/**"
---

# Work on the local environment and the definitions

The local environment is a k3d cluster named `kmo` with Argo Rollouts, RustFS in the namespace `kmo-dev` with the bucket
`kmo-config`, and the sample workloads in `shop`.

- `crds/` holds the definitions of ConfigSync, ConfigStore and ClusterConfigStore. The chart installs them: its build
  copies each file into a template. So `kmo:deploy` runs before `deploy`.
- `dev/kmo/` holds the local cluster-wide store `default`, the values of the local installation and the Secret with the
  local token. The chart creates the namespace `kmo-system`.
- `dev/workloads/configsyncs.yaml` holds one ConfigSync for each sample workload.
- `dev/tenants/` holds the trusted tenant `payments`, with its own store, and the untrusted tenant `partners`, on a
  cluster-wide store.
- `dev/argocd/` holds a pinned ArgoCD, which only the suite `argocd` installs. `dev/demo.sh` is the demo.
- The operator writes the `<name>-kmo` ConfigMaps and Secrets of the sample workloads, so their pods start only after
  `mise run kmo:deploy`.

`dev/README.md` has one line for each entry in `dev/`, saying what it is for. Update it in the same change that adds,
removes or repurposes an entry.
