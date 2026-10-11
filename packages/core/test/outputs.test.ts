import { describe, expect, it } from "vitest";
import { resolveConfigSync } from "../src/defaults";
import { outputObjects, outputPatch, takeoverProblem } from "../src/outputs";
import type { EnvValues } from "../src/types";

const owner = { apiVersion: "kmo.isntall.net/v1alpha1", kind: "ConfigSync", name: "orders-api", uid: "uid-1" };
const sync = resolveConfigSync({ metadata: { name: "orders-api", namespace: "shop" } });
const decode = (value: string | undefined) => Buffer.from(value ?? "", "base64").toString("utf8");

function objects(
  configMapData: EnvValues = { GREETING: "hello" },
  secretData: EnvValues = { DB_PASSWORD: "pässwörd" },
) {
  return outputObjects(sync, { configMapData, secretData, configHash: "abc" }, owner);
}

describe("the two output objects", () => {
  it("are a ConfigMap and a Secret named after the ConfigSync, in its namespace", () => {
    const { configMap, secret } = objects();
    expect(configMap).toMatchObject({ kind: "ConfigMap", metadata: { name: "orders-api-kmo", namespace: "shop" } });
    expect(secret).toMatchObject({
      kind: "Secret",
      type: "Opaque",
      metadata: { name: "orders-api-kmo", namespace: "shop" },
    });
  });

  it("carry KMO's label, the mark that tells Stakater Reloader to leave them alone, and their owner", () => {
    for (const object of Object.values(objects())) {
      expect(object.metadata.labels).toEqual({ "app.kubernetes.io/managed-by": "kmo" });
      expect(object.metadata.annotations).toEqual({ "reloader.stakater.com/ignore": "true" });
      expect(object.metadata.ownerReferences).toEqual([{ ...owner, controller: true, blockOwnerDeletion: true }]);
    }
  });

  it("hold config values as text and secret values base64-encoded, non-ASCII characters included", () => {
    const { configMap, secret } = objects();
    expect(configMap.data).toEqual({ GREETING: "hello" });
    expect(decode(secret.data.DB_PASSWORD)).toBe("pässwörd");
  });

  it("are both built even when there is nothing to put in them", () => {
    const { configMap, secret } = objects({}, {});
    expect(configMap.data).toEqual({});
    expect(secret.data).toEqual({});
  });
});

describe("an object that already holds an output name", () => {
  const wanted = objects().configMap;
  const labels = { "app.kubernetes.io/managed-by": "kmo" };

  it("is no problem when there is none", () => {
    expect(takeoverProblem(wanted, undefined, owner)).toBeUndefined();
  });

  it("is no problem when this ConfigSync wrote it", () => {
    expect(
      takeoverProblem(wanted, { metadata: { labels, ownerReferences: [{ uid: "uid-1" }] } }, owner),
    ).toBeUndefined();
  });

  it("is never taken over when it lacks KMO's label", () => {
    expect(takeoverProblem(wanted, { metadata: {} }, owner)).toBe(
      'ConfigMap "orders-api-kmo" already exists and was not written by KMO',
    );
  });

  it("is never taken over when another ConfigSync owns it", () => {
    expect(takeoverProblem(wanted, { metadata: { labels, ownerReferences: [{ uid: "uid-2" }] } }, owner)).toBe(
      'ConfigMap "orders-api-kmo" already belongs to another ConfigSync',
    );
  });
});

describe("the change to an existing output object", () => {
  const wanted = objects().configMap;
  const asWritten = { metadata: wanted.metadata, data: { GREETING: "hello" } };

  it("is nothing when the object is already as wanted", () => {
    expect(outputPatch(wanted, asWritten)).toEqual([]);
  });

  it("replaces the data whole, so a key added by hand goes away", () => {
    const edited = { ...asWritten, data: { GREETING: "hello", EXTRA: "by hand" } };
    expect(outputPatch(wanted, edited)).toContainEqual({ op: "add", path: "/data", value: { GREETING: "hello" } });
  });

  it("puts back a label that was removed", () => {
    const edited = { metadata: { ...wanted.metadata, labels: {} }, data: asWritten.data };
    expect(outputPatch(wanted, edited)).toContainEqual({
      op: "add",
      path: "/metadata/labels",
      value: wanted.metadata.labels,
    });
  });

  it("keeps labels and annotations that others added", () => {
    const edited = {
      metadata: { ...wanted.metadata, labels: { ...wanted.metadata.labels, team: "orders" } },
      data: asWritten.data,
    };
    expect(outputPatch(wanted, edited)).toEqual([]);
  });
});
