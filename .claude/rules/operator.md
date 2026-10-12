---
paths:
  - "packages/operator/**"
  - "package.json"
---

# Work on `packages/operator`

`@kmo/operator` is the Pepr module, a thin shell around core. `docs/design.md` records what was verified about Pepr.

## The files

- `pepr.ts` is the entry point, and `src/capability.ts` holds every binding.
- `src/kinds.ts` holds the client kinds, and `src/guarded-kind.ts` the shim for watches on a kind that may be missing.
- `src/cluster.ts` holds the small cluster reads: stores and stored keys.
- `src/credentials.ts` chooses between stored keys and `src/web-identity.ts`, the exchange of a ServiceAccount's token
  for AWS keys.
- `src/s3.ts` reads the store, and `src/store-status.ts` reports the `Ready` condition of a store.
- `src/reconcile.ts` is one reconcile from start to finish. `src/outputs.ts` writes the ConfigMap and the Secret,
  `src/targets.ts` stamps the targets, and `src/report.ts` leaves the status and the Events on the ConfigSync.
- `src/triggers.ts` holds the handlers that ask for a sync, with `src/generation-gate.ts` to tell a spec change from any
  other update.
- `package.json` holds the Pepr settings and the hand-written RBAC rules.

## Dependencies

- The root `overrides` are scoped to the package that brings each dependency. `@kubernetes/client-node` must keep
  `js-yaml` 4, or `pepr build` breaks. A changed override needs a regenerated lockfile.
- npm installs two copies of `kubernetes-fluent-client`, one for the operator and one inside Pepr, and each has its own
  list of registered kinds. Take `RegisterKind`, `kind` and `K8s` from `pepr`, or Pepr does not know the kind.
- Use scoped RBAC with hand-written rules. Pepr's default grants cluster admin.

## Watches on a kind that may be missing

- A watch on a kind that is not installed crash-loops Pepr's watcher and takes the refresh timer with it. Hence the
  guarded Rollout watch (`KMO_GUARD_ROLLOUT_WATCH`, on by default), proven on the cluster by
  `mise run check:rollout-guard`.
- Another optional kind needs a `GuardedKind` value in `src/kinds.ts` and a call to `guardKind` after its watches are
  declared. Never a plain watch.
- The shim behind that guard uses parts of Pepr that are not public. Treat every Pepr upgrade as a possible rewrite of
  the shim: Pepr stays pinned to an exact version, and `docs/upgrading-pepr.md` is the procedure to move the pin.

## Triggers and reconciles

- No trigger reconciles by itself. Each one sets the sync annotation with `requestSync`, as the receiver does, so there
  is one path into a reconcile. `requestSync` sends the uid, so the API server refuses it when the ConfigSync is gone.
- The operator's own status updates trigger a reconcile. `needsReconcile` returns early when neither
  `metadata.generation` nor the sync annotation differs from what the status records. Keep every new trigger on that
  path.
- `PatchStatus` sends a merge patch, which removes a field only when it is null. A status field that can go away must be
  written as null, as `statusPatch` does for the handled sync request, or the early return never holds.
- The watches see the operator's own writes before the reconcile has recorded them in the status. A handler that reads
  the status must use `putOff` while `needsReconcile` holds, or one change costs two reconciles. It must not wait in
  place: Pepr delivers the next event of a watch only when the callback has returned.
- A trigger check that was put off must read the workload again. The object that the watch delivered is older than the
  reconcile it waited for.
- Every watcher start asks for one sync of every ConfigSync, because every store is new to the generation gate.

## Admission

The module has an admission binding, so Pepr creates the Deployment `pepr-kmo` next to `pepr-kmo-watcher`, with failure
policy `Fail`. While its pods are down, nothing can create or change a ConfigSync, the operator included. Hence
`requestSync` sends a refused request again, and `kmo:deploy` waits for both Deployments.

## When the work is done

Run `mise run test:e2e -- smoke`. `docs/commands.md` has the other tasks.
