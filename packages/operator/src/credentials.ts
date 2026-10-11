import { storeIdentity, type Store } from "@kmo/core";
import { SyncFailure, readSecretCredentials, type StoreCredentials } from "./cluster";
import { WebIdentity } from "./web-identity";

const webIdentity = new WebIdentity();

/**
 * Gets the keys to reach a store, by whichever identity the store names.
 * @param store The store.
 * @returns Short-lived keys of the store's ServiceAccount, or the stored keys of its credentials Secret.
 * @throws SyncFailure with reason CredentialsMissing when the identity cannot be used.
 */
export async function readCredentials(store: Store): Promise<StoreCredentials> {
  const resolved = storeIdentity(store);
  if (!resolved.ok) throw new SyncFailure("CredentialsMissing", resolved.reason);
  const { identity } = resolved;
  return identity.method === "serviceAccount"
    ? webIdentity.credentials(store, identity)
    : readSecretCredentials(identity.namespace, identity.name);
}
