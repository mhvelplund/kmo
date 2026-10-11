# KMO Receiver and Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> `CLAUDE.md` overrides both skills: work on `main`, do one task, leave it uncommitted, then stop.

**Goal:** Close the loop: a changed file in the store reaches the pods with no manual step. Then finish the first spec
with the full end-to-end tests, the `demo` task and the documentation.

**Architecture:** `packages/receiver` is a small HTTP service around `@kmo/core`. It keeps a watched, in-memory list of
ConfigSyncs and stores, turns each store event into a bucket and a key with the core normalizers, finds the affected
ConfigSyncs with `findAffectedSyncs`, and sets the sync annotation on each with a server-side apply that carries the
uid, as the operator's `requestSync` does. It never reads the store and has no permission on Secrets. The end-to-end
tests are Bash suites under `test/e2e/` with one runner.

**Tech Stack:** Node 24.21.0, `node:http` (no web framework), `@kubernetes/client-node` 1.4.0 (informers and
server-side apply), esbuild 0.28.2 (bundle), Docker and the k3d registry, TypeScript 5.9.3, Vitest 5, Bash, RustFS 1.0.1.

**Spec:** `docs/superpowers/specs/2026-10-10-kmo-operator-core-design.md`

**Spike findings:** `docs/superpowers/spikes/2026-10-10-kmo-operator-core-spike.md`

## Where this plan sits

The spec lists thirteen build steps. The foundations plan did steps 1 to 4 and the operator plan did steps 5 to 11.
This plan does the last two. It is the last plan of the first spec.

| Task | Spec step | Subject                      |
|------|-----------|------------------------------|
| 1    | 12        | The receiver's answers       |
| 2    | 12        | The receiver in the cluster  |
| 3    | 13        | The end-to-end tests         |
| 4    | 13        | The `demo` task              |
| 5    | 13        | The documentation            |

## Global Constraints

- The product is **KMO**; Kubernetes names use `kmo`. Never write "zeemo" in code, manifests or docs. The repository's
  directory keeps the name `zeemo`.
- API group `kmo.isntall.net`, version `v1alpha1`. The operator runs in `pepr-system`. The receiver runs in
  `kmo-system`. Local-only namespace `kmo-dev`.
- Commit directly to `main`. No branches, no worktrees. Conventional commit messages with the types `feat`, `fix` and
  `chore`.
- **A commit step waits for the user.** Leave finished work in the working tree, report, and stop. Tick the commit
  checkbox only when the user has asked for the commit and it is made. Never push. Never start the next task unasked.
- Learning pace. Every task opens with a **Before** note to explain to the user and closes with an **After** step that
  shows something observable, followed by a pause for questions.
- Explanations use ASD-STE100 Simplified Technical English.
- Pinned versions, all exact: `@kubernetes/client-node` `1.4.0`, `esbuild` `0.28.2` (the version Pepr already
  installs), image `node:24.21.0-alpine`. Pepr stays at `2.0.3`; this plan does not touch the pin.
- The receiver does not import `pepr` or `kubernetes-fluent-client`. It has no permission on Secrets, and no code
  that reads the store.
- Decisions that need no cluster go into `@kmo/core` with unit tests. `@kmo/core` makes no Kubernetes or network calls.
  Reuse what exists: `normalizeRustfsEvent`, `normalizeEventBridgeEvent`, `MalformedEventError`, `findAffectedSyncs`,
  `isSuspended`, `SYNC_REQUESTED_ANNOTATION`.
- Messages that reach logs or HTTP answers never contain the token or a value from an env file. They may name buckets,
  keys, namespaces and names.
- Comments: terse, only where something is hard to follow, no reasons and no history. Every exported function, class and
  type gets a terse JSDoc block covering what it does, its parameters and its return value. Every attribute of an
  exported interface gets a one-line JSDoc, also where a snippet in this plan leaves it out.
- Unit tests read as statements of behavior. No coverage chasing. Event normalizers are tested against real payloads.
- Docs are for people: high level, few code fences. `docs/index.md` is the entry point.
- `dev/README.md` lists every entry in `dev/`. Update it in the same change that adds, removes or repurposes one.
- Nothing about one person's computer in committed files: no absolute local paths, user names, AWS account IDs,
  profiles or regions.
- Commands assume Mise is activated in the shell. If it is not, prefix them with `mise x --`.
- Run `npm run format` before each commit so the pre-commit hooks pass.
- The code in this plan was written against the installed `@kubernetes/client-node` 1.4.0 type definitions and the
  existing sources, but it was not compiled or run. When `npm run typecheck` or the cluster disagrees with a snippet,
  correct the snippet, keep its behavior, and tell the user what changed in the After step.

## Additions to the spec

Things the spec does not say, decided here. Each is small; say so to the user in the Before note of its task.

- **`GET /readyz` and the answer 503.** The receiver's lists are empty for a moment after it starts. An event that
  arrives then would match nothing and be answered with 200, and so be lost. `/readyz` answers 503 until every list
  was filled once, the Deployment uses it as its readiness probe, and an event that still arrives early is answered
  with 503 so that the sender sends it again. (Task 1)
- **Other answers.** 404 for an unknown path, 405 for a known path with the wrong method, 413 for a body over 1 MiB.
  `HEAD /` is answered with 200 without a token, because RustFS checks its target that way (spike, check 1). (Task 1)
- **A suspended ConfigSync gets no sync request** from the receiver. The operator's own triggers do the same, and a
  resume reconciles at once. (Task 1)
- **An EventBridge event from a source other than `aws.s3`** makes `normalizeEventBridgeEvent` return no events. The
  rule lives in core, so that the receiver stays a thin shell. (Task 1)
- **One object for every sync request.** `syncRequestApply` in core builds the object that is applied. The operator's
  `requestSync` and the receiver both use it, so they cannot drift apart. (Task 2)
- **The receiver uses `@kubernetes/client-node` directly**, with informers, and not Pepr's client. Its field manager
  is `kmo-receiver`; the operator's is `pepr`. Both force the apply, so the last one to ask owns the annotation.
  (Task 2)
- **The token** reaches the receiver as the environment variable `KMO_RECEIVER_TOKEN`, from the key `token` of the
  Secret `kmo-receiver-token`. A changed token needs a restart of the receiver. (Task 2)
- **Build and manifests.** The receiver is bundled on the build computer with esbuild, as Pepr does for the operator,
  and the image only copies the bundle. Its manifests are in `dev/receiver/` until the packaging spec brings a chart.
  (Task 2)
- **Mise tasks** `receiver:deploy`, `receiver:logs` and `demo`. `test:e2e` runs every suite, or only the suites named
  after `--`. `check:rollout-guard` stays as a shortcut for one suite. (Tasks 2, 3 and 4)
- **The check that the timer retries a failed sync** moves from the smoke suite to the failures suite, and heals the
  failure with a Secret, because with the receiver a corrected file is synced at once. (Tasks 2 and 3)

Known limit, accepted: the receiver does not join events. Twenty changed files in one second ask for twenty syncs. The
config hash keeps the pods from rolling more than once for the same values.

## Review Focus

- **An event that arrives before the lists are filled.** It is answered with 503, never with a 200 that matched
  nothing. (Task 1, handler test)
- **A token of another length, or no token.** The answer is 401 and nothing throws; the comparison takes the same time
  for a right and a wrong token of the same length. (Task 1, handler test)
- **One notification with several records for the same ConfigSync.** One sync request, not one for each record.
  (Task 1, handler test)
- **A body that is larger than any real event.** 413, and the process keeps little of it in memory. (Task 1, server
  test)
- **A ConfigSync that is deleted between the match and the write.** The request ends quietly and the ConfigSync is not
  created again; any other refusal is a 500. (Task 2, cluster test)
- **An event while the admission pods are down.** The apply is refused, the answer is 500, and the change is not lost:
  the sender sends it again, or the refresh interval picks it up. (Task 1 handler test for the 500; Task 3 events suite
  on the cluster; Task 2 After step records what RustFS does after a 500)

## File Structure

```text
package-lock.json                          regenerated for the new workspace (Task 1)
mise.toml                                  receiver:deploy, receiver:logs (Task 2); test:e2e (Task 3); demo (Task 4)
packages/core/src/events.ts                an EventBridge event from another source yields no events (Task 1)
packages/core/src/trigger.ts               syncRequestApply (Task 2)
packages/core/test/fixtures/eventbridge-parameter-store.json   the documented AWS sample event (Task 1)
packages/operator/src/triggers.ts          requestSync uses syncRequestApply (Task 2)
packages/receiver/package.json             @kmo/receiver, its two dependencies and the build script (Task 1)
packages/receiver/src/handler.ts           one request in, one answer out; no socket, no cluster (Task 1)
packages/receiver/src/server.ts            node:http around the handler; body limit (Task 1)
packages/receiver/src/log.ts               one JSON line for each message (Task 1)
packages/receiver/src/cluster.ts           the watched lists and the sync request (Task 2)
packages/receiver/src/main.ts              entry point: settings, start, stop (Task 2)
packages/receiver/Dockerfile               copies the bundle into a Node image (Task 2)
packages/receiver/test/*.test.ts           handler, server and cluster tests
dev/receiver/receiver.yaml                 ServiceAccount, ClusterRole, binding, token Secret, Deployment, Service (Task 2)
dev/demo.sh                                changes a file and shows the rollout (Task 4)
test/e2e/lib.sh                            helpers shared by the suites (Task 3)
test/e2e/run.sh                            sets up once and runs the suites (Task 3)
test/e2e/smoke.sh                          the quick suite; uses the receiver from Task 2 on
test/e2e/events.sh                         the receiver on the cluster (Task 3)
test/e2e/kinds.sh                          a rolling update of each workload kind; wiring warnings (Task 3)
test/e2e/failures.sh                       the failures that the smoke suite does not cover; the timer (Task 3)
test/e2e/tenants.sh                        the rules that keep tenants apart (Task 3)
test/e2e/rollout-guard.sh                  unchanged; now the last suite of the runner
docs/*.md                                  the full documentation (Task 5)
```

---

### Task 1: The receiver's answers

**Before (explain to the user):** A **webhook** is an HTTP request that one system sends to another when something
happened. RustFS sends one for each changed file. The sender knows only the status code of the answer, so the codes are
the whole contract: 200 means "done, forget it", and a 5xx means "send it again". This is **at-least-once delivery**:
the same event may arrive twice, and that must be harmless. It is, because a sync request only says "look again".
This task builds the part of the receiver that needs no cluster: it reads a request and decides the answer. The
cluster is behind four small functions, so the tests replace them. Additions to the spec to mention: `/readyz` and
503, the answers 404, 405 and 413, no sync request for a suspended ConfigSync, and the rule for EventBridge events
from other sources, which goes into core.

**Files:**

- Create: `packages/receiver/package.json`, `packages/receiver/src/handler.ts`, `packages/receiver/src/server.ts`,
  `packages/receiver/src/log.ts`, `packages/receiver/test/handler.test.ts`, `packages/receiver/test/server.test.ts`,
  `packages/core/test/fixtures/eventbridge-parameter-store.json`
- Modify: `packages/core/src/events.ts`, `packages/core/test/events.test.ts`, `package-lock.json`, `README.md`,
  `CLAUDE.md`

**Interfaces:**

- Consumes, from `@kmo/core`: `normalizeRustfsEvent(body: unknown): StoreEvent[]`,
  `normalizeEventBridgeEvent(body: unknown): StoreEvent[]`, `MalformedEventError`,
  `findAffectedSyncs(event: StoreEvent, syncs: ConfigSync[], stores: Store[]): ConfigSync[]`,
  `isSuspended(sync: ConfigSync): boolean`.
- Produces, from `packages/receiver/src/handler.ts`:
  - `interface ReceiverRequest { method: string; path: string; authorization?: string; body: string }`
  - `interface ReceiverResponse { status: number; body: string }`
  - `interface ReceiverDeps { token: string; ready(): boolean; syncs(): ConfigSync[]; stores(): Store[];
    requestSync(sync: ConfigSync): Promise<void>; log: Log }`
  - `handle(request: ReceiverRequest, deps: ReceiverDeps): Promise<ReceiverResponse>`
- Produces, from `server.ts`: `createReceiver(deps: ReceiverDeps): Server` (`Server` from `node:http`).
- Produces, from `log.ts`: `type Log = (message: string, fields?: Record<string, unknown>) => void`, `log: Log`,
  `errorName(error: unknown): string`.

- [x] **Step 1: Write the failing core test**

Save the sample "Parameter Store Change" event from the AWS documentation as
`packages/core/test/fixtures/eventbridge-parameter-store.json`:

```json
{
  "version": "0",
  "id": "6a7e4feb-b491-4cf7-a9f1-bf3703497718",
  "detail-type": "Parameter Store Change",
  "source": "aws.ssm",
  "account": "123456789012",
  "time": "2017-05-22T16:43:48Z",
  "region": "us-east-2",
  "resources": ["arn:aws:ssm:us-east-2:123456789012:parameter/MyExampleParameter"],
  "detail": {
    "operation": "Create",
    "name": "MyExampleParameter",
    "type": "String",
    "description": "Sample Parameter"
  }
}
```

Add to the EventBridge `describe` block of `packages/core/test/events.test.ts`, with the import
`import parameterStore from "./fixtures/eventbridge-parameter-store.json";` next to the other fixtures:

```ts
it("yields nothing for an event from a source other than S3, so other kinds of store can come later", () => {
  expect(normalizeEventBridgeEvent(parameterStore)).toEqual([]);
});

it("still refuses an event that names no source and no file", () => {
  expect(() => normalizeEventBridgeEvent({ detail: {} })).toThrow(MalformedEventError);
});
```

- [x] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/core/test/events.test.ts`
Expected: the first new test FAILS with `MalformedEventError: expected detail.bucket.name and detail.object.key`. The
second passes already.

- [x] **Step 3: Make it pass**

In `packages/core/src/events.ts`, replace `normalizeEventBridgeEvent` and its JSDoc:

```ts
const S3_SOURCE = "aws.s3";

/**
 * Reads an Amazon S3 event delivered through EventBridge.
 * @param body The parsed JSON body.
 * @returns A single event, with the key exactly as sent; nothing for an event from a source other than S3.
 * @throws MalformedEventError if the body is an S3 event, or names no source, and has no bucket and key.
 */
