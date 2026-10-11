import type { FailureReason, Store } from "@kmo/core";
import type { GenericClass } from "kubernetes-fluent-client";
import { K8s, a } from "pepr";
import { ClusterConfigStoreKind, ConfigStoreKind } from "./kinds";

/** The keys to one store. */
export interface StoreCredentials {
  /** The public half of the key pair. */
  accessKeyId: string;
  /** The secret half of the key pair. */
  secretAccessKey: string;
  /** The third part of short-lived keys; absent for stored keys. */
  sessionToken?: string;
}

/** Raised when a reconcile must stop without writing anything. */
export class SyncFailure extends Error {
  /**
   * @param reason The machine-readable reason.
   * @param message What went wrong, without any value from a file or a credential.
   */
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
    this.name = "SyncFailure";
  }
}

/**
 * Gets one object, treating "not found" as an answer.
 * @param model The kind to read.
 * @param name The object's name.
 * @param namespace Its namespace, for namespaced kinds.
 * @returns The object, or undefined when it or its kind does not exist.
 */
export async function getOrUndefined<T extends GenericClass>(
  model: T,
  name: string,
  namespace?: string,
): Promise<InstanceType<T> | undefined> {
  try {
    const client = namespace ? K8s(model).InNamespace(namespace) : K8s(model);
    return (await client.Get(name)) as InstanceType<T>;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined;
    throw error;
  }
}

/**
 * Lists every store in the cluster.
 * @returns Namespace stores and cluster-wide stores, in the shape the core logic reads.
 */
export async function listStores(): Promise<Store[]> {
  const [own, clusterWide] = await Promise.all([K8s(ConfigStoreKind).Get(), K8s(ClusterConfigStoreKind).Get()]);
  const usable = (item: ConfigStoreKind | ClusterConfigStoreKind) => item.spec !== undefined && item.metadata?.name;
  return [
    ...own.items.filter(usable).map((item): Store => ({
      kind: "ConfigStore",
      metadata: { name: item.metadata!.name!, namespace: item.metadata!.namespace },
      spec: item.spec!,
    })),
    ...clusterWide.items.filter(usable).map((item): Store => ({
      kind: "ClusterConfigStore",
      metadata: { name: item.metadata!.name! },
      spec: item.spec!,
    })),
  ];
}

/**
 * Reads a store's keys out of the data of its credentials Secret.
 * @param data The Secret's data, base64-encoded as the API server returns it.
 * @param where A name for the Secret, used in the error.
 * @returns The decoded keys.
 * @throws SyncFailure with reason CredentialsMissing when a key is absent or empty.
 */
export function credentialsFrom(data: Record<string, string> | undefined, where: string): StoreCredentials {
  const read = (key: keyof StoreCredentials) => {
    const value = Buffer.from(data?.[key] ?? "", "base64").toString("utf8");
    if (value === "") throw new SyncFailure("CredentialsMissing", `${where} has no key "${key}"`);
    return value;
  };
  return { accessKeyId: read("accessKeyId"), secretAccessKey: read("secretAccessKey") };
}

/**
 * Reads stored keys from a credentials Secret.
 * @param namespace The Secret's namespace.
 * @param name The Secret's name.
 * @returns The keys.
 * @throws SyncFailure with reason CredentialsMissing when the Secret or one of its keys is absent.
 */
export async function readSecretCredentials(namespace: string, name: string): Promise<StoreCredentials> {
  const where = `Secret ${namespace}/${name}`;
  const secret = await getOrUndefined(a.Secret, name, namespace);
  if (!secret) throw new SyncFailure("CredentialsMissing", `${where} was not found`);
  return credentialsFrom(secret.data, where);
}
