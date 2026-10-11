import {
  CONFIG_HASH_ANNOTATION,
  borrowsTemplate,
  hashStamp,
  podTemplate,
  type ResolvedConfigSync,
  type TargetKind,
  type TargetReport,
} from "@kmo/core";
import type { GenericClass } from "kubernetes-fluent-client";
import { K8s, a } from "pepr";
import { getOrUndefined } from "./cluster";
import { Rollout } from "./kinds";

/** The client model of each kind of target. */
export const TARGET_MODELS: Record<TargetKind, GenericClass> = {
  Deployment: a.Deployment,
  StatefulSet: a.StatefulSet,
  DaemonSet: a.DaemonSet,
  CronJob: a.CronJob,
  Rollout,
};

/**
 * Sets the config hash on the pod template of each target that does not carry it yet.
 * @param sync The resolved ConfigSync.
 * @param hash The config hash.
 * @returns What happened to each target. A target whose hash is current is not touched.
 */
export async function stampTargets(sync: ResolvedConfigSync, hash: string): Promise<TargetReport[]> {
  return Promise.all(
    sync.targets.map(async ({ kind, name }): Promise<TargetReport> => {
      const model = TARGET_MODELS[kind];
      const workload = await getOrUndefined(model, name, sync.namespace);
      if (!workload) return { kind, name, state: "missing" };
      if (borrowsTemplate(kind, workload)) return { kind, name, state: "borrowed" };

      const template = podTemplate(kind, workload);
      const podSpec = template?.spec;
      if (template?.metadata?.annotations?.[CONFIG_HASH_ANNOTATION] === hash)
        return { kind, name, state: "unchanged", podSpec };

      await K8s(model).Apply(hashStamp(kind, name, sync.namespace, hash), { force: true });
      return { kind, name, state: "stamped", podSpec };
    }),
  );
}
