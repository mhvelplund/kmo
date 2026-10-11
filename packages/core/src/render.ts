import { DotenvParseError, parseDotenv } from "./dotenv";
import { configHash } from "./hash";
import { mergeValues } from "./merge";
import type { EnvValues, SourceName } from "./types";

/** The text of each file of one source that was found; a missing file is left out. */
export type SourceTexts = Partial<Record<SourceName, string>>;

/** The files read from one store. */
export interface SourceInput {
  /** The store they came from, such as ClusterConfigStore/default. */
  store: string;
  /** The text of each file that exists. */
  texts: SourceTexts;
}

/** What a reconcile writes for one workload. */
export interface Outputs {
  /** Merged values of the config files. */
  configMapData: EnvValues;
  /** Merged values of the secrets files. */
  secretData: EnvValues;
  /** SHA-256 hash of both sets of values. */
  configHash: string;
}

/** Raised when one of the source files cannot be parsed. Never carries a value. */
export class SourceParseError extends Error {
  /**
   * @param store The store the file came from.
   * @param source Which of the four files failed.
   * @param line One-based number of the offending line.
   * @param reason What is wrong with it.
   */
  constructor(
    readonly store: string,
    readonly source: SourceName,
    readonly line: number,
    readonly reason: string,
  ) {
    super(`${store} ${source}, line ${line}: ${reason}`);
    this.name = "SourceParseError";
  }
}

/**
 * Builds a workload's ConfigMap data, Secret data and hash from its source files.
 * @param sources The files of each source, in the order of the ConfigSync.
 * @returns The merged outputs: every common file first, then every service file, a later source winning.
 * @throws SourceParseError if any file cannot be parsed; nothing is returned in that case.
 */
export function buildOutputs(sources: SourceInput[]): Outputs {
  const all = (file: SourceName) => sources.map((source) => parse(source, file));
  const configMapData = mergeValues(...all("commonConfig"), ...all("config"));
  const secretData = mergeValues(...all("commonSecrets"), ...all("secrets"));
  return { configMapData, secretData, configHash: configHash(configMapData, secretData) };
}

function parse(source: SourceInput, file: SourceName): EnvValues {
  try {
    return parseDotenv(source.texts[file] ?? "");
  } catch (error) {
    if (error instanceof DotenvParseError) throw new SourceParseError(source.store, file, error.line, error.reason);
    throw error;
  }
}
