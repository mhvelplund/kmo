import {
  CONFIG_HASH_ANNOTATION,
  isSuspended,
  needsReconcile,
  outputsDrifted,
  podTemplate,
  resolveConfigSync,
  syncDue,
  syncRequestApply,
  syncsTargeting,
  syncsUsingStore,
  targetNeedsSync,
  type ConfigSync,
  type ExistingObject,
  type Store,
  type StoreKind,
  type TargetKind,
} from "@kmo/core";
import type { KubernetesObject } from "kubernetes-fluent-client";
import { K8s, Log, a } from "pepr";
import { getOrUndefined, listStores } from "./cluster";
import { GenerationGate } from "./generation-gate";
import { ClusterConfigStoreKind, ConfigStoreKind, ConfigSyncKind, toCore } from "./kinds";
import { checkAllStores, reportStore } from "./store-status";
import { TARGET_MODELS } from "./targets";

const targetGate = new GenerationGate();
const storeGate = new GenerationGate();

/** How long to wait before a check is made again, and how many times. */
const RECHECK_MS = 2000;
const RECHECKS = 5;

/**
 * Tells whether a check must be made again later, because a reconcile that is still pending will change the status.
 * The check is not awaited, so the watch that delivered the object is not held up.
 * @param sync The ConfigSync the check reads.
 * @param attempt How many times the check was put off already.
 * @param check The check to make again.
 * @returns True when the check was put off.
 */
function putOff(sync: ConfigSync, attempt: number, check: () => Promise<void>): boolean {
  if (attempt >= RECHECKS || !needsReconcile(sync)) return false;
  setTimeout(() => {
    check().catch((error: unknown) => Log.error(error, "KMO trigger check failed"));
  }, RECHECK_MS);
  return true;
}

/** How long to wait before a refused sync request is sent again, and how many times. */
const RETRY_MS = 5000;
const RETRIES = 6;

/**
 * Asks for a sync of a ConfigSync, the same way the receiver does. A request that the API server does not take, as when
 * the admission pods are starting, is sent again later without holding up the caller.
 * @param sync The resource.
 * @param why The trigger, for the log.
 * @param attempt How many times the request was sent already.
 */
export async function requestSync(sync: ConfigSync, why: string, attempt = 0): Promise<void> {
  const { name, namespace } = sync.metadata;
  try {
    await K8s(ConfigSyncKind).Apply(syncRequestApply(sync, new Date()), { force: true });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 409) return;
    if (attempt >= RETRIES) throw error;
    Log.warn({ namespace, name, why, status }, "KMO could not request a sync and tries again");
    setTimeout(() => {
      requestSync(sync, why, attempt + 1).catch((again: unknown) => Log.error(again, "KMO sync request failed"));
    }, RETRY_MS);
    return;
  }
  Log.info({ namespace, name, why }, "KMO requested a sync");
}

async function listSyncs(namespace?: string): Promise<ConfigSync[]> {
  const client = namespace ? K8s(ConfigSyncKind).InNamespace(namespace) : K8s(ConfigSyncKind);
  return (await client.Get()).items.map(toCore);
}

/** Asks for a sync of every ConfigSync that is due, then checks every store. Run once a minute. */
export async function onTick(): Promise<void> {
  const now = new Date();
  for (const sync of await listSyncs()) {
    if (syncDue(sync, now)) await requestSync(sync, "timer");
  }
  await checkAllStores();
}

/**
 * Reacts to a created, changed or deleted output object.
 * @param object The ConfigMap or Secret a watch delivered.
 */
export async function onOutputChange(object: KubernetesObject): Promise<void> {
  await checkOutputs(object, 0);
}

async function checkOutputs(object: KubernetesObject, attempt: number): Promise<void> {
  const owner = object.metadata?.ownerReferences?.find((reference) => reference.kind === "ConfigSync");
  const namespace = object.metadata?.namespace;
  if (!owner || !namespace) return;

  const found = await getOrUndefined(ConfigSyncKind, owner.name, namespace);
  if (!found || found.metadata?.deletionTimestamp) return;
  const sync = toCore(found);
  if (isSuspended(sync)) return;
  if (putOff(sync, attempt, () => checkOutputs(object, attempt + 1))) return;

  let output;
  try {
    output = resolveConfigSync(sync).output;
  } catch {
    return;
  }
  const [configMap, secret] = await Promise.all([
    getOrUndefined(a.ConfigMap, output.configMapName, namespace),
    getOrUndefined(a.Secret, output.secretName, namespace),
  ]);
  if (outputsDrifted(sync, configMap as ExistingObject | undefined, secret as ExistingObject | undefined)) {
    await requestSync(sync, "output changed");
  }
}

/**
 * Makes the handler for created or changed workloads of one kind.
 * @param kind The workload kind.
 * @returns A watch callback.
 */
export function onTargetChange(kind: TargetKind) {
  return async (workload: KubernetesObject): Promise<void> => {
    const { name, namespace } = workload.metadata ?? {};
    if (!name || !namespace || !targetGate.changed(workload)) return;
    await checkTarget(kind, workload, name, namespace, 0);
  };
}

async function checkTarget(
  kind: TargetKind,
  delivered: KubernetesObject,
  name: string,
  namespace: string,
  attempt: number,
): Promise<void> {
  // A check that was put off reads the workload again, because the reconcile it waited for may have stamped it.
  const workload = attempt === 0 ? delivered : await getOrUndefined(TARGET_MODELS[kind], name, namespace);
  if (!workload) return;
  const stamped = podTemplate(kind, workload)?.metadata?.annotations?.[CONFIG_HASH_ANNOTATION];
  const syncs = syncsTargeting(kind, name, await listSyncs(namespace)).filter((sync) => !isSuspended(sync));
  const pending = syncs.find((sync) => needsReconcile(sync));
  if (pending && putOff(pending, attempt, () => checkTarget(kind, delivered, name, namespace, attempt + 1))) return;
  for (const sync of syncs) {
    if (targetNeedsSync(sync, stamped)) await requestSync(sync, `${kind} changed`);
  }
}

function toStore(kind: StoreKind, object: ConfigStoreKind | ClusterConfigStoreKind): Store | undefined {
  const name = object.metadata?.name;
  if (!name || !object.spec) return undefined;
  const namespace = kind === "ConfigStore" ? object.metadata?.namespace : undefined;
  return { kind, metadata: { name, namespace }, spec: object.spec };
}

async function syncUsersOf(store: Store, why: string): Promise<void> {
  const [syncs, stores] = await Promise.all([listSyncs(), listStores()]);
  for (const sync of syncsUsingStore(store, syncs, stores)) {
    if (!isSuspended(sync)) await requestSync(sync, why);
  }
}

/**
 * Makes the handler for created or changed stores of one kind.
 * @param kind The store kind.
 * @returns A watch callback.
 */
export function onStoreChange(kind: StoreKind) {
  return async (object: ConfigStoreKind | ClusterConfigStoreKind): Promise<void> => {
    const store = toStore(kind, object);
    if (!store || !storeGate.changed(object)) return;
    await syncUsersOf(store, "store changed");
    await reportStore(store, object.status?.conditions);
  };
}

/**
 * Makes the handler for deleted stores of one kind.
 * @param kind The store kind.
 * @returns A watch callback.
 */
export function onStoreDelete(kind: StoreKind) {
  return async (object: ConfigStoreKind | ClusterConfigStoreKind): Promise<void> => {
    const store = toStore(kind, object);
    storeGate.forget(object);
    if (store) await syncUsersOf(store, "store deleted");
  };
}
