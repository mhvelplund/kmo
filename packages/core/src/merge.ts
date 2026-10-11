import type { EnvValues } from "./types";

/**
 * Merges sets of values into one.
 * @param layers The sets, least important first; a later set wins over an earlier one.
 * @returns The effective values.
 */
export function mergeValues(...layers: EnvValues[]): EnvValues {
  return Object.assign({}, ...layers) as EnvValues;
}
