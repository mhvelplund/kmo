import { describe, expect, it } from "vitest";
import { borrowsTemplate, hashStamp, podTemplate } from "../src/workload";

const template = { metadata: { annotations: { "kmo.isntall.net/config-hash": "abc" } }, spec: { containers: [] } };

describe("the pod template of a workload", () => {
  it.each(["Deployment", "StatefulSet", "DaemonSet", "Rollout"] as const)("is spec.template for a %s", (kind) => {
    expect(podTemplate(kind, { spec: { template } })).toBe(template);
  });

  it("is one level deeper for a CronJob, inside its job template", () => {
    expect(podTemplate("CronJob", { spec: { jobTemplate: { spec: { template } } } })).toBe(template);
  });

  it("is absent for a Rollout that borrows its template from a Deployment", () => {
    const rollout = { spec: { workloadRef: { kind: "Deployment", name: "checkout" } } };
    expect(podTemplate("Rollout", rollout)).toBeUndefined();
    expect(borrowsTemplate("Rollout", rollout)).toBe(true);
  });
});

describe("the hash stamp", () => {
  it("is the smallest object that sets the annotation on a Deployment's pod template", () => {
    expect(hashStamp("Deployment", "orders-api", "shop", "abc")).toEqual({
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "orders-api", namespace: "shop" },
      spec: { template: { metadata: { annotations: { "kmo.isntall.net/config-hash": "abc" } } } },
    });
  });

  it("goes on the job template of a CronJob, so each run records the config it used", () => {
    expect(hashStamp("CronJob", "nightly-report", "shop", "abc")).toMatchObject({
      apiVersion: "batch/v1",
      spec: {
        jobTemplate: { spec: { template: { metadata: { annotations: { "kmo.isntall.net/config-hash": "abc" } } } } },
      },
    });
  });

  it("uses the Argo Rollouts API for a Rollout", () => {
    expect(hashStamp("Rollout", "checkout", "shop", "abc")).toMatchObject({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Rollout",
    });
  });
});
