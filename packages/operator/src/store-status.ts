import { storeConditions, type Condition, type Store } from "@kmo/core";
import { K8s, Log } from "pepr";
import { SyncFailure } from "./cluster";
import { readCredentials } from "./credentials";
import { ClusterConfigStoreKind, ConfigStoreKind } from "./kinds";
import { checkBucket } from "./s3";

/**
 * Checks one store's bucket and writes the result to the store's Ready condition.
 * @param store The store.
 * @param previous The store's conditions before the check.
 */
export async function reportStore(store: Store, previous: Condition[] | undefined): Promise<void> {
  let problem: string | undefined;
  try {
    await checkBucket(store, await readCredentials(store));
  } catch (error) {
    if (!(error instanceof SyncFailure)) throw error;
    problem = error.message;
  }

  const conditions = storeConditions(previous, problem, new Date().toISOString());
  const same = previous?.[0]?.status === conditions[0]?.status && previous?.[0]?.message === conditions[0]?.message;
  if (same) return;

  const { name, namespace } = store.metadata;
  if (store.kind === "ConfigStore") {
    await K8s(ConfigStoreKind).PatchStatus({ metadata: { name, namespace }, status: { conditions } });
  } else {
    await K8s(ClusterConfigStoreKind).PatchStatus({ metadata: { name }, status: { conditions } });
  }
  Log.info({ kind: store.kind, namespace, name, ready: !problem }, "KMO checked a store");
}

/** Checks every store in the cluster. Run once a minute. */
export async function checkAllStores(): Promise<void> {
  const [own, clusterWide] = await Promise.all([K8s(ConfigStoreKind).Get(), K8s(ClusterConfigStoreKind).Get()]);
  for (const item of own.items) {
    if (!item.spec || !item.metadata?.name) continue;
    const metadata = { name: item.metadata.name, namespace: item.metadata.namespace };
    await reportStore({ kind: "ConfigStore", metadata, spec: item.spec }, item.status?.conditions);
  }
  for (const item of clusterWide.items) {
    if (!item.spec || !item.metadata?.name) continue;
    const metadata = { name: item.metadata.name };
    await reportStore({ kind: "ClusterConfigStore", metadata, spec: item.spec }, item.status?.conditions);
  }
}
