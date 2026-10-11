import { SYNC_REQUESTED_ANNOTATION, type ConfigSync } from "@kmo/core";
import { ApiException } from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";
import { requestSync, toStore, toSync, type PatchApi } from "../src/cluster";

const sync: ConfigSync = { metadata: { name: "orders-api", namespace: "shop", uid: "uid-1" } };
const now = new Date("2026-10-11T08:00:00.000Z");

/** A client whose patch call records its request, or fails with an HTTP status code. */
function client(failWith?: number) {
  const calls: Parameters<PatchApi["patchNamespacedCustomObject"]>[0][] = [];
  const api: PatchApi = {
    patchNamespacedCustomObject: async (request) => {
      calls.push(request);
      if (failWith) throw new ApiException(failWith, "refused", undefined, {});
    },
  };
  return { api, calls };
}

describe("a sync request from the receiver", () => {
  it("applies the sync annotation to the one ConfigSync, by force and under the receiver's own name", async () => {
    const { api, calls } = client();
    await requestSync(api, sync, now);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      group: "kmo.isntall.net",
      version: "v1alpha1",
      plural: "configsyncs",
      namespace: "shop",
      name: "orders-api",
      fieldManager: "kmo-receiver",
      force: true,
      body: { metadata: { uid: "uid-1", annotations: { [SYNC_REQUESTED_ANNOTATION]: "2026-10-11T08:00:00.000Z" } } },
    });
  });

  it("ends quietly when the ConfigSync is gone, whichever way the API server says so", async () => {
    await expect(requestSync(client(404).api, sync, now)).resolves.toBeUndefined();
    await expect(requestSync(client(409).api, sync, now)).resolves.toBeUndefined();
  });

  it("fails on any other refusal, so that the sender of the event tries again", async () => {
    await expect(requestSync(client(500).api, sync, now)).rejects.toThrow(ApiException);
    await expect(requestSync(client(403).api, sync, now)).rejects.toThrow(ApiException);
  });
});

describe("what the receiver keeps of the cluster", () => {
  it("is the identity, the annotations and the spec of a ConfigSync", () => {
    const object = { metadata: { name: "orders-api", namespace: "shop", uid: "uid-1" }, spec: { suspend: true } };
    expect(toSync(object)).toEqual({
      metadata: { name: "orders-api", namespace: "shop", uid: "uid-1", annotations: undefined },
      spec: { suspend: true },
    });
  });

  it("is a namespace for a ConfigStore and none for a ClusterConfigStore", () => {
    const object = { metadata: { name: "default", namespace: "payments" }, spec: { s3: { bucket: "b", region: "r" } } };
    expect(toStore("ConfigStore", object)?.metadata).toEqual({ name: "default", namespace: "payments" });
    expect(toStore("ClusterConfigStore", object)?.metadata).toEqual({ name: "default", namespace: undefined });
  });

  it("leaves out a store that has no spec", () => {
    expect(toStore("ConfigStore", { metadata: { name: "empty", namespace: "payments" } })).toBeUndefined();
  });
});
