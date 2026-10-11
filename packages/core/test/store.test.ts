import { describe, expect, it } from "vitest";
import { findStore, storeKeys, storeLabel } from "../src/store";
import type { S3Location, Store } from "../src/types";

const credentialsSecretRef = { name: "store-credentials" };

/** A ConfigStore in a namespace. */
function namespaceStore(name: string, namespace: string, s3: Partial<S3Location> = {}): Store {
  return {
    kind: "ConfigStore",
    metadata: { name, namespace },
    spec: { s3: { bucket: `${namespace}-bucket`, region: "eu-west-1", credentialsSecretRef, ...s3 } },
  };
}

/** A ClusterConfigStore open to the given namespaces. */
function clusterStore(name: string, allowedNamespaces: string[] | undefined, s3: Partial<S3Location> = {}): Store {
  return {
    kind: "ClusterConfigStore",
    metadata: { name },
    spec: { s3: { bucket: "company-config", region: "eu-west-1", credentialsSecretRef, ...s3 }, allowedNamespaces },
  };
}

describe("a source that names no store", () => {
  it("uses the ConfigStore called default in the ConfigSync's own namespace", () => {
    const own = namespaceStore("default", "shop");
    expect(findStore("shop", undefined, [clusterStore("default", ["*"]), own])).toEqual({ ok: true, store: own });
  });

  it("otherwise uses the ClusterConfigStore called default, if that allows the namespace", () => {
    const shared = clusterStore("default", ["shop"]);
    expect(findStore("shop", undefined, [namespaceStore("default", "billing"), shared])).toEqual({
      ok: true,
      store: shared,
    });
  });

  it("finds no store when the cluster-wide default does not allow the namespace", () => {
    expect(findStore("shop", undefined, [clusterStore("default", ["billing"])])).toEqual({
      ok: false,
      reason: 'no store is named and no default store is available to namespace "shop"',
    });
  });

  it("finds no store when there are no default stores at all", () => {
    expect(findStore("shop", undefined, [namespaceStore("team", "shop")]).ok).toBe(false);
  });
});

describe("a source that names a store", () => {
  const team = { kind: "ConfigStore", name: "team" } as const;
  const shared = { kind: "ClusterConfigStore", name: "shared" } as const;

  it("uses the ConfigStore of that name in the ConfigSync's own namespace", () => {
    const own = namespaceStore("team", "shop");
    expect(findStore("shop", team, [namespaceStore("team", "billing"), own])).toEqual({ ok: true, store: own });
  });

  it("cannot use a ConfigStore from another namespace", () => {
    expect(findStore("shop", team, [namespaceStore("team", "billing")])).toEqual({
      ok: false,
      reason: 'ConfigStore "team" was not found in namespace "shop"',
    });
  });

  it("can use a ClusterConfigStore that lists the namespace or allows all with *", () => {
    expect(findStore("shop", shared, [clusterStore("shared", ["billing", "shop"])]).ok).toBe(true);
    expect(findStore("shop", shared, [clusterStore("shared", ["*"])]).ok).toBe(true);
  });

  it("is refused by a ClusterConfigStore that does not list the namespace", () => {
    expect(findStore("shop", shared, [clusterStore("shared", ["billing"])])).toEqual({
      ok: false,
      reason: 'ClusterConfigStore "shared" does not allow namespace "shop"',
    });
  });

  it("is refused by a ClusterConfigStore that lists no namespaces, since there is no default", () => {
    expect(findStore("shop", shared, [clusterStore("shared", undefined)]).ok).toBe(false);
  });
});

describe("a store's label", () => {
  it("is its kind and name", () => {
    expect(storeLabel(namespaceStore("default", "shop"))).toBe("ConfigStore/default");
  });
});

describe("the files a store holds for a ConfigSync", () => {
  it("are in a folder named after the namespace and name, next to a common folder", () => {
    expect(storeKeys(clusterStore("shared", ["*"]), "shop", "orders-api", true)).toEqual({
      config: "shop/orders-api/config.env",
      secrets: "shop/orders-api/secrets.env",
      commonConfig: "_common/config.env",
      commonSecrets: "_common/secrets.env",
    });
  });

  it("leave out the common files when the source does not want them", () => {
    expect(storeKeys(clusterStore("shared", ["*"]), "shop", "orders-api", false)).toEqual({
      config: "shop/orders-api/config.env",
      secrets: "shop/orders-api/secrets.env",
    });
  });

  it("are under the store's prefix, with or without a trailing slash on the prefix", () => {
    expect(storeKeys(clusterStore("shared", ["*"], { keyPrefix: "prod" }), "shop", "orders-api", true)).toMatchObject({
      config: "prod/shop/orders-api/config.env",
      commonConfig: "prod/_common/config.env",
    });
    expect(storeKeys(clusterStore("shared", ["*"], { keyPrefix: "prod/" }), "shop", "orders-api", true)).toMatchObject({
      config: "prod/shop/orders-api/config.env",
    });
  });

  it("are where the store says, when it sets its own folders", () => {
    const own = namespaceStore("team", "shop", { serviceFolder: "apps/{name}", commonFolder: "shared/{namespace}" });
    expect(storeKeys(own, "shop", "orders-api", true)).toEqual({
      config: "apps/orders-api/config.env",
      secrets: "apps/orders-api/secrets.env",
      commonConfig: "shared/shop/config.env",
      commonSecrets: "shared/shop/secrets.env",
    });
  });
});
