import { describe, expect, it } from "vitest";
import { resolveConfigSync } from "../src/defaults";
import { findStore, fullKey, sourceAccessProblem, storeLabel } from "../src/store";
import type { ConfigSyncSpec, Store } from "../src/types";

const credentials = { name: "store-credentials" };

/** A ConfigStore in a namespace. */
function namespaceStore(name: string, namespace: string, keyPrefix?: string): Store {
  return {
    kind: "ConfigStore",
    metadata: { name, namespace },
    spec: { bucket: `${namespace}-bucket`, region: "eu-west-1", keyPrefix, credentialsSecretRef: credentials },
  };
}

/** A ClusterConfigStore open to the given namespaces. */
function clusterStore(name: string, allowedNamespaces: string[] | undefined, keyPrefix?: string): Store {
  return {
    kind: "ClusterConfigStore",
    metadata: { name },
    spec: {
      bucket: "company-config",
      region: "eu-west-1",
      keyPrefix,
      allowedNamespaces,
      credentialsSecretRef: credentials,
    },
  };
}

/** The resolved ConfigSync orders-api in namespace shop. */
function ordersApi(spec?: ConfigSyncSpec) {
  return resolveConfigSync({ metadata: { name: "orders-api", namespace: "shop" }, spec });
}

describe("a ConfigSync that names no store", () => {
  it("uses the ConfigStore called default in its own namespace", () => {
    const own = namespaceStore("default", "shop");
    expect(findStore(ordersApi(), [clusterStore("default", ["*"]), own])).toEqual({ ok: true, store: own });
  });

  it("otherwise uses the ClusterConfigStore called default, if that allows its namespace", () => {
    const shared = clusterStore("default", ["shop"]);
    expect(findStore(ordersApi(), [namespaceStore("default", "billing"), shared])).toEqual({ ok: true, store: shared });
  });

  it("finds no store when the cluster-wide default does not allow its namespace", () => {
    expect(findStore(ordersApi(), [clusterStore("default", ["billing"])])).toEqual({
      ok: false,
      reason: 'no store is named and no default store is available to namespace "shop"',
    });
  });

  it("finds no store when there are no default stores at all", () => {
    expect(findStore(ordersApi(), [namespaceStore("team", "shop")]).ok).toBe(false);
  });
});

describe("a ConfigSync that names a store", () => {
  it("uses the ConfigStore of that name in its own namespace", () => {
    const team = namespaceStore("team", "shop");
    expect(findStore(ordersApi({ storeRef: { name: "team" } }), [namespaceStore("team", "billing"), team])).toEqual({
      ok: true,
      store: team,
    });
  });

  it("cannot use a ConfigStore from another namespace", () => {
    expect(findStore(ordersApi({ storeRef: { name: "team" } }), [namespaceStore("team", "billing")])).toEqual({
      ok: false,
      reason: 'ConfigStore "team" was not found in namespace "shop"',
    });
  });

  it("can use a ClusterConfigStore that lists its namespace or allows all with *", () => {
    const storeRef = { kind: "ClusterConfigStore", name: "shared" } as const;
    expect(findStore(ordersApi({ storeRef }), [clusterStore("shared", ["billing", "shop"])]).ok).toBe(true);
    expect(findStore(ordersApi({ storeRef }), [clusterStore("shared", ["*"])]).ok).toBe(true);
  });

  it("is refused by a ClusterConfigStore that does not list its namespace", () => {
    const storeRef = { kind: "ClusterConfigStore", name: "shared" } as const;
    expect(findStore(ordersApi({ storeRef }), [clusterStore("shared", ["billing"])])).toEqual({
      ok: false,
      reason: 'ClusterConfigStore "shared" does not allow namespace "shop"',
    });
  });

  it("is refused by a ClusterConfigStore that lists no namespaces, since there is no default", () => {
    const storeRef = { kind: "ClusterConfigStore", name: "shared" } as const;
    expect(findStore(ordersApi({ storeRef }), [clusterStore("shared", undefined)]).ok).toBe(false);
  });
});

describe("a store's label", () => {
  it("is its kind and name", () => {
    expect(storeLabel(namespaceStore("default", "shop"))).toBe("ConfigStore/default");
  });
});

describe("the full key of a file", () => {
  it("is the source key itself when the store has no prefix", () => {
    expect(fullKey(clusterStore("shared", ["*"]), "shop/orders-api/config.env")).toBe("shop/orders-api/config.env");
  });

  it("puts the store's prefix in front, with or without a trailing slash on the prefix", () => {
    expect(fullKey(clusterStore("shared", ["*"], "prod"), "_common/config.env")).toBe("prod/_common/config.env");
    expect(fullKey(clusterStore("shared", ["*"], "prod/"), "_common/config.env")).toBe("prod/_common/config.env");
  });
});

describe("what a ConfigSync may read", () => {
  const shared = clusterStore("shared", ["*"]);

  it("is its own namespace folder and the common folder, on a cluster-wide store", () => {
    expect(sourceAccessProblem(ordersApi(), shared)).toBeUndefined();
    expect(sourceAccessProblem(ordersApi({ source: { config: "shop/other-app/config.env" } }), shared)).toBeUndefined();
  });

  it("is never another namespace's folder, on a cluster-wide store", () => {
    expect(sourceAccessProblem(ordersApi({ source: { secrets: "billing/ledger/secrets.env" } }), shared)).toBe(
      'source "secrets" is outside the folders namespace "shop" may read from a cluster-wide store',
    );
  });

  it("is not a folder whose name merely starts with its namespace", () => {
    expect(sourceAccessProblem(ordersApi({ source: { config: "shop-admin/app/config.env" } }), shared)).toBeDefined();
  });

  it("is any key at all in a store of its own namespace", () => {
    const own = namespaceStore("default", "shop");
    expect(sourceAccessProblem(ordersApi({ source: { config: "anything/app.env" } }), own)).toBeUndefined();
  });

  it.each(["/shop/orders-api/config.env", "shop/../billing/config.env", ""])("never includes the key %j", (key) => {
    expect(sourceAccessProblem(ordersApi({ source: { config: key } }), namespaceStore("default", "shop"))).toBe(
      'source "config" is not a usable key',
    );
  });
});