export function normalizeEventBridgeEvent(body: unknown): StoreEvent[] {
  const source = dig(body, "source");
  if (typeof source === "string" && source !== S3_SOURCE) return [];
  const bucket = dig(body, "detail", "bucket", "name");
  const key = dig(body, "detail", "object", "key");
  if (typeof bucket !== "string" || typeof key !== "string") {
    throw new MalformedEventError("expected detail.bucket.name and detail.object.key");
  }
  return [{ bucket, key }];
}
```

Run: `npx vitest run packages/core/test/events.test.ts`. Expected: PASS.

- [x] **Step 4: Create the package**

`packages/receiver/package.json`:

```json
{
  "name": "@kmo/receiver",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Turns a store change event into a sync request on each affected ConfigSync",
  "scripts": {
    "build": "esbuild src/main.ts --bundle --platform=node --target=node24 --format=cjs --outfile=dist/receiver.cjs"
  },
  "dependencies": {
    "@kmo/core": "*",
    "@kubernetes/client-node": "1.4.0"
  },
  "devDependencies": {
    "esbuild": "0.28.2"
  }
}
```

Run: `npm install`. Expected: `node_modules/@kmo/receiver` is a link to the package, and no package changes version
(`git diff package-lock.json` shows only the new workspace). Then run `npm audit` and compare its output with
`docs/advisories.md`: this is the review that the page asks for when dependencies change. A new advisory is a stop:
show it to the user.

- [x] **Step 5: Write the failing handler tests**

`packages/receiver/test/handler.test.ts`:

```ts
import type { ConfigSync, ConfigSyncSpec, Store } from "@kmo/core";
import { describe, expect, it } from "vitest";
import eventBridgeCreated from "../../core/test/fixtures/eventbridge-object-created.json";
import parameterStore from "../../core/test/fixtures/eventbridge-parameter-store.json";
import rustfsDelete from "../../core/test/fixtures/rustfs-delete.json";
import rustfsPut from "../../core/test/fixtures/rustfs-put.json";
import { handle, type ReceiverDeps, type ReceiverRequest } from "../src/handler";

const TOKEN = "kmo-local-token";

/** The cluster-wide store named default, on the bucket of the captured events. */
const defaultStore: Store = {
  kind: "ClusterConfigStore",
  metadata: { name: "default" },
  spec: {
    s3: { bucket: "kmo-config", region: "us-east-1", credentialsSecretRef: { name: "keys", namespace: "kmo-system" } },
    allowedNamespaces: ["*"],
  },
};

/** A ConfigSync in namespace shop. */
function sync(name: string, spec?: ConfigSyncSpec): ConfigSync {
  return { metadata: { name, namespace: "shop", uid: `uid-${name}` }, spec };
}

/** A receiver on a cluster with two ConfigSyncs, and the names it asked a sync for. */
function receiver(overrides: Partial<ReceiverDeps> = {}) {
  const requested: string[] = [];
  const deps: ReceiverDeps = {
    token: TOKEN,
    ready: () => true,
    syncs: () => [sync("orders-api"), sync("checkout")],
    stores: () => [defaultStore],
    requestSync: async (target) => {
      requested.push(target.metadata.name);
    },
    log: () => {},
    ...overrides,
  };
  const send = (request: Partial<ReceiverRequest> = {}) =>
    handle({ method: "POST", path: "/events/rustfs", authorization: `Bearer ${TOKEN}`, body: "", ...request }, deps);
  return { requested, send };
}

/** A notification body with one record for each key, encoded as RustFS sends them. */
function notification(...keys: string[]): string {
  return JSON.stringify({
    Records: keys.map((key) => ({ s3: { bucket: { name: "kmo-config" }, object: { key: encodeURIComponent(key) } } })),
  });
}

/** An S3 event as EventBridge delivers it. */
function s3Event(bucket: string, key: string): string {
  return JSON.stringify({ source: "aws.s3", detail: { bucket: { name: bucket }, object: { key } } });
}

describe("a RustFS notification", () => {
  it("asks for a sync of the ConfigSync whose file was uploaded", async () => {
    const { requested, send } = receiver();
    expect((await send({ body: JSON.stringify(rustfsPut) })).status).toBe(200);
    expect(requested).toEqual(["orders-api"]);
  });

  it("treats a deleted file the same way", async () => {
    const { requested, send } = receiver();
    expect((await send({ body: JSON.stringify(rustfsDelete) })).status).toBe(200);
    expect(requested).toEqual(["orders-api"]);
  });

  it("asks for a sync of every ConfigSync of the store when a common file changed", async () => {
    const { requested, send } = receiver();
    await send({ body: notification("_common/secrets.env") });
    expect(requested.sort()).toEqual(["checkout", "orders-api"]);
  });

  it("answers 200 and asks for nothing when no ConfigSync reads the file", async () => {
    const { requested, send } = receiver();
    expect((await send({ body: notification("shop/orders-api/notes.txt") })).status).toBe(200);
    expect(requested).toEqual([]);
  });

  it("asks once for a ConfigSync that several records name", async () => {
    const { requested, send } = receiver();
    await send({ body: notification("shop/orders-api/config.env", "shop/orders-api/secrets.env") });
    expect(requested).toEqual(["orders-api"]);
  });

  it("leaves a suspended ConfigSync alone", async () => {
    const { requested, send } = receiver({ syncs: () => [sync("orders-api", { suspend: true }), sync("checkout")] });
    expect((await send({ body: notification("_common/config.env") })).status).toBe(200);
    expect(requested).toEqual(["checkout"]);
  });
});

describe("an EventBridge event", () => {
  const path = "/events/eventbridge";

  it("asks for a sync when S3 reports a file that a ConfigSync reads", async () => {
    const { requested, send } = receiver();
    expect((await send({ path, body: s3Event("kmo-config", "shop/checkout/config.env") })).status).toBe(200);
    expect(requested).toEqual(["checkout"]);
  });

  it("is accepted in the form that AWS sends, also when nothing reads the file", async () => {
    const { requested, send } = receiver();
    expect((await send({ path, body: JSON.stringify(eventBridgeCreated) })).status).toBe(200);
    expect(requested).toEqual([]);
  });

  it("is answered with 200 and ignored when it comes from a source other than S3", async () => {
    const { requested, send } = receiver();
    expect((await send({ path, body: JSON.stringify(parameterStore) })).status).toBe(200);
    expect(requested).toEqual([]);
  });
});

describe("a request that the receiver refuses", () => {
  const body = JSON.stringify(rustfsPut);

  it("gets 401 without a token, and nothing is asked for", async () => {
    const { requested, send } = receiver();
    expect((await send({ authorization: undefined, body })).status).toBe(401);
    expect(requested).toEqual([]);
  });

  it("gets 401 with a wrong token, whatever its length", async () => {
    const { send } = receiver();
    expect((await send({ authorization: "Bearer kmo-local-tokeX", body })).status).toBe(401);
    expect((await send({ authorization: "Bearer short", body })).status).toBe(401);
    expect((await send({ authorization: TOKEN, body })).status).toBe(401);
  });

  it("gets 400 for a body that is not JSON", async () => {
    const { send } = receiver();
    expect((await send({ body: "not json" })).status).toBe(400);
  });

  it("gets 400, with the reason, for JSON that is not a notification", async () => {
    const { send } = receiver();
    const answer = await send({ body: "{}" });
    expect(answer.status).toBe(400);
    expect(answer.body).toBe("expected a Records list");
  });

  it("gets 503 while the lists of the cluster are not filled yet, so that the sender tries again", async () => {
    const { requested, send } = receiver({ ready: () => false });
    expect((await send({ body })).status).toBe(503);
    expect(requested).toEqual([]);
  });

  it("gets 500 when a sync request fails, after every other request was still sent", async () => {
    const requested: string[] = [];
    const { send } = receiver({
      requestSync: async (target) => {
        if (target.metadata.name === "orders-api") throw new Error("admission is down");
        requested.push(target.metadata.name);
      },
    });
    expect((await send({ body: notification("_common/config.env") })).status).toBe(500);
    expect(requested).toEqual(["checkout"]);
  });

  it("gets 404 for an unknown path and 405 for an event path that is not posted to", async () => {
    const { send } = receiver();
    expect((await send({ path: "/events/other" })).status).toBe(404);
    expect((await send({ method: "GET" })).status).toBe(405);
  });
});

describe("the checks that need no token", () => {
  const open = { authorization: undefined };

  it("answer HEAD / with 200, because RustFS checks its target that way", async () => {
    const { send } = receiver();
    expect((await send({ ...open, method: "HEAD", path: "/" })).status).toBe(200);
  });

  it("answer /healthz with 200 whenever the process runs", async () => {
    const { send } = receiver({ ready: () => false });
    expect((await send({ ...open, method: "GET", path: "/healthz" })).status).toBe(200);
  });

  it("answer /readyz with 503 until the lists of the cluster are filled", async () => {
    expect((await receiver({ ready: () => false }).send({ ...open, method: "GET", path: "/readyz" })).status).toBe(503);
    expect((await receiver().send({ ...open, method: "GET", path: "/readyz" })).status).toBe(200);
  });
});
```

- [x] **Step 6: Run them to see them fail**

Run: `npx vitest run packages/receiver`
Expected: FAIL, `Cannot find module '../src/handler'` (or a failed import resolution with that path).

- [x] **Step 7: Write the log helper and the handler**

`packages/receiver/src/log.ts`:

```ts
/** Writes one message with its fields. */
export type Log = (message: string, fields?: Record<string, unknown>) => void;

/**
 * Writes a message to the standard output as one line of JSON.
 * @param message What happened.
 * @param fields Details; never the token or a value from a file.
 */
export const log: Log = (message, fields = {}) => {
  console.log(JSON.stringify({ time: new Date().toISOString(), message, ...fields }));
};

/**
 * Names an error without repeating what it may hold.
 * @param error What was thrown.
 * @returns The error's name, with its HTTP status code when it has one.
 */
export function errorName(error: unknown): string {
  const { name, code } = (error ?? {}) as { name?: string; code?: unknown };
  return typeof code === "number" ? `${name ?? "Error"} ${code}` : (name ?? "unknown error");
}
```

`packages/receiver/src/handler.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import {
  MalformedEventError,
  findAffectedSyncs,
  isSuspended,
  normalizeEventBridgeEvent,
  normalizeRustfsEvent,
  type ConfigSync,
  type Store,
  type StoreEvent,
} from "@kmo/core";
import { errorName, type Log } from "./log";

/** The parts of an HTTP request that the receiver reads. */
export interface ReceiverRequest {
  /** The HTTP method, in capitals. */
  method: string;
  /** The path, without a query. */
  path: string;
  /** The value of the Authorization header. */
  authorization?: string;
  /** The body as text. */
  body: string;
}

/** The receiver's answer to one request. */
export interface ReceiverResponse {
  /** The HTTP status code. */
  status: number;
  /** A short text for people. */
  body: string;
}

/** What the receiver needs from outside; replaced in tests. */
export interface ReceiverDeps {
  /** The shared bearer token. */
  token: string;
  /** Tells whether every list of the cluster was filled once. */
  ready(): boolean;
  /** Every ConfigSync in the cluster. */
  syncs(): ConfigSync[];
  /** Every ConfigStore and ClusterConfigStore in the cluster. */
  stores(): Store[];
  /** Asks for a sync of one ConfigSync. */
  requestSync(sync: ConfigSync): Promise<void>;
  /** Writes a log line. */
  log: Log;
}

const NORMALIZERS: Record<string, (body: unknown) => StoreEvent[]> = {
  "/events/rustfs": normalizeRustfsEvent,
  "/events/eventbridge": normalizeEventBridgeEvent,
};

const answer = (status: number, body: string): ReceiverResponse => ({ status, body });

/**
 * Answers one request.
 * @param request The request.
 * @param deps The token, the lists of the cluster and the way to ask for a sync.
 * @returns 200 when every affected ConfigSync was asked to sync, also when there is none; 400 for a body that is not
 *   an event; 401 for a bad token; 500 when a sync request failed; 503 before the lists are filled.
 */
export async function handle(request: ReceiverRequest, deps: ReceiverDeps): Promise<ReceiverResponse> {
  const { method, path } = request;
  if (path === "/" && method === "HEAD") return answer(200, "");
  if (path === "/healthz") return answer(200, "ok");
  if (path === "/readyz") return deps.ready() ? answer(200, "ready") : answer(503, "not ready");

  const normalize = NORMALIZERS[path];
  if (!normalize) return answer(404, "not found");
  if (method !== "POST") return answer(405, "method not allowed");
  if (!authorized(request.authorization, deps.token)) return answer(401, "unauthorized");
  if (!deps.ready()) return answer(503, "not ready");

  let events: StoreEvent[];
  try {
    events = normalize(JSON.parse(request.body));
  } catch (error) {
    if (error instanceof SyntaxError) return answer(400, "the body is not JSON");
    if (error instanceof MalformedEventError) return answer(400, error.message);
    throw error;
  }

  const affected = affectedSyncs(events, deps.syncs(), deps.stores());
  const results = await Promise.allSettled(affected.map((sync) => deps.requestSync(sync)));
  const failures = results.filter((result) => result.status === "rejected");
  deps.log("KMO receiver handled an event", {
    path,
    files: events.map((event) => `${event.bucket}/${event.key}`),
    requested: affected.map((sync) => `${sync.metadata.namespace}/${sync.metadata.name}`),
    failed: failures.length,
    ...(failures[0] ? { error: errorName(failures[0].reason) } : {}),
  });
  if (failures.length > 0) return answer(500, `${failures.length} sync requests failed`);
  return answer(200, `${affected.length} sync requests`);
}

