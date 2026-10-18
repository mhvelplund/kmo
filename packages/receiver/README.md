# @kmo/receiver

The **receiver** is a stateless HTTP service that receives change events from the store. For each ConfigSync that reads
the changed file, it sets the annotation `kmo.isntall.net/sync-requested-at`. The **operator** sees the annotation and
syncs that ConfigSync.

The **receiver** accepts events from RustFS on `/events/rustfs` and from AWS EventBridge on `/events/eventbridge`. Each
request must include the **receiver**'s token in the header `Authorization: Bearer <token>`. The token is a shared
secret that you create after you install the chart, in the Secret `kmo-receiver-token` in `kmo-system`, and the store
must be set up to send it. The **receiver** never reads the store and has no access to Secrets.

The **receiver** runs in the namespace `kmo-system`. It is a separate program because a [Pepr](https://docs.pepr.dev)
module cannot serve its own HTTP endpoints.

- Entry point: `src/main.ts`. The HTTP server is in `src/server.ts`, the routes and responses are in `src/handler.ts`,
  and the calls to the cluster are in `src/cluster.ts`.
- Settings: `KMO_RECEIVER_TOKEN` (required) and `PORT` (default 8080).
- Build: `npm run build --workspace @kmo/receiver` bundles the code into `dist/receiver.cjs`, and the `Dockerfile` puts
  that file into an image. `mise run kmo:deploy` does both for the local cluster.

[The receiver](../../docs/receiver.md) describes its responses and its token.
