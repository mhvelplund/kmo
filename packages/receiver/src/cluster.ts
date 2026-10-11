import {
  syncRequestApply,
  type ConfigSync,
  type ConfigSyncSpec,
  type Store,
  type StoreKind,
  type StoreSpec,
} from "@kmo/core";
import {
  ApiException,
  CustomObjectsApi,
  PatchStrategy,
  makeInformer,
  setHeaderOptions,
  type Informer,
  type KubeConfig,
  type KubernetesListObject,
  type KubernetesObject,
  type ObjectCache,
} from "@kubernetes/client-node";
import { errorName, type Log } from "./log";

const GROUP = "kmo.isntall.net";
const VERSION = "v1alpha1";
const FIELD_MANAGER = "kmo-receiver";
const RESTART_MS = 5000;
const PLURALS = ["configsyncs", "configstores", "clusterconfigstores"] as const;

type Plural = (typeof PLURALS)[number];
type Cache = Informer<Raw> & ObjectCache<Raw>;

/** A KMO resource as the client returns it. */
export type Raw = KubernetesObject & { spec?: unknown };

/** The one call of the Kubernetes client that a sync request needs; replaced in tests. */
export type PatchApi = Pick<CustomObjectsApi, "patchNamespacedCustomObject">;

/**
 * Asks for a sync of a ConfigSync, the same way the operator does.
 * @param api The Kubernetes client.
 * @param sync The resource.
 * @param now The current time.
 * @throws ApiException when the API server refuses the request for another reason than that the resource is gone.
 */
export async function requestSync(api: PatchApi, sync: ConfigSync, now: Date): Promise<void> {
  const { name, namespace } = sync.metadata;
  try {
    await api.patchNamespacedCustomObject(
      {
        group: GROUP,
        version: VERSION,
        namespace,
        plural: "configsyncs",
        name,
        body: syncRequestApply(sync, now),
        fieldManager: FIELD_MANAGER,
        force: true,
      },
      setHeaderOptions("Content-Type", PatchStrategy.ServerSideApply),
    );
  } catch (error) {
    if (error instanceof ApiException && (error.code === 404 || error.code === 409)) return;
    throw error;
  }
}

/**
 * Reduces a ConfigSync from the cluster to what the core logic reads.
 * @param object The resource as the client returns it.
 * @returns Its identity, its annotations and its spec.
 */
export function toSync(object: Raw): ConfigSync {
  return {
    metadata: {
      name: object.metadata?.name ?? "",
      namespace: object.metadata?.namespace ?? "",
      uid: object.metadata?.uid,
      annotations: object.metadata?.annotations,
    },
    spec: object.spec as ConfigSyncSpec | undefined,
  };
}

/**
 * Reduces a store from the cluster to what the core logic reads.
 * @param kind Which of the two kinds of store it is.
 * @param object The resource as the client returns it.
 * @returns The store, or undefined when it has no name or no spec.
 */
export function toStore(kind: StoreKind, object: Raw): Store | undefined {
  const name = object.metadata?.name;
  if (!name || !object.spec) return undefined;
  const namespace = kind === "ConfigStore" ? object.metadata?.namespace : undefined;
  return { kind, metadata: { name, namespace }, spec: object.spec as StoreSpec };
}

/** The receiver's view of the cluster: three watched lists, and the way to ask for a sync. */
export class Cluster {
  readonly #api: CustomObjectsApi;
  readonly #kubeConfig: KubeConfig;
  readonly #log: Log;
  readonly #listed = new Set<Plural>();
  readonly #caches: Record<Plural, Cache>;

  /**
   * @param kubeConfig How to reach the API server.
   * @param log Writes a log line.
   */
  constructor(kubeConfig: KubeConfig, log: Log) {
    this.#kubeConfig = kubeConfig;
    this.#log = log;
    this.#api = kubeConfig.makeApiClient(CustomObjectsApi);
    this.#caches = {
      configsyncs: this.#watch("configsyncs"),
      configstores: this.#watch("configstores"),
      clusterconfigstores: this.#watch("clusterconfigstores"),
    };
  }

  /** Starts the three watches. A watch that cannot start is started again later. */
  async start(): Promise<void> {
    await Promise.all(Object.values(this.#caches).map((cache) => cache.start()));
  }

  /** @returns True when every list was filled at least once. */
  ready(): boolean {
    return this.#listed.size === PLURALS.length;
  }

  /** @returns Every ConfigSync in the cluster. */
  syncs(): ConfigSync[] {
    return this.#caches.configsyncs.list().map(toSync);
  }

  /** @returns Every ConfigStore and ClusterConfigStore in the cluster. */
  stores(): Store[] {
    return [
      ...this.#caches.configstores.list().map((object) => toStore("ConfigStore", object)),
      ...this.#caches.clusterconfigstores.list().map((object) => toStore("ClusterConfigStore", object)),
    ].filter((store): store is Store => store !== undefined);
  }

  /**
   * Asks for a sync of a ConfigSync.
   * @param sync The resource.
   */
  requestSync(sync: ConfigSync): Promise<void> {
    return requestSync(this.#api, sync, new Date());
  }

  #watch(plural: Plural): Cache {
    const list = async () => {
      const result = (await this.#api.listClusterCustomObject({
        group: GROUP,
        version: VERSION,
        plural,
      })) as KubernetesListObject<Raw>;
      this.#listed.add(plural);
      return result;
    };
    const cache = makeInformer<Raw>(this.#kubeConfig, `/apis/${GROUP}/${VERSION}/${plural}`, list);
    // The informer stops on an error and does not start again by itself.
    cache.on("error", (error: unknown) => {
      this.#log("KMO receiver lost a watch and starts it again", { plural, error: errorName(error) });
      setTimeout(() => void cache.start(), RESTART_MS);
    });
    return cache;
  }
}