function authorized(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${token}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

function affectedSyncs(events: StoreEvent[], syncs: ConfigSync[], stores: Store[]): ConfigSync[] {
  const found = new Map<string, ConfigSync>();
  for (const event of events) {
    for (const sync of findAffectedSyncs(event, syncs, stores)) {
      if (!isSuspended(sync)) found.set(`${sync.metadata.namespace}/${sync.metadata.name}`, sync);
    }
  }
  return [...found.values()];
}
```

`failures[0].reason` needs the narrowed type: write the filter as
`results.filter((result): result is PromiseRejectedResult => result.status === "rejected")`.

Run: `npx vitest run packages/receiver`. Expected: every handler test passes.

- [x] **Step 8: Write the failing server tests**

`packages/receiver/test/server.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import rustfsPut from "../../core/test/fixtures/rustfs-put.json";
import { createReceiver } from "../src/server";

describe("the receiver on a socket", () => {
  const requested: string[] = [];
  const server = createReceiver({
    token: "kmo-local-token",
    ready: () => true,
    syncs: () => [{ metadata: { name: "orders-api", namespace: "shop" } }],
    stores: () => [
      {
        kind: "ClusterConfigStore",
        metadata: { name: "default" },
        spec: { s3: { bucket: "kmo-config", region: "us-east-1" }, allowedNamespaces: ["*"] },
      },
    ],
    requestSync: async (sync) => {
      requested.push(sync.metadata.name);
    },
    log: () => {},
  });
  let url = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const post = (body: string) =>
    fetch(`${url}/events/rustfs`, { method: "POST", headers: { authorization: "Bearer kmo-local-token" }, body });

  it("takes the event that RustFS posts, token and all", async () => {
    expect((await post(JSON.stringify(rustfsPut))).status).toBe(200);
    expect(requested).toEqual(["orders-api"]);
  });

  it("answers the check that RustFS makes when it starts", async () => {
    expect((await fetch(url, { method: "HEAD" })).status).toBe(200);
  });

  it("reads the path without its query", async () => {
    expect((await fetch(`${url}/healthz?from=probe`)).status).toBe(200);
  });

  it("refuses a body over one mebibyte with 413", async () => {
    expect((await post("x".repeat(1024 * 1024 + 1))).status).toBe(413);
  });
});
```

Run: `npx vitest run packages/receiver/test/server.test.ts`. Expected: FAIL, `Cannot find module '../src/server'`.

- [x] **Step 9: Write the server**

`packages/receiver/src/server.ts`:

```ts
import { createServer, type Server } from "node:http";
import { handle, type ReceiverDeps } from "./handler";
import { errorName } from "./log";

const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Makes the HTTP server of the receiver.
 * @param deps The token, the lists of the cluster and the way to ask for a sync.
 * @returns A server that is not listening yet.
 */
export function createReceiver(deps: ReceiverDeps): Server {
  return createServer((request, response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      const reply = (status: number, body: string) => {
        response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
        response.end(request.method === "HEAD" ? undefined : body);
      };
      if (size > MAX_BODY_BYTES) return reply(413, "the body is too large");
      handle(
        {
          method: request.method ?? "",
          path: (request.url ?? "").split("?")[0] ?? "",
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString("utf8"),
        },
        deps,
      )
        .then((answer) => reply(answer.status, answer.body))
        .catch((error: unknown) => {
          deps.log("KMO receiver failed", { error: errorName(error) });
          reply(500, "internal error");
        });
    });
  });
}
```

Run: `npx vitest run packages/receiver`. Expected: PASS, all files.

- [x] **Step 10: Check everything**

Run: `npm run format && mise run lint && mise run test`. Expected: all pass. `packages/receiver/src` and
`packages/receiver/test` are checked already, because the root `tsconfig.json` and `vitest.config.ts` match
`packages/*`.

- [x] **Step 11: After (show, then pause)**

Show the user `npx vitest run packages/receiver --reporter=verbose`: the test names are the receiver's contract, one
line for each answer. Point out the two tests that protect against a lost event (503 before the lists are filled, 500
when a sync request fails). Say that nothing runs in the cluster yet. Update `README.md` (layout: `receiver` is the
HTTP service, not deployed yet) and `CLAUDE.md` (state: `packages/receiver` exists with its handler and server; it has
no cluster code and is not deployed; layout paragraph for the package). Pause for questions.

- [ ] **Step 12: Commit (waits for the user)**

```bash
npm run format
git add package-lock.json packages/core packages/receiver README.md CLAUDE.md
git commit -m "feat: add the receiver's request handling"
```

---

### Task 2: The receiver in the cluster

**Before (explain to the user):** Four Kubernetes ideas arrive with this task.

- An **informer** is the standard way for a program to know what is in the cluster: it lists a kind once, then keeps a
  watch open and applies every change to a list in memory. The receiver keeps three such lists (ConfigSyncs and the
  two kinds of store), so it can answer an event without a single read from the API server.
- **Server-side apply** sends only the fields you care about, here one annotation, and the API server merges them. It
  records a **field manager** for each field, which is why `kubectl get --show-managed-fields` can say who last asked
  for a sync. The uid in the applied object makes the API server refuse the apply when the ConfigSync is gone.
- A **Deployment** with a **Service** gives the pods one stable name, `kmo-receiver.kmo-system.svc`. The **readiness
  probe** keeps a pod out of the Service until its lists are filled; the **liveness probe** restarts a pod that hangs.
- A **ServiceAccount** with a **ClusterRole** gives the receiver exactly three permissions. It cannot read a Secret,
  so a break-in through the one open port finds no store credentials.

Also new: the cluster's own **image registry**. The operator did not need one, because Pepr ships its code inside a
Secret. Additions to the spec to mention: `syncRequestApply` in core, the client and field manager, the token as an
environment variable, the bundle and the place of the manifests, and the two Mise tasks. RustFS already points at the
receiver's address with the token `kmo-local-token` (`dev/store/rustfs.yaml`), so no store setting changes.

**Files:**

- Create: `packages/receiver/src/cluster.ts`, `packages/receiver/src/main.ts`, `packages/receiver/Dockerfile`,
  `packages/receiver/test/cluster.test.ts`, `dev/receiver/receiver.yaml`
- Modify: `packages/core/src/trigger.ts`, `packages/core/test/trigger.test.ts`, `packages/operator/src/triggers.ts`,
  `mise.toml`, `test/e2e/smoke.sh`, `dev/README.md`, `docs/getting-started.md`, `docs/index.md`, `README.md`,
  `CLAUDE.md`

**Interfaces:**

- Consumes: `ReceiverDeps`, `createReceiver`, `log`, `errorName`, `Log` from Task 1; `SYNC_REQUESTED_ANNOTATION`.
- Produces, from `@kmo/core` (`trigger.ts`): `syncRequestApply(sync: ConfigSync, now: Date)`, which returns
  `{ apiVersion: string; kind: string; metadata: { name; namespace; uid; annotations } }`.
- Produces, from `packages/receiver/src/cluster.ts`:
  - `type PatchApi = Pick<CustomObjectsApi, "patchNamespacedCustomObject">`
  - `requestSync(api: PatchApi, sync: ConfigSync, now: Date): Promise<void>`
  - `toSync(object: Raw): ConfigSync`, `toStore(kind: StoreKind, object: Raw): Store | undefined`
  - `class Cluster` with `start(): Promise<void>`, `ready(): boolean`, `syncs(): ConfigSync[]`, `stores(): Store[]`,
    `requestSync(sync: ConfigSync): Promise<void>`
- Produces, on the cluster: Deployment and Service `kmo-receiver` in `kmo-system`, port 8080; log lines
  `KMO receiver handled an event` and `KMO receiver is ready`.

- [x] **Step 1: Write the failing core test**

Add to `packages/core/test/trigger.test.ts` (import `syncRequestApply` and `SYNC_REQUESTED_ANNOTATION` from
`../src/trigger`):

```ts
describe("a sync request", () => {
  const sync: ConfigSync = { metadata: { name: "orders-api", namespace: "shop", uid: "uid-1", generation: 4 } };
  const request = syncRequestApply(sync, new Date("2026-10-11T08:00:00.000Z"));

  it("names the ConfigSync and sets only the sync annotation, to the current time", () => {
    expect(request).toEqual({
      apiVersion: "kmo.isntall.net/v1alpha1",
      kind: "ConfigSync",
      metadata: {
        name: "orders-api",
        namespace: "shop",
        uid: "uid-1",
        annotations: { [SYNC_REQUESTED_ANNOTATION]: "2026-10-11T08:00:00.000Z" },
      },
    });
  });

  it("carries the uid, so that a ConfigSync that is gone is not created again", () => {
    expect(request.metadata.uid).toBe("uid-1");
  });
});
```

Run: `npx vitest run packages/core/test/trigger.test.ts`. Expected: FAIL, `syncRequestApply is not a function`.

- [x] **Step 2: Add `syncRequestApply` and use it in the operator**

Append to `packages/core/src/trigger.ts`:

```ts
/**
 * Builds the object that asks for a sync of a ConfigSync when it is applied to the cluster.
 * @param sync The resource.
 * @param now The current time, which becomes the value of the sync annotation.
 * @returns The resource's identity and the sync annotation, and nothing else. The uid makes the API server refuse the
 *   apply when the resource is gone.
 */
export function syncRequestApply(sync: ConfigSync, now: Date) {
  const { name, namespace, uid } = sync.metadata;
  return {
    apiVersion: "kmo.isntall.net/v1alpha1",
    kind: "ConfigSync",
    metadata: { name, namespace, uid, annotations: { [SYNC_REQUESTED_ANNOTATION]: now.toISOString() } },
  };
}
```

In `packages/operator/src/triggers.ts`, in `requestSync`, replace the `Apply` call and its comment with:

```ts
    await K8s(ConfigSyncKind).Apply(syncRequestApply(sync, new Date()), { force: true });
```

Change the destructuring above it to `const { name, namespace } = sync.metadata;`, import `syncRequestApply` from
`@kmo/core`, and remove the import of `SYNC_REQUESTED_ANNOTATION`, which is now unused there.

Run: `mise run test && npm run typecheck`. Expected: PASS.

- [x] **Step 3: Write the failing cluster tests**

`packages/receiver/test/cluster.test.ts`:

```ts
import { SYNC_REQUESTED_ANNOTATION, type ConfigSync } from "@kmo/core";
import { ApiException } from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";
import { requestSync, toStore, toSync, type PatchApi } from "../src/cluster";

const sync: ConfigSync = { metadata: { name: "orders-api", namespace: "shop", uid: "uid-1" } };
const now = new Date("2026-10-11T08:00:00.000Z");

/** A client whose patch call records its request, or fails with an HTTP status code. */
function client(failWith?: number) {
  const calls: Parameters<PatchApi["patchNamespacedCustomObject"]>[0][] = [];
  const api: PatchApi = {
    patchNamespacedCustomObject: async (request) => {
      calls.push(request);
      if (failWith) throw new ApiException(failWith, "refused", undefined, {});
    },
  };
  return { api, calls };
}

describe("a sync request from the receiver", () => {
  it("applies the sync annotation to the one ConfigSync, by force and under the receiver's own name", async () => {
    const { api, calls } = client();
    await requestSync(api, sync, now);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      group: "kmo.isntall.net",
      version: "v1alpha1",
      plural: "configsyncs",
      namespace: "shop",
      name: "orders-api",
      fieldManager: "kmo-receiver",
      force: true,
      body: { metadata: { uid: "uid-1", annotations: { [SYNC_REQUESTED_ANNOTATION]: "2026-10-11T08:00:00.000Z" } } },
    });
  });

  it("ends quietly when the ConfigSync is gone, whichever way the API server says so", async () => {
    await expect(requestSync(client(404).api, sync, now)).resolves.toBeUndefined();
    await expect(requestSync(client(409).api, sync, now)).resolves.toBeUndefined();
  });

  it("fails on any other refusal, so that the sender of the event tries again", async () => {
    await expect(requestSync(client(500).api, sync, now)).rejects.toThrow(ApiException);
    await expect(requestSync(client(403).api, sync, now)).rejects.toThrow(ApiException);
  });
});

describe("what the receiver keeps of the cluster", () => {
  it("is the identity, the annotations and the spec of a ConfigSync", () => {
    const object = { metadata: { name: "orders-api", namespace: "shop", uid: "uid-1" }, spec: { suspend: true } };
    expect(toSync(object)).toEqual({
      metadata: { name: "orders-api", namespace: "shop", uid: "uid-1", annotations: undefined },
      spec: { suspend: true },
    });
  });

  it("is a namespace for a ConfigStore and none for a ClusterConfigStore", () => {
    const object = { metadata: { name: "default", namespace: "payments" }, spec: { s3: { bucket: "b", region: "r" } } };
    expect(toStore("ConfigStore", object)?.metadata).toEqual({ name: "default", namespace: "payments" });
    expect(toStore("ClusterConfigStore", object)?.metadata).toEqual({ name: "default", namespace: undefined });
  });

  it("leaves out a store that has no spec", () => {
    expect(toStore("ConfigStore", { metadata: { name: "empty", namespace: "payments" } })).toBeUndefined();
  });
});
```

Run: `npx vitest run packages/receiver/test/cluster.test.ts`. Expected: FAIL, `Cannot find module '../src/cluster'`.

- [x] **Step 4: Write the cluster module**

`packages/receiver/src/cluster.ts`:

```ts
import {
  syncRequestApply,
  type ConfigSync,
  type ConfigSyncSpec,
  type Store,
  type StoreKind,
  type StoreSpec,
} from "@kmo/core";
import {
  ApiException,
  CustomObjectsApi,
  PatchStrategy,
  makeInformer,
  setHeaderOptions,
  type Informer,
  type KubeConfig,
  type KubernetesListObject,
  type KubernetesObject,
  type ObjectCache,
} from "@kubernetes/client-node";
import { errorName, type Log } from "./log";

const GROUP = "kmo.isntall.net";
const VERSION = "v1alpha1";
const FIELD_MANAGER = "kmo-receiver";
const RESTART_MS = 5000;
const PLURALS = ["configsyncs", "configstores", "clusterconfigstores"] as const;

type Plural = (typeof PLURALS)[number];
type Cache = Informer<Raw> & ObjectCache<Raw>;

/** A KMO resource as the client returns it. */
export type Raw = KubernetesObject & { spec?: unknown };

/** The one call of the Kubernetes client that a sync request needs; replaced in tests. */
export type PatchApi = Pick<CustomObjectsApi, "patchNamespacedCustomObject">;

/**
 * Asks for a sync of a ConfigSync, the same way the operator does.
 * @param api The Kubernetes client.
 * @param sync The resource.
 * @param now The current time.
 * @throws ApiException when the API server refuses the request for another reason than that the resource is gone.
 */
export async function requestSync(api: PatchApi, sync: ConfigSync, now: Date): Promise<void> {
  const { name, namespace } = sync.metadata;
  try {
    await api.patchNamespacedCustomObject(
      {
        group: GROUP,
        version: VERSION,
        namespace,
        plural: "configsyncs",
        name,
        body: syncRequestApply(sync, now),
        fieldManager: FIELD_MANAGER,
        force: true,
      },
      setHeaderOptions("Content-Type", PatchStrategy.ServerSideApply),
    );
  } catch (error) {
    if (error instanceof ApiException && (error.code === 404 || error.code === 409)) return;
    throw error;
  }
}

/**
 * Reduces a ConfigSync from the cluster to what the core logic reads.
 * @param object The resource as the client returns it.
 * @returns Its identity, its annotations and its spec.
 */
