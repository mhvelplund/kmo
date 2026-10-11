import { eventsFor, nextStatus, syncRequest, type ConfigSyncStatus, type SyncOutcome } from "@kmo/core";
import { K8s, sdk } from "pepr";
import { ConfigSyncKind, toCore } from "./kinds";

/**
 * Shapes a status for a merge patch, which removes a field only when it is null.
 * @param status The status to write.
 * @returns The status, with the handled sync request set to null when there is none.
 */
export function statusPatch(
  status: ConfigSyncStatus,
): Omit<ConfigSyncStatus, "lastHandledSyncRequest"> & { lastHandledSyncRequest: string | null } {
  return { ...status, lastHandledSyncRequest: status.lastHandledSyncRequest ?? null };
}

/**
 * Records the outcome of a reconcile on the ConfigSync: its status, and an Event for each change worth telling.
 * @param sync The resource the reconcile acted on.
 * @param outcome How the reconcile ended.
 */
export async function report(sync: ConfigSyncKind, outcome: SyncOutcome): Promise<void> {
  const observed = {
    generation: sync.metadata?.generation,
    syncRequest: syncRequest(toCore(sync)),
    now: new Date().toISOString(),
  };
  const status = nextStatus(sync.status, outcome, observed);

  await K8s(ConfigSyncKind).PatchStatus({
    metadata: { name: sync.metadata?.name, namespace: sync.metadata?.namespace },
    status: statusPatch(status) as ConfigSyncStatus,
  });

  for (const note of eventsFor(sync.status, status)) {
    await sdk.writeEvent(
      sync,
      { message: note.message },
      {
        eventType: note.type,
        eventReason: note.reason,
        reportingComponent: "kmo-operator",
        reportingInstance: process.env.HOSTNAME ?? "kmo-operator",
      },
    );
  }
}
