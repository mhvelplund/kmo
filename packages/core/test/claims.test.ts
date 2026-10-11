import { describe, expect, it } from "vitest";
import { findClaimConflict } from "../src/claims";
import type { ConfigSync } from "../src/types";

const sync = (name: string, spec: ConfigSync["spec"] = {}): ConfigSync => ({
  metadata: { name, namespace: "shop" },
  spec,
});

describe("a ConfigSync conflicts with another", () => {
  it("when both target the same workload", () => {
    const candidate = sync("second", { targets: [{ name: "orders-api" }] });
    expect(findClaimConflict(candidate, [sync("orders-api")])).toBe(
      'Deployment "orders-api" is already a target of ConfigSync "orders-api"',
    );
  });

  it("when both write a ConfigMap with the same name", () => {
    const candidate = sync("second", { output: { configMapName: "orders-api-kmo" } });
    expect(findClaimConflict(candidate, [sync("orders-api")])).toBe(
      'ConfigMap "orders-api-kmo" is already an output of ConfigSync "orders-api"',
    );
  });

  it("when both write a Secret with the same name", () => {
    const candidate = sync("second", { output: { secretName: "orders-api-kmo" } });
    expect(findClaimConflict(candidate, [sync("orders-api")])).toBe(
      'Secret "orders-api-kmo" is already an output of ConfigSync "orders-api"',
    );
  });

  it("even when the other one is suspended, because it keeps its claims", () => {
    const candidate = sync("second", { targets: [{ name: "orders-api" }] });
    expect(findClaimConflict(candidate, [sync("orders-api", { suspend: true })])).toBeDefined();
  });
});

describe("a ConfigSync does not conflict", () => {
  it("with one that targets a workload of the same name but another kind", () => {
    const candidate = sync("second", { targets: [{ kind: "CronJob", name: "orders-api" }] });
    expect(findClaimConflict(candidate, [sync("orders-api")])).toBeUndefined();
  });

  it("with an earlier version of itself", () => {
    expect(findClaimConflict(sync("orders-api", { suspend: true }), [sync("orders-api")])).toBeUndefined();
  });

  it("when it serves several workloads that nothing else claims", () => {
    const candidate = sync("shared", { targets: [{ name: "one" }, { kind: "CronJob", name: "two" }] });
    expect(findClaimConflict(candidate, [sync("orders-api")])).toBeUndefined();
  });

  it("with a ConfigSync whose spec cannot be read; that one reports its own problem", () => {
    expect(findClaimConflict(sync("second"), [sync("broken", { refreshInterval: "soon" })])).toBeUndefined();
  });
});
