import { resolveOrUndefined } from "./defaults";
import { configHash } from "./hash";
import type { ExistingObject } from "./outputs";
import { findStore, storeLabel } from "./store";
import type { ConfigSync, Store, TargetKind } from "./types";

/** Annotation that asks for a sync; its value only has to change. */
export const SYNC_REQUESTED_ANNOTATION = "kmo.isntall.net/sync-requested-at";

/**
 * Reads the sync request of a ConfigSync.
 * @param sync The resource.
 * @returns The value of the sync annotation, or undefined when there is none.
 */
export function syncRequest(sync: ConfigSync): string | undefined {
  return sync.metadata.annotations?.[SYNC_REQUESTED_ANNOTATION];
}

/**
 * Tells whether a ConfigSync has changed in a way the operator has not acted on.
 * @param sync The resource as it is in the cluster now.
 * @returns False when neither its spec nor its sync request changed since the last reconcile.
 */
export function needsReconcile(sync: ConfigSync): boolean {
  const status = sync.status;
  return (
    status?.observedGeneration !== sync.metadata.generation || status?.lastHandledSyncRequest !== syncRequest(sync)
  );
}

/**
 * Tells whether a ConfigSync is suspended.
 * @param sync The resource.
 * @returns True when its spec sets suspend.
 */
export function isSuspended(sync: ConfigSync): boolean {
  return sync.spec?.suspend === true;
}

/**
 * Tells whether the timer must ask for a sync of a ConfigSync.
 * @param sync The resource.
 * @param now The current time.
 * @returns True when it was never synced, is not ready, or its refresh interval has passed. Never for a suspended
 *   resource or one whose spec cannot be used.
 */
export function syncDue(sync: ConfigSync, now: Date): boolean {
  const resolved = resolveOrUndefined(sync);
  if (!resolved || resolved.suspend) return false;
  const ready = sync.status?.conditions?.find((condition) => condition.type === "Ready");
  if (ready?.status === "False" || !sync.status?.lastSyncTime) return true;
  return now.getTime() - new Date(sync.status.lastSyncTime).getTime() >= resolved.refreshIntervalMs;
}

/**
 * Tells whether the output objects differ from what the last sync wrote.
 * @param sync The ConfigSync that owns them.
 * @param configMap The ConfigMap in the cluster, if it exists.
 * @param secret The Secret in the cluster, if it exists, with base64 data.
 * @returns True when one is missing or their contents no longer hash to the recorded config hash.
 */
export function outputsDrifted(
  sync: ConfigSync,
  configMap: ExistingObject | undefined,
  secret: ExistingObject | undefined,
): boolean {
  if (!configMap || !secret) return true;
  const decoded = Object.fromEntries(
    Object.entries(secret.data ?? {}).map(([key, value]) => [key, Buffer.from(value, "base64").toString("utf8")]),
  );
  return configHash(configMap.data ?? {}, decoded) !== sync.status?.configHash;
}

/**
 * Tells whether a change to a target workload calls for a sync.
 * @param sync A ConfigSync that targets the workload.
 * @param stampedHash The config hash on the workload's pod template, if any.
 * @returns True when the hash is not current, or the last sync reported a wiring problem.
 */
export function targetNeedsSync(sync: ConfigSync, stampedHash: string | undefined): boolean {
  const wired = sync.status?.conditions?.find((condition) => condition.type === "TargetsWired");
  return stampedHash !== sync.status?.configHash || wired?.status !== "True";
}

/**
 * Finds the ConfigSyncs that target a workload.
 * @param kind The workload's kind.
 * @param name The workload's name.
 * @param syncs The ConfigSyncs of the workload's namespace.
 * @returns Those whose resolved targets include the workload.
 */
export function syncsTargeting(kind: TargetKind, name: string, syncs: ConfigSync[]): ConfigSync[] {
  return syncs.filter((sync) =>
    resolveOrUndefined(sync)?.targets.some((target) => target.kind === kind && target.name === name),
  );
}

/**
 * Finds the ConfigSyncs that a change to a store can affect.
 * @param store The store that was created, changed or deleted.
 * @param syncs Every ConfigSync in the cluster.
 * @param stores Every store in the cluster now.
 * @returns Those that read the store at their last sync, or that have a source that resolves to it now.
 */
export function syncsUsingStore(store: Store, syncs: ConfigSync[], stores: Store[]): ConfigSync[] {
  const same = (other: Store) =>
    other.kind === store.kind &&
    other.metadata.name === store.metadata.name &&
    other.metadata.namespace === store.metadata.namespace;
  return syncs.filter((sync) => {
    const inReach = store.kind === "ClusterConfigStore" || store.metadata.namespace === sync.metadata.namespace;
    if (!inReach) return false;
    if (sync.status?.stores?.includes(storeLabel(store))) return true;
    const resolved = resolveOrUndefined(sync);
    if (!resolved) return false;
    return resolved.sources.some((source) => {
      const lookup = findStore(resolved.namespace, source.storeRef, stores);
      return lookup.ok && same(lookup.store);
    });
  });
}

/**
 * Builds the object that asks for a sync of a ConfigSync when it is applied to the cluster.
 * @param sync The resource.
 * @param now The current time, which becomes the value of the sync annotation.
 * @returns The resource's identity and the sync annotation, and nothing else. The uid makes the API server refuse the
 *   apply when the resource is gone.
 */
export function syncRequestApply(sync: ConfigSync, now: Date) {
  const { name, namespace, uid } = sync.metadata;
  return {
    apiVersion: "kmo.isntall.net/v1alpha1",
    kind: "ConfigSync",
    metadata: { name, namespace, uid, annotations: { [SYNC_REQUESTED_ANNOTATION]: now.toISOString() } },
  };
}
