import { describe, expect, it } from "vitest";
import { findAffectedSyncs } from "../src/matching";
import type { ConfigSync, ConfigSyncSpec, Store } from "../src/types";

const credentials = { name: "store-credentials" };

/** A cluster-wide default store open to every namespace. */
function defaultStore(bucket: string, keyPrefix?: string): Store {
  return {
    kind: "ClusterConfigStore",
    metadata: { name: "default" },
    spec: { bucket, region: "eu-west-1", keyPrefix, allowedNamespaces: ["*"], credentialsSecretRef: credentials },
  };
}

/** A ConfigSync in namespace shop. */
function sync(name: string, spec?: ConfigSyncSpec): ConfigSync {
  return { metadata: { name, namespace: "shop" }, spec };
}

/** The names of the ConfigSyncs affected by a change to a key. */
function affected(key: string, syncs: ConfigSync[], stores: Store[], bucket = "company-config"): string[] {
  return findAffectedSyncs({ bucket, key }, syncs, stores).map((s) => s.metadata.name);
}

describe("a changed file", () => {
  const syncs = [sync("orders-api"), sync("checkout")];
  const stores = [defaultStore("company-config")];

  it("affects the one ConfigSync whose folder it is in", () => {
    expect(affected("shop/orders-api/secrets.env", syncs, stores)).toEqual(["orders-api"]);
  });

  it("affects every ConfigSync of the store when it is a common file", () => {
    expect(affected("_common/config.env", syncs, stores)).toEqual(["orders-api", "checkout"]);
  });

  it("affects nothing when no ConfigSync reads it", () => {
    expect(affected("shop/orders-api/notes.txt", syncs, stores)).toEqual([]);
  });

  it("affects nothing when it is in a different bucket", () => {
    expect(affected("shop/orders-api/config.env", syncs, stores, "another-bucket")).toEqual([]);
  });

  it("is matched under the store's key prefix", () => {
    const prefixed = [defaultStore("company-config", "prod")];
    expect(affected("prod/shop/orders-api/config.env", syncs, prefixed)).toEqual(["orders-api"]);
    expect(affected("shop/orders-api/config.env", syncs, prefixed)).toEqual([]);
  });

  it("is matched against a source key written out in the spec", () => {
    const custom = [sync("orders-api", { source: { config: "shop/shared/app.env" } })];
    expect(affected("shop/shared/app.env", custom, stores)).toEqual(["orders-api"]);
  });

  it("still affects a suspended ConfigSync; the operator decides to ignore the request", () => {
    expect(affected("shop/orders-api/config.env", [sync("orders-api", { suspend: true })], stores)).toEqual([
      "orders-api",
    ]);
  });

  it("passes over a ConfigSync that has no usable store or an unusable spec", () => {
    const broken = [sync("orders-api", { storeRef: { name: "gone" } }), sync("checkout", { refreshInterval: "soon" })];
    expect(affected("_common/config.env", broken, stores)).toEqual([]);
  });
});
