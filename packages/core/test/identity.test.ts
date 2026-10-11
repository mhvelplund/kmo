import { describe, expect, it } from "vitest";
import { sessionName, storeIdentity } from "../src/identity";
import type { S3Location, Store } from "../src/types";

const own = (s3: Partial<S3Location>): Store => ({
  kind: "ConfigStore",
  metadata: { name: "default", namespace: "payments" },
  spec: { s3: { bucket: "b", region: "eu-west-1", ...s3 } },
});
const clusterWide = (s3: Partial<S3Location>): Store => ({
  kind: "ClusterConfigStore",
  metadata: { name: "partners" },
  spec: { s3: { bucket: "b", region: "eu-west-1", ...s3 }, allowedNamespaces: ["partners"] },
});

describe("the identity of a store", () => {
  it("is a ServiceAccount when the store names one", () => {
    expect(storeIdentity(own({ serviceAccountRef: { name: "store" } }))).toEqual({
      ok: true,
      identity: { method: "serviceAccount", namespace: "payments", name: "store" },
    });
  });

  it("is a Secret with stored keys when the store names one", () => {
    expect(storeIdentity(own({ credentialsSecretRef: { name: "keys" } }))).toMatchObject({
      identity: { method: "secret", namespace: "payments", name: "keys" },
    });
  });

  it("always lives in the namespace of a namespace store, whatever the reference says", () => {
    const store = own({ serviceAccountRef: { name: "store", namespace: "kmo-system" } });
    expect(storeIdentity(store)).toMatchObject({ identity: { namespace: "payments" } });
  });

  it("lives in the namespace a cluster-wide store names", () => {
    const store = clusterWide({ serviceAccountRef: { name: "store", namespace: "kmo-system" } });
    expect(storeIdentity(store)).toMatchObject({ identity: { namespace: "kmo-system", name: "store" } });
  });

  it("is unusable when a cluster-wide store does not say where it lives", () => {
    expect(storeIdentity(clusterWide({ serviceAccountRef: { name: "store" } }))).toEqual({
      ok: false,
      reason: "the store's serviceAccountRef names no namespace",
    });
  });

  it("is unusable when the store names none, or both", () => {
    expect(storeIdentity(own({}))).toMatchObject({ ok: false });
    const both = own({ serviceAccountRef: { name: "store" }, credentialsSecretRef: { name: "keys" } });
    expect(storeIdentity(both)).toMatchObject({ ok: false });
  });
});

describe("the name of a store's session in AWS", () => {
  it("says which store asked, so it can be found in CloudTrail", () => {
    expect(sessionName(own({}))).toBe("kmo-payments-default");
    expect(sessionName(clusterWide({}))).toBe("kmo-cluster-partners");
  });

  it("is never longer than AWS allows", () => {
    const long = own({});
    long.metadata.name = "x".repeat(100);
    expect(sessionName(long)).toHaveLength(64);
  });
});
