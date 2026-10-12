import { clusterApi } from "./api";
import { createKeys, patchWebhook } from "./commands";
import type { Settings } from "./commands";
import { renewKeys } from "./renew";

const settings: Settings = {
  namespace: "pepr-system",
  tlsSecret: "pepr-kmo-tls",
  addressSecret: "pepr-kmo-api-path",
  webhook: "pepr-kmo",
  service: "pepr-kmo",
  days: Number(process.env.KMO_CERTIFICATE_DAYS ?? "90"),
  renewBeforeDays: Number(process.env.KMO_RENEW_BEFORE_DAYS ?? "30"),
};
const log = (line: string): void => console.log(line);
const clock = {
  now: () => new Date(),
  wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "create") await createKeys(clusterApi(), settings, log);
  else if (command === "patch") await patchWebhook(clusterApi(), settings, log);
  else if (command === "renew") await renewKeys(clusterApi(), settings, log, clock);
  else throw new Error('The command must be "create", "patch" or "renew"');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "The command failed");
  process.exit(1);
});
