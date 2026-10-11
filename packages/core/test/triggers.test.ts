import { describe, expect, it } from "vitest";
import { configHash } from "../src/hash";
import { nextStatus } from "../src/status";
import { outputsDrifted, syncDue, syncsTargeting, syncsUsingStore, targetNeedsSync } from "../src/trigger";
import type { ConfigSync, Store } from "../src/types";

const base64 = (text: string) => Buffer.from(text).toString("base64");
const hash = configHash({ A: "1" }, { B: "2" });
const syncedAt = (time: string, wiringProblems: string[] = []) =>
  nextStatus(
    undefined,
    {
      result: "synced",
      stores: ["ClusterConfigStore/default"],
      sources: [],
      configHash: hash,
      empty: false,
      wiringProblems,
    },
    { generation: 1, now: time },
  );
const sync = (
  name: string,
  spec: ConfigSync["spec"] = {},
  status = syncedAt("2026-10-11T09:00:00.000Z"),
): ConfigSync => ({
  metadata: { name, namespace: "shop", generation: 1 },
  spec,
  status,
});
const clusterStore = (name: string, allowedNamespaces = ["*"]): Store => ({
  kind: "ClusterConfigStore",
  metadata: { name },
  spec: {
    s3: { bucket: "b", region: "r", credentialsSecretRef: { name: "c", namespace: "kmo-system" } },
    allowedNamespaces,
  },
});

describe("a sync is due", () => {
  const now = (time: string) => new Date(`2026-10-11T${time}.000Z`);

  it("when the refresh interval has passed since the last sync", () => {
    expect(syncDue(sync("a"), now("09:29:59"))).toBe(false);
    expect(syncDue(sync("a"), now("09:30:00"))).toBe(true);
    expect(syncDue(sync("a", { refreshInterval: "5m" }), now("09:05:00"))).toBe(true);
  });

  it("when the resource has never been synced", () => {
    expect(syncDue({ metadata: { name: "a", namespace: "shop" } }, now("09:00:00"))).toBe(true);
  });

  it("at every check while the resource is not ready, so a failure is retried", () => {
    const failed = nextStatus(
      syncedAt("2026-10-11T09:00:00.000Z"),
      { result: "failed", reason: "StoreUnreachable", message: "m" },
      { generation: 1, now: "2026-10-11T09:01:00.000Z" },
    );
    expect(syncDue(sync("a", {}, failed), now("09:02:00"))).toBe(true);
  });

  it("never while the resource is suspended", () => {
    expect(syncDue(sync("a", { suspend: true }), now("12:00:00"))).toBe(false);
  });

  it("never while its spec cannot be used, since asking again changes nothing", () => {
    expect(syncDue(sync("a", { refreshInterval: "30s" }), now("12:00:00"))).toBe(false);
  });
});

describe("the output objects have drifted", () => {
  const configMap = { data: { A: "1" } };
  const secret = { data: { B: base64("2") } };

  it("not when they still hold what the last sync wrote", () => {
    expect(outputsDrifted(sync("a"), configMap, secret)).toBe(false);
  });

  it("when a value was edited by hand", () => {
    expect(outputsDrifted(sync("a"), { data: { A: "edited" } }, secret)).toBe(true);
    expect(outputsDrifted(sync("a"), configMap, { data: { B: base64("edited") } })).toBe(true);
  });

  it("when one of them was deleted", () => {
    expect(outputsDrifted(sync("a"), undefined, secret)).toBe(true);
  });
});

describe("a changed target needs a sync", () => {
  it("when it does not carry the current hash, as a new workload does not", () => {
    expect(targetNeedsSync(sync("a"), undefined)).toBe(true);
    expect(targetNeedsSync(sync("a"), "old")).toBe(true);
  });

  it("not when its hash is current and its wiring was fine", () => {
    expect(targetNeedsSync(sync("a"), hash)).toBe(false);
  });

  it("when its wiring was reported as wrong, because the change may have fixed it", () => {
    const status = syncedAt("2026-10-11T09:00:00.000Z", ['Deployment "a" does not exist']);
    expect(targetNeedsSync(sync("a", {}, status), hash)).toBe(true);
  });
});

describe("the ConfigSyncs behind a workload", () => {
  it("are those that name it as a target, by default or explicitly", () => {
    const syncs = [
      sync("orders-api"),
      sync("batch", { targets: [{ kind: "CronJob", name: "orders-api" }] }),
      sync("other"),
    ];
    expect(syncsTargeting("Deployment", "orders-api", syncs).map((s) => s.metadata.name)).toEqual(["orders-api"]);
    expect(syncsTargeting("CronJob", "orders-api", syncs).map((s) => s.metadata.name)).toEqual(["batch"]);
  });
});

describe("the ConfigSyncs behind a store", () => {
  it("are those that would use it now", () => {
    const store = clusterStore("default");
    const named = sync("named", { sources: [{ storeRef: { kind: "ClusterConfigStore", name: "other" } }] }, {});
    const result = syncsUsingStore(store, [sync("a", {}, {}), named], [store, clusterStore("other")]);
    expect(result.map((s) => s.metadata.name)).toEqual(["a"]);
  });

  it("include those that list it as one of several sources", () => {
    const other = clusterStore("other");
    const sources = [
      { storeRef: { kind: "ClusterConfigStore", name: "default" } as const },
      { storeRef: { kind: "ClusterConfigStore", name: "other" } as const },
    ];
    const result = syncsUsingStore(other, [sync("both", { sources }, {})], [clusterStore("default"), other]);
    expect(result.map((s) => s.metadata.name)).toEqual(["both"]);
  });

  it("include those that used it last time, so they notice when it is deleted", () => {
    expect(syncsUsingStore(clusterStore("default"), [sync("a")], []).map((s) => s.metadata.name)).toEqual(["a"]);
  });
});
