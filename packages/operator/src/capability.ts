import { MANAGED_BY, MANAGED_BY_LABEL, findClaimConflict } from "@kmo/core";
import { Capability, K8s, Log, a } from "pepr";
import { guardKind } from "./guarded-kind";
import { ClusterConfigStoreKind, ConfigStoreKind, ConfigSyncKind, ROLLOUT_GUARD, Rollout, toCore } from "./kinds";
import { reconcile } from "./reconcile";
import { onOutputChange, onStoreChange, onStoreDelete, onTargetChange, onTick } from "./triggers";

/** The KMO operator's one capability. */
export const Kmo = new Capability({
  name: "kmo",
  description: "Keeps ConfigMaps and Secrets in step with env files in an object store",
  namespaces: [],
});

const { When, OnSchedule } = Kmo;

When(ConfigSyncKind)
  .IsCreatedOrUpdated()
  .Validate(async (request) => {
    const namespace = request.Raw.metadata?.namespace ?? "";
    const others = await K8s(ConfigSyncKind).InNamespace(namespace).Get();
    const conflict = findClaimConflict(toCore(request.Raw), others.items.map(toCore));
    return conflict ? request.Deny(conflict) : request.Approve();
  })
  .Reconcile(reconcile);

for (const model of [a.ConfigMap, a.Secret]) {
  When(model).IsCreatedOrUpdated().WithLabel(MANAGED_BY_LABEL, MANAGED_BY).Watch(onOutputChange);
  When(model).IsDeleted().WithLabel(MANAGED_BY_LABEL, MANAGED_BY).Watch(onOutputChange);
}

When(a.Deployment).IsCreatedOrUpdated().Watch(onTargetChange("Deployment"));
When(a.StatefulSet).IsCreatedOrUpdated().Watch(onTargetChange("StatefulSet"));
When(a.DaemonSet).IsCreatedOrUpdated().Watch(onTargetChange("DaemonSet"));
When(a.CronJob).IsCreatedOrUpdated().Watch(onTargetChange("CronJob"));
When(Rollout).IsCreatedOrUpdated().Watch(onTargetChange("Rollout"));

When(ConfigStoreKind).IsCreatedOrUpdated().Watch(onStoreChange("ConfigStore"));
When(ConfigStoreKind).IsDeleted().Watch(onStoreDelete("ConfigStore"));
When(ClusterConfigStoreKind).IsCreatedOrUpdated().Watch(onStoreChange("ClusterConfigStore"));
When(ClusterConfigStoreKind).IsDeleted().Watch(onStoreDelete("ClusterConfigStore"));

guardKind(Kmo, ROLLOUT_GUARD);

OnSchedule({
  name: "kmo-refresh",
  every: 1,
  unit: "minutes",
  run: () => {
    Log.info("KMO tick");
    onTick().catch((error: unknown) => Log.error(error, "KMO refresh check failed"));
  },
});
