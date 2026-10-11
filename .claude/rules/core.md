---
paths:
  - "packages/core/**"
---

# Work on `packages/core`

`@kmo/core` holds every decision that needs no cluster. Everything is exported through `src/index.ts`.

## Rules

- No Kubernetes call and no network call.
- A parse error carries a line number and a reason, never a value, because a value may be a secret.
- Event normalizers are tested against real captured payloads. `test/fixtures/` holds them, and Prettier leaves them as
  they are.

## The files of `src/`

- `dotenv.ts` parses an env file, `merge.ts` merges, `hash.ts` hashes.
- `render.ts` turns the source files of every source into outputs.
- `outputs.ts` is the ConfigMap and the Secret as they must be: the label, the Reloader annotation and the owner.
- `workload.ts` is the kinds of target, the pod template of each and the hash stamp.
- `defaults.ts` and `duration.ts` fill in the fields that a ConfigSync leaves out.
- `store.ts` is the store lookup and the keys of a store's files.
- `events.ts` holds the RustFS and EventBridge event normalizers, and `matching.ts` matches an event to ConfigSyncs.
- `plan.ts` is what a reconcile reads, or why it cannot start.
- `status.ts` is the status and the Events of an outcome.
- `trigger.ts` says whether a ConfigSync needs a reconcile and when a trigger must ask for a sync. It also builds the
  object of a sync request, `syncRequestApply`.
- `claims.ts` finds conflicting ConfigSyncs.
- `identity.ts` says which identity a store uses.
- `types.ts` holds the shared types.
