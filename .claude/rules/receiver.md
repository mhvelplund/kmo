---
paths:
  - "packages/receiver/**"
  - "dev/receiver/**"
---

# Work on `packages/receiver`

`@kmo/receiver` is the HTTP service, a thin shell around core, on `node:http` and `@kubernetes/client-node`.

## Rules

- It does not import `pepr` or `kubernetes-fluent-client`.
- It has no permission on Secrets and no code that reads the store.
- A message in its log or in an HTTP answer never holds the token or a value from a file.
- It works out the files of a ConfigSync with the functions of core, and builds the object of a sync request with
  `syncRequestApply`, as the operator does.
- It answers 200 only when every request for a sync was written, 500 when one failed, and 503 until its lists of the
  cluster are filled, so that the sender sends the event again.

## The files

- `src/handler.ts` turns one request into one answer. It needs no socket and no cluster.
- `src/server.ts` puts the handler on a socket, with a limit on the body.
- `src/cluster.ts` holds the three watched lists (informers) and the sync request.
- `src/log.ts` writes one JSON line for each message.
- `src/main.ts` is the entry point.
- `npm run build --workspace @kmo/receiver` bundles it with esbuild into `dist/receiver.cjs`, and the `Dockerfile`
  copies only that bundle.
- `dev/receiver/` holds its manifests, until packaging brings a chart.

## The registry

Docker on the build computer cannot resolve `kmo-registry.localhost`, so `receiver:deploy` pushes to `localhost:5111`.
Inside the cluster the same registry is named `kmo-registry.localhost:5111`, which is the name in the manifest.

## When the work is done

Run `mise run test:e2e -- smoke`. `docs/commands.md` has the other tasks.
