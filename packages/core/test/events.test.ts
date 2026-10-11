import { describe, expect, it } from "vitest";
import { MalformedEventError, normalizeEventBridgeEvent, normalizeRustfsEvent } from "../src/events";
import eventBridgeCreated from "./fixtures/eventbridge-object-created.json";
import parameterStore from "./fixtures/eventbridge-parameter-store.json";
import rustfsDelete from "./fixtures/rustfs-delete.json";
import rustfsPut from "./fixtures/rustfs-put.json";

/** An S3 notification body with one record. */
function notification(bucket: unknown, key: unknown) {
  return { Records: [{ s3: { bucket: { name: bucket }, object: { key } } }] };
}

describe("a RustFS notification", () => {
  it("names the bucket and the decoded key of an uploaded file", () => {
    expect(normalizeRustfsEvent(rustfsPut)).toEqual([{ bucket: "kmo-config", key: "shop/orders-api/config.env" }]);
  });

  it("reads a deletion the same way as an upload", () => {
    expect(normalizeRustfsEvent(rustfsDelete)).toEqual([{ bucket: "kmo-config", key: "shop/orders-api/config.env" }]);
  });

  it("decodes encoded slashes, spaces written as + and other escapes in a key", () => {
    expect(normalizeRustfsEvent(notification("b", "shop%2Fmy+app%2Fconfig%20v2.env"))).toEqual([
      { bucket: "b", key: "shop/my app/config v2.env" },
    ]);
  });

  it("keeps a real plus sign, which RustFS sends as %2B", () => {
    expect(normalizeRustfsEvent(notification("b", "shop%2Forders-api%2Fwith+space%2Bplus.env"))).toEqual([
      { bucket: "b", key: "shop/orders-api/with space+plus.env" },
    ]);
  });

  it("gives one event per record", () => {
    const body = { Records: [...notification("b", "one").Records, ...notification("b", "two").Records] };
    expect(normalizeRustfsEvent(body).map((event) => event.key)).toEqual(["one", "two"]);
  });

  it("may carry no records", () => {
    expect(normalizeRustfsEvent({ Records: [] })).toEqual([]);
  });

  it.each([
    ["has no Records list", { EventName: "s3:ObjectCreated:Put" }],
    ["is not an object", "hello"],
    ["is empty", null],
    ["has a record without a key", notification("b", undefined)],
    ["has a record without a bucket", notification(undefined, "k")],
    ["has a key with a broken escape", notification("b", "shop%2")],
  ])("is malformed when it %s", (_, body) => {
    expect(() => normalizeRustfsEvent(body)).toThrow(MalformedEventError);
  });
});

describe("an EventBridge event", () => {
  it("names the bucket and key found under detail", () => {
    expect(normalizeEventBridgeEvent(eventBridgeCreated)).toEqual([
      { bucket: "amzn-s3-demo-bucket1", key: "example-key" },
    ]);
  });

  it("takes the key as it is, without decoding", () => {
    const body = { detail: { bucket: { name: "b" }, object: { key: "shop/my+app/100%.env" } } };
    expect(normalizeEventBridgeEvent(body)).toEqual([{ bucket: "b", key: "shop/my+app/100%.env" }]);
  });

  it.each([
    ["has no detail", { source: "aws.s3" }],
    ["has no object key", { detail: { bucket: { name: "b" }, object: {} } }],
    ["is not an object", 42],
  ])("is malformed when it %s", (_, body) => {
    expect(() => normalizeEventBridgeEvent(body)).toThrow(MalformedEventError);
  });

  it("yields nothing for an event from a source other than S3, so other kinds of store can come later", () => {
    expect(normalizeEventBridgeEvent(parameterStore)).toEqual([]);
  });

  it("still refuses an event that names no source and no file", () => {
    expect(() => normalizeEventBridgeEvent({ detail: {} })).toThrow(MalformedEventError);
  });
});
