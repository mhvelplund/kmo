import type { Condition, ConditionType, ConfigSyncStatus, Failure, SourceStatus } from "./types";

/** How one reconcile ended. */
export type SyncOutcome =
  | ({ result: "failed" } & Failure)
  | {
      result: "synced";
      /** Labels of the stores that were read, in the order of the sources. */
      stores: string[];
      /** Every file that was asked for. */
      sources: SourceStatus[];
      /** Hash of the values that were written. */
      configHash: string;
      /** True when every file is missing or holds no values. */
      empty: boolean;
      /** One line for each target that is missing or does not use the outputs. */
      wiringProblems: string[];
    }
  | { result: "suspended" };

/** What the reconcile saw of the resource it acted on. */
export interface Observed {
  /** The generation of the spec. */
  generation?: number;
  /** The value of the sync annotation. */
  syncRequest?: string;
  /** The current time, ISO 8601. */
  now: string;
}

/** An Event to record on a ConfigSync. */
export interface EventNote {
  /** Normal for news, Warning for a problem. */
  type: "Normal" | "Warning";
  /** Short and stable, for machines. */
  reason: string;
  /** For people. */
  message: string;
}

/**
 * Sets one condition in a list.
 * @param conditions The current conditions.
 * @param next The condition to set.
 * @param now The current time, used only when the condition's status changes.
 * @returns A new list with the condition in place.
 */
export function withCondition(
  conditions: Condition[],
  next: Omit<Condition, "lastTransitionTime">,
  now: string,
): Condition[] {
  const current = conditions.find((condition) => condition.type === next.type);
  const lastTransitionTime = current?.status === next.status ? current.lastTransitionTime : now;
  return [...conditions.filter((condition) => condition.type !== next.type), { ...next, lastTransitionTime }];
}

/**
 * Builds the status of a ConfigSync after a reconcile.
 * @param previous The status before the reconcile.
 * @param outcome How the reconcile ended.
 * @param observed The generation and sync request that were acted on, and the time.
 * @returns The new status. A failure or a suspension keeps what the last good sync recorded.
 */
export function nextStatus(
  previous: ConfigSyncStatus | undefined,
  outcome: SyncOutcome,
  observed: Observed,
): ConfigSyncStatus {
  const status: ConfigSyncStatus = {
    ...previous,
    observedGeneration: observed.generation,
    lastHandledSyncRequest: observed.syncRequest,
  };
  let conditions = previous?.conditions ?? [];
  const set = (type: ConditionType, ok: boolean, reason: string, message: string) => {
    conditions = withCondition(conditions, { type, status: ok ? "True" : "False", reason, message }, observed.now);
  };

  if (outcome.result === "suspended") {
    set("Suspended", true, "Suspended", "syncing is suspended");
  } else if (outcome.result === "failed") {
    set("Ready", false, outcome.reason, outcome.message);
    set("Suspended", false, "Active", "syncing is active");
  } else {
    status.lastSyncTime = observed.now;
    status.configHash = outcome.configHash;
    status.stores = outcome.stores;
    status.sources = outcome.sources;
    set("Ready", true, "Synced", "the outputs match the store");
    if (outcome.empty) set("SourcesFound", false, "NoSources", "every source file is missing or empty");
    else set("SourcesFound", true, "Found", "at least one source file holds values");
    if (outcome.wiringProblems.length > 0) set("TargetsWired", false, "NotWired", outcome.wiringProblems.join("; "));
    else set("TargetsWired", true, "Wired", "every target exists and uses the outputs that hold values");
    set("Suspended", false, "Active", "syncing is active");
  }
  return { ...status, conditions };
}

/**
 * Works out which Events a reconcile must record.
 * @param previous The status before the reconcile.
 * @param next The status after it.
 * @returns One note for each condition that changed to something worth telling; none when nothing changed.
 */
export function eventsFor(previous: ConfigSyncStatus | undefined, next: ConfigSyncStatus): EventNote[] {
  const notes: EventNote[] = [];
  for (const type of ["Ready", "SourcesFound", "TargetsWired", "Suspended"] as const) {
    const before = previous?.conditions?.find((condition) => condition.type === type);
    const after = next.conditions?.find((condition) => condition.type === type);
    if (!after || (before?.status === after.status && before.message === after.message)) continue;

    const note = (kind: EventNote["type"]) => notes.push({ type: kind, reason: after.reason, message: after.message });
    if (type === "Suspended") {
      if (after.status === "True") note("Normal");
      else if (before?.status === "True") notes.push({ type: "Normal", reason: "Resumed", message: after.message });
    } else if (after.status === "False") {
      note("Warning");
    } else if (type === "Ready" && before?.status === "False") {
      note("Normal");
    }
  }
  return notes;
}

/**
 * Builds the conditions of a store after a check of its bucket.
 * @param previous The store's conditions before the check.
 * @param problem Why the bucket cannot be reached, or undefined when it can.
 * @param now The current time, used only when the condition's status changes.
 * @returns The store's conditions, with Ready set.
 */
export function storeConditions(
  previous: Condition[] | undefined,
  problem: string | undefined,
  now: string,
): Condition[] {
  const next = problem
    ? { type: "Ready" as const, status: "False" as const, reason: "NotReachable", message: problem }
    : { type: "Ready" as const, status: "True" as const, reason: "Reachable", message: "the bucket can be reached" };
  return withCondition(previous ?? [], next, now);
}
