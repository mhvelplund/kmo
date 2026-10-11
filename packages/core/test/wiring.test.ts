import { describe, expect, it } from "vitest";
import { resolveConfigSync } from "../src/defaults";
import { referencesObject, wiringProblems, type PodSpec } from "../src/workload";

const sync = resolveConfigSync({ metadata: { name: "orders-api", namespace: "shop" } });
const full = { configMapData: { A: "1" }, secretData: { B: "2" }, configHash: "abc" };
const wired: PodSpec = {
  containers: [{ envFrom: [{ configMapRef: { name: "orders-api-kmo" } }, { secretRef: { name: "orders-api-kmo" } }] }],
};

describe("a pod that uses an object", () => {
  it("may take all its keys with envFrom", () => {
    expect(referencesObject(wired, "ConfigMap", "orders-api-kmo")).toBe(true);
    expect(referencesObject(wired, "Secret", "orders-api-kmo")).toBe(true);
  });

  it("may take one key with an env entry", () => {
    const pod: PodSpec = { containers: [{ env: [{ valueFrom: { secretKeyRef: { name: "orders-api-kmo" } } }] }] };
    expect(referencesObject(pod, "Secret", "orders-api-kmo")).toBe(true);
    expect(referencesObject(pod, "ConfigMap", "orders-api-kmo")).toBe(false);
  });

  it("may mount it as a volume", () => {
    const pod: PodSpec = {
      volumes: [{ configMap: { name: "orders-api-kmo" } }, { secret: { secretName: "orders-api-kmo" } }],
    };
    expect(referencesObject(pod, "ConfigMap", "orders-api-kmo")).toBe(true);
    expect(referencesObject(pod, "Secret", "orders-api-kmo")).toBe(true);
  });

  it("may use it from an init container only", () => {
    const pod: PodSpec = { initContainers: [{ envFrom: [{ configMapRef: { name: "orders-api-kmo" } }] }] };
    expect(referencesObject(pod, "ConfigMap", "orders-api-kmo")).toBe(true);
  });

  it("does not use an object it never names", () => {
    expect(referencesObject({ containers: [{}] }, "ConfigMap", "orders-api-kmo")).toBe(false);
  });
});

describe("the wiring of a ConfigSync's targets", () => {
  it("is fine when each target uses both objects", () => {
    expect(
      wiringProblems(sync, full, [{ kind: "Deployment", name: "orders-api", state: "stamped", podSpec: wired }]),
    ).toEqual([]);
  });

  it("reports a target that does not exist", () => {
    expect(wiringProblems(sync, full, [{ kind: "Deployment", name: "orders-api", state: "missing" }])).toEqual([
      'Deployment "orders-api" does not exist',
    ]);
  });

  it("reports a Rollout that takes its pod template from a Deployment", () => {
    expect(wiringProblems(sync, full, [{ kind: "Rollout", name: "checkout", state: "borrowed" }])).toEqual([
      'Rollout "checkout" takes its pod template from a Deployment; name that Deployment as the target',
    ]);
  });

  it("reports an object that holds values but is not used by a target", () => {
    const target = {
      kind: "Deployment" as const,
      name: "orders-api",
      state: "unchanged" as const,
      podSpec: { containers: [{}] },
    };
    expect(wiringProblems(sync, full, [target])).toEqual([
      'Deployment "orders-api" does not use ConfigMap "orders-api-kmo"',
      'Deployment "orders-api" does not use Secret "orders-api-kmo"',
    ]);
  });

  it("does not report an empty object that is not used", () => {
    const empty = { configMapData: {}, secretData: {}, configHash: "abc" };
    const target = {
      kind: "Deployment" as const,
      name: "orders-api",
      state: "unchanged" as const,
      podSpec: { containers: [{}] },
    };
    expect(wiringProblems(sync, empty, [target])).toEqual([]);
  });
});
