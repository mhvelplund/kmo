import { ConfigSyncSpecError, parseDuration } from "./duration";
import type { ConfigSync, SourceName, StoreKind, TargetKind } from "./types";

export { ConfigSyncSpecError } from "./duration";

/** Folder holding the files shared by every workload of a store. */
export const COMMON_FOLDER = "_common";

const DEFAULT_REFRESH_INTERVAL = "30m";
const MINIMUM_REFRESH_INTERVAL_MS = 60_000;

/** A ConfigSync with every default filled in. */
export interface ResolvedConfigSync {
  name: string;
  namespace: string;
  suspend: boolean;
  targets: { kind: TargetKind; name: string }[];
  /** Absent when the spec names no store. */
  storeRef?: { kind: StoreKind; name: string };
  /** Keys relative to the store's key prefix. */
  source: Record<SourceName, string>;
  output: { configMapName: string; secretName: string };
  refreshIntervalMs: number;
}

/**
 * Fills in the defaults of a ConfigSync from its name and namespace.
 * @param sync The resource as stored in the cluster.
 * @returns The resource with no optional field left open, except the store reference.
 * @throws ConfigSyncSpecError if the refresh interval is unreadable or under one minute.
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
    storeRef: spec.storeRef && { kind: spec.storeRef.kind ?? "ConfigStore", name: spec.storeRef.name },
    source: {
      config: spec.source?.config ?? `${namespace}/${name}/config.env`,
      secrets: spec.source?.secrets ?? `${namespace}/${name}/secrets.env`,
      commonConfig: spec.source?.commonConfig ?? `${COMMON_FOLDER}/config.env`,
      commonSecrets: spec.source?.commonSecrets ?? `${COMMON_FOLDER}/secrets.env`,
    },
    output: {
      configMapName: spec.output?.configMapName ?? `${name}-kmo`,
      secretName: spec.output?.secretName ?? `${name}-kmo`,
    },
    refreshIntervalMs,
  };
}
