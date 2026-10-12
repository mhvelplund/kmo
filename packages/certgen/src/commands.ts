import { makeAddress, makeWebhookKeys } from "./keys";
import type { WebhookKeys } from "./keys";

/** A Kubernetes object, as the API server sends it. */
export type KubeObject = Record<string, unknown>;

/** One operation of a JSON patch. */
export interface PatchOperation {
  /** The operation; `add` also replaces a value that is there. */
  op: "add";
  /** The JSON pointer of the field. */
  path: string;
  /** The new value. */
  value: string;
}

/** The four calls that the commands make. */
export interface Api {
  /** Reads one object or one list; gives undefined when it does not exist. */
  get(path: string): Promise<KubeObject | undefined>;
  /** Creates an object in a collection; says if it was there already. */
  create(path: string, body: KubeObject): Promise<"created" | "exists">;
  /** Applies a JSON patch to one object. */
  patch(path: string, operations: PatchOperation[]): Promise<void>;
  /** Deletes one object; an object that is gone is not an error. */
  remove(path: string): Promise<void>;
}

/** The names and the periods that the commands work with. */
export interface Settings {
  /** The namespace of the operator. */
  namespace: string;
  /** The name of the Secret with the key. */
  tlsSecret: string;
  /** The name of the Secret with the address. */
  addressSecret: string;
  /** The name of the ValidatingWebhookConfiguration. */
  webhook: string;
  /** The name of the webhook's Service. */
  service: string;
  /** The number of days that a new certificate is valid. */
  days: number;
  /** A certificate is renewed when it has this number of days left, or fewer. */
  renewBeforeDays: number;
}

/** Writes one line of the log. */
export type Log = (line: string) => void;

/**
 * Encodes a text as base64, as the data of a Secret needs it.
 * @param text The text.
 * @returns The base64 form.
 */
export const encode = (text: string): string => Buffer.from(text).toString("base64");

/**
 * Decodes base64 to a text.
 * @param text The base64 form.
 * @returns The text.
 */
export const decode = (text: string): string => Buffer.from(text, "base64").toString();

/**
 * Reads one value of a Secret, still in base64.
 * @param secret The Secret.
 * @param name The name of the Secret, for the message.
 * @param key The key of the value.
 * @returns The value; throws when the Secret does not hold the key.
 */
export function field(secret: KubeObject, name: string, key: string): string {
  const value = (secret.data as Record<string, string> | undefined)?.[key];
  if (!value) throw new Error(`Secret "${name}" has no "${key}". Delete the Secret and install again.`);
  return value;
}

/**
 * Reads a Secret that must exist.
 * @param api The calls to the cluster.
 * @param settings The names to work on.
 * @param name The name of the Secret.
 * @returns The Secret; throws when it does not exist.
 */
export async function secretOf(api: Api, settings: Settings, name: string): Promise<KubeObject> {
  const secret = await api.get(`/api/v1/namespaces/${settings.namespace}/secrets/${name}`);
  if (!secret) throw new Error(`Secret "${name}" was not found in namespace "${settings.namespace}"`);
  return secret;
}

/** A webhook key and the body of the Secret that holds it. */
export interface Issued {
  /** The authorities of the Secret, in base64. */
  authorities: string;
  /** The body of the Secret. */
  secret: KubeObject;
}

/**
 * Makes a new webhook key, and the Secret for it, without a call to the cluster.
 * @param settings The names and the periods to work with.
 * @param now The moment of issue.
 * @param before The authorities to keep in front of the new one, as PEM.
 * @returns The authorities and the body of the Secret.
 */
export function prepare(settings: Settings, now: Date, before = ""): Issued {
  const keys: WebhookKeys = makeWebhookKeys(`${settings.service}.${settings.namespace}.svc`, settings.days, now);
  const authorities = encode(before + keys.ca);
  return {
    authorities,
    secret: {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: settings.tlsSecret, namespace: settings.namespace },
      type: "kubernetes.io/tls",
      data: { "tls.crt": encode(keys.certificate), "tls.key": encode(keys.key), "ca.crt": authorities },
    },
  };
}

