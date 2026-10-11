import type { ConfigSync, ConfigSyncSpec, Store } from "@kmo/core";
import { describe, expect, it } from "vitest";
import eventBridgeCreated from "../../core/test/fixtures/eventbridge-object-created.json";
import parameterStore from "../../core/test/fixtures/eventbridge-parameter-store.json";
import rustfsDelete from "../../core/test/fixtures/rustfs-delete.json";
import rustfsPut from "../../core/test/fixtures/rustfs-put.json";
import { handle, type ReceiverDeps, type ReceiverRequest } from "../src/handler";

const TOKEN = "kmo-local-token";

/** The cluster-wide store named default, on the bucket of the captured events. */
const defaultStore: Store = {
  kind: "ClusterConfigStore",
  metadata: { name: "default" },
  spec: {
    s3: { bucket: "kmo-config", region: "us-east-1", credentialsSecretRef: { name: "keys", namespace: "kmo-system" } },
    allowedNamespaces: ["*"],
  },
};

/** A ConfigSync in namespace shop. */
function sync(name: string, spec?: ConfigSyncSpec): ConfigSync {
  return { metadata: { name, namespace: "shop", uid: `uid-${name}` }, spec };
}

/** A receiver on a cluster with two ConfigSyncs, and the names it asked a sync for. */
function receiver(overrides: Partial<ReceiverDeps> = {}) {
  const requested: string[] = [];
  const deps: ReceiverDeps = {
    token: TOKEN,
    ready: () => true,
    syncs: () => [sync("orders-api"), sync("checkout")],
    stores: () => [defaultStore],
    requestSync: async (target) => {
      requested.push(target.metadata.name);
    },
    log: () => {},
    ...overrides,
  };
  const send = (request: Partial<ReceiverRequest> = {}) =>
    handle({ method: "POST", path: "/events/rustfs", authorization: `Bearer ${TOKEN}`, body: "", ...request }, deps);
  return { requested, send };
}

/** A notification body with one record for each key, encoded as RustFS sends them. */
function notification(...keys: string[]): string {
  return JSON.stringify({
    Records: keys.map((key) => ({ s3: { bucket: { name: "kmo-config" }, object: { key: encodeURIComponent(key) } } })),
  });
}

/** An S3 event as EventBridge delivers it. */
function s3Event(bucket: string, key: string): string {
  return JSON.stringify({ source: "aws.s3", detail: { bucket: { name: bucket }, object: { key } } });
}

describe("a RustFS notification", () => {
  it("asks for a sync of the ConfigSync whose file was uploaded", async () => {
    const { requested, send } = receiver();
    expect((await send({ body: JSON.stringify(rustfsPut) })).status).toBe(200);
    expect(requested).toEqual(["orders-api"]);
  });

  it("treats a deleted file the same way", async () => {
    const { requested, send } = receiver();
    expect((await send({ body: JSON.stringify(rustfsDelete) })).status).toBe(200);
    expect(requested).toEqual(["orders-api"]);
  });

  it("asks for a sync of every ConfigSync of the store when a common file changed", async () => {
    const { requested, send } = receiver();
    await send({ body: notification("_common/secrets.env") });
    expect(requested.sort()).toEqual(["checkout", "orders-api"]);
  });

  it("answers 200 and asks for nothing when no ConfigSync reads the file", async () => {
    const { requested, send } = receiver();
    expect((await send({ body: notification("shop/orders-api/notes.txt") })).status).toBe(200);
    expect(requested).toEqual([]);
  });

  it("asks once for a ConfigSync that several records name", async () => {
    const { requested, send } = receiver();
    await send({ body: notification("shop/orders-api/config.env", "shop/orders-api/secrets.env") });
    expect(requested).toEqual(["orders-api"]);
  });

  it("leaves a suspended ConfigSync alone", async () => {
    const { requested, send } = receiver({ syncs: () => [sync("orders-api", { suspend: true }), sync("checkout")] });
    expect((await send({ body: notification("_common/config.env") })).status).toBe(200);
    expect(requested).toEqual(["checkout"]);
  });
});

