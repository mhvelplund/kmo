import { describe, expect, it } from "vitest";
import { findAffectedSyncs } from "../src/matching";
import type { ConfigSync, ConfigSyncSpec, S3Location, Store } from "../src/types";

const credentialsSecretRef = { name: "store-credentials" };

/** A cluster-wide store open to every namespace. */
function clusterStore(name: string, bucket: string, s3: Partial<S3Location> = {}): Store {
  return {
    kind: "ClusterConfigStore",
    metadata: { name },
    spec: { s3: { bucket, region: "eu-west-1", credentialsSecretRef, ...s3 }, allowedNamespaces: ["*"] },
  };
}

/** The cluster-wide store named default. */
const defaultStore = (bucket: string, keyPrefix?: string) => clusterStore("default", bucket, { keyPrefix });

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

  it("is matched in the folder that the store sets for its services", () => {
    const custom = [clusterStore("default", "company-config", { serviceFolder: "apps/{namespace}/{name}" })];
    expect(affected("apps/shop/orders-api/config.env", syncs, custom)).toEqual(["orders-api"]);
    expect(affected("shop/orders-api/config.env", syncs, custom)).toEqual([]);
  });

  it("affects a ConfigSync when it is in any one of its sources", () => {
    const overlay = { storeRef: { kind: "ClusterConfigStore", name: "overlay" } } as const;
    const both = [
      sync("orders-api", { sources: [{ storeRef: { kind: "ClusterConfigStore", name: "default" } }, overlay] }),
    ];
    const two = [...stores, clusterStore("overlay", "overlay-bucket")];
    expect(affected("shop/orders-api/config.env", both, two, "overlay-bucket")).toEqual(["orders-api"]);
    expect(affected("shop/orders-api/config.env", both, two, "company-config")).toEqual(["orders-api"]);
  });

  it("does not affect a ConfigSync through a common file that its source leaves out", () => {
    const noCommon = [
      sync("orders-api", { sources: [{ storeRef: { kind: "ClusterConfigStore", name: "default" }, common: false }] }),
    ];
    expect(affected("_common/config.env", noCommon, stores)).toEqual([]);
  });

  it("still affects a suspended ConfigSync; the operator decides to ignore the request", () => {
    expect(affected("shop/orders-api/config.env", [sync("orders-api", { suspend: true })], stores)).toEqual([
      "orders-api",
    ]);
  });

  it("passes over a ConfigSync that has no usable store or an unusable spec", () => {
    const broken = [
      sync("orders-api", { sources: [{ storeRef: { name: "gone" } }] }),
      sync("checkout", { refreshInterval: "soon" }),
    ];
    expect(affected("_common/config.env", broken, stores)).toEqual([]);
  });
});
