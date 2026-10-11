import { ConfigSyncSpecError, parseDuration } from "./duration";
import type { ConfigSync, SourceSpec, StoreKind, TargetKind } from "./types";

export { ConfigSyncSpecError } from "./duration";

/** Folder holding the files shared by every workload of a store, unless the store names another. */
export const COMMON_FOLDER = "_common";

const DEFAULT_REFRESH_INTERVAL = "30m";
const MINIMUM_REFRESH_INTERVAL_MS = 60_000;

/** One source of a ConfigSync with its defaults filled in. */
export interface ResolvedSource {
  /** Absent when the store named default is meant. */
  storeRef?: { kind: StoreKind; name: string };
  /** Whether the store's common files are read. */
  common: boolean;
}

/** A ConfigSync with every default filled in. */
export interface ResolvedConfigSync {
  /** Name of the resource. */
  name: string;
  /** Namespace of the resource, its targets and its outputs. */
  namespace: string;
  /** True when syncing is paused. */
  suspend: boolean;
  /** Workloads that receive the config hash. */
  targets: { kind: TargetKind; name: string }[];
  /** The stores to read from, in order; later ones win. */
  sources: ResolvedSource[];
  /** Names of the ConfigMap and the Secret that are written. */
  output: { configMapName: string; secretName: string };
  /** Time between syncs without an event, in milliseconds. */
  refreshIntervalMs: number;
}

/**
 * Fills in the defaults of a ConfigSync from its name and namespace.
 * @param sync The resource as stored in the cluster.
 * @returns The resource with no optional field left open, except the store of the default source.
 * @throws ConfigSyncSpecError if the refresh interval is unreadable or under one minute, or a store is listed twice.
 */
export function resolveConfigSync(sync: ConfigSync): ResolvedConfigSync {
  const { name, namespace } = sync.metadata;
  const spec = sync.spec ?? {};
  const targets = spec.targets?.length ? spec.targets : [{ name }];
  const refreshIntervalMs = parseDuration(spec.refreshInterval ?? DEFAULT_REFRESH_INTERVAL);
  if (refreshIntervalMs < MINIMUM_REFRESH_INTERVAL_MS) {
    throw new ConfigSyncSpecError("the refresh interval must be at least one minute");
  }

  return {
    name,
    namespace,
    suspend: spec.suspend ?? false,
    targets: targets.map((target) => ({ kind: target.kind ?? "Deployment", name: target.name })),
    sources: resolveSources(spec.sources),
    output: {
      configMapName: spec.output?.configMapName ?? `${name}-kmo`,
      secretName: spec.output?.secretName ?? `${name}-kmo`,
    },
    refreshIntervalMs,
  };
}

function resolveSources(sources: SourceSpec[] | undefined): ResolvedSource[] {
  if (!sources?.length) return [{ common: true }];
  const seen = new Set<string>();
  return sources.map((source) => {
    const storeRef = { kind: source.storeRef.kind ?? "ConfigStore", name: source.storeRef.name };
    const label = `${storeRef.kind}/${storeRef.name}`;
    if (seen.has(label)) throw new ConfigSyncSpecError(`store ${label} is listed more than once`);
    seen.add(label);
    return { storeRef, common: source.common ?? true };
  });
}

/**
 * Resolves a ConfigSync, treating a spec that cannot be used as an answer.
 * @param sync The resource as stored in the cluster.
 * @returns The resolved resource, or undefined when its spec breaks a rule.
 */
export function resolveOrUndefined(sync: ConfigSync): ResolvedConfigSync | undefined {
  try {
    return resolveConfigSync(sync);
  } catch (error) {
    if (error instanceof ConfigSyncSpecError) return undefined;
    throw error;
  }
}
