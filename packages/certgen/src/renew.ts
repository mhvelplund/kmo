import { X509Certificate } from "node:crypto";
import { decode, field, prepare, secretOf, writeWebhook } from "./commands";
import type { Api, Log, Settings } from "./commands";

/** The time, and a way to let it pass. */
export interface Clock {
  /** The present moment. */
  now(): Date;
  /** Ends after the number of milliseconds. */
  wait(ms: number): Promise<void>;
}

interface Pod {
  metadata: { name: string; creationTimestamp: string; deletionTimestamp?: string };
  status?: { conditions?: { type: string; status: string }[] };
}

const DAY_MS = 86_400_000;
const POLL_MS = 2000;
const READY_MS = 180_000;
const CERTIFICATES = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\r?\n?/g;

const ready = (pod: Pod): boolean =>
  !pod.metadata.deletionTimestamp &&
  (pod.status?.conditions ?? []).some((condition) => condition.type === "Ready" && condition.status === "True");

// Deletes each pod of the webhook that is older than the Secret, and waits for its replacement before the next one.
async function restartStale(api: Api, settings: Settings, log: Log, clock: Clock, issued: Date): Promise<void> {
  const path = `/api/v1/namespaces/${settings.namespace}/pods`;
  const list = async (): Promise<Pod[]> =>
    ((await api.get(`${path}?labelSelector=${encodeURIComponent("pepr.dev/controller=admission")}`))?.items ??
      []) as Pod[];

  const pods = await list();
  for (const pod of pods.filter((one) => new Date(one.metadata.creationTimestamp) < issued)) {
    const name = pod.metadata.name;
    await api.remove(`${path}/${name}`);
    log(`Restarted pod ${name}, which ran the certificate from before`);
    const end = clock.now().getTime() + READY_MS;
    for (;;) {
      await clock.wait(POLL_MS);
      const others = (await list()).filter((one) => one.metadata.name !== name && ready(one));
      if (others.length >= pods.length) break;
      if (clock.now().getTime() >= end) {
        throw new Error(
          `The pods of the webhook were not ready ${READY_MS / 1000} seconds after pod "${name}" was deleted`,
        );
      }
    }
  }
}

/**
 * Makes a new certificate when the one in the Secret is near its end, then restarts each pod that runs an older one.
 * The API server trusts the old and the new authority before the certificate changes.
 * @param api The calls to the cluster.
 * @param settings The names and the periods to work with.
 * @param log Receives one line for each thing that was done.
 * @param clock The time.
 * @returns Nothing.
 */
export async function renewKeys(api: Api, settings: Settings, log: Log, clock: Clock): Promise<void> {
  const name = settings.tlsSecret;
  let secret = await secretOf(api, settings, name);
  const end = new Date(new X509Certificate(decode(field(secret, name, "tls.crt"))).validTo).getTime();
  const daysLeft = Math.floor((end - clock.now().getTime()) / DAY_MS);

  if (daysLeft > settings.renewBeforeDays) log(`The certificate in Secret ${name} is valid for ${daysLeft} more days`);
  else {
    const secrets = `/api/v1/namespaces/${settings.namespace}/secrets`;
    const current =
      decode(field(secret, name, "ca.crt"))
        .match(CERTIFICATES)
        ?.at(-1) ?? "";
    const next = prepare(settings, clock.now(), current);
    await writeWebhook(api, settings, next.authorities);
    await api.remove(`${secrets}/${name}`);
    await api.create(secrets, next.secret);
    secret = await secretOf(api, settings, name);
    // Another Job can have made the Secret in between. Then its authorities are the ones to trust.
    await writeWebhook(api, settings, field(secret, name, "ca.crt"));
    log(`Renewed the certificate in Secret ${name}, which had ${daysLeft} days left`);
  }
  const issued = (secret.metadata as { creationTimestamp: string }).creationTimestamp;
  await restartStale(api, settings, log, clock, new Date(issued));
}
