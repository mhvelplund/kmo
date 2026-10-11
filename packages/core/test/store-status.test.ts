import { describe, expect, it } from "vitest";
import { storeConditions } from "../src/status";

describe("the Ready condition of a store", () => {
  it("is true when the bucket can be reached with the store's credentials", () => {
    expect(storeConditions(undefined, undefined, "2026-10-11T09:00:00.000Z")).toEqual([
      {
        type: "Ready",
        status: "True",
        reason: "Reachable",
        message: "the bucket can be reached",
        lastTransitionTime: "2026-10-11T09:00:00.000Z",
      },
    ]);
  });

  it("is false with the problem when it cannot", () => {
    const [ready] = storeConditions(undefined, "Secret kmo-system/creds was not found", "2026-10-11T09:00:00.000Z");
    expect(ready).toMatchObject({
      status: "False",
      reason: "NotReachable",
      message: "Secret kmo-system/creds was not found",
    });
  });

  it("keeps the time it last changed while the store stays reachable", () => {
    const first = storeConditions(undefined, undefined, "2026-10-11T09:00:00.000Z");
    const [ready] = storeConditions(first, undefined, "2026-10-11T09:01:00.000Z");
    expect(ready?.lastTransitionTime).toBe("2026-10-11T09:00:00.000Z");
  });
});
