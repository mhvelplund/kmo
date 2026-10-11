import { describe, expect, it } from "vitest";
import { statusPatch } from "../src/report";

describe("the patch that writes a status", () => {
  it("clears the handled sync request when the annotation is gone", () => {
    expect(statusPatch({ observedGeneration: 2 })).toEqual({ observedGeneration: 2, lastHandledSyncRequest: null });
  });

  it("keeps the handled sync request when there is one", () => {
    expect(statusPatch({ observedGeneration: 2, lastHandledSyncRequest: "request-1" })).toEqual({
      observedGeneration: 2,
      lastHandledSyncRequest: "request-1",
    });
  });
});
