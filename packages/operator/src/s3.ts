import { GetObjectCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { SourceName, SourceStatus, SourceTexts, Store } from "@kmo/core";
import { SyncFailure, type StoreCredentials } from "./cluster";

/** Reads one object; undefined means the object does not exist. */
export type GetObject = (bucket: string, key: string) => Promise<{ text: string; versionId?: string } | undefined>;

/** The files of one source of a ConfigSync as read from its store. */
export interface FetchedSources {
  /** Text of each file that exists. */
  texts: SourceTexts;
  /** A record of every file asked for, found or not. */
  sources: SourceStatus[];
}

const SOURCES: SourceName[] = ["config", "secrets", "commonConfig", "commonSecrets"];

/**
 * Fetches the files of one source of a ConfigSync.
 * @param get How one object is read.
 * @param store The store's label, such as ClusterConfigStore/default.
 * @param bucket The store's bucket.
 * @param keys The full key of each file to read.
 * @returns The text of each file that exists, and a record of every file asked for.
 * @throws SyncFailure with reason StoreUnreachable when any file cannot be read; nothing is returned in that case.
 */
export async function fetchSources(
  get: GetObject,
  store: string,
  bucket: string,
  keys: Partial<Record<SourceName, string>>,
): Promise<FetchedSources> {
  const texts: SourceTexts = {};
  const sources = await Promise.all(
    SOURCES.flatMap((name) => {
      const key = keys[name];
      return key === undefined ? [] : [{ name, key }];
    }).map(async ({ name, key }): Promise<SourceStatus> => {
      try {
        const object = await get(bucket, key);
        if (!object) return { store, key, found: false };
        texts[name] = object.text;
        return { store, key, found: true, ...(object.versionId ? { versionId: object.versionId } : {}) };
      } catch (error) {
        const code = (error as { name?: string }).name ?? "unknown error";
        throw new SyncFailure("StoreUnreachable", `could not read "${key}" from bucket "${bucket}": ${code}`);
      }
    }),
  );
  return { texts, sources };
}

/**
 * Builds the client for one store.
 * @param store The store.
 * @param credentials Its keys.
 * @returns An S3 client for the store's endpoint and addressing style.
 */
export function s3Client(store: Store, credentials: StoreCredentials): S3Client {
  return new S3Client({
    region: store.spec.s3.region,
    endpoint: store.spec.s3.endpoint || undefined,
    forcePathStyle: store.spec.s3.addressingStyle === "Path",
    credentials,
  });
}

/**
 * Makes the reader for one store.
 * @param store The store.
 * @param credentials Its keys.
 * @returns A function that reads one object and answers undefined for a key that does not exist.
 */
export function s3GetObject(store: Store, credentials: StoreCredentials): GetObject {
  const client = s3Client(store, credentials);
  return async (bucket, key) => {
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return { text: (await response.Body?.transformToString("utf-8")) ?? "", versionId: response.VersionId };
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return undefined;
      throw error;
    }
  };
}

/**
 * Checks that a store's bucket can be reached with its credentials.
 * @param store The store.
 * @param credentials Its keys.
 * @throws SyncFailure with reason StoreUnreachable, naming the bucket and the error's name only.
 */
export async function checkBucket(store: Store, credentials: StoreCredentials): Promise<void> {
  try {
    await s3Client(store, credentials).send(new HeadBucketCommand({ Bucket: store.spec.s3.bucket }));
  } catch (error) {
    const code = (error as { name?: string }).name ?? "unknown error";
    throw new SyncFailure("StoreUnreachable", `could not reach bucket "${store.spec.s3.bucket}": ${code}`);
  }
}
