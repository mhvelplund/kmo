import type { Store, StoreIdentity } from "@kmo/core";
import { describe, expect, it } from "vitest";
import { SyncFailure } from "../src/cluster";
import { WebIdentity, type WebIdentityDeps } from "../src/web-identity";

const store: Store = {
  kind: "ConfigStore",
  metadata: { name: "default", namespace: "payments" },
  spec: { s3: { bucket: "b", region: "eu-west-1", serviceAccountRef: { name: "store" } } },
};
const identity: StoreIdentity = { method: "serviceAccount", namespace: "payments", name: "store" };
const ROLE = "arn:aws:iam::123456789012:role/payments-config";

/** Kubernetes and AWS, replaced by stand-ins that record what they were asked. */
function world(overrides: Partial<WebIdentityDeps> = {}) {
  const calls: string[] = [];
  let clock = new Date("2026-10-11T09:00:00Z");
  const deps: WebIdentityDeps = {
    roleArnOf: async () => ROLE,
    requestToken: async (namespace, name) => {
      calls.push(`token for ${namespace}/${name}`);
      return "signed-token";
    },
    assumeRole: async ({ roleArn, token, region, sessionName }) => {
      calls.push(`assume ${roleArn} in ${region} as ${sessionName} with ${token}`);
      return {
        accessKeyId: "ASIA-TEMP",
        secretAccessKey: "temp-secret",
        sessionToken: "temp-session",
        expiresAt: new Date(clock.getTime() + 60 * 60_000),
      };
    },
    now: () => clock,
    ...overrides,
  };
  return { calls, deps, advanceMinutes: (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000)) };
}

describe("a store that is reached as a ServiceAccount", () => {
  it("gets short-lived keys in exchange for a token of that ServiceAccount", async () => {
    const { calls, deps } = world();
    const credentials = await new WebIdentity(deps).credentials(store, identity);
    expect(credentials).toEqual({
      accessKeyId: "ASIA-TEMP",
      secretAccessKey: "temp-secret",
      sessionToken: "temp-session",
    });
    expect(calls).toEqual([
      "token for payments/store",
      `assume ${ROLE} in eu-west-1 as kmo-payments-default with signed-token`,
    ]);
  });

  it("keeps the keys in memory and uses them again while they are valid", async () => {
    const { calls, deps, advanceMinutes } = world();
    const webIdentity = new WebIdentity(deps);
    await webIdentity.credentials(store, identity);
    advanceMinutes(50);
    await webIdentity.credentials(store, identity);
    expect(calls).toHaveLength(2);
  });

  it("gets new keys shortly before the old ones expire", async () => {
    const { calls, deps, advanceMinutes } = world();
    const webIdentity = new WebIdentity(deps);
    await webIdentity.credentials(store, identity);
    advanceMinutes(56);
    await webIdentity.credentials(store, identity);
    expect(calls).toHaveLength(4);
  });

  it("gets new keys at once when the ServiceAccount names another role", async () => {
    let role = ROLE;
    const { calls, deps } = world({ roleArnOf: async () => role });
    const webIdentity = new WebIdentity(deps);
    await webIdentity.credentials(store, identity);
    role = "arn:aws:iam::123456789012:role/other";
    await webIdentity.credentials(store, identity);
    expect(calls).toHaveLength(4);
  });
});

describe("a store whose ServiceAccount cannot be used", () => {
  const failure = async (deps: WebIdentityDeps): Promise<SyncFailure> => {
    try {
      await new WebIdentity(deps).credentials(store, identity);
    } catch (error) {
      return error as SyncFailure;
    }
    throw new Error("expected a failure");
  };

  it("fails when the ServiceAccount names no role", async () => {
    const error = await failure(world({ roleArnOf: async () => undefined }).deps);
    expect(error).toBeInstanceOf(SyncFailure);
    expect(error.reason).toBe("CredentialsMissing");
    expect(error.message).toBe('ServiceAccount payments/store has no annotation "eks.amazonaws.com/role-arn"');
  });

  it("fails when Kubernetes gives no token, naming the ServiceAccount", async () => {
    const requestToken = async () => {
      throw Object.assign(new Error('serviceaccounts "store" not found'), { name: "NotFound" });
    };
    const error = await failure(world({ requestToken }).deps);
    expect(error.message).toBe("could not get a token for ServiceAccount payments/store: NotFound");
  });

  it("fails when AWS refuses the role, naming the role and never the token", async () => {
    const assumeRole = async () => {
      throw Object.assign(new Error("Not authorized, token signed-token"), { name: "AccessDenied" });
    };
    const error = await failure(world({ assumeRole }).deps);
    expect(error.message).toBe(`AWS refused role "${ROLE}" for ServiceAccount payments/store: AccessDenied`);
  });
});
