import { COMMON_FOLDER, type ResolvedConfigSync } from "./defaults";
import type { SourceName, Store } from "./types";

const DEFAULT_STORE = "default";

/** The outcome of looking for a ConfigSync's store. */
export type StoreLookup = { ok: true; store: Store } | { ok: false; reason: string };

/**
 * Names a store the way it is shown in a ConfigSync's status.
 * @param store The store.
 * @returns Its kind and name, such as ConfigStore/default.
 */
export function storeLabel(store: Store): string {
  return `${store.kind}/${store.metadata.name}`;
}

/**
 * Tells whether a namespace may use a store.
 * @param store The store.
 * @param namespace The namespace asking.
 * @returns True for a ConfigStore in that namespace, or a ClusterConfigStore that lists it or lists `*`.
 */
export function allowsNamespace(store: Store, namespace: string): boolean {
  if (store.kind === "ConfigStore") return store.metadata.namespace === namespace;
  const allowed = store.spec.allowedNamespaces ?? [];
  return allowed.includes("*") || allowed.includes(namespace);
}

/**
 * Finds the store a ConfigSync reads from.
 * @param sync The resolved ConfigSync.
 * @param stores Every ConfigStore and ClusterConfigStore in the cluster.
 * @returns The store, or the reason none can be used.
 */
export function findStore(sync: ResolvedConfigSync, stores: Store[]): StoreLookup {
  const { namespace, storeRef } = sync;
  const own = (name: string) =>
    stores.find((s) => s.kind === "ConfigStore" && s.metadata.name === name && s.metadata.namespace === namespace);
  const clusterWide = (name: string) => stores.find((s) => s.kind === "ClusterConfigStore" && s.metadata.name === name);

  if (!storeRef) {
    const store = own(DEFAULT_STORE) ?? clusterWide(DEFAULT_STORE);
    if (store && allowsNamespace(store, namespace)) return { ok: true, store };
    return { ok: false, reason: `no store is named and no default store is available to namespace "${namespace}"` };
  }

  if (storeRef.kind === "ConfigStore") {
    const store = own(storeRef.name);
    if (store) return { ok: true, store };
    return { ok: false, reason: `ConfigStore "${storeRef.name}" was not found in namespace "${namespace}"` };
  }

  const store = clusterWide(storeRef.name);
  if (!store) return { ok: false, reason: `ClusterConfigStore "${storeRef.name}" was not found` };
  if (!allowsNamespace(store, namespace)) {
    return { ok: false, reason: `ClusterConfigStore "${storeRef.name}" does not allow namespace "${namespace}"` };
  }
  return { ok: true, store };
}

/**
 * Builds the key of a file in the store's bucket.
 * @param store The store, whose key prefix goes in front.
 * @param key A source key relative to that prefix.
 * @returns The full key in the bucket.
 */
export function fullKey(store: Store, key: string): string {
  const prefix = (store.spec.keyPrefix ?? "").replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${key}` : key;
}

/**
 * Checks that a ConfigSync may read each of its source keys from a store.
 * @param sync The resolved ConfigSync.
 * @param store The store it reads from.
 * @returns A reason naming the first source that may not be read, or undefined when all may.
 */
export function sourceAccessProblem(sync: ResolvedConfigSync, store: Store): string | undefined {
  const allowedFolders = [`${sync.namespace}/`, `${COMMON_FOLDER}/`];
  for (const [source, key] of Object.entries(sync.source) as [SourceName, string][]) {
    if (key === "" || key.startsWith("/") || key.split("/").includes("..")) {
      return `source "${source}" is not a usable key`;
    }
    if (store.kind === "ClusterConfigStore" && !allowedFolders.some((folder) => key.startsWith(folder))) {
      return `source "${source}" is outside the folders namespace "${sync.namespace}" may read from a cluster-wide store`;
    }
  }
  return undefined;
}
