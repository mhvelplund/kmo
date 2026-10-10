import { createHash } from "node:crypto";
import type { EnvValues } from "./types";

/**
 * Hashes the contents of a workload's two output objects.
 * @param configMapData Data of the ConfigMap.
 * @param secretData Data of the Secret.
 * @returns A SHA-256 digest in lowercase hex, independent of key order.
 */
export function configHash(configMapData: EnvValues, secretData: EnvValues): string {
  const canonical = JSON.stringify([sortedEntries(configMapData), sortedEntries(secretData)]);
  return createHash("sha256").update(canonical).digest("hex");
}

function sortedEntries(values: EnvValues): [string, string][] {
  return Object.entries(values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
