# Known limits and open points

This page says what KMO does not do, and what the next pieces of work must still prove.

## Known limits

- **A late `TargetsWired` warning.** When someone removes the reference to an output object from a workload that is
  already wired, the warning appears at the next sync, not at once.
- **One list for each workload at the start.** When the operator's watcher starts, each workload in the cluster causes
  one list of the ConfigSyncs in its namespace. On a large cluster this is a burst of reads.
- **Every start syncs everything once.** Each ConfigSync is synced once when the watcher starts. No pod restarts for it,
  because the hashes are the same.
- **The operator may read every Secret**, and may create a token for every ServiceAccount, because a store can keep its
  identity in any namespace. So a person who may deploy or change the operator can reach every Secret in the cluster.
  Give that right only to cluster administrators. [Security](security.md) lists the rights and how to limit them.
- **No ConfigSync can be created or changed while the admission pods are down.** That includes the operator's own
  requests for a sync and the receiver's. They are made again when the pods are back.
- **The receiver does not join events.** Twenty changed files ask for twenty syncs. The hash keeps the pods from rolling
  more than once for the same values.
- **Two conflicting ConfigSyncs created at the same instant** can both pass the admission check. This is rare and is not
  guarded against.
- **The receiver matches on bucket name and key only.** Two stores with the same bucket name at different endpoints can
  cause a sync that was not needed. It is harmless.
- **A common-file change rolls many workloads at once.** Restarts are not spread out.
- **No TLS and one shared token on the receiver.** Proper authentication comes with the AWS integration.
- **The operator runs in `pepr-system`.** Pepr decides that, and it cannot be changed.
- **The Rollout guard uses parts of Pepr that are not public.** A Pepr upgrade can break it.
  [Upgrading Pepr](upgrading-pepr.md) is the procedure.
- **One ConfigMap and one Secret for each ConfigSync, of at most 1 MiB each.** Larger values are refused with the reason
  `OutputTooLarge`, and are not split over several objects. A pod could not use them anyway: Linux allows a process
  about 2 MiB of arguments and environment in total, and about 128 KiB for one value.
- **The receiver keeps every ConfigSync and every store in memory**, so its memory grows with their number. More pods do
  not lower the memory of each pod, because each one keeps the full list. The local manifest limits a pod to 128Mi, and
  a pod that passes its limit is restarted. [The receiver](receiver.md#memory) says how to size it.
- **A key that is in both the ConfigMap and the Secret** is resolved by the order of the workload's own references. KMO
  does not check for it.

## Open points for the next work

Two more pieces of work are planned, and neither is designed yet: packaging, and the AWS integration.

- **Several copies of the operator in one cluster.** An early experiment suggested that Pepr modules with different
  identifiers can share a cluster, all in `pepr-system`. That was read from the names that Pepr generates, not from the
  Pepr documentation. Confirm it in the documentation before anything depends on it.
- **EventBridge keys.** KMO takes the key of an EventBridge event as it is, on the assumption that it is not
  URL-encoded. The AWS integration must confirm this against a live event, with a key that holds a space and a plus
  sign, and add the captured event to `packages/core/test/fixtures/`.
- **The proof inside EKS of stores without stored keys.** The path is proven from a cluster outside EKS. Packaging
  brings the first EKS cluster and must repeat `test/e2e/aws/setup.sh` there, without the step that publishes the
  signing keys, because EKS registers them itself.
- **Packaging.** The receiver's manifests are in `dev/receiver/` and its image is built for the local registry.
  Packaging brings the Helm chart, a published image and the ArgoCD application.
- **The key in the chart that Pepr generates.** `pepr build` puts the private key of the admission webhook in its chart.
  A chart that is published must not hold it. Packaging must decide how each installation gets its own key, and whether
  the cluster needs an admission policy for `pepr-system`. See [Security](security.md).
- **Advisories.** [Known advisories](advisories.md) is reviewed again whenever dependencies change.

## Read next

- [Installing](installing.md) for what a cluster needs today.
- [Troubleshooting](troubleshooting.md) for problems that have a fix.
