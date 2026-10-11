import { resolveOrUndefined } from "./defaults";
import type { ConfigSync } from "./types";

/**
 * Looks for a target or output name that a ConfigSync shares with another.
 * @param candidate The ConfigSync being created or changed.
 * @param others The ConfigSyncs of the same namespace; an entry with the candidate's name is ignored.
 * @returns A message naming the first shared claim and its holder, or undefined when there is none.
 */
export function findClaimConflict(candidate: ConfigSync, others: ConfigSync[]): string | undefined {
  const mine = resolveOrUndefined(candidate);
  if (!mine) return undefined;

  for (const other of others) {
    if (other.metadata.name === candidate.metadata.name) continue;
    const theirs = resolveOrUndefined(other);
    if (!theirs) continue;
    const holder = `ConfigSync "${theirs.name}"`;

    const shared = mine.targets.find((target) =>
      theirs.targets.some((taken) => taken.kind === target.kind && taken.name === target.name),
    );
    if (shared) return `${shared.kind} "${shared.name}" is already a target of ${holder}`;
    if (mine.output.configMapName === theirs.output.configMapName) {
      return `ConfigMap "${mine.output.configMapName}" is already an output of ${holder}`;
    }
    if (mine.output.secretName === theirs.output.secretName) {
      return `Secret "${mine.output.secretName}" is already an output of ${holder}`;
    }
  }
  return undefined;
}