export function toSync(object: Raw): ConfigSync {
  return {
    metadata: {
      name: object.metadata?.name ?? "",
      namespace: object.metadata?.namespace ?? "",
      uid: object.metadata?.uid,
      annotations: object.metadata?.annotations,
    },
    spec: object.spec as ConfigSyncSpec | undefined,
  };
}

/**
 * Reduces a store from the cluster to what the core logic reads.
 * @param kind Which of the two kinds of store it is.
 * @param object The resource as the client returns it.
 * @returns The store, or undefined when it has no name or no spec.
 */
export function toStore(kind: StoreKind, object: Raw): Store | undefined {
  const name = object.metadata?.name;
  if (!name || !object.spec) return undefined;
  const namespace = kind === "ConfigStore" ? object.metadata?.namespace : undefined;
  return { kind, metadata: { name, namespace }, spec: object.spec as StoreSpec };
}

/** The receiver's view of the cluster: three watched lists, and the way to ask for a sync. */
export class Cluster {
  readonly #api: CustomObjectsApi;
  readonly #kubeConfig: KubeConfig;
  readonly #log: Log;
  readonly #listed = new Set<Plural>();
  readonly #caches: Record<Plural, Cache>;

  /**
   * @param kubeConfig How to reach the API server.
   * @param log Writes a log line.
   */
  constructor(kubeConfig: KubeConfig, log: Log) {
    this.#kubeConfig = kubeConfig;
    this.#log = log;
    this.#api = kubeConfig.makeApiClient(CustomObjectsApi);
    this.#caches = {
      configsyncs: this.#watch("configsyncs"),
      configstores: this.#watch("configstores"),
      clusterconfigstores: this.#watch("clusterconfigstores"),
    };
  }

  /** Starts the three watches. A watch that cannot start is started again later. */
  async start(): Promise<void> {
    await Promise.all(Object.values(this.#caches).map((cache) => cache.start()));
  }

  /** @returns True when every list was filled at least once. */
  ready(): boolean {
    return this.#listed.size === PLURALS.length;
  }

  /** @returns Every ConfigSync in the cluster. */
  syncs(): ConfigSync[] {
    return this.#caches.configsyncs.list().map(toSync);
  }

  /** @returns Every ConfigStore and ClusterConfigStore in the cluster. */
  stores(): Store[] {
    return [
      ...this.#caches.configstores.list().map((object) => toStore("ConfigStore", object)),
      ...this.#caches.clusterconfigstores.list().map((object) => toStore("ClusterConfigStore", object)),
    ].filter((store): store is Store => store !== undefined);
  }

  /**
   * Asks for a sync of a ConfigSync.
   * @param sync The resource.
   */
  requestSync(sync: ConfigSync): Promise<void> {
    return requestSync(this.#api, sync, new Date());
  }

  #watch(plural: Plural): Cache {
    const list = async () => {
      const result = (await this.#api.listClusterCustomObject({
        group: GROUP,
        version: VERSION,
        plural,
      })) as KubernetesListObject<Raw>;
      this.#listed.add(plural);
      return result;
    };
    const cache = makeInformer<Raw>(this.#kubeConfig, `/apis/${GROUP}/${VERSION}/${plural}`, list);
    // The informer stops on an error and does not start again by itself.
    cache.on("error", (error: unknown) => {
      this.#log("KMO receiver lost a watch and starts it again", { plural, error: errorName(error) });
      setTimeout(() => void cache.start(), RESTART_MS);
    });
    return cache;
  }
}
```

Run: `npx vitest run packages/receiver && npm run typecheck`. Expected: PASS. The fake client in the test returns
`undefined` where the real call returns the patched object; if the type check objects, return `{}` from the fake.

- [x] **Step 5: Write the entry point**

`packages/receiver/src/main.ts`:

```ts
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
```

The line `KMO receiver is ready` is written when the watches have started; `/readyz` is the real answer to whether
the lists are filled.

Run: `npm run build --workspace @kmo/receiver`. Expected: `packages/receiver/dist/receiver.cjs` exists and esbuild
reports no error. `dist/` is in `.gitignore` already. Then check that it starts and refuses to run without a token:
`node packages/receiver/dist/receiver.cjs`; expected: one JSON line with `KMO receiver stopped` and
`KMO_RECEIVER_TOKEN is not set`, exit code 1.

- [x] **Step 6: Write the image and the manifests**

`packages/receiver/Dockerfile`:

```dockerfile
FROM node:24.21.0-alpine
WORKDIR /app
COPY dist/receiver.cjs ./
USER 1000
EXPOSE 8080
CMD ["node", "receiver.cjs"]
```

`dev/receiver/receiver.yaml`:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kmo-receiver
  namespace: kmo-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: kmo-receiver
rules:
  - apiGroups: [kmo.isntall.net]
    resources: [configsyncs]
    verbs: [get, list, watch, patch]
  - apiGroups: [kmo.isntall.net]
    resources: [configstores, clusterconfigstores]
    verbs: [get, list, watch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kmo-receiver
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: kmo-receiver
subjects:
  - kind: ServiceAccount
    name: kmo-receiver
    namespace: kmo-system
---
apiVersion: v1
kind: Secret
metadata:
  name: kmo-receiver-token
  namespace: kmo-system
stringData:
  token: kmo-local-token
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kmo-receiver
  namespace: kmo-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kmo-receiver
  template:
    metadata:
      labels:
        app: kmo-receiver
    spec:
      serviceAccountName: kmo-receiver
      terminationGracePeriodSeconds: 10
      containers:
        - name: receiver
          image: kmo-registry.localhost:5111/kmo-receiver:dev
          imagePullPolicy: Always
          env:
            - name: KMO_RECEIVER_TOKEN
              valueFrom:
                secretKeyRef:
                  name: kmo-receiver-token
                  key: token
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            periodSeconds: 20
          resources:
            requests:
              cpu: 10m
              memory: 64Mi
          securityContext:
            runAsNonRoot: true
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop: [ALL]
---
apiVersion: v1
kind: Service
metadata:
  name: kmo-receiver
  namespace: kmo-system
spec:
  selector:
    app: kmo-receiver
  ports:
    - name: http
      port: 8080
      targetPort: http
```

Add one line to `dev/README.md`: `receiver/` holds the receiver's ServiceAccount, its three permissions, the local
token, its Deployment and its Service; the `receiver:deploy` task applies it, after it has pushed the image.

- [x] **Step 7: Add the Mise tasks**

In `mise.toml`, after `operator:logs`:

```toml
[tasks."receiver:deploy"]
description = "Build the receiver, push its image to the cluster's registry and install it"
run = [
  "npm run build --workspace @kmo/receiver",
  "docker build --quiet -t kmo-registry.localhost:5111/kmo-receiver:dev packages/receiver",
  "docker push --quiet kmo-registry.localhost:5111/kmo-receiver:dev",
  "kubectl apply -f dev/receiver/",
  "kubectl rollout restart deployment/kmo-receiver -n kmo-system",
  "kubectl rollout status deployment/kmo-receiver -n kmo-system --timeout=120s",
]

[tasks."receiver:logs"]
description = "Show the last ten minutes of the receiver's log"
run = "kubectl logs -n kmo-system deployment/kmo-receiver --since=10m"
```

Run: `mise run receiver:deploy`. Expected: the rollout finishes. This is the first use of the k3d registry. If
`docker push` cannot resolve or reach `kmo-registry.localhost:5111`, push to `localhost:5111/kmo-receiver:dev`
(build with that tag too) and keep the image name in the manifest as it is: inside the cluster the registry is
known by its k3d name. Tell the user which form was needed.

- [x] **Step 8: See it work by hand**

```bash
mise run receiver:logs | tail -3
kubectl get pods -n kmo-system
printf 'GREETING=hello from the receiver\nLOG_LEVEL=debug\n' | mise run store -- s3 cp - s3://kmo-config/shop/orders-api/config.env
sleep 5
mise run receiver:logs | grep "handled an event" | tail -1
kubectl get configmap orders-api-kmo -n shop -o jsonpath='{.data.GREETING}'; echo
kubectl rollout status deployment/orders-api -n shop
```

Expected: `KMO receiver is ready` with five or more ConfigSyncs and three stores; the pod is `1/1`; the log line names
the file `kmo-config/shop/orders-api/config.env` and the request `shop/orders-api`; the ConfigMap holds the new
greeting; the Deployment rolls. No annotation was set by hand. If the event does not arrive, read
`kubectl logs -n kmo-dev deployment/rustfs --since=5m` for the webhook target: RustFS queues events while its target
is down and delivers them within a minute (spike, check 1).

- [x] **Step 9: Let the smoke suite use the receiver**

With the receiver running, a changed file is synced at once, so `test/e2e/smoke.sh` must stop asking by hand, or one
change costs two reconciles and Check 5 fails. Change it as follows.

1. Header comment, first line: `End-to-end smoke test of the operator and the receiver on the local cluster.`
2. After `quietly mise run operator:deploy`, add:

   ```bash
   echo "Setup: installing the receiver from the working tree"
   quietly mise run receiver:deploy
   ```

3. Check 4: delete the line `request_sync` after the `put`. Change the title to
   `Check 4: a changed file rolls the workload, with no request by hand`.
4. Check 5: delete the line `request_sync` after the `put`. Change the last check's text to
   `one changed file started one reconcile`.
5. Check 8, first part: delete the line `request_sync` after the unparsable `put`.
6. Check 8, middle part: a good file now syncs at once, so name the missing store first. Replace the four lines from
   `put "$NS/app/config.env" 'GREETING=two\nLOG_LEVEL=changed\n'` to the check `the hash is the same` with:

   ```bash
   set_sources "[$FIRST,$SECOND,\"common\":false},{\"storeRef\":{\"kind\":\"ClusterConfigStore\",\"name\":\"$LATE\"}}]"
   wait_for "a missing store is the new reason" '[ "$(condition app Ready reason)" = "StoreNotFound" ]'
   put "$NS/app/config.env" 'GREETING=two\nLOG_LEVEL=changed\n'
   sleep 8
   check "a missing store leaves the ConfigMap as it was, also for the stores that exist" '[ "$(config_data)" = "$DATA" ]'
   check "the hash is the same" '[ "$(stamp)" = "$BEFORE" ]'
   ```

7. Check 8, last part: delete the five lines from `put "$NS/app/config.env" 'this line is not an assignment\n'`
   (the second one, after `has_event app Normal Synced`) to the check
   `the timer tries a failed sync again, with no request`. Task 3 proves the timer in the failures suite.
8. Check 10 keeps its `request_sync`: it shows that a request by hand is ignored while suspended.

Run: `mise run test:e2e`. Expected: every line starts with `PASS`, and the last line is `All checks passed.`

- [x] **Step 10: After (show, then pause)**

Show the user the result of Step 8 again, slowly, and then:

```bash
kubectl get csync orders-api -n shop -o yaml --show-managed-fields | grep -B2 -A8 'manager: kmo-receiver'
kubectl auth can-i get secrets -A --as=system:serviceaccount:kmo-system:kmo-receiver
kubectl auth can-i patch configsyncs -A --as=system:serviceaccount:kmo-system:kmo-receiver
kubectl auth can-i delete configsyncs -A --as=system:serviceaccount:kmo-system:kmo-receiver
```

Expected: the field manager `kmo-receiver` owns the sync annotation; then `no`, `yes`, `no`. Then one observation
that decides a sentence in the docs. Scale the admission pods away, change a file, and bring them back:

```bash
kubectl scale deployment/pepr-kmo -n pepr-system --replicas=0
printf 'GREETING=sent while admission was down\nLOG_LEVEL=debug\n' | mise run store -- s3 cp - s3://kmo-config/shop/orders-api/config.env
sleep 10 && mise run receiver:logs | grep "handled an event" | tail -2
kubectl scale deployment/pepr-kmo -n pepr-system --replicas=2 && kubectl rollout status deployment/pepr-kmo -n pepr-system
sleep 90 && kubectl get configmap orders-api-kmo -n shop -o jsonpath='{.data.GREETING}'; echo
```

The receiver's log shows `"failed":1`: it answered 500. Record whether RustFS sent the event again (a second log line
with `"failed":0`, and the new greeting in the ConfigMap). If it did not, the refresh interval is what picks such a
change up, and Task 5 says so in `docs/receiver.md` and `docs/limits.md`. Either result is acceptable; write down
which one it was in the report to the user. `mise run deploy` puts the sample files back.

Update `docs/getting-started.md` (a fifth task, `mise run receiver:deploy`; the section "Try it" needs no annotation
by hand any more; remove "What does not work yet"), `docs/index.md` and `README.md` (the receiver exists), and
`CLAUDE.md` (state: step 12 is done, the receiver runs in `kmo-system`, and a changed file is synced at once; layout:
`packages/receiver` with its five source files and `dev/receiver/`; commands: `receiver:deploy`, `receiver:logs`;
remove the sentences that say the receiver does not exist). Pause for questions.

- [ ] **Step 11: Commit (waits for the user)**

```bash
npm run format
git add packages mise.toml dev test/e2e/smoke.sh docs README.md CLAUDE.md
git commit -m "feat: add the receiver, so a changed file is synced at once"
```

---

### Task 3: The end-to-end tests

**Before (explain to the user):** A unit test proves a decision. An **end-to-end test** proves the system: it changes
a file in the real store and looks at real pods. The operator plan showed many things by hand in its After steps; a
thing shown by hand is proven once, and a script proves it again after every change. This task turns those
demonstrations into suites, and adds what the spec's test list still lacks. Each suite works in a **namespace** of its
own and removes it at the end, so suites do not disturb each other or the sample workloads. The suites are Bash,
because they drive `kubectl` and the AWS command line, the same tools a person uses. Additions to the spec to mention:
`test:e2e` runs all suites or the ones named, and the timer check moved to the failures suite.

What the spec's list asks for, and where it is checked:

