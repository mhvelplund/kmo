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

  it("reads its namespace and name folder, and the common folder", () => {
    expect(resolved.source).toEqual({
      config: "shop/orders-api/config.env",
      secrets: "shop/orders-api/secrets.env",
      commonConfig: "_common/config.env",
      commonSecrets: "_common/secrets.env",
    });
  });

  it("writes a ConfigMap and a Secret named after itself with a -kmo suffix", () => {
    expect(resolved.output).toEqual({ configMapName: "orders-api-kmo", secretName: "orders-api-kmo" });
  });

  it("refreshes every thirty minutes and is not suspended", () => {
    expect(resolved.refreshIntervalMs).toBe(30 * 60 * 1000);
    expect(resolved.suspend).toBe(false);
  });

  it("names no store, leaving the choice to the default lookup", () => {
    expect(resolved.storeRef).toBeUndefined();
  });
});

describe("a ConfigSync that sets fields", () => {
  it("keeps what it sets and defaults the rest", () => {
    const resolved = resolveConfigSync(
      ordersApi({
        suspend: true,
        source: { config: "shared/app.env" },
        output: { secretName: "orders-secrets" },
        refreshInterval: "1h30m",
      }),
    );
    expect(resolved.suspend).toBe(true);
    expect(resolved.source.config).toBe("shared/app.env");
    expect(resolved.source.secrets).toBe("shop/orders-api/secrets.env");
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

  it("means a ConfigStore when it names a store without a kind", () => {
    expect(resolveConfigSync(ordersApi({ storeRef: { name: "team" } })).storeRef).toEqual({
      kind: "ConfigStore",
      name: "team",
    });
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