/**
 * Makes a new webhook key and creates the Secret that holds it.
 * @param api The calls to the cluster.
 * @param settings The names and the periods to work with.
 * @param now The moment of issue.
 * @returns True when the Secret was created; false when it was there already.
 */
export async function issue(api: Api, settings: Settings, now: Date): Promise<boolean> {
  const secrets = `/api/v1/namespaces/${settings.namespace}/secrets`;
  return (await api.create(secrets, prepare(settings, now).secret)) === "created";
}

/**
 * Writes the authorities, and the address when one is given, into each webhook of the configuration.
 * @param api The calls to the cluster.
 * @param settings The names to work on.
 * @param caBundle The authorities, in base64.
 * @param path The path of the webhook; left as it is when undefined.
 * @returns True when a field was changed.
 */
export async function writeWebhook(api: Api, settings: Settings, caBundle: string, path?: string): Promise<boolean> {
  const url = `/apis/admissionregistration.k8s.io/v1/validatingwebhookconfigurations/${settings.webhook}`;
  const configuration = await api.get(url);
  if (!configuration) throw new Error(`ValidatingWebhookConfiguration "${settings.webhook}" was not found`);
  const webhooks = (configuration.webhooks ?? []) as {
    clientConfig?: { caBundle?: string; service?: { path?: string } };
  }[];

  const operations: PatchOperation[] = [];
  webhooks.forEach((webhook, index) => {
    const config = `/webhooks/${index}/clientConfig`;
    if (webhook.clientConfig?.caBundle !== caBundle) {
      operations.push({ op: "add", path: `${config}/caBundle`, value: caBundle });
    }
    if (path !== undefined && webhook.clientConfig?.service?.path !== path) {
      operations.push({ op: "add", path: `${config}/service/path`, value: path });
    }
  });
  if (operations.length > 0) await api.patch(url, operations);
  return operations.length > 0;
}

/**
 * Makes the Secret with the key and the Secret with the address, each only when it is missing.
 * @param api The calls to the cluster.
 * @param settings The names to work on.
 * @param log Receives one line for each Secret.
 * @param now The moment of issue of a new certificate.
 * @returns Nothing.
 */
export async function createKeys(api: Api, settings: Settings, log: Log, now: Date = new Date()): Promise<void> {
  const secrets = `/api/v1/namespaces/${settings.namespace}/secrets`;
  const made = !(await api.get(`${secrets}/${settings.tlsSecret}`)) && (await issue(api, settings, now));
  log(made ? `Created Secret ${settings.tlsSecret}` : `Left Secret ${settings.tlsSecret} as it is`);

  const address = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: settings.addressSecret, namespace: settings.namespace },
    data: { value: encode(makeAddress()) },
  };
  const added =
    !(await api.get(`${secrets}/${settings.addressSecret}`)) && (await api.create(secrets, address)) === "created";
  log(added ? `Created Secret ${settings.addressSecret}` : `Left Secret ${settings.addressSecret} as it is`);
}

/**
 * Writes the authorities and the address from the two Secrets into the webhook configuration.
 * @param api The calls to the cluster.
 * @param settings The names to work on.
 * @param log Receives one line that says if anything changed.
 * @returns Nothing.
 */
export async function patchWebhook(api: Api, settings: Settings, log: Log): Promise<void> {
  const caBundle = field(await secretOf(api, settings, settings.tlsSecret), settings.tlsSecret, "ca.crt");
  const address = field(await secretOf(api, settings, settings.addressSecret), settings.addressSecret, "value");
  const changed = await writeWebhook(api, settings, caBundle, `/validate/${decode(address)}`);
  log(
    changed
      ? `Wrote the authority and the address into ValidatingWebhookConfiguration ${settings.webhook}`
      : `Left ValidatingWebhookConfiguration ${settings.webhook} as it is`,
  );
}