| The spec asks for                                    | Suite and check                          |
|------------------------------------------------------|------------------------------------------|
| A workload-file change                               | smoke 4; events 3                        |
| A common-file change                                 | events 4                                 |
| An overridden common key causing no restart          | events 5                                 |
| A rolling update of each workload kind               | kinds 2                                  |
| Each warning                                         | smoke 9; kinds 3 and 4                   |
| Each failure                                         | smoke 8 and 12; failures 1 to 4          |
| A hand edit being reverted                           | smoke 6                                  |
| Suspending and resuming                              | smoke 10; events 7                       |
| A key prefix; two stores sharing a bucket            | smoke 7; events (its store); tenants 2   |
| A namespace store before the cluster-wide one        | tenants 1                                |
| A resource refused another namespace's files         | smoke 12; tenants 3                      |
| A namespace refused a store that does not allow it   | smoke 12; tenants 4                      |
| Rejection of a conflicting ConfigSync                | smoke 11                                 |
| Deletion of a ConfigSync                             | smoke 14                                 |
| The receiver's answers, on the cluster               | events 1, 6 and 8                        |
| The guarded Rollout watch                            | rollout-guard 1 to 4                     |

**Files:**

- Create: `test/e2e/lib.sh`, `test/e2e/run.sh`, `test/e2e/events.sh`, `test/e2e/kinds.sh`, `test/e2e/failures.sh`,
  `test/e2e/tenants.sh` (all executable: `chmod +x`)
- Modify: `test/e2e/smoke.sh`, `mise.toml`, `docs/getting-started.md`, `docs/upgrading-pepr.md`, `CLAUDE.md`

**Interfaces:**

- Consumes: the tasks `cluster:up`, `deploy`, `operator:deploy`, `receiver:deploy`; the log line
  `KMO reconciled`; the sample tenants `payments` and `partners`.
- Produces, from `test/e2e/lib.sh`, for every suite: `pass`, `fail`, `check <text> <condition>`,
  `wait_for <text> <condition> [seconds]`, `quietly <command...>`, `store <aws args>`, `put <key> <content>`,
  `value_in <namespace> <ConfigMap> <key>`, `condition_of <namespace> <ConfigSync> <type> <field>`,
  `event_on <namespace> <ConfigSync> <type> <reason>`, `hash_on <namespace> <kind> <name>`,
  `handled <namespace> <ConfigSync>`, `pods_on <namespace> <app> <hash>`, `deployment <namespace> <name> [ConfigMap]`,
  `watcher_restarts`, `ensure_environment`, `finish`; the variables `BUCKET`, `WATCHER`, `FAILED`.
- Produces: `test/e2e/run.sh [suite...]`, exit code 0 only when every suite passed.

- [x] **Step 1: Write the shared helpers**

`test/e2e/lib.sh`:

```bash
# Helpers shared by the end-to-end suites. Source it from the repository root.
CLUSTER=kmo
BUCKET=${BUCKET:-kmo-config}
WATCHER=deployment/pepr-kmo-watcher
FAILED=0

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=1; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
# wait_for <description> <condition> [seconds]: passes as soon as the condition holds.
wait_for() {
  local end=$((SECONDS + ${3:-60}))
  until eval "$2"; do
    if [ "$SECONDS" -ge "$end" ]; then fail "$1"; return; fi
    sleep 2
  done
  pass "$1"
}
# quietly <command...>: runs a setup command, and shows its output only when it fails.
quietly() {
  local output
  output=$("$@" 2>&1) || { echo "$output" | tail -30; echo "Setup failed: $*"; exit 1; }
}
finish() {
  if [ "$FAILED" = "0" ]; then echo "All checks passed."; else echo "At least one check failed."; exit 1; fi
}

store() {
  AWS_CONFIG_FILE=dev/aws-config AWS_PROFILE=default AWS_ACCESS_KEY_ID=kmoadmin \
    AWS_SECRET_ACCESS_KEY=kmo-local-secret aws "$@"
}
# put <key> <content>: writes a file to the bucket named in BUCKET.
put() { printf '%b' "$2" | store s3 cp - "s3://$BUCKET/$1" >/dev/null; }

# value_in <namespace> <ConfigMap> <key>: one value of a ConfigMap.
value_in() { kubectl get configmap "$2" -n "$1" -o jsonpath="{.data.$3}" 2>/dev/null || true; }
# condition_of <namespace> <ConfigSync> <type> <field>: one field of one condition in the status.
condition_of() {
  kubectl get csync "$2" -n "$1" -o jsonpath="{.status.conditions[?(@.type==\"$3\")].$4}" 2>/dev/null || true
}
# event_on <namespace> <ConfigSync> <type> <reason>: true when such an Event is recorded on the ConfigSync.
event_on() {
  local selector="involvedObject.kind=ConfigSync,involvedObject.name=$2,type=$3,reason=$4"
  [ -n "$(kubectl get events -n "$1" --field-selector "$selector" -o name 2>/dev/null)" ]
}
# handled <namespace> <ConfigSync>: the sync request that the last reconcile handled.
handled() { kubectl get csync "$2" -n "$1" -o jsonpath='{.status.lastHandledSyncRequest}' 2>/dev/null || true; }
# hash_on <namespace> <kind> <name>: the config hash on the pod template of a workload.
hash_on() {
  local template='.spec.template'
  [ "$2" = "cronjob" ] && template='.spec.jobTemplate.spec.template'
  kubectl get "$2" "$3" -n "$1" \
    -o jsonpath="{$template.metadata.annotations.kmo\.isntall\.net/config-hash}" 2>/dev/null || true
}
# pods_on <namespace> <app> <hash>: true when the app has pods and every one of them carries the hash.
pods_on() {
  local hashes
  hashes=$(kubectl get pods -n "$1" -l "app=$2" \
    -o jsonpath='{range .items[*]}{.metadata.annotations.kmo\.isntall\.net/config-hash}{"\n"}{end}' 2>/dev/null | sort -u)
  [ -n "$3" ] && [ "$hashes" = "$3" ]
}
watcher_restarts() {
  kubectl get pods -n pepr-system -l pepr.dev/controller=watcher \
    -o jsonpath='{range .items[*]}{.status.containerStatuses[0].restartCount}{"\n"}{end}' | sort -n | tail -1
}

# deployment <namespace> <name> [ConfigMap]: prints a one-pod Deployment, which reads the ConfigMap when one is named.
deployment() {
  cat <<EOF
apiVersion: apps/v1
kind: Deployment
metadata: { name: $2, namespace: $1 }
spec:
  replicas: 1
  selector: { matchLabels: { app: $2 } }
  template:
    metadata: { labels: { app: $2 } }
    spec:
      terminationGracePeriodSeconds: 1
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c", "while true; do sleep 3600; done"]
${3:+          envFrom: [{ configMapRef: { name: $3 } }]}
EOF
}

# ensure_environment: the cluster, the local environment, and the operator and receiver of the working tree.
# The runner does this once and sets KMO_E2E_READY for the suites it starts.
ensure_environment() {
  [ "${KMO_E2E_READY:-}" = "1" ] && return
  timeout 10 docker info >/dev/null 2>&1 || { echo "Docker is not available. Start Docker and run the test again."; exit 1; }
  if ! k3d cluster list "$CLUSTER" >/dev/null 2>&1; then
    echo "Setup: the cluster $CLUSTER is missing; creating it"
    quietly mise run cluster:up
  elif ! kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
    echo "Setup: the cluster $CLUSTER is stopped; starting it"
    quietly k3d cluster start "$CLUSTER"
    quietly kubectl wait --for=condition=Ready nodes --all --timeout=120s
  fi
  if ! kubectl get clusterconfigstore default >/dev/null 2>&1; then
    echo "Setup: installing the local environment"
    quietly mise run deploy
  fi
  echo "Setup: installing the operator and the receiver from the working tree"
  quietly mise run operator:deploy
  quietly mise run receiver:deploy
}
```

- [x] **Step 2: Make the smoke suite use them**

In `test/e2e/smoke.sh`:

1. After the `cd` line add `source test/e2e/lib.sh`.
2. Delete the lines `CLUSTER=kmo`, `BUCKET=kmo-config`, `WATCHER=...` and `FAILED=0`, and the functions `pass`, `fail`,
   `check`, `wait_for`, `store`, `put`, `quietly` and `watcher_restarts`. Keep every other function: they are about
   the one ConfigSync `app`.
3. Replace the setup block, from the line `timeout 10 docker info` to `quietly mise run receiver:deploy`, with the one
   line `ensure_environment`.
4. Replace the last line with `finish`.

Run: `test/e2e/smoke.sh`. Expected: the same output as before, ending in `All checks passed.`

- [x] **Step 3: Write the runner and wire the task**

`test/e2e/run.sh`:

```bash
#!/usr/bin/env bash
# Runs the end-to-end suites on the local cluster, one after the other. With arguments, runs only the suites named.
# rollout-guard is last, because it removes and reinstalls Argo Rollouts and restarts the operator.
set -uo pipefail

cd "$(dirname "$0")/../.."
source test/e2e/lib.sh
ALL=(smoke events kinds failures tenants rollout-guard)
SUITES=("$@")
[ "${#SUITES[@]}" -gt 0 ] || SUITES=("${ALL[@]}")
for suite in "${SUITES[@]}"; do
  [ -x "test/e2e/$suite.sh" ] || { echo "No suite named $suite. The suites are: ${ALL[*]}"; exit 2; }
done

ensure_environment
RESULT=0
SUMMARY=()
for suite in "${SUITES[@]}"; do
  printf '\n=== %s\n' "$suite"
  started=$SECONDS
  if KMO_E2E_READY=1 "test/e2e/$suite.sh"; then
    SUMMARY+=("PASS  $suite ($((SECONDS - started)) s)")
  else
    SUMMARY+=("FAIL  $suite ($((SECONDS - started)) s)")
    RESULT=1
  fi
done
printf '\n=== summary\n'
printf '%s\n' "${SUMMARY[@]}"
exit "$RESULT"
```

In `mise.toml`, change the `test:e2e` task:

```toml
[tasks."test:e2e"]
description = "Run the end-to-end suites on the local cluster; name suites after -- to run only those"
run = "test/e2e/run.sh"
```

Change `check:rollout-guard` to `run = "test/e2e/run.sh rollout-guard"`.

Run: `chmod +x test/e2e/*.sh && mise run test:e2e -- smoke`. Expected: the smoke checks, then a summary with one
line, `PASS  smoke`.

- [x] **Step 4: Write the events suite**

`test/e2e/events.sh`:

