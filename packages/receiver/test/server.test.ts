import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import rustfsPut from "../../core/test/fixtures/rustfs-put.json";
import { createReceiver } from "../src/server";

describe("the receiver on a socket", () => {
  const requested: string[] = [];
  const server = createReceiver({
    token: "kmo-local-token",
    ready: () => true,
    syncs: () => [{ metadata: { name: "orders-api", namespace: "shop" } }],
    stores: () => [
      {
        kind: "ClusterConfigStore",
        metadata: { name: "default" },
        spec: { s3: { bucket: "kmo-config", region: "us-east-1" }, allowedNamespaces: ["*"] },
      },
    ],
    requestSync: async (sync) => {
      requested.push(sync.metadata.name);
    },
    log: () => {},
  });
  let url = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const post = (body: string) =>
    fetch(`${url}/events/rustfs`, { method: "POST", headers: { authorization: "Bearer kmo-local-token" }, body });

  it("takes the event that RustFS posts, token and all", async () => {
    expect((await post(JSON.stringify(rustfsPut))).status).toBe(200);
    expect(requested).toEqual(["orders-api"]);
  });

  it("answers the check that RustFS makes when it starts", async () => {
    expect((await fetch(url, { method: "HEAD" })).status).toBe(200);
  });

  it("reads the path without its query", async () => {
    expect((await fetch(`${url}/healthz?from=probe`)).status).toBe(200);
  });

  it("refuses a body over 64 KiB with 413", async () => {
    expect((await post("x".repeat(64 * 1024 + 1))).status).toBe(413);
  });
});
