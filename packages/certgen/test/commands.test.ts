import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createKeys, patchWebhook } from "../src/commands";
import type { Api, KubeObject, PatchOperation, Settings } from "../src/commands";
import { renewKeys } from "../src/renew";

const SETTINGS: Settings = {
  namespace: "pepr-system",
  tlsSecret: "pepr-kmo-tls",
  addressSecret: "pepr-kmo-api-path",
  webhook: "pepr-kmo",
  service: "pepr-kmo",
  days: 90,
  renewBeforeDays: 30,
};
const SECRETS = "/api/v1/namespaces/pepr-system/secrets";
const TLS = `${SECRETS}/pepr-kmo-tls`;
const ADDRESS = `${SECRETS}/pepr-kmo-api-path`;
const PODS = "/api/v1/namespaces/pepr-system/pods";
const WEBHOOK = "/apis/admissionregistration.k8s.io/v1/validatingwebhookconfigurations/pepr-kmo";
const NOW = new Date("2026-10-11T12:00:00Z");
const DAY_MS = 86_400_000;
const CERTIFICATE = /-----BEGIN CERTIFICATE-----/g;

interface Pod {
  metadata: { name: string; creationTimestamp: string };
  status: { conditions: { type: string; status: string }[] };
}
interface ClientConfig {
  caBundle?: string;
  service: { path?: string };
}

// A cluster in memory. A deleted pod gets a replacement, which is ready after the next wait.
function cluster(replacementsGetReady = true) {
  let now = NOW;
  let replacements = 0;
  const objects: Record<string, KubeObject> = { [WEBHOOK]: { webhooks: [{ clientConfig: { service: {} } }] } };
  const calls: string[] = [];
  const lines: string[] = [];
  const pods: Pod[] = [];
  const pod = (name: string, ready: boolean): Pod => ({
    metadata: { name, creationTimestamp: now.toISOString() },
    status: { conditions: [{ type: "Ready", status: ready ? "True" : "False" }] },
  });
  const api: Api = {
    get: async (path) => (path.startsWith(PODS) ? { items: pods } : objects[path]),
    create: async (path, body) => {
      const metadata = body.metadata as { name: string; creationTimestamp?: string };
      if (objects[`${path}/${metadata.name}`]) return "exists";
      metadata.creationTimestamp = now.toISOString();
      objects[`${path}/${metadata.name}`] = body;
      calls.push(`create ${metadata.name}`);
      return "created";
    },
    patch: async (path, operations: PatchOperation[]) => {
      calls.push("patch");
      const webhooks = objects[path]?.webhooks as { clientConfig: ClientConfig }[];
      for (const operation of operations) {
        const [, , index, , field] = operation.path.split("/");
        const config = webhooks[Number(index)]!.clientConfig;
        if (field === "caBundle") config.caBundle = operation.value;
        else config.service.path = operation.value;
      }
    },
    remove: async (path) => {
      const name = path.split("/").at(-1) ?? "";
      calls.push(`delete ${name}`);
      if (!path.startsWith(`${PODS}/`)) {
        objects[path] = undefined as unknown as KubeObject;
        return;
      }
      pods.splice(
        pods.findIndex((one) => one.metadata.name === name),
        1,
      );
      pods.push(pod(`replacement-${++replacements}`, false));
    },
  };
  const clock = {
    now: () => now,
    wait: async (ms: number) => {
      calls.push("wait");
      now = new Date(now.getTime() + ms);
      if (replacementsGetReady) for (const one of pods) one.status.conditions = [{ type: "Ready", status: "True" }];
    },
  };
  return {
    api,
    calls,
    lines,
    clock,
    log: (line: string) => lines.push(line),
    addPods: (...names: string[]) => pods.push(...names.map((name) => pod(name, true))),
    passDays: (days: number) => (now = new Date(now.getTime() + days * DAY_MS)),
    secret: (path: string, key: string) =>
      Buffer.from((objects[path]?.data as Record<string, string> | undefined)?.[key] ?? "", "base64").toString(),
    setSecret: (path: string, data: Record<string, string>) => (objects[path] = { metadata: {}, data }),
    config: () => (objects[WEBHOOK]?.webhooks as { clientConfig: ClientConfig }[])[0]!.clientConfig,
    podCalls: () =>
      calls.filter((call) => call === "wait" || (call.startsWith("delete ") && !call.includes("pepr-kmo"))),
  };
}

// A cluster that was installed at NOW: the two Secrets, the webhook configuration and two pods of the webhook.
async function installed(replacementsGetReady = true) {
  const c = cluster(replacementsGetReady);
  await createKeys(c.api, SETTINGS, c.log, c.clock.now());
  await patchWebhook(c.api, SETTINGS, c.log);
  c.addPods("a", "b");
  c.calls.length = 0;
  return c;
}