```bash
#!/usr/bin/env bash
# End-to-end test of the receiver: its answers, and changed files that reach the pods with no request by hand.
# It uses its own namespace and its own store, under a key prefix of the sample bucket.
set -euo pipefail

cd "$(dirname "$0")/../.."
source test/e2e/lib.sh
NS=kmo-e2e-events
STORE=e2e-events
URL=http://localhost:18080
TOKEN=kmo-local-token
FORWARD=""
REPLICAS=""

# answer <method> <path> [token] [body]: the status code of the receiver's answer.
answer() {
  local args=(-s -o /dev/null -w '%{http_code}' --max-time 15)
  if [ "$1" = "HEAD" ]; then args+=(--head); else args+=(-X "$1"); fi
  [ -n "${3:-}" ] && args+=(-H "Authorization: Bearer $3")
  [ -n "${4:-}" ] && args+=(-d "$4")
  curl "${args[@]}" "$URL$2" 2>/dev/null || true
}
s3_event() { printf '{"source":"aws.s3","detail":{"bucket":{"name":"%s"},"object":{"key":"%s"}}}' "$BUCKET" "$1"; }
requested_at() {
  kubectl get csync "$1" -n "$NS" -o jsonpath='{.metadata.annotations.kmo\.isntall\.net/sync-requested-at}'
}
pod_names() { kubectl get pods -n "$NS" -l "app=$1" -o name | sort; }
admission_pods() { kubectl get pods -n pepr-system -o name | grep pepr-kmo | grep -v watcher || true; }

cleanup() {
  [ -n "$FORWARD" ] && kill "$FORWARD" 2>/dev/null || true
  [ -n "$REPLICAS" ] && kubectl scale deployment/pepr-kmo -n pepr-system --replicas="$REPLICAS" >/dev/null 2>&1 || true
  kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  kubectl delete clusterconfigstore "$STORE" --ignore-not-found >/dev/null 2>&1 || true
  store s3 rm --recursive "s3://$BUCKET/$STORE/" >/dev/null 2>&1 || true
}

ensure_environment
trap cleanup EXIT
cleanup
kubectl wait --for=delete "namespace/$NS" --timeout=60s >/dev/null 2>&1 || true
kubectl port-forward -n kmo-system service/kmo-receiver 18080:8080 >/dev/null 2>&1 &
FORWARD=$!

echo "Setup: a store with two services, one of which sets a common key itself"
put "$STORE/_common/config.env" 'SHARED=common\nREGION=north\n'
put "$STORE/$NS/one/config.env" 'OWN=one\nSHARED=mine\n'
put "$STORE/$NS/two/config.env" 'OWN=two\n'
{
  cat <<EOF
apiVersion: v1
kind: Namespace
metadata: { name: $NS }
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ClusterConfigStore
metadata: { name: $STORE }
spec:
  s3:
    bucket: $BUCKET
    keyPrefix: $STORE
    region: us-east-1
    endpoint: http://rustfs.kmo-dev.svc:9000
    addressingStyle: Path
    credentialsSecretRef: { name: kmo-config-credentials, namespace: kmo-system }
  allowedNamespaces: [$NS]
EOF
  for name in one two; do
    cat <<EOF
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: $name, namespace: $NS }
spec:
  sources: [{ storeRef: { kind: ClusterConfigStore, name: $STORE } }]
---
EOF
    deployment "$NS" "$name" "$name-kmo"
  done
} | kubectl apply -f - >/dev/null

echo "Check 1: the receiver's answers"
wait_for "the receiver can be reached" '[ "$(answer GET /healthz)" = "200" ]' 20
[ "$FAILED" = "0" ] || { echo "The receiver cannot be reached, so the other checks cannot pass. Stopping."; exit 1; }
check "HEAD / needs no token" '[ "$(answer HEAD /)" = "200" ]'
check "the lists of the cluster are filled" '[ "$(answer GET /readyz)" = "200" ]'
check "an event without a token is refused" '[ "$(answer POST /events/rustfs "" "{}")" = "401" ]'
check "an event with a wrong token is refused" '[ "$(answer POST /events/rustfs wrong "{}")" = "401" ]'
check "a body that is not JSON is refused" '[ "$(answer POST /events/rustfs "$TOKEN" "not json")" = "400" ]'
check "JSON that is not an event is refused" '[ "$(answer POST /events/eventbridge "$TOKEN" "{}")" = "400" ]'
check "an unknown path is not found" '[ "$(answer POST /events/other "$TOKEN" "{}")" = "404" ]'

echo "Check 2: the first sync"
wait_for "one has its own value" '[ "$(value_in "$NS" one-kmo OWN)" = "one" ]'
wait_for "two has the common value" '[ "$(value_in "$NS" two-kmo SHARED)" = "common" ]'
[ "$FAILED" = "0" ] || { echo "Nothing was synced, so the other checks cannot pass. Stopping."; exit 1; }
wait_for "the pods of one run on its hash" 'pods_on "$NS" one "$(hash_on "$NS" deployment one)"' 120
wait_for "the pods of two run on its hash" 'pods_on "$NS" two "$(hash_on "$NS" deployment two)"' 120

echo "Check 3: a changed service file reaches its pods, with no request by hand"
ONE=$(hash_on "$NS" deployment one); TWO=$(hash_on "$NS" deployment two)
put "$STORE/$NS/one/config.env" 'OWN=changed\nSHARED=mine\n'
wait_for "the ConfigMap has the new value" '[ "$(value_in "$NS" one-kmo OWN)" = "changed" ]' 30
wait_for "the hash changed" '[ "$(hash_on "$NS" deployment one)" != "$ONE" ]' 30
wait_for "the pods were replaced" 'pods_on "$NS" one "$(hash_on "$NS" deployment one)"' 120
check "the other service was not touched" '[ "$(hash_on "$NS" deployment two)" = "$TWO" ]'

echo "Check 4: a changed common file reaches every service of the store"
ONE=$(hash_on "$NS" deployment one)
put "$STORE/_common/config.env" 'SHARED=common\nREGION=south\n'
wait_for "one has the new common value" '[ "$(value_in "$NS" one-kmo REGION)" = "south" ]' 30
wait_for "two has it too" '[ "$(value_in "$NS" two-kmo REGION)" = "south" ]' 30
wait_for "both hashes changed" \
  '[ "$(hash_on "$NS" deployment one)" != "$ONE" ] && [ "$(hash_on "$NS" deployment two)" != "$TWO" ]' 30
wait_for "the pods of one were replaced" 'pods_on "$NS" one "$(hash_on "$NS" deployment one)"' 120
wait_for "the pods of two were replaced" 'pods_on "$NS" two "$(hash_on "$NS" deployment two)"' 120

echo "Check 5: a common key that a service sets itself causes no restart of that service"
ONE=$(hash_on "$NS" deployment one); TWO=$(hash_on "$NS" deployment two)
PODS=$(pod_names one); HANDLED=$(handled "$NS" one)
put "$STORE/_common/config.env" 'SHARED=other\nREGION=south\n'
wait_for "the service without its own value gets the new one" '[ "$(value_in "$NS" two-kmo SHARED)" = "other" ]' 30
wait_for "and its hash changed" '[ "$(hash_on "$NS" deployment two)" != "$TWO" ]' 30
wait_for "the service with its own value was synced too" '[ "$(handled "$NS" one)" != "$HANDLED" ]' 30
check "it keeps its own value" '[ "$(value_in "$NS" one-kmo SHARED)" = "mine" ]'
check "its hash is the same" '[ "$(hash_on "$NS" deployment one)" = "$ONE" ]'
check "none of its pods was replaced" '[ "$(pod_names one)" = "$PODS" ]'

echo "Check 6: EventBridge events"
HANDLED=$(handled "$NS" two)
SSM='{"source":"aws.ssm","detail-type":"Parameter Store Change","detail":{"name":"x","operation":"Update"}}'
check "an event from another source is answered with 200" \
  '[ "$(answer POST /events/eventbridge "$TOKEN" "$SSM")" = "200" ]'
sleep 5
check "and starts no sync" '[ "$(handled "$NS" two)" = "$HANDLED" ]'
check "an S3 event for a file of a service is answered with 200" \
  '[ "$(answer POST /events/eventbridge "$TOKEN" "$(s3_event "$STORE/$NS/two/config.env")")" = "200" ]'
wait_for "and starts a sync of that service" '[ "$(handled "$NS" two)" != "$HANDLED" ]' 30

echo "Check 7: a deleted file, and a suspended ConfigSync"
store s3 rm "s3://$BUCKET/$STORE/$NS/one/config.env" >/dev/null
wait_for "the values of a deleted file are gone" '[ -z "$(value_in "$NS" one-kmo OWN)" ]' 30
check "and the common value takes the place of the service's own" '[ "$(value_in "$NS" one-kmo SHARED)" = "other" ]'
kubectl patch csync two -n "$NS" --type merge -p '{"spec":{"suspend":true}}' >/dev/null
wait_for "two says that it is suspended" '[ "$(condition_of "$NS" two Suspended status)" = "True" ]' 20
REQUESTED=$(requested_at two)
put "$STORE/$NS/two/config.env" 'OWN=while suspended\n'
sleep 8
check "the receiver asks for no sync of a suspended ConfigSync" '[ "$(requested_at two)" = "$REQUESTED" ]'
kubectl patch csync two -n "$NS" --type merge -p '{"spec":{"suspend":false}}' >/dev/null
wait_for "the change arrives when syncing is resumed" '[ "$(value_in "$NS" two-kmo OWN)" = "while suspended" ]' 30

echo "Check 8: what the receiver may do, and what it answers when a request for a sync is refused"
ACCOUNT=system:serviceaccount:kmo-system:kmo-receiver
check "it cannot read Secrets" '[ "$(kubectl auth can-i get secrets -A --as="$ACCOUNT" 2>/dev/null)" = "no" ]'
check "it cannot delete a ConfigSync" '[ "$(kubectl auth can-i delete configsyncs -A --as="$ACCOUNT" 2>/dev/null)" = "no" ]'
check "it can patch a ConfigSync" '[ "$(kubectl auth can-i patch configsyncs -A --as="$ACCOUNT" 2>/dev/null)" = "yes" ]'
REPLICAS=$(kubectl get deployment pepr-kmo -n pepr-system -o jsonpath='{.spec.replicas}')
kubectl scale deployment/pepr-kmo -n pepr-system --replicas=0 >/dev/null
wait_for "the admission pods are gone" '[ -z "$(admission_pods)" ]' 60
check "with admission down, the answer is 500, so that the sender tries again" \
  '[ "$(answer POST /events/eventbridge "$TOKEN" "$(s3_event "$STORE/$NS/two/config.env")")" = "500" ]'
kubectl scale deployment/pepr-kmo -n pepr-system --replicas="$REPLICAS" >/dev/null
quietly kubectl rollout status deployment/pepr-kmo -n pepr-system --timeout=180s
REPLICAS=""
check "with admission back, the same event is taken" \
  '[ "$(answer POST /events/eventbridge "$TOKEN" "$(s3_event "$STORE/$NS/two/config.env")")" = "200" ]'

finish
```

Run: `chmod +x test/e2e/events.sh && mise run test:e2e -- events`. Expected: every line `PASS`. The suite needs
`curl` on the computer; it is not a Mise tool. If it is missing, the first check of Check 1 fails and the suite stops.

- [x] **Step 5: Write the kinds suite**

`test/e2e/kinds.sh`:

```bash
#!/usr/bin/env bash
# End-to-end test of the five workload kinds: one ConfigSync stamps and rolls one workload of each kind.
# Then the two warnings about wiring that the smoke suite does not cover. It needs Argo Rollouts.
set -euo pipefail

cd "$(dirname "$0")/../.."
source test/e2e/lib.sh
NS=kmo-e2e-kinds
# The kind as kubectl names it, and the name of the workload of that kind.
WORKLOADS=("deployment web" "statefulset db" "daemonset agent" "cronjob report" "rollout canary")

# pod_template <app>: the pod template of a sample workload, indented for a workload's spec.
pod_template() {
  cat <<EOF
  template:
    metadata: { labels: { app: $1 } }
    spec:
      terminationGracePeriodSeconds: 1
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c", "while true; do sleep 3600; done"]
          envFrom: [{ configMapRef: { name: app-kmo } }]
EOF
}
# all_stamped <hash>: true when every workload carries the hash on its pod template.
all_stamped() {
  local workload
  for workload in "${WORKLOADS[@]}"; do
    # shellcheck disable=SC2086
    [ "$(hash_on "$NS" $workload)" = "$1" ] || return 1
  done
}
status_hash() { kubectl get csync app -n "$NS" -o jsonpath='{.status.configHash}' 2>/dev/null || true; }

cleanup() {
  kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  store s3 rm --recursive "s3://$BUCKET/$NS/" >/dev/null 2>&1 || true
}

ensure_environment
trap cleanup EXIT
cleanup
kubectl wait --for=delete "namespace/$NS" --timeout=90s >/dev/null 2>&1 || true

echo "Setup: one ConfigSync with a workload of each kind as its targets"
put "$NS/app/config.env" 'COLOR=green\n'
put "$NS/loose/config.env" 'UNUSED=yes\n'
{
  cat <<EOF
apiVersion: v1
kind: Namespace
metadata: { name: $NS }
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: app, namespace: $NS }
spec:
  targets:
    - { kind: Deployment, name: web }
    - { kind: StatefulSet, name: db }
    - { kind: DaemonSet, name: agent }
    - { kind: CronJob, name: report }
    - { kind: Rollout, name: canary }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: web, namespace: $NS }
spec:
  replicas: 2
  selector: { matchLabels: { app: web } }
$(pod_template web)
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: db, namespace: $NS }
spec:
  serviceName: db
  replicas: 1
  selector: { matchLabels: { app: db } }
$(pod_template db)
---
apiVersion: apps/v1
kind: DaemonSet
metadata: { name: agent, namespace: $NS }
spec:
  selector: { matchLabels: { app: agent } }
$(pod_template agent)
---
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: canary, namespace: $NS }
spec:
  replicas: 2
  strategy: { canary: {} }
  selector: { matchLabels: { app: canary } }
$(pod_template canary)
---
apiVersion: batch/v1
kind: CronJob
metadata: { name: report, namespace: $NS }
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        metadata: { labels: { app: report } }
        spec:
          restartPolicy: Never
          containers:
            - name: app
              image: busybox:1.37.0
              command: ["sh", "-c", "echo \$COLOR"]
              envFrom: [{ configMapRef: { name: app-kmo } }]
EOF
} | kubectl apply -f - >/dev/null

echo "Check 1: every kind gets the same hash"
wait_for "the ConfigSync is ready" '[ "$(condition_of "$NS" app Ready status)" = "True" ]'
[ "$FAILED" = "0" ] || { echo "Nothing was synced, so the other checks cannot pass. Stopping."; exit 1; }
wait_for "all five workloads carry the hash of the status" 'all_stamped "$(status_hash)"' 30
check "every target is wired, though none uses the empty Secret" \
  '[ "$(condition_of "$NS" app TargetsWired status)" = "True" ]'
for app in web db agent canary; do
  wait_for "the pods of $app run on that hash" "pods_on $NS $app \"\$(status_hash)\"" 180
done

echo "Check 2: a changed value rolls every kind"
BEFORE=$(status_hash)
put "$NS/app/config.env" 'COLOR=blue\n'
wait_for "the hash of the status changed" '[ -n "$(status_hash)" ] && [ "$(status_hash)" != "$BEFORE" ]' 30
wait_for "all five workloads carry the new hash" 'all_stamped "$(status_hash)"' 30
for app in web db agent canary; do
  wait_for "the pods of $app were replaced" "pods_on $NS $app \"\$(status_hash)\"" 180
done
check "a pod of the Deployment has the new value" \
  '[ "$(kubectl exec -n "$NS" deployment/web -- printenv COLOR 2>/dev/null)" = "blue" ]'
check "the pod of the StatefulSet has the new value" \
  '[ "$(kubectl exec -n "$NS" db-0 -- printenv COLOR 2>/dev/null)" = "blue" ]'
kubectl create job once -n "$NS" --from=cronjob/report >/dev/null
check "a run of the CronJob records the config that it used" \
  '[ "$(hash_on "$NS" job once)" = "$(status_hash)" ]'
wait_for "and prints the new value" '[ "$(kubectl logs -n "$NS" job/once 2>/dev/null)" = "blue" ]' 60

echo "Check 3: a Rollout that takes its pod template from a Deployment"
kubectl apply -f - >/dev/null <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: borrower, namespace: $NS }
spec:
  replicas: 0
  strategy: { canary: {} }
  workloadRef: { apiVersion: apps/v1, kind: Deployment, name: web }
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: borrower, namespace: $NS }
spec:
  targets: [{ kind: Rollout, name: borrower }]
EOF
wait_for "the ConfigSync warns, and says which target to name" \
  '[[ "$(condition_of "$NS" borrower TargetsWired message)" == *"takes its pod template from a Deployment"* ]]' 30
check "it is still ready" '[ "$(condition_of "$NS" borrower Ready status)" = "True" ]'
check "the warning is an Event" 'event_on "$NS" borrower Warning NotWired'

echo "Check 4: an output that holds values and that the target does not use"
{
  cat <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: loose, namespace: $NS }
---
EOF
  deployment "$NS" loose
} | kubectl apply -f - >/dev/null
wait_for "the ConfigSync warns, and names the ConfigMap" \
  '[[ "$(condition_of "$NS" loose TargetsWired message)" == *"does not use ConfigMap \"loose-kmo\""* ]]' 30
check "the workload is stamped all the same" '[ "$(hash_on "$NS" deployment loose | wc -c)" = "64" ]'
check "the warning is an Event" 'event_on "$NS" loose Warning NotWired'

finish
```

`hash_on "$NS" job once` reads `.spec.template`, which is where a Job keeps its pod template. The ConfigSync `loose`
also reads the common files of the store `default`, which is why its ConfigMap holds values even without its own file.

Run: `chmod +x test/e2e/kinds.sh && mise run test:e2e -- kinds`. Expected: every line `PASS`. If Argo Rollouts keeps
the Rollout `borrower` from being created with `replicas: 0`, leave that field out and set `workloadRef.scaleDown` to
`never`; the check is about the warning, not about the pods.

- [x] **Step 6: Write the failures suite**

`test/e2e/failures.sh`:

