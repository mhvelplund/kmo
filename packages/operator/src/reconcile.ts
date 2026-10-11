import {
  SourceParseError,
  buildOutputs,
  outputObjects,
  planSync,
  storeLabel,
  type PlannedSource,
  type SourceInput,
  type SourceStatus,
} from "@kmo/core";
import { Log } from "pepr";
import { SyncFailure, listStores, readCredentials } from "./cluster";
import { ownerOf, toCore, type ConfigSyncKind } from "./kinds";
import { writeOutputs } from "./outputs";
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
 * Reconciles one ConfigSync.
 * @param sync The resource Pepr delivered.
 */
export async function reconcile(sync: ConfigSyncKind): Promise<void> {
  const where = { namespace: sync.metadata?.namespace, name: sync.metadata?.name };
  try {
    const plan = planSync(toCore(sync), await listStores());
    if (!plan.ok) throw new SyncFailure(plan.reason, plan.message);

    const read = await readSources(plan.sources);
    const outputs = buildOutputs(read.inputs);

    const owner = ownerOf(sync);
    await writeOutputs(outputObjects(plan.sync, outputs, owner), owner);
    const targets = await stampTargets(plan.sync, outputs.configHash);

    Log.info(
      {
        ...where,
        sources: read.sources,
        configKeys: Object.keys(outputs.configMapData).length,
        secretKeys: Object.keys(outputs.secretData).length,
        configHash: outputs.configHash,
        targets: targets.map(({ kind, name, state }) => ({ kind, name, state })),
      },
      "KMO synced",
    );
  } catch (error) {
    if (error instanceof SyncFailure)
      return void Log.warn({ ...where, reason: error.reason }, `KMO sync failed: ${error.message}`);
    if (error instanceof SourceParseError)
      return void Log.warn({ ...where, reason: "SourceUnparsable" }, `KMO sync failed: ${error.message}`);
    throw error;
  }
}