describe("the Job before the installation", () => {
  it("makes the two Secrets when they are missing", async () => {
    const c = cluster();
    await createKeys(c.api, SETTINGS, c.log, NOW);
    expect(c.calls).toEqual(["create pepr-kmo-tls", "create pepr-kmo-api-path"]);
    expect(c.secret(TLS, "tls.key")).toContain("PRIVATE KEY");
    expect(c.secret(ADDRESS, "value")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaves a Secret that is there as it is", async () => {
    const c = cluster();
    await createKeys(c.api, SETTINGS, c.log, NOW);
    const key = c.secret(TLS, "tls.key");
    await createKeys(c.api, SETTINGS, c.log, NOW);
    expect(c.calls).toHaveLength(2);
    expect(c.secret(TLS, "tls.key")).toBe(key);
  });
});

describe("the Job after the installation", () => {
  it("writes the authority and the address into the webhook configuration", async () => {
    const c = await installed();
    expect(Buffer.from(c.config().caBundle ?? "", "base64").toString()).toBe(c.secret(TLS, "ca.crt"));
    expect(c.config().service.path).toBe(`/validate/${c.secret(ADDRESS, "value")}`);
  });

  it("changes nothing when it runs again", async () => {
    const c = await installed();
    await patchWebhook(c.api, SETTINGS, c.log);
    expect(c.calls).toEqual([]);
  });

  it("stops when a Secret is missing", async () => {
    const c = cluster();
    await expect(patchWebhook(c.api, SETTINGS, c.log)).rejects.toThrow('Secret "pepr-kmo-tls" was not found');
  });

  it("says what to do with a Secret from an older installation, which has no authority", async () => {
    const c = cluster();
    c.setSecret(TLS, { "tls.crt": "eA==", "tls.key": "eA==" });
    c.setSecret(ADDRESS, { value: "eA==" });
    await expect(patchWebhook(c.api, SETTINGS, c.log)).rejects.toThrow(
      'Secret "pepr-kmo-tls" has no "ca.crt". Delete the Secret and install again.',
    );
  });
});

describe("the daily renewal", () => {
  it("leaves a certificate alone that has more than 30 days left", async () => {
    const c = await installed();
    c.passDays(59);
    await renewKeys(c.api, SETTINGS, c.log, c.clock);
    expect(c.calls).toEqual([]);
  });

  it("makes a new certificate when 30 days are left", async () => {
    const c = await installed();
    const key = c.secret(TLS, "tls.key");
    c.passDays(60);
    await renewKeys(c.api, SETTINGS, c.log, c.clock);
    expect(c.secret(TLS, "tls.key")).not.toBe(key);
    expect(new Date(new X509Certificate(c.secret(TLS, "tls.crt")).validTo).getTime()).toBe(
      NOW.getTime() + 150 * DAY_MS,
    );
  });

  it("makes the API server trust the old and the new authority before the certificate changes", async () => {
    const c = await installed();
    const old = c.secret(TLS, "ca.crt");
    c.passDays(60);
    await renewKeys(c.api, SETTINGS, c.log, c.clock);
    expect(c.calls.slice(0, 3)).toEqual(["patch", "delete pepr-kmo-tls", "create pepr-kmo-tls"]);
    const trusted = Buffer.from(c.config().caBundle ?? "", "base64").toString();
    expect(trusted.match(CERTIFICATE)).toHaveLength(2);
    expect(trusted.startsWith(old)).toBe(true);
    expect(trusted).toBe(c.secret(TLS, "ca.crt"));
  });

  it("restarts the pods of the webhook one at a time, and waits for each replacement", async () => {
    const c = await installed();
    c.passDays(60);
    await renewKeys(c.api, SETTINGS, c.log, c.clock);
    expect(c.podCalls()).toEqual(["delete a", "wait", "delete b", "wait"]);
  });

  it("restarts pods that still run the old certificate, after a renewal that was interrupted", async () => {
    const c = cluster();
    c.addPods("a", "b");
    c.passDays(1);
    await createKeys(c.api, SETTINGS, c.log, c.clock.now());
    await renewKeys(c.api, SETTINGS, c.log, c.clock);
    expect(c.calls).not.toContain("delete pepr-kmo-tls");
    expect(c.podCalls()).toEqual(["delete a", "wait", "delete b", "wait"]);
  });

  it("stops when a replacement does not become ready, and leaves the other pod running", async () => {
    const c = await installed(false);
    c.passDays(60);
    await expect(renewKeys(c.api, SETTINGS, c.log, c.clock)).rejects.toThrow(
      'The pods of the webhook were not ready 180 seconds after pod "a" was deleted',
    );
    expect(c.calls).not.toContain("delete b");
  });

  it("keeps the last two authorities only", async () => {
    const c = await installed();
    c.passDays(60);
    await renewKeys(c.api, SETTINGS, c.log, c.clock);
    c.passDays(60);
    await renewKeys(c.api, SETTINGS, c.log, c.clock);
    expect(c.secret(TLS, "ca.crt").match(CERTIFICATE)).toHaveLength(2);
  });
});

describe("the log of the Jobs", () => {
  it("never holds the key or the address", async () => {
    const c = await installed();
    c.passDays(60);
    await renewKeys(c.api, SETTINGS, c.log, c.clock);
    const log = c.lines.join("\n");
    expect(log).toContain("pepr-kmo-tls");
    expect(log).not.toContain(c.secret(ADDRESS, "value"));
    expect(log).not.toContain("PRIVATE KEY");
  });
});
