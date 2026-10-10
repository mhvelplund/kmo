/** Values read from one env file, or merged from several. */
export type EnvValues = Record<string, string>;

/** Workload kinds a ConfigSync can target. */
export type TargetKind = "Deployment" | "StatefulSet" | "DaemonSet" | "CronJob" | "Rollout";

/** The two kinds of store. */
export type StoreKind = "ConfigStore" | "ClusterConfigStore";

/** The four files a ConfigSync reads. */
export type SourceName = "config" | "secrets" | "commonConfig" | "commonSecrets";

/** The spec of a ConfigSync as written by a user; every field is optional. */
export interface ConfigSyncSpec {
  suspend?: boolean;
  targets?: { kind?: TargetKind; name: string }[];
  storeRef?: { kind?: StoreKind; name: string };
  source?: Partial<Record<SourceName, string>>;
  output?: { configMapName?: string; secretName?: string };
  refreshInterval?: string;
}

/** A ConfigSync resource, reduced to what the core logic reads. */
export interface ConfigSync {
  metadata: { name: string; namespace: string };
  spec?: ConfigSyncSpec;
}

/** The spec shared by ConfigStore and ClusterConfigStore. */
export interface StoreSpec {
  bucket: string;
  keyPrefix?: string;
  region: string;
  endpoint?: string;
  addressingStyle?: "VirtualHosted" | "Path";
  credentialsSecretRef: { name: string; namespace?: string };
  allowedNamespaces?: string[];
}

/** A ConfigStore or ClusterConfigStore; only a ConfigStore has a namespace. */
export interface Store {
  kind: StoreKind;
  metadata: { name: string; namespace?: string };
  spec: StoreSpec;
}
