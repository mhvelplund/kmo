import { ConfigSyncSpecError, resolveConfigSync, type ResolvedConfigSync } from "./defaults";
import { findStore, storeKeys } from "./store";
import type { ConfigSync, Failure, SourceName, Store } from "./types";

/** One source of a ConfigSync, ready to be read. */
export interface PlannedSource {
  /** The store to read from. */
  store: Store;
  /** The full key in the bucket of each file to read. */
  keys: Partial<Record<SourceName, string>>;
}

/** What a reconcile must read, or why it cannot start. */
export type SyncPlan = { ok: true; sync: ResolvedConfigSync; sources: PlannedSource[] } | ({ ok: false } & Failure);

/**
 * Works out what a ConfigSync reads and from where.
 * @param sync The resource as stored in the cluster.
 * @param stores Every ConfigStore and ClusterConfigStore in the cluster.
 * @returns The resolved resource and its sources in order, each with its store and keys, or the failure.
 */
export function planSync(sync: ConfigSync, stores: Store[]): SyncPlan {
  let resolved: ResolvedConfigSync;
  try {
    resolved = resolveConfigSync(sync);
  } catch (error) {
    if (error instanceof ConfigSyncSpecError) return { ok: false, reason: "InvalidSpec", message: error.message };
    throw error;
  }

  const sources: PlannedSource[] = [];
  for (const source of resolved.sources) {
    const lookup = findStore(resolved.namespace, source.storeRef, stores);
    if (!lookup.ok) return { ok: false, reason: "StoreNotFound", message: lookup.reason };
    const keys = storeKeys(lookup.store, resolved.namespace, resolved.name, source.common);
    sources.push({ store: lookup.store, keys });
  }
  return { ok: true, sync: resolved, sources };
}
