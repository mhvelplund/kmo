import { describe, expect, it } from "vitest";
import { needsReconcile } from "../src/trigger";
import type { ConfigSync } from "../src/types";

const sync = (generation: number, request: string | undefined, status: ConfigSync["status"]): ConfigSync => ({
  metadata: {
    name: "orders-api",
    namespace: "shop",
    generation,
    annotations: request ? { "kmo.isntall.net/sync-requested-at": request } : {},
  },
  status,
});

describe("a ConfigSync needs a reconcile", () => {
  it("when it is new", () => {
    expect(needsReconcile(sync(1, undefined, undefined))).toBe(true);
  });

  it("when its spec changed", () => {
    expect(needsReconcile(sync(2, undefined, { observedGeneration: 1 }))).toBe(true);
  });

  it("when a sync was requested that has not been handled", () => {
    expect(needsReconcile(sync(1, "request-2", { observedGeneration: 1, lastHandledSyncRequest: "request-1" }))).toBe(
      true,
    );
  });

  it("but not when the only change is the operator's own status update", () => {
    expect(needsReconcile(sync(1, "request-1", { observedGeneration: 1, lastHandledSyncRequest: "request-1" }))).toBe(
      false,
    );
    expect(needsReconcile(sync(1, undefined, { observedGeneration: 1 }))).toBe(false);
  });
});
