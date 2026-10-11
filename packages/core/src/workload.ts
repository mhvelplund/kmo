import type { ResolvedConfigSync } from "./defaults";
import type { Outputs } from "./render";
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

/**
 * Tells whether a pod uses a ConfigMap or Secret.
 * @param podSpec The pod spec of a workload.
 * @param kind The kind of object.
 * @param name The object's name.
 * @returns True when a container or init container uses it through envFrom or an env entry, or a volume mounts it.
 */
export function referencesObject(podSpec: PodSpec | undefined, kind: "ConfigMap" | "Secret", name: string): boolean {
  const isConfigMap = kind === "ConfigMap";
  const containers = [...(podSpec?.containers ?? []), ...(podSpec?.initContainers ?? [])];
  const byContainer = containers.some(
    (container) =>
      (container.envFrom ?? []).some((from) => (isConfigMap ? from.configMapRef : from.secretRef)?.name === name) ||
      (container.env ?? []).some(
        (entry) => (isConfigMap ? entry.valueFrom?.configMapKeyRef : entry.valueFrom?.secretKeyRef)?.name === name,
      ),
  );
  const byVolume = (podSpec?.volumes ?? []).some(
    (volume) =>
      (isConfigMap ? volume.configMap?.name : volume.secret?.secretName) === name ||
      (volume.projected?.sources ?? []).some(
        (source) => (isConfigMap ? source.configMap : source.secret)?.name === name,
      ),
  );
  return byContainer || byVolume;
}

/**
 * Lists what is wrong with how a ConfigSync's targets are wired to its outputs.
 * @param sync The resolved ConfigSync.
 * @param outputs The merged values.
 * @param targets What the reconcile found for each target.
 * @returns One line for each problem; empty when all is well. An empty output object need not be used.
 */
export function wiringProblems(sync: ResolvedConfigSync, outputs: Outputs, targets: TargetReport[]): string[] {
  const { configMapName, secretName } = sync.output;
  const problems: string[] = [];
  for (const target of targets) {
    const what = `${target.kind} "${target.name}"`;
    if (target.state === "missing") {
      problems.push(`${what} does not exist`);
    } else if (target.state === "borrowed") {
      problems.push(`${what} takes its pod template from a Deployment; name that Deployment as the target`);
    } else {
      if (
        Object.keys(outputs.configMapData).length > 0 &&
        !referencesObject(target.podSpec, "ConfigMap", configMapName)
      ) {
        problems.push(`${what} does not use ConfigMap "${configMapName}"`);
      }
      if (Object.keys(outputs.secretData).length > 0 && !referencesObject(target.podSpec, "Secret", secretName)) {
        problems.push(`${what} does not use Secret "${secretName}"`);
      }
    }
  }
  return problems;
}
