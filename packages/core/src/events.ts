/** A change to one file in a bucket, whatever announced it. */
export interface StoreEvent {
  /** Bucket that holds the file. */
  bucket: string;
  /** Full key of the file. */
  key: string;
}

/** Raised when an event body does not have the expected shape. */
export class MalformedEventError extends Error {
  /** @param message What is wrong with the body. */
  constructor(message: string) {
    super(message);
    this.name = "MalformedEventError";
  }
}

/**
 * Reads an S3 notification as sent by RustFS.
 * @param body The parsed JSON body.
 * @returns One event per record, with URL-decoded keys.
 * @throws MalformedEventError if the body is not a notification.
 */
export function normalizeRustfsEvent(body: unknown): StoreEvent[] {
  const records = dig(body, "Records");
  if (!Array.isArray(records)) throw new MalformedEventError("expected a Records list");
  return records.map((record: unknown, index) => {
    const bucket = dig(record, "s3", "bucket", "name");
    const key = dig(record, "s3", "object", "key");
    if (typeof bucket !== "string" || typeof key !== "string") {
      throw new MalformedEventError(`record ${index} has no bucket name or object key`);
    }
    return { bucket, key: decodeKey(key, index) };
  });
}

const S3_SOURCE = "aws.s3";

/**
 * Reads an Amazon S3 event delivered through EventBridge.
 * @param body The parsed JSON body.
 * @returns A single event, with the key exactly as sent; nothing for an event from a source other than S3.
 * @throws MalformedEventError if the body is an S3 event, or names no source, and has no bucket and key.
 */
export function normalizeEventBridgeEvent(body: unknown): StoreEvent[] {
  const source = dig(body, "source");
  if (typeof source === "string" && source !== S3_SOURCE) return [];
  const bucket = dig(body, "detail", "bucket", "name");
  const key = dig(body, "detail", "object", "key");
  if (typeof bucket !== "string" || typeof key !== "string") {
    throw new MalformedEventError("expected detail.bucket.name and detail.object.key");
  }
  return [{ bucket, key }];
}

function dig(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>(
    (current, part) =>
      typeof current === "object" && current !== null ? (current as Record<string, unknown>)[part] : undefined,
    value,
  );
}

function decodeKey(key: string, index: number): string {
  try {
    return decodeURIComponent(key.replace(/\+/g, " "));
  } catch {
    throw new MalformedEventError(`record ${index} has a key that cannot be decoded`);
  }
}
