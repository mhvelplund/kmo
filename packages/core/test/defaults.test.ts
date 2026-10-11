import { describe, expect, it } from "vitest";
import { ConfigSyncSpecError, resolveConfigSync } from "../src/defaults";
import type { ConfigSyncSpec } from "../src/types";

/** A ConfigSync named orders-api in namespace shop with the given spec. */
function ordersApi(spec?: ConfigSyncSpec) {
  return { metadata: { name: "orders-api", namespace: "shop" }, spec };
}

describe("a ConfigSync with an empty spec", () => {
  const resolved = resolveConfigSync(ordersApi());

  it("targets the Deployment that shares its name", () => {
    expect(resolved.targets).toEqual([{ kind: "Deployment", name: "orders-api" }]);
  });

  it("writes a ConfigMap and a Secret named after itself with a -kmo suffix", () => {
    expect(resolved.output).toEqual({ configMapName: "orders-api-kmo", secretName: "orders-api-kmo" });
  });

  it("refreshes every thirty minutes and is not suspended", () => {
    expect(resolved.refreshIntervalMs).toBe(30 * 60 * 1000);
    expect(resolved.suspend).toBe(false);
  });

  it("has one source that names no store, leaving the choice to the default lookup, and reads the common files", () => {
    expect(resolved.sources).toEqual([{ common: true }]);
  });
});

describe("a ConfigSync that sets fields", () => {
  it("keeps what it sets and defaults the rest", () => {
    const resolved = resolveConfigSync(
      ordersApi({
        suspend: true,
        output: { secretName: "orders-secrets" },
        refreshInterval: "1h30m",
      }),
    );
    expect(resolved.suspend).toBe(true);
    expect(resolved.output).toEqual({ configMapName: "orders-api-kmo", secretName: "orders-secrets" });
    expect(resolved.refreshIntervalMs).toBe(90 * 60 * 1000);
  });

  it("can list several targets, each a Deployment unless it says otherwise", () => {
    const resolved = resolveConfigSync(ordersApi({ targets: [{ name: "api" }, { kind: "CronJob", name: "cleanup" }] }));
    expect(resolved.targets).toEqual([
      { kind: "Deployment", name: "api" },
      { kind: "CronJob", name: "cleanup" },
    ]);
  });

  it("falls back to the default target when its target list is empty", () => {
    expect(resolveConfigSync(ordersApi({ targets: [] })).targets).toEqual([{ kind: "Deployment", name: "orders-api" }]);
  });

  it("means a ConfigStore when a source names a store without a kind", () => {
    expect(resolveConfigSync(ordersApi({ sources: [{ storeRef: { name: "team" } }] })).sources).toEqual([
      { storeRef: { kind: "ConfigStore", name: "team" }, common: true },
    ]);
  });

  it("keeps its sources in the order they are written, each reading the common files unless it says otherwise", () => {
    const resolved = resolveConfigSync(
      ordersApi({
        sources: [
          { storeRef: { kind: "ClusterConfigStore", name: "company" } },
          { storeRef: { name: "team" }, common: false },
        ],
      }),
    );
    expect(resolved.sources).toEqual([
      { storeRef: { kind: "ClusterConfigStore", name: "company" }, common: true },
      { storeRef: { kind: "ConfigStore", name: "team" }, common: false },
    ]);
  });

  it("falls back to the default source when its source list is empty", () => {
    expect(resolveConfigSync(ordersApi({ sources: [] })).sources).toEqual([{ common: true }]);
  });

  it("is rejected when it lists the same store twice", () => {
    const twice = ordersApi({
      sources: [{ storeRef: { name: "team" } }, { storeRef: { name: "team" }, common: false }],
    });
    expect(() => resolveConfigSync(twice)).toThrow("store ConfigStore/team is listed more than once");
  });
});

describe("a refresh interval", () => {
  it.each(["30s", "0m", "soon", "", "5 minutes", "1.5h"])(
    "is rejected when shorter than a minute or unreadable: %j",
    (text) => {
      expect(() => resolveConfigSync(ordersApi({ refreshInterval: text }))).toThrow(ConfigSyncSpecError);
    },
  );

  it("may be exactly one minute", () => {
    expect(resolveConfigSync(ordersApi({ refreshInterval: "60s" })).refreshIntervalMs).toBe(60_000);
  });
});