```bash
#!/usr/bin/env bash
# End-to-end test of the failures that the smoke suite does not cover: an output name that is taken, a store listed
# twice, a bucket that cannot be read, and credentials that are missing. The last one heals by the timer alone.
set -euo pipefail

cd "$(dirname "$0")/../.."
source test/e2e/lib.sh
NS=kmo-e2e-failures

# local_store <name> <bucket> <credentials Secret>: prints a ConfigStore on the local object store.
local_store() {
  cat <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigStore
metadata: { name: $1, namespace: $NS }
spec:
  s3:
    bucket: $2
    region: us-east-1
    endpoint: http://rustfs.kmo-dev.svc:9000
    addressingStyle: Path
    credentialsSecretRef: { name: $3 }
EOF
}
# keys <name>: creates a Secret with the keys of the local object store.
keys() {
  kubectl create secret generic "$1" -n "$NS" \
    --from-literal=accessKeyId=kmoadmin --from-literal=secretAccessKey=kmo-local-secret >/dev/null
}
reason() { condition_of "$NS" "$1" Ready reason; }
message() { condition_of "$NS" "$1" Ready message; }

cleanup() {
  kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  store s3 rm --recursive "s3://$BUCKET/$NS/" >/dev/null 2>&1 || true
}

ensure_environment
trap cleanup EXIT
cleanup
kubectl wait --for=delete "namespace/$NS" --timeout=60s >/dev/null 2>&1 || true
kubectl create namespace "$NS" >/dev/null
put "$NS/taken/config.env" 'FROM=the store\n'
put "$NS/locked/config.env" 'HEALED=yes\n'

echo "Check 1: an output name that an object of someone else holds"
kubectl create configmap taken-kmo -n "$NS" --from-literal=FROM=someone-else >/dev/null
kubectl apply -f - >/dev/null <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: taken, namespace: $NS }
EOF
wait_for "the ConfigSync is not ready, with the reason" '[ "$(reason taken)" = "OutputTaken" ]' 30
check "the object of someone else is left as it was" '[ "$(value_in "$NS" taken-kmo FROM)" = "someone-else" ]'
check "the other output is not written, though its name is free" \
  '! kubectl get secret taken-kmo -n "$NS" >/dev/null 2>&1'
check "a Warning Event is recorded" 'event_on "$NS" taken Warning OutputTaken'

echo "Check 2: the same store listed twice"
kubectl apply -f - >/dev/null <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: twice, namespace: $NS }
spec:
  sources:
    - storeRef: { kind: ClusterConfigStore, name: default }
    - storeRef: { kind: ClusterConfigStore, name: default }
EOF
wait_for "the ConfigSync is not ready, with the reason" '[ "$(reason twice)" = "InvalidSpec" ]' 30
check "the message names the store" '[[ "$(message twice)" == *"ClusterConfigStore/default is listed more than once"* ]]'
check "nothing was written" '! kubectl get configmap twice-kmo -n "$NS" >/dev/null 2>&1'

echo "Check 3: a bucket that cannot be read"
keys store-keys
{
  local_store nowhere kmo-no-such-bucket store-keys
  cat <<EOF
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: lost, namespace: $NS }
spec:
  sources: [{ storeRef: { name: nowhere } }]
EOF
} | kubectl apply -f - >/dev/null
wait_for "the ConfigSync is not ready, with the reason" '[ "$(reason lost)" = "StoreUnreachable" ]' 30
check "the message names the bucket" '[[ "$(message lost)" == *"kmo-no-such-bucket"* ]]'
check "nothing was written" '! kubectl get configmap lost-kmo -n "$NS" >/dev/null 2>&1'
wait_for "the store says that it is not ready" \
  '[ "$(kubectl get cstore nowhere -n "$NS" -o jsonpath="{.status.conditions[0].reason}")" = "NotReachable" ]' 30
check "a Warning Event is recorded" 'event_on "$NS" lost Warning StoreUnreachable'

echo "Check 4: credentials that are missing, and the timer that tries again"
{
  local_store locked "$BUCKET" late-keys
  cat <<EOF
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: locked, namespace: $NS }
spec:
  sources: [{ storeRef: { name: locked } }]
EOF
} | kubectl apply -f - >/dev/null
wait_for "the ConfigSync is not ready, with the reason" '[ "$(reason locked)" = "CredentialsMissing" ]' 30
check "the message names the Secret" '[[ "$(message locked)" == *"Secret $NS/late-keys was not found"* ]]'
keys late-keys
wait_for "the timer tries the failed sync again, with no event and no request" \
  '[ "$(value_in "$NS" locked-kmo HEALED)" = "yes" ]' 100
wait_for "the ConfigSync is ready again" '[ "$(reason locked)" != "CredentialsMissing" ]' 20
check "the other ConfigSyncs kept their own failures" '[ "$(reason taken)" = "OutputTaken" ]'

finish
```

Run: `chmod +x test/e2e/failures.sh && mise run test:e2e -- failures`. Expected: every line `PASS`. The two messages
that are matched word for word come from `packages/core/src/defaults.ts` and `packages/operator/src/cluster.ts`; if a
check fails on the wording, read the real message with `kubectl get csync -n kmo-e2e-failures -o yaml` and match
that, without changing the operator.

- [x] **Step 7: Write the tenants suite**

`test/e2e/tenants.sh`:

```bash
#!/usr/bin/env bash
# End-to-end test of the rules that keep tenants apart. It reads the two sample tenants, payments and partners, and
# adds one namespace of its own that tries to reach what belongs to others.
set -euo pipefail

cd "$(dirname "$0")/../.."
source test/e2e/lib.sh
NS=kmo-e2e-tenant
TENANT_FILE=s3://kmo-tenant/payments/ledger/config.env

stores_of() { kubectl get csync "$2" -n "$1" -o jsonpath='{.status.stores}' 2>/dev/null || true; }
keys_of() { kubectl get csync "$2" -n "$1" -o jsonpath='{.status.sources[*].key}' 2>/dev/null || true; }
# visitor <name> <spec>: creates a ConfigSync in the namespace of this suite.
visitor() {
  printf 'apiVersion: kmo.isntall.net/v1alpha1\nkind: ConfigSync\nmetadata: { name: %s, namespace: %s }\nspec: %s\n' \
    "$1" "$NS" "$2" | kubectl apply -f - >/dev/null
}

cleanup() { kubectl delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true; }

ensure_environment
trap cleanup EXIT
cleanup
kubectl wait --for=delete "namespace/$NS" --timeout=60s >/dev/null 2>&1 || true
kubectl create namespace "$NS" >/dev/null

echo "Check 1: a store in the namespace wins over the cluster-wide store of the same name"
wait_for "the ConfigSync of payments is ready" '[ "$(condition_of payments ledger Ready status)" = "True" ]'
check "it read the ConfigStore default, not the ClusterConfigStore default" \
  '[ "$(stores_of payments ledger)" = "[\"ConfigStore/default\"]" ]'
check "its values come from the bucket of the tenant" '[ "$(value_in payments ledger-kmo REGION)" = "eu-central-1" ]'
HANDLED=$(handled payments ledger)
store s3 cp "$TENANT_FILE" - | store s3 cp - "$TENANT_FILE" >/dev/null
wait_for "an event from the second bucket starts a sync of the tenant's ConfigSync" \
  '[ "$(handled payments ledger)" != "$HANDLED" ]' 30

echo "Check 2: two stores share a bucket, each under its own key prefix"
wait_for "the ConfigSync of partners is ready" '[ "$(condition_of partners portal Ready status)" = "True" ]'
check "its common value comes from its own common folder" '[ "$(value_in partners portal-kmo REGION)" = "partner-zone" ]'
check "every file it asked for is under the prefix of its store" \
  '[ "$(keys_of partners portal | tr " " "\n" | grep -vc "^partners-store/")" = "0" ]'

echo "Check 3: a ConfigSync reads only the folder of its own namespace"
visitor orders-api '{ sources: [{ storeRef: { kind: ClusterConfigStore, name: default } }] }'
wait_for "a ConfigSync named after a service of another namespace is ready" \
  '[ "$(condition_of "$NS" orders-api Ready status)" = "True" ]' 30
check "it has the common values" '[ -n "$(value_in "$NS" orders-api-kmo REGION)" ]'
check "it has none of the values of shop/orders-api" '[ -z "$(value_in "$NS" orders-api-kmo GREETING)" ]'
check "no file it asked for is in the folder of shop" '[[ " $(keys_of "$NS" orders-api)" != *" shop/"* ]]'
check "its Secret is empty" \
  '[ -z "$(kubectl get secret orders-api-kmo -n "$NS" -o jsonpath="{.data.DB_PASSWORD}" 2>/dev/null)" ]'

echo "Check 4: stores that do not allow the namespace"
visitor guest '{ sources: [{ storeRef: { kind: ClusterConfigStore, name: partners } }] }'
wait_for "a cluster-wide store that does not list the namespace is refused" \
  '[[ "$(condition_of "$NS" guest Ready message)" == *"does not allow namespace \"$NS\""* ]]' 30
check "nothing was written for it" '! kubectl get configmap guest-kmo -n "$NS" >/dev/null 2>&1'
visitor neighbour '{ sources: [{ storeRef: { kind: ConfigStore, name: default } }] }'
wait_for "the ConfigStore of another namespace cannot be named" \
  '[[ "$(condition_of "$NS" neighbour Ready message)" == *"was not found in namespace \"$NS\""* ]]' 30
check "a Warning Event says so" 'event_on "$NS" neighbour Warning StoreNotFound'

finish
```

The values `eu-central-1` and `partner-zone` are in `dev/store-files-tenant/_common/config.env` and
`dev/store-files/partners-store/_common/config.env`; read both files and correct the two checks if they differ.
`DB_PASSWORD` is a key of `dev/store-files/shop/orders-api/secrets.env`; use a key that the file really has.

Run: `chmod +x test/e2e/tenants.sh && mise run test:e2e -- tenants`. Expected: every line `PASS`.

- [x] **Step 8: Run everything**

Run: `mise run test:e2e`. Expected: six suites, about seventeen minutes, and a summary of six `PASS` lines.
`rollout-guard.sh` is not changed; if its second check does not find `Rollout changed` in the log, read the watcher
log for the line that a changed Rollout now writes and correct the pattern, in that file only.

Then `npm run format && mise run lint`. Expected: pass.

- [x] **Step 9: After (show, then pause)**

Show the user the summary, and the table at the top of this task with the spec's list next to the checks. Point out
the two ways to run: `mise run test:e2e` for everything, `mise run test:e2e -- smoke` for the quick suite after a
change. Update `docs/getting-started.md` (the section "Check that it works": six suites, what each proves, the time),
`docs/upgrading-pepr.md` (step 4: `mise run test:e2e -- rollout-guard`; `check:rollout-guard` is the same thing), and
`CLAUDE.md` (commands: `test:e2e` runs every suite in about seventeen minutes and takes suite names; run the smoke
suite at the end of every task that changes the operator or the receiver, and the full run before a commit; add a
check to the suite that fits for each new behavior; layout: the files of `test/e2e/`). Pause for questions.

- [ ] **Step 10: Commit (waits for the user)**

```bash
npm run format
git add test/e2e mise.toml docs CLAUDE.md
git commit -m "feat: add the end-to-end suites and their runner"
```

---

### Task 4: The `demo` task

**Before (explain to the user):** The demo is the whole product in one minute, for a person who has just cloned the
repository. It changes one value in the store and then only watches: the receiver's log line, the new ConfigMap, the
new hash, and `kubectl rollout status`, which follows a **rolling update** as Kubernetes replaces the pods one at a
time. Nothing in it is new code; it is the tools a person would use, in order, with a sentence before each.

**Files:**

- Create: `dev/demo.sh` (executable)
- Modify: `mise.toml`, `dev/README.md`, `docs/getting-started.md`, `CLAUDE.md`

**Interfaces:**

- Consumes: the sample workload `orders-api` in `shop`, its file `shop/orders-api/config.env` in the bucket
  `kmo-config`, the log line `KMO receiver handled an event`.
- Produces: `mise run demo`.

- [x] **Step 1: Write the script**

`dev/demo.sh`:

```bash
#!/usr/bin/env bash
# Changes one value in the local store and shows what KMO does with it, step by step.
set -euo pipefail

cd "$(dirname "$0")/.."
FILE=s3://kmo-config/shop/orders-api/config.env
HASH='{.spec.template.metadata.annotations.kmo\.isntall\.net/config-hash}'

store() {
  AWS_CONFIG_FILE=dev/aws-config AWS_PROFILE=default AWS_ACCESS_KEY_ID=kmoadmin \
    AWS_SECRET_ACCESS_KEY=kmo-local-secret aws "$@"
}
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
stamp() { kubectl get deployment orders-api -n shop -o jsonpath="$HASH"; }
greeting() { kubectl logs -n shop deployment/orders-api 2>/dev/null | grep '^GREETING=' || true; }

if ! kubectl get deployment kmo-receiver -n kmo-system >/dev/null 2>&1; then
  echo "The local environment is not complete. Run these first, in order:"
  echo "  mise run cluster:up && mise run deploy && mise run operator:deploy && mise run receiver:deploy"
  exit 1
fi

GREETING="hello at $(date +%T)"
BEFORE=$(stamp)

say "1. The value that a pod of orders-api runs with now"
greeting

say "2. Change GREETING in $FILE to: $GREETING"
CONTENT=$(store s3 cp "$FILE" -)
printf '%s\n' "$CONTENT" | sed "s|^GREETING=.*|GREETING=$GREETING|" | store s3 cp - "$FILE" >/dev/null
echo "The file is changed. Nothing else is done by hand from here on."

say "3. The store tells the receiver, and the receiver asks for a sync"
for _ in $(seq 1 15); do
  [ "$(stamp)" != "$BEFORE" ] && break
  sleep 2
done
kubectl logs -n kmo-system deployment/kmo-receiver --since=1m | grep "handled an event" | tail -1

say "4. The operator writes the ConfigMap and puts a new hash on the pod template"
echo "ConfigMap orders-api-kmo: GREETING=$(kubectl get configmap orders-api-kmo -n shop -o jsonpath='{.data.GREETING}')"
echo "config hash before: $BEFORE"
echo "config hash now:    $(stamp)"
if [ "$(stamp)" = "$BEFORE" ]; then
  echo "The hash did not change. Look at: kubectl describe csync orders-api -n shop"
  exit 1
fi

say "5. Kubernetes sees a changed pod template and replaces the pods"
kubectl rollout status deployment/orders-api -n shop --timeout=120s

say "6. The value that a new pod runs with"
greeting

say "7. What the ConfigSync reports"
kubectl get csync orders-api -n shop
kubectl get events -n shop --field-selector involvedObject.kind=ConfigSync,involvedObject.name=orders-api | tail -3

printf '\nRun it again to see another change. mise run deploy puts the sample files back.\n'
```

- [x] **Step 2: Add the task and run it**

In `mise.toml`, after `test:e2e`:

```toml
[tasks.demo]
description = "Change a file in the local store and show the rollout that follows"
run = "dev/demo.sh"
```

