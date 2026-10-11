import { KubeConfig } from "@kubernetes/client-node";
import { Cluster } from "./cluster";
import { errorName, log } from "./log";
import { createReceiver } from "./server";

const STOP_MS = 5000;

async function main(): Promise<void> {
  const token = process.env.KMO_RECEIVER_TOKEN ?? "";
  if (token === "") throw new Error("KMO_RECEIVER_TOKEN is not set");
  const port = Number(process.env.PORT ?? "8080");

  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();
  const cluster = new Cluster(kubeConfig, log);
  const server = createReceiver({
    token,
    ready: () => cluster.ready(),
    syncs: () => cluster.syncs(),
    stores: () => cluster.stores(),
    requestSync: (sync) => cluster.requestSync(sync),
    log,
  });

  process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), STOP_MS).unref();
  });

  server.listen(port, () => log("KMO receiver listens", { port }));
  await cluster.start();
  log("KMO receiver is ready", { configSyncs: cluster.syncs().length, stores: cluster.stores().length });
}

main().catch((error: unknown) => {
  log("KMO receiver stopped", { error: errorName(error), reason: error instanceof Error ? error.message : "" });
  process.exit(1);
});
