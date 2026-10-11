/** Values read from one env file, or merged from several. */
export type EnvValues = Record<string, string>;

/** Workload kinds a ConfigSync can target. */
export type TargetKind = "Deployment" | "StatefulSet" | "DaemonSet" | "CronJob" | "Rollout";

/** The two kinds of store. */
export type StoreKind = "ConfigStore" | "ClusterConfigStore";

/** The four files a ConfigSync reads from one store. */
export type SourceName = "config" | "secrets" | "commonConfig" | "commonSecrets";

/** A reference to a store by kind and name. */
export interface StoreRef {
  /** Which of the two kinds; a ConfigStore when left out. */
  kind?: StoreKind;
  /** Name of the store. */
  name: string;
}

/** One source of a ConfigSync: a store, and whether its common files are read. */
export interface SourceSpec {
  /** The store to read from. */
  storeRef: StoreRef;
  /** False to leave out the store's common files; true when left out. */
  common?: boolean;
}

/** The spec of a ConfigSync as written by a user; every field is optional. */
export interface ConfigSyncSpec {
  /** Pauses all syncing and restarts. */
  suspend?: boolean;
  /** Workloads that receive the config hash. */
  targets?: { kind?: TargetKind; name: string }[];
  /** The stores to read from, in order; later ones win. */
  sources?: SourceSpec[];
  /** Names of the ConfigMap and the Secret that are written. */
  output?: { configMapName?: string; secretName?: string };
  /** How often to sync without an event, such as 30m. */
  refreshInterval?: string;
}

/** A ConfigSync resource, reduced to what the core logic reads. */
export interface ConfigSync {
  /** Name and namespace of the resource, and what the cluster records about it. */
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    generation?: number;
    annotations?: Record<string, string>;
  };
  /** What the user asked for. */
  spec?: ConfigSyncSpec;
  /** What the operator last reported. */
  status?: ConfigSyncStatus;
}

/** A location in an S3-compatible bucket, and the identity to reach it. */
export interface S3Location {
  /** Name of the bucket. */
  bucket: string;
  /** Prefix put before every key. */
  keyPrefix?: string;
  /** Region of the bucket. */
  region: string;
  /** URL of the store, for stores other than AWS. */
  endpoint?: string;
  /** Where the bucket name goes in the URL. */
  addressingStyle?: "VirtualHosted" | "Path";
  /** A ServiceAccount whose token AWS exchanges for short-lived keys. */
  serviceAccountRef?: { name: string; namespace?: string };
  /** A Secret with stored keys, for stores that cannot use a ServiceAccount. */
  credentialsSecretRef?: { name: string; namespace?: string };
  /** Folder of one service's files; may hold {namespace} and {name}. */
  serviceFolder?: string;
  /** Folder of the files shared by every service; may hold {namespace} and {name}. */
  commonFolder?: string;
}

/** The spec shared by ConfigStore and ClusterConfigStore. */
export interface StoreSpec {
  /** Where the files are, for a store that is an S3-compatible bucket. */
  s3: S3Location;
  /** Namespaces that may use a cluster-wide store; * allows all. */
  allowedNamespaces?: string[];
}

/** A ConfigStore or ClusterConfigStore; only a ConfigStore has a namespace. */
export interface Store {
  /** Which of the two kinds this is. */
  kind: StoreKind;
  /** Name of the store, and its namespace for a ConfigStore. */
  metadata: { name: string; namespace?: string };
  /** Where the store is and how to reach it. */
  spec: StoreSpec;
}

/** Why a reconcile stopped without writing anything. */
export type FailureReason =
  | "InvalidSpec"
  | "StoreNotFound"
  | "CredentialsMissing"
  | "StoreUnreachable"
  | "SourceUnparsable"
  | "OutputTaken"
  | "InternalError";

/** A failed reconcile: a reason for machines and a message for people. */
export interface Failure {
  /** The reason, for machines. */
  reason: FailureReason;
  /** What went wrong, for people; never a value. */
  message: string;
}

/** One source file as recorded in a ConfigSync's status. */
export interface SourceStatus {
  /** The store it was read from, such as ClusterConfigStore/default. */
  store: string;
  /** Full key in the bucket. */
  key: string;
  /** Whether the file exists. */
  found: boolean;
  /** Version of the file that was read, when the bucket keeps versions. */
  versionId?: string;
}

/** The conditions a ConfigSync reports. */
export type ConditionType = "Ready" | "SourcesFound" | "TargetsWired" | "Suspended";

/** One named fact in a resource's status. */
export interface Condition {
  /** Which fact this is. */
  type: ConditionType;
  /** Whether the fact holds. */
  status: "True" | "False";
  /** Short and stable, for machines. */
  reason: string;
  /** For people. */
  message: string;
  /** When the status last changed between True and False. */
  lastTransitionTime: string;
}

/** The status of a ConfigSync. */
export interface ConfigSyncStatus {
  /** Generation of the spec that the last reconcile handled. */
  observedGeneration?: number;
  /** Value of the sync annotation that the last reconcile handled. */
  lastHandledSyncRequest?: string;
  /** When the outputs were last written, ISO 8601. */
  lastSyncTime?: string;
  /** Hash of the values that were last written. */
  configHash?: string;
  /** Kind and name of each store that was read, in the order of the sources. */
  stores?: string[];
  /** Every file the last good sync asked for. */
  sources?: SourceStatus[];
  /** The named facts about the resource. */
  conditions?: Condition[];
}
