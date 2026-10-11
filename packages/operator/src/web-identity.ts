import { AssumeRoleWithWebIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { ROLE_ARN_ANNOTATION, TOKEN_AUDIENCE, sessionName, type Store, type StoreIdentity } from "@kmo/core";
import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { a } from "pepr";
import { SyncFailure, getOrUndefined, type StoreCredentials } from "./cluster";

/** Keys that stop working at a known time. */
export interface TimedCredentials extends StoreCredentials {
  /** When the keys stop working. */
  expiresAt: Date;
}

/** What the exchange needs from Kubernetes and AWS; replaced in tests. */
export interface WebIdentityDeps {
  /** Reads the role a ServiceAccount names; undefined when it names none. */
  roleArnOf(namespace: string, name: string): Promise<string | undefined>;
  /** Asks Kubernetes for a short-lived token of a ServiceAccount, made out to AWS STS. */
  requestToken(namespace: string, name: string): Promise<string>;
  /** Exchanges a token for keys of a role. */
  assumeRole(request: {
    roleArn: string;
    token: string;
    region: string;
    sessionName: string;
  }): Promise<TimedCredentials>;
  /** The current time. */
  now(): Date;
}

const REFRESH_MARGIN_MS = 5 * 60_000;
const TOKEN_SECONDS = 600;

let coreApi: CoreV1Api | undefined;
function core(): CoreV1Api {
  if (!coreApi) {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    coreApi = kubeConfig.makeApiClient(CoreV1Api);
  }
  return coreApi;
}

const clusterAndAws: WebIdentityDeps = {
  roleArnOf: async (namespace, name) =>
    (await getOrUndefined(a.ServiceAccount, name, namespace))?.metadata?.annotations?.[ROLE_ARN_ANNOTATION],
  requestToken: async (namespace, name) => {
    const body = { spec: { audiences: [TOKEN_AUDIENCE], expirationSeconds: TOKEN_SECONDS } };
    const response = await core().createNamespacedServiceAccountToken({ namespace, name, body });
    return response.status?.token ?? "";
  },
  assumeRole: async ({ roleArn, token, region, sessionName }) => {
    const response = await new STSClient({ region }).send(
      new AssumeRoleWithWebIdentityCommand({ RoleArn: roleArn, RoleSessionName: sessionName, WebIdentityToken: token }),
    );
    const keys = response.Credentials;
    if (!keys?.AccessKeyId || !keys.SecretAccessKey || !keys.Expiration) throw new Error("no credentials returned");
    return {
      accessKeyId: keys.AccessKeyId,
      secretAccessKey: keys.SecretAccessKey,
      sessionToken: keys.SessionToken,
      expiresAt: keys.Expiration,
    };
  },
  now: () => new Date(),
};

/** Reaches AWS as a store's ServiceAccount, and keeps the short-lived keys in memory until they are about to expire. */
export class WebIdentity {
  readonly #cache = new Map<string, TimedCredentials>();
  readonly #deps: WebIdentityDeps;

  /** @param deps Kubernetes and AWS; replaced in tests. */
  constructor(deps: WebIdentityDeps = clusterAndAws) {
    this.#deps = deps;
  }

  /**
   * Gets keys for a store.
   * @param store The store.
   * @param identity The store's ServiceAccount.
   * @returns Keys valid for at least five more minutes.
   * @throws SyncFailure with reason CredentialsMissing when the ServiceAccount names no role, Kubernetes gives no
   *   token, or AWS refuses the role. The message never holds the token.
   */
  async credentials(store: Store, identity: StoreIdentity): Promise<StoreCredentials> {
    const { namespace, name } = identity;
    const who = `ServiceAccount ${namespace}/${name}`;

    const roleArn = await this.#deps.roleArnOf(namespace, name);
    if (!roleArn) throw new SyncFailure("CredentialsMissing", `${who} has no annotation "${ROLE_ARN_ANNOTATION}"`);

    const key = `${namespace}/${name}|${roleArn}|${store.spec.s3.region}`;
    let timed = this.#cache.get(key);
    if (!timed || timed.expiresAt.getTime() - this.#deps.now().getTime() < REFRESH_MARGIN_MS) {
      const token = await this.#deps.requestToken(namespace, name).catch((error: unknown) => {
        throw new SyncFailure("CredentialsMissing", `could not get a token for ${who}: ${errorName(error)}`);
      });
      const request = { roleArn, token, region: store.spec.s3.region, sessionName: sessionName(store) };
      timed = await this.#deps.assumeRole(request).catch((error: unknown) => {
        throw new SyncFailure("CredentialsMissing", `AWS refused role "${roleArn}" for ${who}: ${errorName(error)}`);
      });
      this.#cache.set(key, timed);
    }
    const { accessKeyId, secretAccessKey, sessionToken } = timed;
    return { accessKeyId, secretAccessKey, sessionToken };
  }
}

function errorName(error: unknown): string {
  return (error as { name?: string }).name ?? "unknown error";
}
