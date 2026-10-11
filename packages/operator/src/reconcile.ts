import {
  SourceParseError,
  buildOutputs,
  isSuspended,
  needsReconcile,
  outputObjects,
  planSync,
  storeLabel,
  wiringProblems,
  type PlannedSource,
  type SourceInput,
  type SourceStatus,
  type SyncOutcome,
} from "@kmo/core";
import { Log } from "pepr";
import { SyncFailure, getOrUndefined, listStores } from "./cluster";
import { readCredentials } from "./credentials";
import { ConfigSyncKind, ownerOf, toCore } from "./kinds";
import { writeOutputs } from "./outputs";
import { report } from "./report";
import { fetchSources, s3GetObject } from "./s3";
import { stampTargets } from "./targets";

/**
 * Reads the files of every source of a ConfigSync.
 * @param planned The sources in order, each with its store and keys.
 * @returns The texts for merging, and a record of every file asked for.
 * @throws SyncFailure when a store's credentials or one of its files cannot be read.
 */
export async function readSources(
  planned: PlannedSource[],
): Promise<{ inputs: SourceInput[]; sources: SourceStatus[] }> {
  const inputs: SourceInput[] = [];
  const sources: SourceStatus[] = [];
  for (const { store, keys } of planned) {
    const label = storeLabel(store);
    const get = s3GetObject(store, await readCredentials(store));
    const read = await fetchSources(get, label, store.spec.s3.bucket, keys);
    inputs.push({ store: label, texts: read.texts });
    sources.push(...read.sources);
  }
  return { inputs, sources };
}

/**
 * Does the work of one reconcile.
 * @param sync The resource as it is in the cluster now.
 * @returns How it ended. Expected failures are returned, never thrown.
 */
export async function runSync(sync: ConfigSyncKind): Promise<SyncOutcome> {
  try {
    if (isSuspended(toCore(sync))) return { result: "suspended" };

    const plan = planSync(toCore(sync), await listStores());
    if (!plan.ok) return { result: "failed", reason: plan.reason, message: plan.message };

    const read = await readSources(plan.sources);
    const outputs = buildOutputs(read.inputs);

    const owner = ownerOf(sync);
    await writeOutputs(outputObjects(plan.sync, outputs, owner), owner);
    const targets = await stampTargets(plan.sync, outputs.configHash);

    return {
      result: "synced",
      stores: plan.sources.map((source) => storeLabel(source.store)),
      sources: read.sources,
      configHash: outputs.configHash,
      empty: Object.keys(outputs.configMapData).length + Object.keys(outputs.secretData).length === 0,
      wiringProblems: wiringProblems(plan.sync, outputs, targets),
    };
  } catch (error) {
    if (error instanceof SyncFailure) return { result: "failed", reason: error.reason, message: error.message };
    if (error instanceof SourceParseError)
      return { result: "failed", reason: "SourceUnparsable", message: error.message };
    Log.error(error, "KMO sync failed unexpectedly");
    const name = error instanceof Error ? error.name : "unknown";
    return { result: "failed", reason: "InternalError", message: `unexpected error (${name}); see the operator log` };
  }
}

/**
 * Reconciles one ConfigSync.
 * @param delivered The resource Pepr delivered; it is read again, so queued duplicates find nothing to do.
 */
export async function reconcile(delivered: ConfigSyncKind): Promise<void> {
  const sync = await getOrUndefined(ConfigSyncKind, delivered.metadata?.name ?? "", delivered.metadata?.namespace);
  if (!sync || !needsReconcile(toCore(sync))) return;

  const outcome = await runSync(sync);
  await report(sync, outcome);
  const where = { namespace: sync.metadata?.namespace, name: sync.metadata?.name };
  if (outcome.result === "failed")
    Log.warn({ ...where, reason: outcome.reason }, `KMO sync failed: ${outcome.message}`);
  Log.info({ ...where, result: outcome.result }, "KMO reconciled");
}
