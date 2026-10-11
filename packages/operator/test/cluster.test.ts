import { describe, expect, it } from "vitest";
import { SyncFailure, credentialsFrom } from "../src/cluster";

const base64 = (text: string) => Buffer.from(text).toString("base64");

describe("store credentials", () => {
  it("are read from the two keys of the Secret", () => {
    const data = { accessKeyId: base64("kmoadmin"), secretAccessKey: base64("s3cret") };
    expect(credentialsFrom(data, "Secret kmo-system/creds")).toEqual({
      accessKeyId: "kmoadmin",
      secretAccessKey: "s3cret",
    });
  });

  it("are refused when a key is missing, naming the key and never a value", () => {
    const attempt = () => credentialsFrom({ accessKeyId: base64("kmoadmin") }, "Secret kmo-system/creds");
    expect(attempt).toThrow(SyncFailure);
    expect(attempt).toThrow('Secret kmo-system/creds has no key "secretAccessKey"');
  });
});
