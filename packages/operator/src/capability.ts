import { Capability, Log } from "pepr";
import { guardKind } from "./guarded-kind";
import { ConfigSyncKind, ROLLOUT_GUARD, Rollout } from "./kinds";
import { reconcile } from "./reconcile";

/** The KMO operator's one capability. */
export const Kmo = new Capability({
  name: "kmo",
  description: "Keeps ConfigMaps and Secrets in step with env files in an object store",
  namespaces: [],
});

const { When, OnSchedule } = Kmo;

When(ConfigSyncKind).IsCreatedOrUpdated().Reconcile(reconcile);

When(Rollout)
  .IsCreatedOrUpdated()
  .Watch((rollout) => {
    Log.info({ namespace: rollout.metadata?.namespace, name: rollout.metadata?.name }, "KMO saw rollout");
  });

guardKind(Kmo, ROLLOUT_GUARD);

OnSchedule({
  name: "kmo-tick",
  every: 1,
  unit: "minutes",
  run: () => {
    Log.info("KMO tick");
  },
});