describe("an EventBridge event", () => {
  const path = "/events/eventbridge";

  it("asks for a sync when S3 reports a file that a ConfigSync reads", async () => {
    const { requested, send } = receiver();
    expect((await send({ path, body: s3Event("kmo-config", "shop/checkout/config.env") })).status).toBe(200);
    expect(requested).toEqual(["checkout"]);
  });

  it("is accepted in the form that AWS sends, also when nothing reads the file", async () => {
    const { requested, send } = receiver();
    expect((await send({ path, body: JSON.stringify(eventBridgeCreated) })).status).toBe(200);
    expect(requested).toEqual([]);
  });

  it("is answered with 200 and ignored when it comes from a source other than S3", async () => {
    const { requested, send } = receiver();
    expect((await send({ path, body: JSON.stringify(parameterStore) })).status).toBe(200);
    expect(requested).toEqual([]);
  });
});

describe("a request that the receiver refuses", () => {
  const body = JSON.stringify(rustfsPut);

  it("gets 401 without a token, and nothing is asked for", async () => {
    const { requested, send } = receiver();
    expect((await send({ authorization: undefined, body })).status).toBe(401);
    expect(requested).toEqual([]);
  });

  it("gets 401 with a wrong token, whatever its length", async () => {
    const { send } = receiver();
    expect((await send({ authorization: "Bearer kmo-local-tokeX", body })).status).toBe(401);
    expect((await send({ authorization: "Bearer short", body })).status).toBe(401);
    expect((await send({ authorization: TOKEN, body })).status).toBe(401);
  });

  it("gets 400 for a body that is not JSON", async () => {
    const { send } = receiver();
    expect((await send({ body: "not json" })).status).toBe(400);
  });

  it("gets 400, with the reason, for JSON that is not a notification", async () => {
    const { send } = receiver();
    const answer = await send({ body: "{}" });
    expect(answer.status).toBe(400);
    expect(answer.body).toBe("expected a Records list");
  });

  it("gets 503 while the lists of the cluster are not filled yet, so that the sender tries again", async () => {
    const { requested, send } = receiver({ ready: () => false });
    expect((await send({ body })).status).toBe(503);
    expect(requested).toEqual([]);
  });

  it("gets 500 when a sync request fails, after every other request was still sent", async () => {
    const requested: string[] = [];
    const { send } = receiver({
      requestSync: async (target) => {
        if (target.metadata.name === "orders-api") throw new Error("admission is down");
        requested.push(target.metadata.name);
      },
    });
    expect((await send({ body: notification("_common/config.env") })).status).toBe(500);
    expect(requested).toEqual(["checkout"]);
  });

  it("gets 404 for an unknown path and 405 for an event path that is not posted to", async () => {
    const { send } = receiver();
    expect((await send({ path: "/events/other" })).status).toBe(404);
    expect((await send({ method: "GET" })).status).toBe(405);
  });
});

describe("the checks that need no token", () => {
  const open = { authorization: undefined };

  it("answer HEAD / with 200, because RustFS checks its target that way", async () => {
    const { send } = receiver();
    expect((await send({ ...open, method: "HEAD", path: "/" })).status).toBe(200);
  });

  it("answer /healthz with 200 whenever the process runs", async () => {
    const { send } = receiver({ ready: () => false });
    expect((await send({ ...open, method: "GET", path: "/healthz" })).status).toBe(200);
  });

  it("answer /readyz with 503 until the lists of the cluster are filled", async () => {
    expect((await receiver({ ready: () => false }).send({ ...open, method: "GET", path: "/readyz" })).status).toBe(503);
    expect((await receiver().send({ ...open, method: "GET", path: "/readyz" })).status).toBe(200);
  });
});