Run: `chmod +x dev/demo.sh && mise run demo`. Expected: seven headed steps; step 3 shows the receiver's log line with
`shop/orders-api`; step 4 shows two different hashes; step 5 ends with `successfully rolled out`; step 6 shows the
greeting with the time of the run. Run it a second time: it works again, with a new time. Then run it on a cluster
without the receiver (`kubectl scale deployment/kmo-receiver -n kmo-system --replicas=0` does not count; test the
guard with `KUBECONFIG=/dev/null mise run demo`): it prints the four tasks to run first and exits with 1.

Add one line to `dev/README.md`: `demo.sh` changes one value of the sample service `orders-api` in the store and
shows each step up to the new pods; the `demo` task runs it.

- [x] **Step 3: After (show, then pause)**

Run `mise run demo` with the user and read each step with them. Then `mise run deploy` to put the sample files back,
and note that this alone rolls `orders-api` once more, for the same reason. Update `docs/getting-started.md` (the
section "Try it" starts with `mise run demo`, then tells how to change a file by hand) and `CLAUDE.md` (commands:
`mise run demo`; remove the sentence that says the task does not exist). Run `npm run format && mise run lint`. Pause
for questions.

- [ ] **Step 4: Commit (waits for the user)**

```bash
npm run format
git add dev mise.toml docs CLAUDE.md
git commit -m "feat: add the demo task"
```

---

### Task 5: The documentation

**Before (explain to the user):** The code is done; this task makes it usable by someone who was not here. The spec
names the pages. Each one answers one question a reader has, in the order they have it: what is this, how do I try
it, what do I write in a ConfigSync, how do I give a team its own store, what went wrong, and what do the Kubernetes
words mean. The last page is the one this project exists for: it collects every Kubernetes idea that the Before notes
of the three plans explained. One more page states honestly what KMO does not do, and what the next two specs must
still prove.

**Files:**

- Create: `docs/architecture.md`, `docs/configsync.md`, `docs/stores.md`, `docs/receiver.md`, `docs/tenants.md`,
  `docs/troubleshooting.md`, `docs/concepts.md`, `docs/limits.md`, `docs/installing.md`
- Modify: `docs/index.md`, `docs/getting-started.md`, `docs/aws-identity.md`, `docs/advisories.md`, `README.md`,
  `CLAUDE.md`

**Rules for every page:** written for people, in Simplified Technical English; short sentences, one idea each; a code
fence only where a reader must copy something; the YAML examples of the spec may be used whole. No absolute local
paths, no account IDs. Every fact below must be on the page that is named for it; check each against the code or the
cluster before writing it, and do not copy a sentence from this plan that the cluster contradicts. Each page ends
with links to the pages a reader wants next.

- [x] **Step 1: `docs/architecture.md`**

- The diagram of the spec (store, receiver, ConfigSync, operator, outputs, workload), and one paragraph for each part.
- The path of one changed file, as a numbered list: event, match, annotation, reconcile, two objects, hash, rollout.
- Why two components: Pepr cannot host an HTTP endpoint; the open port holds no store credentials; webhooks, the
  timer and requests by hand share one path, the annotation `kmo.isntall.net/sync-requested-at`.
- Why a hash and not a timestamp; why the store is the source of truth; why the operator merges.
- Where each part runs: the operator in `pepr-system` (Pepr decides), the receiver in `kmo-system`.
- The packages: `core` (every decision, no cluster), `operator`, `receiver`; the shared code is why both agree on the
  keys of a ConfigSync.
- The table "Decisions and their reasons" of the spec, by link, not copied.

- [x] **Step 2: `docs/configsync.md` and `docs/stores.md`**

`docs/configsync.md`, the reference of the ConfigSync:

- The full example of the spec with every default, then one short section for each field: `suspend`, `targets`,
  `sources` (order, `common: false`, at most eight, no store twice), `output`, `refreshInterval` (minimum one minute).
- The merge order, with one worked example of two stores and four files.
- The status: each field, the four conditions with their reasons (`kubectl get csync` columns), and the Events.
- Failures and warnings as two tables: what happened, the reason, what KMO does. Take the reasons from
  `FailureReason` in `packages/core/src/types.ts` and from `packages/core/src/status.ts`.
- What triggers a sync (six triggers) and how to ask for one by hand.
- One ConfigSync for each workload: the admission check, its message, and that a suspended one keeps its claims.
- What happens on delete.
- The file format: dotenv rules, no expansion, one line for each value, `\n` in double quotes.

`docs/stores.md`, the reference of both kinds of store:

- The example of the spec; every field of `spec.s3`; the two identities and that exactly one is set.
- The layout: default folders, `keyPrefix`, `serviceFolder` and `commonFolder` with the two placeholders, and the
  rule that a ClusterConfigStore must keep `{namespace}` in its `serviceFolder`.
- `allowedNamespaces` and `*`; the default store and how a ConfigSync finds it.
- The `Ready` condition and when it is checked.
- Addressing style, and why RustFS needs `Path`.
- Other kinds of store are planned and not built; one sentence, with the four rules of the spec by link.

- [x] **Step 3: `docs/receiver.md` and `docs/tenants.md`**

`docs/receiver.md`:

- What it does and what it cannot do (no store access, no Secrets; its three permissions).
- The paths and answers as one table: `POST /events/rustfs`, `POST /events/eventbridge`, `HEAD /`, `GET /healthz`,
  `GET /readyz`; 200, 400, 401, 404, 405, 413, 500, 503, and what a sender should do with each.
- The token: Secret `kmo-receiver-token`, key `token`, one token for all tenants and why that is enough; a changed
  token needs a restart.
- How it matches: bucket name and key only; a suspended ConfigSync is skipped; an EventBridge event from another
  source is ignored.
- How to point a store at it: the RustFS settings of `dev/store/rustfs.yaml` as the worked example; EventBridge
  comes with the AWS integration spec.
- It is stateless and can run as several pods; the log lines to look for.
- What happens to an event while the receiver or the admission pods are down, with the result that Task 2 recorded.

`docs/tenants.md`: move the section "Tenants" of `docs/getting-started.md` here and extend it into a guide: the
trusted tenant (own ConfigStore), the untrusted tenant (ClusterConfigStore, credentials in `kmo-system`, no permission
to create stores), sharing a bucket by key prefix, what a tenant can and cannot reach, and that the cluster's own
access rules for people are the administrator's work. Link to `docs/aws-identity.md` for stores without stored keys.
Leave a two-sentence summary and a link in `docs/getting-started.md`.

- [x] **Step 4: `docs/troubleshooting.md` and `docs/limits.md`**

`docs/troubleshooting.md`, as "what you see, why, what to do", one entry for each of these:

- A pod stays in `CreateContainerConfigError`: the ConfigMap or Secret does not exist yet; the operator is not
  installed or the ConfigSync is not ready.
- A changed file does nothing: read the receiver's log, then the ConfigSync's conditions, then the operator's log
  (`mise run receiver:logs`, `kubectl describe csync`, `mise run operator:logs`); the ConfigSync may be suspended.
- The ConfigMap changed and no pod restarted: the effective values are the same, or the workload does not use the
  object (`TargetsWired`), or the kind does not roll by itself (`OnDelete`, CronJob, a Rollout's own steps).
- `Ready` is false: one entry for each reason, with the message to expect.
- `kubectl apply` of a ConfigSync is refused: the conflict message; or the admission pods are down.
- Nothing can create or change a ConfigSync: the Deployment `pepr-kmo` is down; its failure policy is `Fail`.
- The operator's watcher restarts in a loop: a watched kind is missing; `KMO_GUARD_ROLLOUT_WATCH`; link to
  `docs/upgrading-pepr.md`.
- The receiver answers 401, 503 or 500: the token, the lists, the admission pods.
- A store is not ready: the bucket, the Secret, the ServiceAccount and its role.
- Many workloads rolled at once: a common file changed.

`docs/limits.md`, in two parts. Every item of both lists is required.

Known limits:

- **A late `TargetsWired` warning.** When someone removes the reference to an output object from a workload that is
  already wired, the warning appears at the next sync, not at once.
- **One list for each workload at the start.** When the operator's watcher starts, each workload in the cluster
  causes one list of the ConfigSyncs in its namespace. On a large cluster this is a burst of reads.
- **Every start syncs everything once.** Each ConfigSync is synced once when the watcher starts.
- **The operator may read every Secret**, and may create a token for every ServiceAccount, because a store can keep
  its identity in any namespace. Say what this means for who may deploy or change the operator.
- **No ConfigSync can be created or changed while the admission pods are down**, the operator's own sync requests
  and the receiver's included.
- **The receiver does not join events.** Many changed files ask for many syncs; the hash keeps the pods from rolling
  more than once for the same values.
- **Two conflicting ConfigSyncs created at the same instant** can both pass the admission check.
- **The receiver matches on bucket name and key only**, so two stores with the same bucket name at different
  endpoints can cause a sync that was not needed.
- **A common-file change rolls many workloads at once**; restarts are not staggered.
- **No TLS and one shared token** on the receiver; proper authentication comes with the AWS integration spec.
- **The operator runs in `pepr-system`**, and that cannot be changed.
- **The Rollout shim uses parts of Pepr that are not public**; link to `docs/upgrading-pepr.md`.

Open points for the next specs:

- **Several copies of the operator in one cluster.** The spike's answer (modules with different UUIDs can share a
  cluster, all in `pepr-system`) was read from the generated names, not from the Pepr documentation. Confirm it in the
  documentation before anything depends on it.
- **EventBridge keys.** The normalizer takes the key of an EventBridge event as it is, on the assumption that it is
  not URL-encoded. The AWS integration spec must confirm this against a live event, with a key that holds a space and
  a plus sign, and add the captured event to `packages/core/test/fixtures/`.
- **The proof inside EKS of stores without stored keys.** The path is proven from a cluster outside EKS. The
  packaging spec brings the first EKS cluster and must repeat `test/e2e/aws/setup.sh` there, without the step that
  publishes the signing keys, because EKS registers them itself.
- **Packaging.** The receiver's manifests are in `dev/receiver/` and its image is built for the local registry. The
  packaging spec brings the Helm chart, a published image and the ArgoCD application.
- **`docs/advisories.md`** is reviewed again whenever dependencies change.

Update `docs/aws-identity.md`: its status paragraph links to the EKS item above. Update `docs/advisories.md`: add
the date of the last review (the `npm audit` of Task 1) and the sentence that the page is reviewed again when
dependencies change.

- [x] **Step 5: `docs/concepts.md`**

One short section for each Kubernetes idea the project uses: what it is in two or three sentences, where KMO uses
it, and the file to read. Take the ideas from the Before notes of the three plans. At least: custom resource
definition and custom resource; controller and reconcile, level-triggered; operator; watch and informer; status,
conditions and Events; `metadata.generation` and `observedGeneration`; owner reference and garbage collection; labels
and annotations; pod template and rolling update; the workload kinds and how each one rolls; admission webhook and
failure policy; server-side apply and field managers; ServiceAccount, Role and ClusterRole, least privilege; a
ServiceAccount token and web identity; namespace as the boundary between tenants; Deployment, Service and probes;
ConfigMap and Secret, `envFrom`; at-least-once delivery and why a repeated event is harmless.

- [x] **Step 6: The entry points**

- `docs/getting-started.md`: check every command on a fresh cluster (`mise run cluster:down`, then the five tasks, then
  `mise run demo`). Keep it a walk-through; move reference material to the new pages and link to them.
- `docs/installing.md`: what a cluster needs today, said honestly: the three definitions in `crds/`, the operator
  (`npx pepr build` in `packages/operator` writes the manifests to `dist/`), the receiver (an image from
  `packages/receiver` and the manifests of `dev/receiver/` with another image name and another token), a store and its
  notification settings. Say that this is not a supported installation yet, that the Helm chart comes with the
  packaging spec, and that the local environment is the way to try KMO now.
- `docs/index.md`: the overview, then every page in reading order with one line each. Remove "being built in steps".
- `README.md`: the introduction without "under construction"; the layout with `packages/receiver`; the section
  "Installing" links to `docs/installing.md` and `docs/getting-started.md`.
- `CLAUDE.md`: steps 12 and 13 are done and this plan is complete; the first spec is finished, and the next work is
  the packaging spec and the AWS integration spec, which do not exist yet; point to `docs/limits.md` for the open
  points; list the docs pages; remove what is no longer true.

- [x] **Step 7: Check everything**

Run: `npm run format && mise run lint && mise run test`. Expected: all pass, markdownlint included. Then check the
links: for each `](` target in `docs/*.md` and `README.md` that is not a URL, the file exists. Run
`grep -rn "zeemo\|/home/" docs README.md dev packages test --include='*.md' --include='*.sh' --include='*.yaml' --include='*.ts'`.
Expected: no match outside the repository-layout sketch of the spec, which names the directory.

Run: `mise run test:e2e`. Expected: six `PASS` lines. This is the last full run of the first spec.

- [x] **Step 8: After (show, then pause)**

Go through the spec's success criteria with the user, one at a time, and name for each the suite and check, or the
doc page, that proves it. The criterion "works in EKS" is the one that is not met; say so, and show where
`docs/limits.md` records it. Show `docs/index.md` as the table of contents. Pause for questions.

- [ ] **Step 9: Commit (waits for the user)**

```bash
npm run format
git add docs README.md CLAUDE.md
git commit -m "feat: add the full documentation"
```

---

## Verification

How to know the whole plan worked, from a clean state:

1. `mise run cluster:down`, then `mise run setup && mise run cluster:up && mise run deploy && mise run operator:deploy && mise run receiver:deploy`.
2. `mise run lint && mise run test`: every static check and unit test passes, the receiver's included.
3. `mise run demo`: a changed file reaches new pods of `orders-api` with no step by hand.
4. `mise run test:e2e`: the six suites pass. Together they cover every item of the spec's end-to-end list (the table
   in Task 3).
5. `kubectl auth can-i get secrets -A --as=system:serviceaccount:kmo-system:kmo-receiver` answers `no`.
6. A person who reads only `README.md` and `docs/` can do steps 1 and 3 and can find every known limit in
   `docs/limits.md`.

## What comes next

This plan ends the first spec. The next work needs a spec first, not a plan: **packaging** (a Helm chart and an
ArgoCD application, a published receiver image, and the proof of stores without stored keys inside EKS) and **AWS
integration** (Terraform for S3 and EventBridge, proper authentication of the receiver, and the check of EventBridge
keys against a live event). `docs/limits.md`, written in Task 5, carries the open points to them.
