import { COMMON_FOLDER } from "./defaults";
import type { SourceName, Store, StoreKind } from "./types";

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
 * Finds the store of one source of a ConfigSync.
 * @param namespace The ConfigSync's namespace.
 * @param storeRef The store the source names, or undefined for the store named default.
 * @param stores Every ConfigStore and ClusterConfigStore in the cluster.
 * @returns The store, or the reason it cannot be used.
 */
export function findStore(
  namespace: string,
  storeRef: { kind: StoreKind; name: string } | undefined,
  stores: Store[],
): StoreLookup {
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

const SERVICE_FOLDER = "{namespace}/{name}";

/**
 * Names the files a store holds for one ConfigSync.
 * @param store The store, which sets the prefix and the folders.
 * @param namespace The ConfigSync's namespace.
 * @param name The ConfigSync's name.
 * @param common Whether the common files are wanted.
 * @returns The full key in the bucket of each file to read.
 */
export function storeKeys(
  store: Store,
  namespace: string,
  name: string,
  common: boolean,
): Partial<Record<SourceName, string>> {
  const { keyPrefix, serviceFolder = SERVICE_FOLDER, commonFolder = COMMON_FOLDER } = store.spec.s3;
  const prefix = (keyPrefix ?? "").replace(/^\/+|\/+$/g, "");
  const key = (folder: string, file: string) => {
    const path = `${folder.replaceAll("{namespace}", namespace).replaceAll("{name}", name)}/${file}`;
    return prefix ? `${prefix}/${path}` : path;
  };
  return {
    config: key(serviceFolder, "config.env"),
    secrets: key(serviceFolder, "secrets.env"),
    ...(common
      ? { commonConfig: key(commonFolder, "config.env"), commonSecrets: key(commonFolder, "secrets.env") }
      : {}),
  };
}
