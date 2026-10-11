import type { Condition, ConfigSync, ConfigSyncSpec, ConfigSyncStatus, Owner, StoreSpec } from "@kmo/core";
import { RegisterKind, kind } from "pepr";
import type { GuardedKind } from "./guarded-kind";

/** An Argo Rollout, reduced to what KMO reads. */
export class Rollout extends kind.GenericKind {
  spec?: {
    workloadRef?: { kind?: string; name?: string };
    template?: { metadata?: { annotations?: Record<string, string> }; spec?: unknown };
  };
}
RegisterKind(Rollout, { group: "argoproj.io", version: "v1alpha1", kind: "Rollout", plural: "rollouts" });

/** Argo Rollouts is optional, so the Rollout kind is guarded. */
export const ROLLOUT_GUARD: GuardedKind = {
  kind: "Rollout",
  definition: "rollouts.argoproj.io",
  setting: "KMO_GUARD_ROLLOUT_WATCH",
};

/** A ConfigSync as the client returns it. */
export class ConfigSyncKind extends kind.GenericKind {
  spec?: ConfigSyncSpec;
  status?: ConfigSyncStatus;
}
RegisterKind(ConfigSyncKind, {
  group: "kmo.isntall.net",
  version: "v1alpha1",
  kind: "ConfigSync",
  plural: "configsyncs",
});

/** A ConfigStore as the client returns it. */
export class ConfigStoreKind extends kind.GenericKind {
  spec?: StoreSpec;
  status?: { conditions?: Condition[] };
}
RegisterKind(ConfigStoreKind, {
  group: "kmo.isntall.net",
  version: "v1alpha1",
  kind: "ConfigStore",
  plural: "configstores",
});

/** A ClusterConfigStore as the client returns it. */
export class ClusterConfigStoreKind extends kind.GenericKind {
  spec?: StoreSpec;
  status?: { conditions?: Condition[] };
}
RegisterKind(ClusterConfigStoreKind, {
  group: "kmo.isntall.net",
  version: "v1alpha1",
  kind: "ClusterConfigStore",
  plural: "clusterconfigstores",
});

/**
 * Reduces a ConfigSync from the cluster to what the core logic reads.
 * @param sync The resource as the client returns it.
 * @returns The same resource with a name and a namespace that are known to be set.
 */
export function toCore(sync: ConfigSyncKind): ConfigSync {
  return {
    metadata: {
      name: sync.metadata?.name ?? "",
      namespace: sync.metadata?.namespace ?? "",
      uid: sync.metadata?.uid,
      generation: sync.metadata?.generation,
      annotations: sync.metadata?.annotations,
    },
    spec: sync.spec,
    status: sync.status,
  };
}

/**
 * Names a ConfigSync as the owner of its output objects.
 * @param sync The resource as the client returns it.
 * @returns The owner reference fields.
 */
export function ownerOf(sync: ConfigSyncKind): Owner {
  return {
    apiVersion: "kmo.isntall.net/v1alpha1",
    kind: "ConfigSync",
    name: sync.metadata?.name ?? "",
    uid: sync.metadata?.uid ?? "",
  };
}
