import { describe, expect, it } from "vitest";
import { SyncFailure } from "../src/cluster";
import { MAX_OUTPUT_BYTES } from "@kmo/core";
import { fetchSources, refuseLargeFile, type GetObject } from "../src/s3";

const keys = {
  config: "shop/orders-api/config.env",
  secrets: "shop/orders-api/secrets.env",
  commonConfig: "_common/config.env",
  commonSecrets: "_common/secrets.env",
};

const store = "ClusterConfigStore/default";

/** A bucket held in memory. */
function bucketWith(files: Record<string, string>): GetObject {
  return async (_bucket, key) => (key in files ? { text: files[key] ?? "", versionId: `v-${key}` } : undefined);
}

describe("fetching the source files", () => {
  it("returns the text and the version of each file that exists", async () => {
    const fetched = await fetchSources(bucketWith({ [keys.config]: "A=1" }), store, "kmo-config", keys);
    expect(fetched.texts).toEqual({ config: "A=1" });
    expect(fetched.sources).toContainEqual({ store, key: keys.config, found: true, versionId: `v-${keys.config}` });
  });

  it("records a missing file as not found and goes on", async () => {
    const fetched = await fetchSources(bucketWith({}), store, "kmo-config", keys);
    expect(fetched.texts).toEqual({});
    expect(fetched.sources).toHaveLength(4);
    expect(fetched.sources.every((source) => !source.found)).toBe(true);
  });

  it("asks only for the files it is given, so a source without common files reads two", async () => {
    const asked: string[] = [];
    const get: GetObject = async (_bucket, key) => void asked.push(key);
    const fetched = await fetchSources(get, store, "kmo-config", { config: keys.config, secrets: keys.secrets });
    expect(asked.sort()).toEqual([keys.config, keys.secrets]);
    expect(fetched.sources).toHaveLength(2);
  });

  it("fails as a whole when one file cannot be read, and names the key", async () => {
    const get: GetObject = async (_bucket, key) => {
      if (key === keys.secrets)
        throw Object.assign(new Error("denied by secret-access-key-123"), { name: "AccessDenied" });
      return { text: "A=1" };
    };
    const failure = await fetchSources(get, store, "kmo-config", keys).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SyncFailure);
    expect((failure as SyncFailure).reason).toBe("StoreUnreachable");
    expect((failure as SyncFailure).message).toBe(
      'could not read "shop/orders-api/secrets.env" from bucket "kmo-config": AccessDenied',
    );
  });
});

describe("a file that is too large to fit in a ConfigMap or a Secret", () => {
  it("is refused by its size alone, with the key and the bucket in the message", () => {
    const refuse = () => refuseLargeFile("kmo-config", keys.config, MAX_OUTPUT_BYTES + 1);
    expect(refuse).toThrow(SyncFailure);
    expect(refuse).toThrow(`"${keys.config}" in bucket "kmo-config" is 1048577 bytes; the limit is 1048576`);
  });

  it("is not refused at the limit, or when the store does not tell the size", () => {
    expect(() => refuseLargeFile("kmo-config", keys.config, MAX_OUTPUT_BYTES)).not.toThrow();
    expect(() => refuseLargeFile("kmo-config", keys.config, undefined)).not.toThrow();
  });

  it("fails the fetch with its own reason, not as a store that cannot be reached", async () => {
    const get: GetObject = async (bucket, key) => {
      refuseLargeFile(bucket, key, MAX_OUTPUT_BYTES + 1);
      return undefined;
    };
    await expect(fetchSources(get, store, "kmo-config", keys)).rejects.toMatchObject({ reason: "OutputTooLarge" });
  });
});
