import { DotenvParseError, parseDotenv } from "./dotenv";
import { configHash } from "./hash";
import { mergeValues } from "./merge";
import type { EnvValues, SourceName } from "./types";

/** The text of each source file that was found; a missing file is left out. */
export type SourceTexts = Partial<Record<SourceName, string>>;

/** What a reconcile writes for one workload. */
export interface Outputs {
  configMapData: EnvValues;
  secretData: EnvValues;
  configHash: string;
}

/** Raised when one of the source files cannot be parsed. Never carries a value. */
export class SourceParseError extends Error {
  /**
   * @param source Which of the four files failed.
   * @param line One-based number of the offending line.
   * @param reason What is wrong with it.
   */
  constructor(
    readonly source: SourceName,
    readonly line: number,
    readonly reason: string,
  ) {
    super(`${source}, line ${line}: ${reason}`);
    this.name = "SourceParseError";
  }
}

/**
 * Builds a workload's ConfigMap data, Secret data and hash from its source files.
 * @param texts Contents of the files that exist.
 * @returns The merged outputs.
 * @throws SourceParseError if any file cannot be parsed; nothing is returned in that case.
 */
export function buildOutputs(texts: SourceTexts): Outputs {
  const configMapData = mergeValues(parse(texts, "commonConfig"), parse(texts, "config"));
  const secretData = mergeValues(parse(texts, "commonSecrets"), parse(texts, "secrets"));
  return { configMapData, secretData, configHash: configHash(configMapData, secretData) };
}

function parse(texts: SourceTexts, source: SourceName): EnvValues {
  try {
    return parseDotenv(texts[source] ?? "");
  } catch (error) {
    if (error instanceof DotenvParseError) throw new SourceParseError(source, error.line, error.reason);
    throw error;
  }
}
