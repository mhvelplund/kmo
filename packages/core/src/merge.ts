import type { EnvValues } from "./types";

/**
 * Merges common values with a workload's own values.
 * @param common Values shared by every workload of the store.
 * @param workload Values of one workload; these win.
 * @returns The effective values.
 */
export function mergeValues(common: EnvValues, workload: EnvValues): EnvValues {
  return { ...common, ...workload };
}
