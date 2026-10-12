# Known limits

This page says what KMO does not do. [Planned work](planned.md) says what is planned to change that.

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
- **No TLS and one shared token on the receiver.** HTTPS and proper authentication are
  [planned](planned.md#aws-integration).
- **The operator runs in `pepr-system`.** Pepr decides that, and it cannot be changed. The chart must be installed into
  that namespace.
- **A cluster that was off for more than 90 days** comes back with a certificate of the webhook that has ended. No
  ConfigSync can change until the daily renewal has run. [Troubleshooting](troubleshooting.md) says how to start it by
  hand.
- **The operator's pods restart at each upgrade of the chart**, also when the code is the same, because Pepr writes the
  time of the build on them.
- **An uninstall leaves the two Secrets of the webhook** in `pepr-system`. [Installing](installing.md#uninstalling) says
  what else stays.
- **The address of the webhook is in the log of the admission pods.** Pepr writes it there.
- **The Rollout guard uses parts of Pepr that are not public.** A Pepr upgrade can break it.
  [Upgrading Pepr](upgrading-pepr.md) is the procedure.
- **One ConfigMap and one Secret for each ConfigSync, of at most 1 MiB each.** Larger values are refused with the reason
  `OutputTooLarge`, and are not split over several objects. A pod could not use them anyway: Linux allows a process
  about 2 MiB of arguments and environment in total, and about 128 KiB for one value.
- **The receiver keeps every ConfigSync and every store in memory**, so its memory grows with their number. More pods do
  not lower the memory of each pod, because each one keeps the full list. The chart limits a pod to 128Mi by default,
  and a pod that passes its limit is restarted. [The receiver](receiver.md#memory) says how to size it.
- **A key that is in both the ConfigMap and the Secret** is resolved by the order of the workload's own references. KMO
  does not check for it.

## Read next

- [Installing](installing.md) for how to install KMO.
- [Troubleshooting](troubleshooting.md) for problems that have a fix.
- [Planned work](planned.md) for what is planned and what it must still prove.
