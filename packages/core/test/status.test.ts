import { describe, expect, it } from "vitest";
import { eventsFor, nextStatus, type SyncOutcome } from "../src/status";
import type { ConfigSyncStatus } from "../src/types";

const at = (minute: number) => `2026-10-11T09:${String(minute).padStart(2, "0")}:00.000Z`;
const observed = (minute: number, generation = 1, syncRequest?: string) => ({
  generation,
  syncRequest,
  now: at(minute),
});
const synced: SyncOutcome = {
  result: "synced",
  stores: ["ClusterConfigStore/default"],
  sources: [{ store: "ClusterConfigStore/default", key: "shop/orders-api/config.env", found: true, versionId: "v1" }],
  configHash: "abc",
  empty: false,
  wiringProblems: [],
};
const failed: SyncOutcome = {
  result: "failed",
  reason: "SourceUnparsable",
  message: "ClusterConfigStore/default config, line 3: expected KEY=value",
};
const condition = (status: ConfigSyncStatus, type: string) => status.conditions?.find((c) => c.type === type);

describe("the status after a sync", () => {
  it("records what was read, when, and that the resource is ready", () => {
    const status = nextStatus(undefined, synced, observed(1, 4, "request-1"));
    expect(status).toMatchObject({
      observedGeneration: 4,
      lastHandledSyncRequest: "request-1",
      lastSyncTime: at(1),
      configHash: "abc",
      stores: ["ClusterConfigStore/default"],
      sources: synced.sources,
    });
    expect(condition(status, "Ready")).toMatchObject({ status: "True", reason: "Synced" });
    expect(condition(status, "SourcesFound")).toMatchObject({ status: "True" });
    expect(condition(status, "TargetsWired")).toMatchObject({ status: "True" });
    expect(condition(status, "Suspended")).toMatchObject({ status: "False" });
  });

  it("warns when every file is missing or empty, and is still ready", () => {
    const status = nextStatus(undefined, { ...synced, empty: true }, observed(1));
    expect(condition(status, "SourcesFound")).toMatchObject({ status: "False", reason: "NoSources" });
    expect(condition(status, "Ready")).toMatchObject({ status: "True" });
  });

  it("warns about targets that are not wired, and is still ready", () => {
    const status = nextStatus(undefined, { ...synced, wiringProblems: ['Deployment "x" does not exist'] }, observed(1));
    expect(condition(status, "TargetsWired")).toMatchObject({
      status: "False",
      message: 'Deployment "x" does not exist',
    });
    expect(condition(status, "Ready")).toMatchObject({ status: "True" });
  });
});

describe("the status after a failure", () => {
  it("is not ready, with the reason, and keeps what the last good sync recorded", () => {
    const good = nextStatus(undefined, synced, observed(1));
    const status = nextStatus(good, failed, observed(2, 2));
    expect(condition(status, "Ready")).toMatchObject({
      status: "False",
      reason: "SourceUnparsable",
      message: failed.message,
    });
    expect(status).toMatchObject({
      observedGeneration: 2,
      lastSyncTime: at(1),
      configHash: "abc",
      sources: synced.sources,
    });
  });
});

describe("the status of a suspended resource", () => {
  it("keeps its last values and says that it is suspended", () => {
    const good = nextStatus(undefined, synced, observed(1));
    const status = nextStatus(good, { result: "suspended" }, observed(2, 2));
    expect(condition(status, "Suspended")).toMatchObject({ status: "True" });
    expect(status).toMatchObject({ observedGeneration: 2, lastSyncTime: at(1), configHash: "abc" });
    expect(condition(status, "Ready")).toMatchObject({ status: "True" });
  });
});

describe("a condition", () => {
  it("keeps the time it last changed for as long as its state holds", () => {
    const first = nextStatus(undefined, synced, observed(1));
    const second = nextStatus(first, synced, observed(2));
    const third = nextStatus(second, failed, observed(3));
    expect(condition(second, "Ready")?.lastTransitionTime).toBe(at(1));
    expect(condition(third, "Ready")?.lastTransitionTime).toBe(at(3));
  });
});

describe("the Events of a reconcile", () => {
  const good = nextStatus(undefined, synced, observed(1));

  it("are none when nothing changed", () => {
    expect(eventsFor(good, nextStatus(good, synced, observed(2)))).toEqual([]);
  });

  it("include a warning for a failure, once, however often it repeats", () => {
    const bad = nextStatus(good, failed, observed(2));
    expect(eventsFor(good, bad)).toEqual([{ type: "Warning", reason: "SourceUnparsable", message: failed.message }]);
    expect(eventsFor(bad, nextStatus(bad, failed, observed(3)))).toEqual([]);
  });

  it("say so when a failed resource is ready again", () => {
    const bad = nextStatus(good, failed, observed(2));
    expect(eventsFor(bad, nextStatus(bad, synced, observed(3)))).toEqual([
      { type: "Normal", reason: "Synced", message: "the outputs match the store" },
    ]);
  });

  it("include a warning for each warning condition", () => {
    const next = nextStatus(
      good,
      { ...synced, empty: true, wiringProblems: ['Deployment "x" does not exist'] },
      observed(2),
    );
    expect(eventsFor(good, next)).toEqual([
      { type: "Warning", reason: "NoSources", message: "every source file is missing or empty" },
      { type: "Warning", reason: "NotWired", message: 'Deployment "x" does not exist' },
    ]);
  });

  it("record suspending and resuming", () => {
    const paused = nextStatus(good, { result: "suspended" }, observed(2));
    expect(eventsFor(good, paused)).toEqual([{ type: "Normal", reason: "Suspended", message: "syncing is suspended" }]);
    expect(eventsFor(paused, nextStatus(paused, synced, observed(3)))).toEqual([
      { type: "Normal", reason: "Resumed", message: "syncing is active" },
    ]);
  });

  it("say nothing about a new resource that is simply ready", () => {
    expect(eventsFor(undefined, good)).toEqual([]);
  });
});
