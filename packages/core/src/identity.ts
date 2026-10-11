import type { Store } from "./types";

/** Annotation on a ServiceAccount that names the IAM role it may assume. The same one IRSA uses. */
export const ROLE_ARN_ANNOTATION = "eks.amazonaws.com/role-arn";
/** Audience of the token that is sent to AWS STS. */
export const TOKEN_AUDIENCE = "sts.amazonaws.com";

/** How a store proves who is asking, and where that identity lives. */
export interface StoreIdentity {
  /** A ServiceAccount whose token is exchanged for keys, or a Secret that holds keys. */
  method: "serviceAccount" | "secret";
  /** Namespace of the ServiceAccount or Secret. */
  namespace: string;
  /** Name of the ServiceAccount or Secret. */
  name: string;
}

/**
 * Works out the identity a store uses.
 * @param store The store.
 * @returns The ServiceAccount or Secret and its namespace, or the reason the store names no usable identity. For a
 *   ConfigStore the namespace is always the store's own.
 */
export function storeIdentity(store: Store): { ok: true; identity: StoreIdentity } | { ok: false; reason: string } {
  const { serviceAccountRef, credentialsSecretRef } = store.spec.s3;
  if (serviceAccountRef && credentialsSecretRef) {
    return { ok: false, reason: "the store names both a ServiceAccount and a credentials Secret" };
  }
  const method = serviceAccountRef ? "serviceAccount" : "secret";
  const field = serviceAccountRef ? "serviceAccountRef" : "credentialsSecretRef";
  const ref = serviceAccountRef ?? credentialsSecretRef;
  if (!ref) return { ok: false, reason: "the store names neither a ServiceAccount nor a credentials Secret" };

  const namespace = store.kind === "ConfigStore" ? store.metadata.namespace : ref.namespace;
  if (!namespace) return { ok: false, reason: `the store's ${field} names no namespace` };
  return { ok: true, identity: { method, namespace, name: ref.name } };
}

/**
 * Names the AWS session of a store, as it appears in CloudTrail.
 * @param store The store.
 * @returns "kmo-", the store's namespace or "cluster", and its name; at most 64 characters, all allowed by AWS.
 */
export function sessionName(store: Store): string {
  const raw = `kmo-${store.metadata.namespace ?? "cluster"}-${store.metadata.name}`;
  return raw.replace(/[^\w+=,.@-]/g, "-").slice(0, 64);
}
