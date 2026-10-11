import { outputPatch, takeoverProblem, type ExistingObject, type OutputObject, type Owner } from "@kmo/core";
import { K8s, a } from "pepr";
import { SyncFailure, getOrUndefined } from "./cluster";

/**
 * Writes the ConfigMap and the Secret of a ConfigSync.
 * @param wanted Both objects as they must be.
 * @param owner The ConfigSync that owns them.
 * @throws SyncFailure with reason OutputTaken, before anything is written, when a name is held by a foreign object.
 */
export async function writeOutputs(
  wanted: { configMap: OutputObject; secret: OutputObject },
  owner: Owner,
): Promise<void> {
  const { configMap, secret } = wanted;
  const [existingConfigMap, existingSecret] = await Promise.all([
    getOrUndefined(a.ConfigMap, configMap.metadata.name, configMap.metadata.namespace),
    getOrUndefined(a.Secret, secret.metadata.name, secret.metadata.namespace),
  ]);

  const problem =
    takeoverProblem(configMap, existingConfigMap as ExistingObject | undefined, owner) ??
    takeoverProblem(secret, existingSecret as ExistingObject | undefined, owner);
  if (problem) throw new SyncFailure("OutputTaken", problem);

  if (!existingConfigMap) await K8s(a.ConfigMap).Create(configMap);
  else await patch(a.ConfigMap, configMap, existingConfigMap as ExistingObject);

  if (!existingSecret) await K8s(a.Secret).Create(secret);
  else await patch(a.Secret, secret, existingSecret as ExistingObject);
}

async function patch(
  model: typeof a.ConfigMap | typeof a.Secret,
  wanted: OutputObject,
  existing: ExistingObject,
): Promise<void> {
  const operations = outputPatch(wanted, existing);
  if (operations.length === 0) return;
  await K8s(model, { name: wanted.metadata.name, namespace: wanted.metadata.namespace }).Patch(operations);
}
