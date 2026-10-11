import { describe, expect, it } from "vitest";
import { planSync } from "../src/plan";
import type { ConfigSync, S3Location, Store } from "../src/types";

const sync = (spec: ConfigSync["spec"] = {}): ConfigSync => ({
  metadata: { name: "orders-api", namespace: "shop" },
  spec,
});

const clusterStore = (name = "default", s3: Partial<S3Location> = {}, allowedNamespaces = ["*"]): Store => ({
  kind: "ClusterConfigStore",
  metadata: { name },
  spec: {
    s3: {
      bucket: "kmo-config",
      region: "us-east-1",
      credentialsSecretRef: { name: "creds", namespace: "kmo-system" },
      ...s3,
    },
    allowedNamespaces,
  },
});

describe("the plan for a sync", () => {
  it("names the store and the full key of each of the four files", () => {
    const plan = planSync(sync(), [clusterStore("default", { keyPrefix: "prod/" })]);
    expect(plan).toMatchObject({
      ok: true,
      sources: [
        {
          store: { metadata: { name: "default" } },
          keys: {
            config: "prod/shop/orders-api/config.env",
            secrets: "prod/shop/orders-api/secrets.env",
            commonConfig: "prod/_common/config.env",
            commonSecrets: "prod/_common/secrets.env",
          },
        },
      ],
    });
  });

  it("lists the sources in the order of the spec, without the common files where a source turns them off", () => {
    const company = { kind: "ClusterConfigStore", name: "company" } as const;
    const overlay = { kind: "ClusterConfigStore", name: "overlay" } as const;
    const plan = planSync(sync({ sources: [{ storeRef: company }, { storeRef: overlay, common: false }] }), [
      clusterStore("overlay", { bucket: "overlay-bucket" }),
      clusterStore("company"),
    ]);
    expect(plan).toMatchObject({
      ok: true,
      sources: [
        { store: { metadata: { name: "company" } }, keys: { commonConfig: "_common/config.env" } },
        {
          store: { metadata: { name: "overlay" } },
          keys: { config: "shop/orders-api/config.env", secrets: "shop/orders-api/secrets.env" },
        },
      ],
    });
    expect(plan.ok && plan.sources[1]?.keys).not.toHaveProperty("commonConfig");
  });

  it("fails when no store can be found", () => {
    expect(planSync(sync(), [])).toMatchObject({ ok: false, reason: "StoreNotFound" });
  });

  it("fails as a whole when one store of several cannot be found", () => {
    const sources = [
      { storeRef: { kind: "ClusterConfigStore", name: "default" } as const },
      { storeRef: { name: "gone" } },
    ];
    expect(planSync(sync({ sources }), [clusterStore()])).toMatchObject({
      ok: false,
      reason: "StoreNotFound",
      message: 'ConfigStore "gone" was not found in namespace "shop"',
    });
  });

  it("fails when the store does not allow the namespace", () => {
    const plan = planSync(sync({ sources: [{ storeRef: { kind: "ClusterConfigStore", name: "default" } }] }), [
      clusterStore("default", {}, ["billing"]),
    ]);
    expect(plan).toMatchObject({ ok: false, reason: "StoreNotFound" });
  });

  it("fails with the reason when the spec cannot be used", () => {
    const plan = planSync(sync({ refreshInterval: "30s" }), [clusterStore()]);
    expect(plan).toMatchObject({
      ok: false,
      reason: "InvalidSpec",
      message: "the refresh interval must be at least one minute",
    });
  });
});
