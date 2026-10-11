import type { ResolvedConfigSync } from "./defaults";
import type { Outputs } from "./render";
import type { EnvValues } from "./types";

/** Label that marks an object as written by KMO. */
export const MANAGED_BY_LABEL = "app.kubernetes.io/managed-by";
/** Value of that label. */
export const MANAGED_BY = "kmo";
/** Annotation that tells Stakater Reloader to ignore an object. */
export const RELOADER_IGNORE_ANNOTATION = "reloader.stakater.com/ignore";

/** The ConfigSync that owns a pair of output objects. */
export interface Owner {
  /** API group and version of the owner. */
  apiVersion: string;
  /** Kind of the owner. */
  kind: string;
  /** Name of the owner. */
  name: string;
  /** Unique ID that the cluster gave the owner. */
  uid: string;
}

/** A ConfigMap or Secret as KMO writes it. */
export interface OutputObject {
  /** Both kinds are in the core API. */
  apiVersion: "v1";
  /** Which of the two objects this is. */
  kind: "ConfigMap" | "Secret";
  /** Set on a Secret only. */
  type?: "Opaque";
  /** Name, namespace, KMO's label and annotation, and the owner. */
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    ownerReferences: (Owner & { controller: true; blockOwnerDeletion: true })[];
  };
  /** Plain text for a ConfigMap, base64 for a Secret. */
  data: EnvValues;
}

/** The parts of an object in the cluster that the output rules read. */
export interface ExistingObject {
  /** Its labels, annotations and owners. */
  metadata?: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: { uid?: string }[];
  };
  /** Its values as the cluster holds them. */
  data?: Record<string, string>;
}

/** One JSON Patch operation. */
export interface PatchOperation {
  /** Add sets a field, whether it exists or not. */
  op: "add";
  /** JSON Pointer to the field. */
  path: string;
  /** The new value of the field. */
  value: unknown;
}

/**
 * Builds the ConfigMap and the Secret of a ConfigSync.
 * @param sync The resolved ConfigSync.
 * @param outputs The merged values.
 * @param owner The ConfigSync, as the owner of both objects.
 * @returns Both objects, each built even when it holds no values.
 */
export function outputObjects(
  sync: ResolvedConfigSync,
  outputs: Outputs,
  owner: Owner,
): { configMap: OutputObject; secret: OutputObject } {
  const metadata = (name: string): OutputObject["metadata"] => ({
    name,
    namespace: sync.namespace,
    labels: { [MANAGED_BY_LABEL]: MANAGED_BY },
    annotations: { [RELOADER_IGNORE_ANNOTATION]: "true" },
    ownerReferences: [{ ...owner, controller: true, blockOwnerDeletion: true }],
  });
  const encoded = Object.fromEntries(
    Object.entries(outputs.secretData).map(([key, value]) => [key, Buffer.from(value, "utf8").toString("base64")]),
  );
  return {
    configMap: {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: metadata(sync.output.configMapName),
      data: outputs.configMapData,
    },
    secret: {
      apiVersion: "v1",
      kind: "Secret",
      type: "Opaque",
      metadata: metadata(sync.output.secretName),
      data: encoded,
    },
  };
}

/**
 * Tells whether an object that already holds an output name blocks the write.
 * @param wanted The object KMO wants to write.
 * @param existing The object in the cluster with that name, if any.
 * @param owner The ConfigSync that wants to write.
 * @returns The problem, or undefined when the name is free or the object is this ConfigSync's own.
 */
export function takeoverProblem(
  wanted: OutputObject,
  existing: ExistingObject | undefined,
  owner: Owner,
): string | undefined {
  if (!existing) return undefined;
  const what = `${wanted.kind} "${wanted.metadata.name}"`;
  if (existing.metadata?.labels?.[MANAGED_BY_LABEL] !== MANAGED_BY)
    return `${what} already exists and was not written by KMO`;
  const owners = existing.metadata.ownerReferences ?? [];
  if (owners.length > 0 && !owners.some((reference) => reference.uid === owner.uid)) {
    return `${what} already belongs to another ConfigSync`;
  }
  return undefined;
}

/**
 * Works out the change that makes an existing output object as wanted.
 * @param wanted The object KMO wants.
 * @param existing The object in the cluster.
 * @returns JSON Patch operations, empty when nothing has to change. Labels and annotations added by others are kept.
 */
export function outputPatch(wanted: OutputObject, existing: ExistingObject): PatchOperation[] {
  const operations: PatchOperation[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  const holds = (all: Record<string, string> | undefined, part: Record<string, string>) =>
    Object.entries(part).every(([key, value]) => all?.[key] === value);

  if (!same(existing.data ?? {}, wanted.data)) operations.push({ op: "add", path: "/data", value: wanted.data });
  if (!holds(existing.metadata?.labels, wanted.metadata.labels)) {
    operations.push({
      op: "add",
      path: "/metadata/labels",
      value: { ...existing.metadata?.labels, ...wanted.metadata.labels },
    });
  }
  if (!holds(existing.metadata?.annotations, wanted.metadata.annotations)) {
    operations.push({
      op: "add",
      path: "/metadata/annotations",
      value: { ...existing.metadata?.annotations, ...wanted.metadata.annotations },
    });
  }
  const ownerUid = wanted.metadata.ownerReferences[0]?.uid;
  if (!(existing.metadata?.ownerReferences ?? []).some((reference) => reference.uid === ownerUid)) {
    operations.push({ op: "add", path: "/metadata/ownerReferences", value: wanted.metadata.ownerReferences });
  }
  return operations;
}

function sorted(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
