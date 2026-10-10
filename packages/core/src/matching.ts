import { resolveConfigSync } from "./defaults";
import { ConfigSyncSpecError } from "./duration";
import type { StoreEvent } from "./events";
import { findStore, fullKey } from "./store";
import type { ConfigSync, Store } from "./types";

/**
 * Finds the ConfigSyncs that read a changed file.
 * @param event The bucket and key that changed.
 * @param syncs Every ConfigSync in the cluster.
 * @param stores Every ConfigStore and ClusterConfigStore in the cluster.
 * @returns The ConfigSyncs with a source at that key in that bucket, suspended ones included.
 */
export function findAffectedSyncs(event: StoreEvent, syncs: ConfigSync[], stores: Store[]): ConfigSync[] {
  return syncs.filter((sync) => {
    const resolved = resolveOrSkip(sync);
    if (!resolved) return false;
    const lookup = findStore(resolved, stores);
    if (!lookup.ok || lookup.store.spec.bucket !== event.bucket) return false;
    return Object.values(resolved.source).some((key) => fullKey(lookup.store, key) === event.key);
  });
}

function resolveOrSkip(sync: ConfigSync) {
  try {
    return resolveConfigSync(sync);
  } catch (error) {
    if (error instanceof ConfigSyncSpecError) return undefined;
    throw error;
  }
}
