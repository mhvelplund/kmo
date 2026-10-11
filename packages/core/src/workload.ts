import type { TargetKind } from "./types";

/** Annotation on a pod template that holds the hash of the config the pods received. */
export const CONFIG_HASH_ANNOTATION = "kmo.isntall.net/config-hash";

/** The API version of each kind of target. */
export const TARGET_API_VERSION: Record<TargetKind, string> = {
  Deployment: "apps/v1",
  StatefulSet: "apps/v1",
  DaemonSet: "apps/v1",
  CronJob: "batch/v1",
  Rollout: "argoproj.io/v1alpha1",
};

/** A reference from a container to a ConfigMap or Secret. */
interface ObjectReference {
  name?: string;
}

/** A container, reduced to how it can use a ConfigMap or Secret. */
export interface Container {
  /** Whole objects loaded as environment variables. */
  envFrom?: { configMapRef?: ObjectReference; secretRef?: ObjectReference }[];
  /** Single environment variables, each of which may take its value from an object. */
  env?: { valueFrom?: { configMapKeyRef?: ObjectReference; secretKeyRef?: ObjectReference } }[];
}

/** A pod spec, reduced to what the wiring check reads. */
export interface PodSpec {
  /** The containers that run for the life of the pod. */
  containers?: Container[];
  /** The containers that run before them. */
  initContainers?: Container[];
  /** Volumes, each of which may be filled from an object. */
  volumes?: {
    configMap?: ObjectReference;
    secret?: { secretName?: string };
    projected?: { sources?: { configMap?: ObjectReference; secret?: ObjectReference }[] };
  }[];
}

/** A pod template, reduced to what KMO reads. */
export interface PodTemplate {
  /** Where the config hash is stamped. */
  metadata?: { annotations?: Record<string, string> };
  /** What the pods run. */
  spec?: PodSpec;
}

/** What happened to one target of a ConfigSync. */
export type TargetState = "stamped" | "unchanged" | "missing" | "borrowed";

/** One target after a reconcile. */
export interface TargetReport {
  /** Kind of the workload. */
  kind: TargetKind;
  /** Name of the workload. */
  name: string;
  /** What happened to it. */
  state: TargetState;
  /** Absent for a missing target and for a Rollout that borrows its template. */
  podSpec?: PodSpec;
}

interface WorkloadShape {
  spec?: {
    template?: PodTemplate;
    jobTemplate?: { spec?: { template?: PodTemplate } };
    workloadRef?: unknown;
  };
}

/**
 * Finds the pod template of a workload.
 * @param kind The workload's kind.
 * @param workload The workload as the API server returns it.
 * @returns The template, or undefined when the workload has none of its own.
 */
export function podTemplate(kind: TargetKind, workload: unknown): PodTemplate | undefined {
  const spec = (workload as WorkloadShape).spec;
  return kind === "CronJob" ? spec?.jobTemplate?.spec?.template : spec?.template;
}

/**
 * Tells whether a Rollout takes its pod template from a Deployment.
 * @param kind The workload's kind.
 * @param workload The workload as the API server returns it.
 * @returns True for a Rollout with a workload reference and no template of its own.
 */
export function borrowsTemplate(kind: TargetKind, workload: unknown): boolean {
  const spec = (workload as WorkloadShape).spec;
  return kind === "Rollout" && spec?.workloadRef !== undefined && spec.template === undefined;
}

/**
 * Builds the object that sets the config hash on a workload's pod template.
 * @param kind The workload's kind.
 * @param name The workload's name.
 * @param namespace The workload's namespace.
 * @param hash The config hash.
 * @returns A partial workload for server-side apply, holding only that annotation.
 */
export function hashStamp(kind: TargetKind, name: string, namespace: string, hash: string): object {
  const template = { metadata: { annotations: { [CONFIG_HASH_ANNOTATION]: hash } } };
  return {
    apiVersion: TARGET_API_VERSION[kind],
    kind,
    metadata: { name, namespace },
    spec: kind === "CronJob" ? { jobTemplate: { spec: { template } } } : { template },
  };
}
