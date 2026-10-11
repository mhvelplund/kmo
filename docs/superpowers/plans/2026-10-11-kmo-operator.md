# KMO Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> `CLAUDE.md` overrides both skills: work on `main`, do one task, leave it uncommitted, then stop.

**Goal:** Build the KMO operator: a Pepr module that reads env files from a store, writes one ConfigMap and one Secret
for each ConfigSync, rolls the workloads when their effective values change, reports what it did, and keeps tenants
apart.

**Architecture:** `packages/operator` is a thin Pepr module around `@kmo/core`. Every decision that needs no cluster is
a pure function in core with unit tests; the operator only reads from the cluster and the store, calls core, and writes
the result. Every trigger ends as the `kmo.isntall.net/sync-requested-at` annotation on a ConfigSync, so Pepr's
per-resource queue runs one reconcile at a time for each ConfigSync.

**Tech Stack:** Pepr 2.0.3 (exact pin), kubernetes-fluent-client 3.12.3, `@kubernetes/client-node` 1.4.0,
`@aws-sdk/client-s3` and `@aws-sdk/client-sts` 3.1149.0, TypeScript 5.9.3, Vitest 5, k3d with k3s 1.37, RustFS 1.0.1,
Argo Rollouts 1.10.

**Spec:** `docs/superpowers/specs/2026-10-10-kmo-operator-core-design.md`

**Spike findings:** `docs/superpowers/spikes/2026-10-10-kmo-operator-core-spike.md`

## Where this plan sits

The spec lists thirteen build steps. The foundations plan did steps 1 to 4. This plan covers steps 5 to 11. Two tasks
come before step 5, because the design depends on them: the operator package itself, and the proof of the guarded
Rollout watch. One more plan follows:

- **Receiver and finish** (steps 12 and 13): the receiver, the end-to-end tests, the `demo` task and the full docs.

| Task | Spec step | Subject                         |
|------|-----------|---------------------------------|
| 1    | before 5  | Operator package skeleton       |
| 2    | before 5  | Prove the guarded Rollout watch |
| 3    | 5         | The custom resources            |
| 4    | 6         | Syncing: read the store         |
| 5    | 6         | Syncing: write the outputs      |
| 6    | 7         | Rolling updates                 |
| 7    | 8         | Reporting                       |
| 8    | 9         | Staying in step                 |
| 9    | 10        | Guarding                        |
| 10   | 11        | Tenants                         |
| 11   | 11        | Stores without stored keys      |

**Task 2 is a gate.** If one of its four cluster checks fails, stop. Do not start Task 3. The design is revisited with
the user.

## Global Constraints

- The product is **KMO**; Kubernetes names use `kmo`. Never write "zeemo" in code, manifests or docs. The repository's
  directory keeps the name `zeemo`.
- API group `kmo.isntall.net`, version `v1alpha1`. The operator runs in `pepr-system` (Pepr does not let you change it).
  Credentials of cluster-wide stores live in `kmo-system`. Local-only namespace `kmo-dev`.
- Commit directly to `main`. No branches, no worktrees. Conventional commit messages with the types `feat`, `fix` and
  `chore`.
- **A commit step waits for the user.** Leave finished work in the working tree, report, and stop. Tick the commit
  checkbox only when the user has asked for the commit and it is made. Never push. Never start the next task unasked.
- Learning pace. Every task opens with a **Before** note to explain to the user and closes with an **After** step that
  shows something observable, followed by a pause for questions.
- Explanations use ASD-STE100 Simplified Technical English.
- Pinned versions, all exact: `pepr` `2.0.3`, `kubernetes-fluent-client` `3.12.3`, `@kubernetes/client-node` `1.4.0`,
  `@aws-sdk/client-s3` and `@aws-sdk/client-sts` `3.1149.0`.
  TypeScript stays at `5.9.3`.
- **A Pepr upgrade might require the Rollout shim to be rewritten.** Do not change the Pepr pin without the procedure in
  `docs/upgrading-pepr.md` (written in Task 2).
- **Never declare a plain watch on a kind that may be missing.** The watcher crash-loops and takes the schedule with it.
  KMO's own custom resource definitions are applied before the operator that watches them; the Rollout watch goes
  through the shim.
- Decisions that need no cluster go into `@kmo/core` with unit tests. `@kmo/core` makes no Kubernetes or network calls.
  Reuse what exists: `resolveConfigSync`, `findStore`, `allowsNamespace`, `storeKeys`,
  `storeLabel`, `buildOutputs`, `configHash`.
- Any failure stops the whole reconcile and leaves existing objects untouched. Check everything that can fail before the
  first write.
- Messages that reach logs, status or Events never contain a value from an env file or a credential. They name files,
  keys of the bucket, line numbers and reasons.
- RBAC is scoped and written by hand in `packages/operator/package.json` under `pepr.rbac`. Add a rule in the task that
  first needs it, never earlier.
- Comments: terse, only where something is hard to follow, no reasons and no history. Every exported function, class and
  type gets a terse JSDoc block covering what it does, its parameters and its return value. Every attribute of an exported
  interface gets a one-line JSDoc, also where a snippet in this plan leaves it out.
- Unit tests read as statements of behavior. No coverage chasing.
- Docs are for people: high level, few code fences. `docs/index.md` is the entry point.
- `dev/README.md` lists every entry in `dev/`. Update it in the same change that adds, removes or repurposes one.
- Commands assume Mise is activated in the shell. If it is not, prefix them with `mise x --`.
- Run `npm run format` before each commit so the pre-commit hooks pass.
- **The smoke test.** `mise run test:e2e` (`test/e2e/smoke.sh`, added after Task 6) checks the whole path on the local
  cluster. From Task 7 on, every task runs it in its "check and deploy" step and adds a check for each new behavior
  that can be seen on the cluster. When a task changes what the test observes (a log line, a status field, how a sync
  is asked for), change the test in the same task.
- The code in this plan was written against the Pepr 2.0.3 and kubernetes-fluent-client 3.12.3 sources, but it was not
  compiled. When `npm run typecheck` or the cluster disagrees with a snippet, correct the snippet, keep its behavior,
  and tell the user what changed in the After step.

## Additions to the spec

Things the spec does not say, decided here. Each is small; say so to the user in the Before note of its task.

- **`status.lastHandledSyncRequest`** on a ConfigSync holds the value of the sync annotation that the last reconcile
  handled. Together with `status.observedGeneration` it tells the operator that an update was only its own status write.
  Flux uses the same pattern. (Task 7)
- **One path for every trigger.** The refresh timer and changes to outputs, workloads and stores do not reconcile
  directly. They set the sync annotation, as the receiver will. (Task 8)
- **Retries.** A reconcile that failed is requested again by the once-a-minute schedule. (Task 8)
- **The role of a store's ServiceAccount** is read from the annotation `eks.amazonaws.com/role-arn`, as IRSA does.
  (Task 11)
- **Hand-added keys are removed.** The outputs are replaced whole, so a key that someone added by hand goes away, not
  only a changed value. (Task 5)
- **Ordered sources and stores that own their layout.** Decided on 2026-10-11, after Task 4, and written into the
  spec. A ConfigSync lists stores in order (`spec.sources`) and names no key; a store's fields are in `spec.s3`, with
  the two folders and the identity. All common files are merged first, then all service files, a later source winning.
  Tasks 3 to 11 below are revised for this. Where a later snippet still shows an old shape, the spec and the code win.
- **Mise tasks** `operator:deploy`, `operator:logs`, `check:rollout-guard`, `aws:issuer`, `aws:setup` and
  `aws:teardown`. (Tasks 1, 2 and 11)
- **`docs/upgrading-pepr.md`**, the procedure for a Pepr upgrade. (Task 2)

Known limit, accepted: when someone removes the reference to an output object from a workload that is already wired, the
`TargetsWired` warning appears at the next sync, not at once. (Task 8)

## Review Focus

- **Several sources.** A later source wins; a service value beats a common value from any store; `common: false`
  leaves out one store's common files; one missing store fails the whole sync and writes nothing. (Tasks 4 and 10)
- **A key added by hand to an output object.** It is removed at the next sync, the same as a changed value. (Task 5)
- **An output name held by an object that KMO did not write, or that another ConfigSync owns.** The reconcile fails and
  neither output object is written, not even the one whose name is free. (Task 5)
- **Secret values with non-ASCII characters.** `PASSWORD=pässwörd` reaches the pod unchanged. (Task 5)
- **An operator restart.** No workload rolls, because every stamped hash is already current. (Task 6)
- **A refresh interval the schema accepts but the rules do not**, such as `30s`. The ConfigSync becomes not Ready with
  the reason; the operator does not crash and other ConfigSyncs continue. (Task 7)
- **A store that appears after its ConfigSync.** The ConfigSync becomes Ready without a manual trigger. (Task 8)

## File Structure

```text
package.json                              overrides scoped; lockfile regenerated (Task 1)
mise.toml                                 operator:deploy, operator:logs, check:rollout-guard
tsconfig.json                             also checks packages/*/pepr.ts
crds/configsync.yaml                      (Task 3)
crds/configstore.yaml                     (Task 3)
crds/clusterconfigstore.yaml              (Task 3)
dev/README.md                             kept current by Tasks 3, 5 and 10
dev/kmo/                                  kmo-system namespace, default store and its credentials (Task 3)
dev/workloads/configsyncs.yaml            one ConfigSync for each sample workload (Task 3)
dev/tenants/                              trusted and untrusted tenant namespaces (Task 10)
docs/upgrading-pepr.md                    (Task 2)
test/e2e/rollout-guard.sh                 the four cluster checks of the shim (Task 2)
test/e2e/smoke.sh                         the end-to-end smoke test, run with `mise run test:e2e`
test/e2e/aws/                             the proof against a real AWS account (Task 11)
packages/operator/package.json            Pepr settings, scoped RBAC rules, exact pins
packages/operator/tsconfig.json           extends the root config; pepr build needs it
packages/operator/pepr.ts                 module entry point
packages/operator/src/capability.ts       every binding: reconcile, validate, watches, schedule
packages/operator/src/kinds.ts            ConfigSync, stores and Rollout as client kinds
packages/operator/src/guarded-kind.ts    the shim: watches on a kind that may be missing
packages/operator/src/generation-gate.ts  remembers the generation last seen of an object (Task 8)
packages/operator/src/cluster.ts          small cluster reads: stores, credentials, get-or-undefined
packages/operator/src/s3.ts               fetch the source files, check a bucket
packages/operator/src/web-identity.ts     a ServiceAccount's token exchanged for short-lived AWS keys (Task 11)
packages/operator/src/credentials.ts      picks stored keys or web identity for a store (Task 11)
packages/operator/src/outputs.ts          write the ConfigMap and the Secret
packages/operator/src/targets.ts          stamp the hash on the targets
packages/operator/src/reconcile.ts        one reconcile, start to finish
packages/operator/src/report.ts           status and Events
packages/operator/src/triggers.ts         request a sync; handlers for timer, outputs, workloads, stores
packages/operator/test/*.test.ts          unit tests, Pepr contract tests
packages/core/src/types.ts                grows: status, conditions, failure reasons
packages/core/src/plan.ts                 what to read for a ConfigSync (Task 4)
packages/core/src/outputs.ts              the two output objects and the takeover rule (Task 5)
packages/core/src/workload.ts             pod template, stamp, wiring (Tasks 6 and 7)
packages/core/src/status.ts               conditions, status and Events from an outcome (Task 7)
packages/core/src/trigger.ts              when to reconcile, when a sync is due, who is affected (Tasks 7 and 8)
packages/core/src/claims.ts               conflicting ConfigSyncs (Task 9)
packages/core/src/identity.ts             which identity a store uses, and where it lives (Task 11)
packages/core/test/*.test.ts              one test file per module
```



### Task 1: Operator package skeleton

**Before (explain to the user):** An operator is a program in the cluster that watches resources and acts on them. Pepr
packages ours as two Deployments in `pepr-system`: an admission controller, which the API server asks before it accepts
a change, and a watcher, which runs the watches, the reconciles and the schedules. This task adds an empty module and
installs it. The Kubernetes idea is **RBAC**: a ServiceAccount is the identity a pod uses to talk to the API server, a
ClusterRole lists what an identity may do, and a ClusterRoleBinding joins the two. Pepr's default role may do
everything. Ours lists each permission by hand, so the operator can never do more than its work needs.

**Files:**

- Create: `packages/operator/package.json`, `packages/operator/tsconfig.json`, `packages/operator/pepr.ts`,
  `packages/operator/src/capability.ts`
- Modify: `package.json` (overrides), `package-lock.json` (regenerated), `tsconfig.json`, `mise.toml`, `README.md`,
  `CLAUDE.md`

**Interfaces:**

- Consumes: the k3d cluster `kmo` from the foundations plan.
- Produces: the capability `Kmo` exported from `packages/operator/src/capability.ts`; the Deployments `pepr-kmo` and
  `pepr-kmo-watcher` and the ServiceAccount `pepr-kmo` in `pepr-system`; the Mise tasks `operator:deploy` and
  `operator:logs`; the log line `KMO tick` once a minute.

- [x] **Step 1: Scope the `js-yaml` override**

In the root `package.json`, replace the `overrides` block. The pin on `js-yaml` breaks `pepr build`, because
`@kubernetes/client-node` needs version 4.

```json
  "overrides": {
    "markdownlint-cli": {
      "js-yaml": "5.4.3"
    },
    "katex": "0.19.0",
    "smol-toml": "1.9.1"
  }
```

- [x] **Step 2: Create the package**

`packages/operator/package.json`. There is no `type` field on purpose: the spike built the module that way.

```json
{
  "name": "@kmo/operator",
  "version": "0.0.0",
  "private": true,
  "description": "Keeps ConfigMaps and Secrets in step with env files in an object store",
  "pepr": {
    "uuid": "kmo",
    "onError": "reject",
    "webhookTimeout": 10,
    "customLabels": {
      "namespace": {
        "pepr.dev": ""
      }
    },
    "alwaysIgnore": {
      "namespaces": []
    },
    "admission": {
      "alwaysIgnore": {
        "namespaces": []
      }
    },
    "watch": {
      "alwaysIgnore": {
        "namespaces": []
      }
    },
    "includedFiles": [],
    "env": {
      "KMO_GUARD_ROLLOUT_WATCH": "true"
    },
    "rbacMode": "scoped",
    "rbac": [
      {
        "apiGroups": ["apiextensions.k8s.io"],
        "resources": ["customresourcedefinitions"],
        "verbs": ["get", "list", "watch"]
      }
    ]
  },
  "dependencies": {
    "@kmo/core": "*",
    "kubernetes-fluent-client": "3.12.3",
    "pepr": "2.0.3"
  }
}
```

`packages/operator/tsconfig.json`. `pepr build` runs `tsc` with this file.

```json
{
  "extends": "../../tsconfig.json",
  "include": ["pepr.ts", "src"]
}
```

In the root `tsconfig.json`, change `include` so the root type check also covers the entry point:

```json
  "include": ["packages/*/src", "packages/*/test", "packages/*/pepr.ts"]
```

- [x] **Step 3: Write the capability and the entry point**

`packages/operator/src/capability.ts`:

```ts
import { Capability, Log, a } from "pepr";

/** The KMO operator's one capability. */
export const Kmo = new Capability({
  name: "kmo",
  description: "Keeps ConfigMaps and Secrets in step with env files in an object store",
  namespaces: [],
});

const { When, OnSchedule } = Kmo;

When(a.CustomResourceDefinition)
  .IsCreatedOrUpdated()
  .Watch((definition) => {
    Log.info({ name: definition.metadata?.name }, "KMO saw definition");
  });

OnSchedule({
  name: "kmo-tick",
  every: 1,
  unit: "minutes",
  run: () => {
    Log.info("KMO tick");
  },
});
```

`packages/operator/pepr.ts`:

```ts
import { PeprModule } from "pepr";
import cfg from "./package.json";
import { Kmo } from "./src/capability";

new PeprModule(cfg, [Kmo]);
```

- [x] **Step 4: Regenerate the lockfile and install**

A changed `overrides` entry is not picked up while the old lockfile is present.

Run:

```bash
rm -rf node_modules package-lock.json
npm install
npm ls js-yaml
```

Expected: `npm install` succeeds. `npm ls js-yaml` shows version 4 under `@kubernetes/client-node` and 5.4.3 under
`markdownlint-cli`.

- [x] **Step 5: Handle the advisories that Pepr brings**

Run: `npm audit`

The spike saw five advisories, three of them high, in `node-forge` and in the `undici` that `kubernetes-fluent-client`
brings. For each advisory that `npm audit` reports:

1. Read the patched version from `npm audit --json` (the `fixAvailable` and `range` fields of the entry).
2. Add an override in the root `package.json`, scoped to the package that brings the dependency, with the exact patched
   version. For example, under `overrides`: `"kubernetes-fluent-client": { "undici": "<patched version>" }`.
3. Regenerate the lockfile as in Step 4 and run `npm audit` again.

An override stays only if Steps 7 and 8 still pass with it. Remove an override that breaks the build or the deployed
module, and regenerate the lockfile again.

For each advisory that cannot be cleared, add a row to a new page `docs/advisories.md` (advisory ID, package, how it
reaches KMO, whether KMO runs the affected code, why it cannot be cleared) and link the page from `docs/index.md`. Do
not create the page when nothing remains.

- [x] **Step 6: Add the Mise tasks**

Append to `mise.toml`:

```toml
[tasks."operator:deploy"]
description = "Build the operator and install it into the cluster"
dir = "{{config_root}}/packages/operator"
run = [
  "npx pepr deploy --yes",
  "kubectl rollout status deployment/pepr-kmo -n pepr-system --timeout=180s",
  "kubectl rollout status deployment/pepr-kmo-watcher -n pepr-system --timeout=180s",
]

[tasks."operator:logs"]
description = "Show the last ten minutes of the operator's watcher log"
run = "kubectl logs -n pepr-system deployment/pepr-kmo-watcher --since=10m"
```

- [x] **Step 7: Check and build**

Run: `mise run lint && mise run test` Expected: clean, and the 92 existing unit tests pass.

Run: `cd packages/operator && npx pepr build && cd ../..` Expected: `packages/operator/dist/pepr-module-kmo.yaml`
exists. If the build fails on a module it cannot resolve, add that module to `packages/operator/package.json` with an
exact version, regenerate the lockfile, and tell the user in Step 9.

Run: `grep -n -A16 'kind: ClusterRole$' packages/operator/dist/pepr-module-kmo.yaml` Expected: the ClusterRole lists
`customresourcedefinitions` and `peprstores` with named verbs, and has no rule with `*` for resources.

- [x] **Step 8: Deploy**

Run: `mise run operator:deploy` Expected: both rollouts complete.

Run: `kubectl get deployment,pod -n pepr-system` Expected: `pepr-kmo` with two pods and `pepr-kmo-watcher` with one, all
ready, zero restarts.

- [x] **Step 9: After (show, then pause)**

Wait two minutes, then show the user:

```bash
mise run operator:logs | grep -c "KMO saw definition"
mise run operator:logs | grep "KMO tick"
kubectl auth can-i list customresourcedefinitions --as=system:serviceaccount:pepr-system:pepr-kmo
kubectl auth can-i delete pods -A --as=system:serviceaccount:pepr-system:pepr-kmo
kubectl auth can-i get secrets -A --as=system:serviceaccount:pepr-system:pepr-kmo
```

Expected: a count above zero, at least two ticks about a minute apart, then `yes`, `no`, `no`. The last two answers are
the point: this operator cannot delete pods or read Secrets, because no rule lets it. Report the result of Step 5 (which
advisories were cleared, which remain). Update `README.md` (layout: `packages/operator`) and `CLAUDE.md` (state and
layout: the operator package exists; the `js-yaml` consequence is done). Then pause for questions.

- [x] **Step 10: Commit (waits for the user)**

```bash
npm run format
git add package.json package-lock.json tsconfig.json mise.toml README.md CLAUDE.md packages/operator docs
git commit -m "feat: add the operator package with scoped permissions"
```



### Task 2: Prove the guarded Rollout watch

**Before (explain to the user):** A **watch** is a long-lived request to the API server: "tell me about every change to
resources of this kind". A kind exists only when its definition is installed. Argo Rollouts is optional, so the kind
Rollout may be missing, and Pepr's watcher exits when a watch cannot start. The shim in this task keeps the Rollout
watch away from Pepr and starts it only while the definition is installed. It uses parts of Pepr that are not public, so
**a Pepr upgrade might require the shim to be rewritten**. This task therefore also builds the guard for that: a version
tripwire, contract tests, and a script that repeats the cluster checks. Nothing else in the plan may depend on the shim
before these checks pass.

What the shim relies on in Pepr 2.0.3, read from its source:

- `When(...).Watch(callback)` pushes a plain object onto the capability's list, but only when `PEPR_WATCH_MODE=true`,
  `PEPR_MODE=build` or `PEPR_MODE=dev` was set **when Pepr was first imported** (`src/lib/core/capability.ts`,
  `registerWatch`).
- `capability.bindings` returns that same live array, so `splice` on it removes the entry for Pepr too.
- Pepr starts watches in `onReady` (`src/lib/controller/createHooks.ts` calls `setupWatch`), which is after the module
  file has run. Removing an entry while the module loads is early enough.
- `setupWatch` starts each entry with
  `K8s(binding.model, { ...binding.filters, kindOverride: binding.kind }).Watch(...)` and registers a handler for the
  client's `give_up` event that throws (`src/lib/processors/watch-processor.ts`). That throw is what ends the watcher.
  The shim copies the start and registers a handler that does not throw.
- In build mode Pepr only reads the list to generate RBAC, so the entry must stay there.

**Files:**

- Create: `packages/operator/src/kinds.ts`, `packages/operator/src/guarded-kind.ts`,
  `packages/operator/test/guarded-kind.test.ts`, `packages/operator/test/pepr-contract.test.ts`,
  `test/e2e/rollout-guard.sh`, `docs/upgrading-pepr.md`
- Modify: `packages/operator/src/capability.ts`, `packages/operator/package.json` (RBAC), `mise.toml`, `docs/index.md`

**Interfaces:**

- Consumes: `Kmo` from Task 1.
- Produces, from `packages/operator/src/guarded-kind.ts`:
  - `interface GuardedKind { kind: string; definition: string; setting: string }`
  - `type WatchBinding = Capability["bindings"][number]`
  - `guardWanted(guarded: GuardedKind, env: NodeJS.ProcessEnv): boolean`
  - `takeWatchBindings(capability: Capability, kindName: string): WatchBinding[]`
  - `isEstablished(definition: { status?: { conditions?: { type: string; status: string }[] } }): boolean`
  - `class GuardedWatch` with `ensureStarted(): Promise<void>`, `stop(): void`, `readonly running: boolean`
  - `guardKind(capability: Capability, guarded: GuardedKind, env?: NodeJS.ProcessEnv): GuardedWatch | undefined`. It
    takes the watches on the kind out of the capability and declares the two watches on the kind's definition. Call it
    after the watches on the kind are declared.
- Produces, from `packages/operator/src/kinds.ts`: `class Rollout`, and `ROLLOUT_GUARD`, the `GuardedKind` of Rollout.
- Produces: the log lines `KMO saw rollout`, `KMO guarded watch started`, `KMO guarded watch stopped`; the Mise task
  `check:rollout-guard`.

- [x] **Step 1: Write the failing tests for the shim's own logic**

`packages/operator/test/guarded-kind.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GuardedWatch, guardWanted, isEstablished, type GuardedKind, type WatchBinding } from "../src/guarded-kind";

const binding = {} as WatchBinding;
const widget: GuardedKind = { kind: "Widget", definition: "widgets.example.com", setting: "GUARD_WIDGET" };

/** A stand-in for starting a watch that records what happened to it. */
function fakeStarter() {
  const log: string[] = [];
  let giveUp = () => {};
  const start = async (_binding: WatchBinding, onGiveUp: () => void) => {
    log.push("started");
    giveUp = onGiveUp;
    return { close: () => log.push("closed") };
  };
  return { log, start, giveUp: () => giveUp() };
}

describe("the guard setting", () => {
  it("is on when nothing is set", () => {
    expect(guardWanted(widget, {})).toBe(true);
  });

  it("is off only for the value false", () => {
    expect(guardWanted(widget, { GUARD_WIDGET: "false" })).toBe(false);
    expect(guardWanted(widget, { GUARD_WIDGET: "no" })).toBe(true);
  });

  it("listens only to the kind's own variable", () => {
    expect(guardWanted(widget, { GUARD_GADGET: "false" })).toBe(true);
  });

  it("is off while Pepr builds the module, so the permissions for the kind are still generated", () => {
    expect(guardWanted(widget, { PEPR_MODE: "build" })).toBe(false);
  });
});

describe("a definition", () => {
  it("is established when the API server says so", () => {
    expect(isEstablished({ status: { conditions: [{ type: "Established", status: "True" }] } })).toBe(true);
  });

  it("is not established while it is still being set up", () => {
    expect(isEstablished({})).toBe(false);
    expect(isEstablished({ status: { conditions: [{ type: "Established", status: "False" }] } })).toBe(false);
  });
});

describe("a guarded watch", () => {
  it("starts once, however often the definition is seen", async () => {
    const { log, start } = fakeStarter();
    const guarded = new GuardedWatch("Widget", [binding], start);
    await guarded.ensureStarted();
    await guarded.ensureStarted();
    expect(log).toEqual(["started"]);
    expect(guarded.running).toBe(true);
  });

  it("stops when the definition is removed, and starts again when it comes back", async () => {
    const { log, start } = fakeStarter();
    const guarded = new GuardedWatch("Widget", [binding], start);
    await guarded.ensureStarted();
    guarded.stop();
    expect(guarded.running).toBe(false);
    await guarded.ensureStarted();
    expect(log).toEqual(["started", "closed", "started"]);
  });

  it("stops itself when the client gives up, instead of ending the process", async () => {
    const { log, start, giveUp } = fakeStarter();
    const guarded = new GuardedWatch("Widget", [binding], start);
    await guarded.ensureStarted();
    giveUp();
    expect(log).toEqual(["started", "closed"]);
    expect(guarded.running).toBe(false);
  });

  it("does nothing when there is no watch to guard", async () => {
    const { log, start } = fakeStarter();
    const guarded = new GuardedWatch("Widget", [], start);
    await guarded.ensureStarted();
    expect(log).toEqual([]);
  });
});
```

- [x] **Step 2: Run them to see them fail**

Run: `npx vitest run packages/operator/test/guarded-kind.test.ts` Expected: FAIL, the module `../src/guarded-kind`
does not exist.

- [x] **Step 3: Write the kinds file and the shim**

`packages/operator/src/kinds.ts`:

```ts
import { RegisterKind, kind } from "pepr";
import type { GuardedKind } from "./guarded-kind";

/** An Argo Rollout, reduced to what KMO reads. */
export class Rollout extends kind.GenericKind {
  spec?: {
    workloadRef?: { kind?: string; name?: string };
    template?: { metadata?: { annotations?: Record<string, string> }; spec?: unknown };
  };
}
RegisterKind(Rollout, { group: "argoproj.io", version: "v1alpha1", kind: "Rollout", plural: "rollouts" });

/** Argo Rollouts is optional, so the Rollout kind is guarded. */
export const ROLLOUT_GUARD: GuardedKind = {
  kind: "Rollout",
  definition: "rollouts.argoproj.io",
  setting: "KMO_GUARD_ROLLOUT_WATCH",
};
```

`packages/operator/src/guarded-kind.ts`:

```ts
import { WatchEvent, WatchPhase } from "kubernetes-fluent-client";
import { K8s, Log, a, type Capability } from "pepr";

/** A kind that may be missing from the cluster, so KMO starts and stops its watches itself. */
export interface GuardedKind {
  /** Kind name, such as Rollout. */
  kind: string;
  /** Name of the definition that makes the kind exist, such as rollouts.argoproj.io. */
  definition: string;
  /** Environment variable that turns the guard off when it is "false". */
  setting: string;
}

/** One entry of a capability's list of bindings. */
export type WatchBinding = Capability["bindings"][number];

/** Something that can be closed, such as a running watch. */
interface Closable {
  close(): void;
}

/** Starts one watch and reports when the client gives up on it. */
type Starter = (binding: WatchBinding, onGiveUp: () => void) => Promise<Closable>;

/**
 * Tells whether the watches on a kind are taken out of Pepr's hands.
 * @param guarded The kind.
 * @param env The process environment.
 * @returns False when the kind's setting is "false" or Pepr is building the module.
 */
export function guardWanted(guarded: GuardedKind, env: NodeJS.ProcessEnv): boolean {
  return env[guarded.setting] !== "false" && env.PEPR_MODE !== "build";
}

/**
 * Removes the watches on one kind from a capability, so that Pepr does not start them.
 * @param capability The capability that declared them.
 * @param kindName The kind to take, such as Rollout.
 * @returns The removed bindings, in the order they were declared.
 */
export function takeWatchBindings(capability: Capability, kindName: string): WatchBinding[] {
  const bindings = capability.bindings;
  const taken: WatchBinding[] = [];
  for (let index = bindings.length - 1; index >= 0; index--) {
    const binding = bindings[index];
    if (binding?.isWatch && binding.kind.kind === kindName) taken.unshift(...bindings.splice(index, 1));
  }
  return taken;
}

/**
 * Tells whether a custom resource definition is ready to serve its kind.
 * @param definition The definition as the API server returns it.
 * @returns True when its Established condition is True.
 */
export function isEstablished(definition: { status?: { conditions?: { type: string; status: string }[] } }): boolean {
  return (definition.status?.conditions ?? []).some((c) => c.type === "Established" && c.status === "True");
}

/** Copy of what Pepr 2.0.3 does in runBinding, without the handler that throws. Created and changed objects only. */
const startWatch: Starter = async (binding, onGiveUp) => {
  const watcher = K8s(binding.model, { kindOverride: binding.kind }).Watch(
    async (object, phase) => {
      if (phase === WatchPhase.Deleted) return;
      await binding.watchCallback?.(object, phase);
    },
    { resyncFailureMax: 5, resyncDelaySec: 5, lastSeenLimitSeconds: 300, relistIntervalSec: 600 },
  );
  watcher.events.on(WatchEvent.GIVE_UP, (error: Error) => {
    Log.warn({ kind: binding.kind.kind, reason: error.message }, "KMO guarded watch gave up");
    onGiveUp();
  });
  await watcher.start();
  return watcher;
};

/** Watches that KMO starts and stops itself, because their kind may be missing. */
export class GuardedWatch {
  #running: Closable[] = [];
  readonly #kind: string;
  readonly #bindings: WatchBinding[];
  readonly #start: Starter;

  /**
   * @param kind The kind that is watched, for the log.
   * @param bindings The bindings taken from Pepr.
   * @param start How one watch is started; replaced in tests.
   */
  constructor(kind: string, bindings: WatchBinding[], start: Starter = startWatch) {
    this.#kind = kind;
    this.#bindings = bindings;
    this.#start = start;
  }

  /** True while the watches run. */
  get running(): boolean {
    return this.#running.length > 0;
  }

  /** Starts the watches unless they already run. */
  async ensureStarted(): Promise<void> {
    if (this.running || this.#bindings.length === 0) return;
    this.#running = await Promise.all(this.#bindings.map((binding) => this.#start(binding, () => this.stop())));
    Log.info({ kind: this.#kind }, "KMO guarded watch started");
  }

  /** Stops the watches. */
  stop(): void {
    if (!this.running) return;
    for (const watcher of this.#running) watcher.close();
    this.#running = [];
    Log.info({ kind: this.#kind }, "KMO guarded watch stopped");
  }
}

/**
 * Makes the watches on a kind run only while its definition is installed. Call it after those watches are declared.
 * @param capability The capability that declared the watches.
 * @param guarded The kind.
 * @param env The process environment.
 * @returns The guarded watch, or undefined when the guard is off and Pepr keeps the watches.
 */
export function guardKind(
  capability: Capability,
  guarded: GuardedKind,
  env: NodeJS.ProcessEnv = process.env,
): GuardedWatch | undefined {
  if (!guardWanted(guarded, env)) return undefined;
  const watch = new GuardedWatch(guarded.kind, takeWatchBindings(capability, guarded.kind));

  capability
    .When(a.CustomResourceDefinition)
    .IsCreatedOrUpdated()
    .WithName(guarded.definition)
    .Watch(async (definition) => {
      if (isEstablished(definition)) await watch.ensureStarted();
    });

  capability
    .When(a.CustomResourceDefinition)
    .IsDeleted()
    .WithName(guarded.definition)
    .Watch(() => watch.stop());

  return watch;
}
```

- [x] **Step 4: Run the tests to see them pass**

Run: `npx vitest run packages/operator/test/guarded-kind.test.ts` Expected: PASS, 10 tests.

- [x] **Step 5: Write the tripwire and the contract tests**

These run against the installed Pepr, with no cluster. They are the tests that fail when a Pepr upgrade breaks the shim.
`vi.hoisted` sets the environment before Pepr is imported, because Pepr reads it once at import.

`packages/operator/test/pepr-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PEPR_WATCH_MODE = "true";
});

import { WatchEvent, WatchPhase } from "kubernetes-fluent-client";
import { Capability, RegisterKind, a, kind } from "pepr";
import { guardKind, takeWatchBindings, type GuardedKind } from "../src/guarded-kind";

/** Versions the shim was last proven against, on the cluster, with `mise run check:rollout-guard`. */
const VERIFIED = { pepr: "2.0.3", "kubernetes-fluent-client": "3.12.3" };

const require = createRequire(import.meta.url);

function installedVersion(name: string): string {
  return JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")).version;
}

class Probe extends kind.GenericKind {}
RegisterKind(Probe, { group: "contract.kmo.isntall.net", version: "v1", kind: "Probe", plural: "probes" });

/** A capability with a watch on Probe between two watches on ConfigMaps. */
function capabilityWithWatches(seen: string[] = []) {
  const capability = new Capability({ name: "contract", description: "contract tests", namespaces: [] });
  capability
    .When(a.ConfigMap)
    .IsCreatedOrUpdated()
    .Watch(() => undefined);
  capability
    .When(Probe)
    .IsCreatedOrUpdated()
    .Watch((probe) => {
      seen.push(probe.metadata?.name ?? "");
    });
  capability
    .When(a.ConfigMap)
    .IsDeleted()
    .Watch(() => undefined);
  return capability;
}

describe("the versions the Rollout shim was verified against", () => {
  it.each(Object.entries(VERIFIED))(
    "%s is still %s; after an upgrade follow docs/upgrading-pepr.md before you change this number",
    (name, version) => {
      expect(installedVersion(name)).toBe(version);
    },
  );
});

describe("what the Rollout shim relies on in Pepr", () => {
  it("lists a declared watch as a binding that names its kind and model", () => {
    const binding = capabilityWithWatches().bindings[1];
    expect(binding).toMatchObject({
      isWatch: true,
      kind: { group: "contract.kmo.isntall.net", version: "v1", kind: "Probe" },
    });
    expect(binding?.model).toBe(Probe);
  });

  it("keeps the declared callback on the binding, callable with an object and a phase", async () => {
    const seen: string[] = [];
    const binding = capabilityWithWatches(seen).bindings[1];
    await binding?.watchCallback?.({ metadata: { name: "one" } }, WatchPhase.Added);
    expect(seen).toEqual(["one"]);
  });

  it("hands out its live list, so a binding that is taken out stays out", () => {
    const capability = capabilityWithWatches();
    const taken = takeWatchBindings(capability, "Probe");
    expect(taken.map((binding) => binding.kind.kind)).toEqual(["Probe"]);
    expect(capability.bindings.map((binding) => binding.kind.kind)).toEqual(["ConfigMap", "ConfigMap"]);
  });

  it("leaves the other bindings as they were", () => {
    const capability = capabilityWithWatches();
    const before = capability.bindings.filter((binding) => binding.kind.kind === "ConfigMap");
    takeWatchBindings(capability, "Probe");
    expect(capability.bindings).toEqual(before);
  });
});

describe("guarding a kind", () => {
  const probe: GuardedKind = {
    kind: "Probe",
    definition: "probes.contract.kmo.isntall.net",
    setting: "GUARD_PROBE",
  };

  it("takes the kind's watch away from Pepr and watches its definition by name instead", () => {
    const capability = capabilityWithWatches();
    guardKind(capability, probe, {});
    expect(capability.bindings.map((binding) => [binding.kind.kind, binding.filters.name])).toEqual([
      ["ConfigMap", ""],
      ["ConfigMap", ""],
      ["CustomResourceDefinition", probe.definition],
      ["CustomResourceDefinition", probe.definition],
    ]);
  });

  it("leaves everything to Pepr when the setting is false", () => {
    const capability = capabilityWithWatches();
    expect(guardKind(capability, probe, { GUARD_PROBE: "false" })).toBeUndefined();
    expect(capability.bindings.map((binding) => binding.kind.kind)).toEqual(["ConfigMap", "Probe", "ConfigMap"]);
  });
});

describe("what the Rollout shim relies on in the client", () => {
  it("names the event it sends when a watch cannot be kept alive", () => {
    expect(WatchEvent.GIVE_UP).toBe("give_up");
  });
});
```

- [x] **Step 6: Run the contract tests**

Run: `npx vitest run packages/operator/test/pepr-contract.test.ts` Expected: PASS, 9 tests. A failure here is a finding,
not a test to weaken: it means the source reading above is wrong for the installed Pepr. Stop and tell the user.

- [x] **Step 7: Declare the Rollout watch through the shim**

Replace `packages/operator/src/capability.ts`:

```ts
import { Capability, Log } from "pepr";
import { guardKind } from "./guarded-kind";
import { ROLLOUT_GUARD, Rollout } from "./kinds";

/** The KMO operator's one capability. */
export const Kmo = new Capability({
  name: "kmo",
  description: "Keeps ConfigMaps and Secrets in step with env files in an object store",
  namespaces: [],
});

const { When, OnSchedule } = Kmo;

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
```

Every watcher start delivers the objects that already exist, so the definition watch also covers the case where Argo
Rollouts was installed before the operator.

Add the Rollout rule to `pepr.rbac` in `packages/operator/package.json`:

```json
      {
        "apiGroups": ["argoproj.io"],
        "resources": ["rollouts"],
        "verbs": ["get", "list", "watch"]
      }
```

- [x] **Step 8: Write the cluster checks as a script**

`test/e2e/rollout-guard.sh` (make it executable with `chmod +x`). It removes Argo Rollouts from the local cluster and
puts it back, so it is for the k3d cluster only.

```bash
#!/usr/bin/env bash
# Proves the guarded Rollout watch on the local cluster. Run it again after every Pepr upgrade.
set -euo pipefail

cd "$(dirname "$0")/../.."
NS=pepr-system
WATCHER=deployment/pepr-kmo-watcher

logs() { kubectl logs -n "$NS" "$WATCHER" --since="$1" 2>/dev/null || true; }
restarts() {
  kubectl get pods -n "$NS" -l pepr.dev/controller=watcher \
    -o jsonpath='{range .items[*]}{.status.containerStatuses[0].restartCount}{"\n"}{end}' | sort -n | tail -1
}
restart_watcher() {
  kubectl rollout restart -n "$NS" "$WATCHER" >/dev/null
  kubectl rollout status -n "$NS" "$WATCHER" --timeout=180s >/dev/null
}
remove_rollouts() {
  kubectl delete -k dev/argo-rollouts --ignore-not-found --wait=true >/dev/null
  kubectl wait --for=delete crd/rollouts.argoproj.io --timeout=120s >/dev/null 2>&1 || true
}
install_rollouts() {
  kubectl apply --server-side -k dev/argo-rollouts >/dev/null
  kubectl wait --for=condition=Established crd/rollouts.argoproj.io --timeout=60s >/dev/null
  kubectl apply -f dev/workloads/checkout.yaml >/dev/null
}
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=1; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
FAILED=0

echo "Check 1: without the Rollout kind the watcher stays up and the schedule ticks"
remove_rollouts
restart_watcher
sleep 150
check "the watcher did not restart" '[ "$(restarts)" = "0" ]'
check "the schedule ticked at least twice" '[ "$(logs 150s | grep -c "KMO tick")" -ge 2 ]'
check "no Rollout watch was started" '! logs 150s | grep -q "KMO guarded watch started"'

echo "Check 2: the watch starts when Argo Rollouts is installed"
install_rollouts
sleep 30
check "the guarded watch started" 'logs 60s | grep -q "KMO guarded watch started"'
# From Task 8 on, the watch asks for a sync instead of logging that it saw the Rollout.
check "the Rollout checkout was seen" 'logs 60s | grep -E "KMO saw rollout|Rollout changed" | grep -q checkout'
check "the watcher did not restart" '[ "$(restarts)" = "0" ]'

echo "Check 3: the watch stops when Argo Rollouts is removed"
remove_rollouts
sleep 90
check "the guarded watch stopped" 'logs 120s | grep -q "KMO guarded watch stopped"'
check "the watcher did not restart" '[ "$(restarts)" = "0" ]'
check "the schedule still ticks" '[ "$(logs 90s | grep -c "KMO tick")" -ge 1 ]'

echo "Check 4: with the setting off, the plain Pepr behavior returns"
kubectl set env -n "$NS" "$WATCHER" KMO_GUARD_ROLLOUT_WATCH=false >/dev/null
kubectl rollout status -n "$NS" "$WATCHER" --timeout=60s >/dev/null 2>&1 || true
sleep 90
check "the watcher gave up on the missing kind" \
  '[ "$(restarts)" -ge 1 ] || logs 120s | grep -q "WatchEvent GiveUp Error"'

echo "Restore: setting on, Argo Rollouts and the sample Rollout back"
kubectl set env -n "$NS" "$WATCHER" KMO_GUARD_ROLLOUT_WATCH=true >/dev/null
install_rollouts
kubectl rollout status -n "$NS" "$WATCHER" --timeout=180s >/dev/null

[ "$FAILED" = "0" ] && echo "All checks passed." || { echo "At least one check failed."; exit 1; }
```

Append to `mise.toml`:

```toml
[tasks."check:rollout-guard"]
description = "Prove the guarded Rollout watch on the local cluster (removes and reinstalls Argo Rollouts)"
run = "test/e2e/rollout-guard.sh"
```

- [x] **Step 9: Write the upgrade procedure**

`docs/upgrading-pepr.md`, and a link to it from the Pages list in `docs/index.md`:

```markdown
# Upgrading Pepr

KMO watches Argo Rollouts through a small shim, so that the operator also runs on clusters without Argo Rollouts. The
shim uses parts of Pepr that are not public. Pepr can change them in any release, so **an upgrade of Pepr might require
the shim to be rewritten**. For that reason Pepr and its Kubernetes client are pinned to exact versions, and an upgrade
is never a change of one number.

## Procedure

1. Change the versions of `pepr` and `kubernetes-fluent-client` in `packages/operator/package.json`. The client version
   must be the one that the new Pepr uses.
2. Run `mise run test`. The test "the versions the Rollout shim was verified against" fails. That is expected: it is
   the reminder to do the next steps.
3. Look at the other tests in `packages/operator/test/pepr-contract.test.ts`. Each states one thing the shim relies on.
   If one fails, the shim must be changed before you continue.
4. Run `mise run operator:deploy`, then `mise run check:rollout-guard`. The script removes and reinstalls Argo Rollouts
   on the local cluster and takes about seven minutes.
5. Only when the contract tests and all four cluster checks pass, change the versions in the `VERIFIED` constant of the
   contract test file.

## When a check fails

Set `KMO_GUARD_ROLLOUT_WATCH` to `false` to run without the shim. Argo Rollouts must then be installed before the
operator starts. Then read `packages/operator/src/guarded-kind.ts` next to the new Pepr source: the file names the
Pepr code it copies. Rewrite the shim, add a contract test for what it now relies on, and run the procedure again.
```

- [x] **Step 10: Deploy and run the cluster checks**

Run: `mise run lint && mise run test` Expected: clean; the 19 new tests pass.

Run: `mise run operator:deploy && mise run check:rollout-guard` Expected: ten `PASS` lines and `All checks passed.` The
run takes about seven minutes.

**If a check fails: stop.** Show the user the failing line and the watcher log around it (`mise run operator:logs`). Do
not adjust the script to make it pass and do not start Task 3. The design is revisited with the user.

- [x] **Step 11: After (show, then pause)**

Show the user the script output, and the two test files as a description of the guard
(`npx vitest run packages/operator --reporter=verbose`). Say again, in plain words, that a Pepr upgrade might require
the shim to be rewritten, and that the tripwire test, the contract tests and the script are what make that visible.
Update `CLAUDE.md`: the guarded Rollout watch is now proven, not only decided. Pause for questions.

- [x] **Step 12: Commit (waits for the user)**

```bash
npm run format
git add packages/operator test/e2e mise.toml docs CLAUDE.md
git commit -m "feat: guard the Rollout watch against a missing kind"
```



### Task 3: The custom resources

**Before (explain to the user):** A **CustomResourceDefinition** teaches the API server a new kind. After it is
installed, `kubectl` can create, list and validate resources of that kind exactly like built-in ones, and the API server
stores them, but nothing acts on them: a resource is only a record until a controller reads it. This task installs the
three KMO kinds. Three ideas are new. The **OpenAPI schema** in a definition lets the API server refuse a malformed
resource before anything else sees it. The **status subresource** splits a resource in two halves: `spec`, what the user
wants, written by the user; and `status`, what is true now, written by the controller. And **scope**: ConfigSync and
ConfigStore live in a namespace, ClusterConfigStore does not.

**Files:**

- Create: `crds/configsync.yaml`, `crds/configstore.yaml`, `crds/clusterconfigstore.yaml`, `dev/kmo/namespace.yaml`,
  `dev/kmo/default-store.yaml`, `dev/workloads/configsyncs.yaml`
- Modify: `dev/kustomization.yaml`, `dev/README.md`, `mise.toml`, `docs/getting-started.md`, `README.md`, `CLAUDE.md`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: the kinds `ConfigSync` (plural `configsyncs`, short name `csync`), `ConfigStore` (`configstores`, `cstore`)
  and `ClusterConfigStore` (`clusterconfigstores`, `ccstore`) in `kmo.isntall.net/v1alpha1`; the ClusterConfigStore
  `default`; the Secret `kmo-config-credentials` in `kmo-system` with the keys `accessKeyId` and `secretAccessKey`; five
  ConfigSyncs in `shop`. The `deploy` and `operator:deploy` tasks apply `crds/` first.

- [x] **Step 1: Write the ConfigSync definition**

`crds/configsync.yaml`:

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: configsyncs.kmo.isntall.net
spec:
  group: kmo.isntall.net
  scope: Namespaced
  names:
    kind: ConfigSync
    listKind: ConfigSyncList
    plural: configsyncs
    singular: configsync
    shortNames: [csync]
  versions:
    - name: v1alpha1
      served: true
      storage: true
      subresources:
        status: {}
      additionalPrinterColumns:
        - name: Ready
          type: string
          jsonPath: .status.conditions[?(@.type=="Ready")].status
        - name: Suspended
          type: boolean
          jsonPath: .spec.suspend
        - name: Stores
          type: string
          jsonPath: .status.stores
        - name: Last sync
          type: date
          jsonPath: .status.lastSyncTime
        - name: Age
          type: date
          jsonPath: .metadata.creationTimestamp
      schema:
        openAPIV3Schema:
          type: object
          description: Keeps one ConfigMap and one Secret in step with env files in a store.
          properties:
            spec:
              type: object
              properties:
                suspend:
                  type: boolean
                  description: Pauses all syncing and restarts for this resource.
                targets:
                  type: array
                  description:
                    Workloads in this namespace that receive the config hash. Default, one Deployment named after this
                    resource.
                  items:
                    type: object
                    required: [name]
                    properties:
                      kind:
                        type: string
                        enum: [Deployment, StatefulSet, DaemonSet, CronJob, Rollout]
                      name:
                        type: string
                        minLength: 1
                sources:
                  type: array
                  description:
                    The stores to read from, in order. A later source wins over an earlier one. Default, the store named
                    default.
                  maxItems: 8
                  items:
                    type: object
                    required: [storeRef]
                    properties:
                      storeRef:
                        type: object
                        description: The store to read from.
                        required: [name]
                        properties:
                          kind:
                            type: string
                            enum: [ConfigStore, ClusterConfigStore]
                          name:
                            type: string
                            minLength: 1
                      common:
                        type: boolean
                        description: Set to false to leave out the common files of this store. Default, true.
                output:
                  type: object
                  description: Names of the two objects that are written. Default, this resource's name plus -kmo.
                  properties:
                    configMapName: { type: string, minLength: 1, maxLength: 253 }
                    secretName: { type: string, minLength: 1, maxLength: 253 }
                refreshInterval:
                  type: string
                  description: How often to sync without an event, such as 30m or 1h30m. At least one minute.
                  pattern: ^(\d+h)?(\d+m)?(\d+s)?$
                  minLength: 2
            status:
              type: object
              properties:
                observedGeneration: { type: integer, format: int64 }
                lastHandledSyncRequest: { type: string }
                lastSyncTime: { type: string, format: date-time }
                configHash: { type: string }
                stores:
                  type: array
                  items: { type: string }
                sources:
                  type: array
                  items:
                    type: object
                    required: [store, key, found]
                    properties:
                      store: { type: string }
                      key: { type: string }
                      found: { type: boolean }
                      versionId: { type: string }
                conditions:
                  type: array
                  x-kubernetes-list-type: map
                  x-kubernetes-list-map-keys: [type]
                  items:
                    type: object
                    required: [type, status, reason, message, lastTransitionTime]
                    properties:
                      type: { type: string }
                      status: { type: string, enum: ["True", "False", "Unknown"] }
                      reason: { type: string }
                      message: { type: string }
                      lastTransitionTime: { type: string, format: date-time }
                      observedGeneration: { type: integer, format: int64 }
```

- [x] **Step 2: Write the two store definitions**

`crds/configstore.yaml`:

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: configstores.kmo.isntall.net
spec:
  group: kmo.isntall.net
  scope: Namespaced
  names:
    kind: ConfigStore
    listKind: ConfigStoreList
    plural: configstores
    singular: configstore
    shortNames: [cstore]
  versions:
    - name: v1alpha1
      served: true
      storage: true
      subresources:
        status: {}
      additionalPrinterColumns:
        - name: Bucket
          type: string
          jsonPath: .spec.s3.bucket
        - name: Prefix
          type: string
          jsonPath: .spec.s3.keyPrefix
        - name: Ready
          type: string
          jsonPath: .status.conditions[?(@.type=="Ready")].status
        - name: Age
          type: date
          jsonPath: .metadata.creationTimestamp
      schema:
        openAPIV3Schema:
          type: object
          description: One location in a bucket, for the ConfigSyncs of its own namespace.
          required: [spec]
          properties:
            spec:
              type: object
              required: [s3]
              properties:
                s3:
                  type: object
                  description:
                    Where the files are, for a store that is an S3-compatible bucket, and the identity to reach it.
                  required: [bucket, region]
                  oneOf:
                    - required: [serviceAccountRef]
                    - required: [credentialsSecretRef]
                  properties:
                    bucket: { type: string, minLength: 1 }
                    keyPrefix: { type: string }
                    region: { type: string, minLength: 1 }
                    endpoint: { type: string }
                    addressingStyle:
                      type: string
                      enum: [VirtualHosted, Path]
                    serviceFolder:
                      type: string
                      description: Folder of one service's files, under the key prefix. Default, {namespace}/{name}.
                      pattern: ^[A-Za-z0-9_{}-]+(/[A-Za-z0-9_{}-]+)*$
                    commonFolder:
                      type: string
                      description: Folder of the files shared by every service, under the key prefix. Default, _common.
                      pattern: ^[A-Za-z0-9_{}-]+(/[A-Za-z0-9_{}-]+)*$
                    serviceAccountRef:
                      type: object
                      description: A ServiceAccount in this namespace whose token AWS exchanges for short-lived keys.
                      required: [name]
                      properties:
                        name: { type: string, minLength: 1 }
                    credentialsSecretRef:
                      type: object
                      description:
                        A Secret in this namespace with the keys accessKeyId and secretAccessKey. Not for AWS.
                      required: [name]
                      properties:
                        name: { type: string, minLength: 1 }
            status:
              type: object
              properties:
                conditions:
                  type: array
                  x-kubernetes-list-type: map
                  x-kubernetes-list-map-keys: [type]
                  items:
                    type: object
                    required: [type, status, reason, message, lastTransitionTime]
                    properties:
                      type: { type: string }
                      status: { type: string, enum: ["True", "False", "Unknown"] }
                      reason: { type: string }
                      message: { type: string }
                      lastTransitionTime: { type: string, format: date-time }
                      observedGeneration: { type: integer, format: int64 }
```

`crds/clusterconfigstore.yaml` is the same with these differences: the name is `clusterconfigstores.kmo.isntall.net`,
`scope` is `Cluster`, the names are `ClusterConfigStore`, `ClusterConfigStoreList`, `clusterconfigstores`,
`clusterconfigstore` and `[ccstore]`, the description is "One location in a bucket, offered to the namespaces it
lists.", and the `spec` schema is:

```yaml
            spec:
              type: object
              required: [s3, allowedNamespaces]
              properties:
                s3:
                  type: object
                  description:
                    Where the files are, for a store that is an S3-compatible bucket, and the identity to reach it.
                  required: [bucket, region]
                  oneOf:
                    - required: [serviceAccountRef]
                    - required: [credentialsSecretRef]
                  x-kubernetes-validations:
                    - rule: "!has(self.serviceFolder) || self.serviceFolder.contains('{namespace}')"
                      message: serviceFolder must contain {namespace}, so that no namespace reads the files of another
                  properties:
                    bucket: { type: string, minLength: 1 }
                    keyPrefix: { type: string }
                    region: { type: string, minLength: 1 }
                    endpoint: { type: string }
                    addressingStyle:
                      type: string
                      enum: [VirtualHosted, Path]
                    serviceFolder:
                      type: string
                      description: Folder of one service's files, under the key prefix. Default, {namespace}/{name}.
                      pattern: ^[A-Za-z0-9_{}-]+(/[A-Za-z0-9_{}-]+)*$
                    commonFolder:
                      type: string
                      description: Folder of the files shared by every service, under the key prefix. Default, _common.
                      pattern: ^[A-Za-z0-9_{}-]+(/[A-Za-z0-9_{}-]+)*$
                    serviceAccountRef:
                      type: object
                      description: A ServiceAccount whose token AWS exchanges for short-lived keys, and its namespace.
                      required: [name, namespace]
                      properties:
                        name: { type: string, minLength: 1 }
                        namespace: { type: string, minLength: 1 }
                    credentialsSecretRef:
                      type: object
                      description:
                        A Secret with the keys accessKeyId and secretAccessKey, and its namespace. Not for AWS.
                      required: [name, namespace]
                      properties:
                        name: { type: string, minLength: 1 }
                        namespace: { type: string, minLength: 1 }
                allowedNamespaces:
                  type: array
                  description: The namespaces that may use this store. The single entry * allows all.
                  minItems: 1
                  items: { type: string, minLength: 1 }
```

Write the file out in full; do not use YAML anchors across files.

- [x] **Step 3: Install them and look**

Run:

```bash
kubectl apply -f crds/
kubectl wait --for=condition=Established --timeout=30s \
  crd/configsyncs.kmo.isntall.net crd/configstores.kmo.isntall.net crd/clusterconfigstores.kmo.isntall.net
kubectl api-resources --api-group=kmo.isntall.net
kubectl explain configsync.spec
```

Expected: three kinds listed with their short names and scope, and `kubectl explain` prints the descriptions from the
schema.

- [x] **Step 4: See the schema refuse bad resources**

Run each and note the message the API server gives:

```bash
kubectl apply --dry-run=server -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: bad-kind, namespace: shop }
spec: { targets: [{ kind: Pod, name: x }] }
EOF
kubectl apply --dry-run=server -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: bad-interval, namespace: shop }
spec: { refreshInterval: often }
EOF
kubectl apply --dry-run=server -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ClusterConfigStore
metadata: { name: no-namespaces }
spec: { s3: { bucket: b, region: r, credentialsSecretRef: { name: s, namespace: kmo-system } } }
EOF
kubectl apply --dry-run=server -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigStore
metadata: { name: no-identity, namespace: shop }
spec: { s3: { bucket: b, region: r } }
EOF
kubectl apply --dry-run=server -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigStore
metadata: { name: two-identities, namespace: shop }
spec: { s3: { bucket: b, region: r, serviceAccountRef: { name: a }, credentialsSecretRef: { name: s } } }
EOF
kubectl apply --dry-run=server -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ClusterConfigStore
metadata: { name: shared-folder }
spec:
  s3: { bucket: b, region: r, serviceFolder: "apps/{name}", credentialsSecretRef: { name: s, namespace: kmo-system } }
  allowedNamespaces: ["*"]
EOF
kubectl apply --dry-run=server -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: all-defaults, namespace: shop }
EOF
```

Expected: the first three are refused (`Unsupported value: "Pod"`, a pattern mismatch for `often`,
`spec.allowedNamespaces: Required value`). The next two are refused too: a store must name exactly one identity, a
ServiceAccount or a credentials Secret. The sixth is refused by a **CEL validation rule**, a rule in the definition that
the API server checks and that a plain schema cannot express: the service folder of a cluster-wide store must contain
`{namespace}`, so that no namespace reads the files of another. The last is accepted: every field of a ConfigSync is
optional.

A store has two ways to prove who is asking. `serviceAccountRef` is the way for AWS and stores no key; it is built in
Task 11. `credentialsSecretRef` is for stores that cannot do that, and the local RustFS is one, so every local store in
this plan uses it.

- [x] **Step 5: Add the default store and the ConfigSyncs to the local environment**

`dev/kmo/namespace.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: kmo-system
```

`dev/kmo/default-store.yaml`. The Secret holds the local store's root keys; they are not secret.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: kmo-config-credentials
  namespace: kmo-system
stringData:
  accessKeyId: kmoadmin
  secretAccessKey: kmo-local-secret
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ClusterConfigStore
metadata:
  name: default
spec:
  s3:
    bucket: kmo-config
    region: us-east-1
    endpoint: http://rustfs.kmo-dev.svc:9000
    addressingStyle: Path
    credentialsSecretRef:
      name: kmo-config-credentials
      namespace: kmo-system
  allowedNamespaces: ["*"]
```

`dev/workloads/configsyncs.yaml`. The first uses every default; the others name only the kind of their target. None lists
sources, so each reads from the store named `default`.

```yaml
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata:
  name: orders-api
  namespace: shop
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata:
  name: inventory
  namespace: shop
spec:
  targets:
    - kind: StatefulSet
      name: inventory
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata:
  name: node-agent
  namespace: shop
spec:
  targets:
    - kind: DaemonSet
      name: node-agent
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata:
  name: nightly-report
  namespace: shop
spec:
  targets:
    - kind: CronJob
      name: nightly-report
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata:
  name: checkout
  namespace: shop
spec:
  targets:
    - kind: Rollout
      name: checkout
```

In `dev/kustomization.yaml`, add to `resources`:

```yaml
  - kmo/namespace.yaml
  - kmo/default-store.yaml
  - workloads/configsyncs.yaml
```

In `mise.toml`, make both tasks install the definitions first. In `tasks.deploy`, insert as the first two entries of
`run`:

```toml
  "kubectl apply -f crds/",
  "kubectl wait --for=condition=Established --timeout=60s crd/configsyncs.kmo.isntall.net crd/configstores.kmo.isntall.net crd/clusterconfigstores.kmo.isntall.net",
```

In `tasks."operator:deploy"`, insert as the first entry of `run`:

```toml
  "kubectl apply -f {{config_root}}/crds/",
```

Update `dev/README.md`: add a line for `kmo/` (the `kmo-system` namespace, and the cluster-wide store `default` with its
credentials) and extend the `workloads/` line (it now also holds a ConfigSync for each workload).

- [x] **Step 6: After (show, then pause)**

Run: `mise run deploy`, then show the user:

```bash
kubectl get clusterconfigstore
kubectl get configsync -n shop
kubectl get csync orders-api -n shop -o yaml
```

Expected: the store `default` with its bucket, five ConfigSyncs whose `Ready`, `Store` and `Last sync` columns are
empty, and a resource with no `status`. Point out the empty columns: nothing reads these resources yet. Update
`docs/getting-started.md` (the three kinds exist; nothing acts on them yet), `README.md` (layout: `crds/`) and
`CLAUDE.md` (step 5 done; `crds/` exists). Pause for questions.

- [x] **Step 7: Commit (waits for the user)**

```bash
npm run format
git add crds dev mise.toml docs README.md CLAUDE.md
git commit -m "feat: add the ConfigSync and store definitions"
```



### Task 4: Syncing: read the store

**Before (explain to the user):** **Reconcile** is the operator's basic move: look at one resource, look at the world,
and act until the two agree. Pepr calls our reconcile function for each ConfigSync when it is created or changed, one at
a time for the same resource. This task does the first half of a reconcile: find the store of each source, read its credentials from a
Secret, and fetch its files. It writes nothing yet; it logs what it found. The operator now needs more permissions,
and each one is added by hand: to read ConfigSyncs and stores, and to read Secrets. Reading Secrets in every namespace
is a strong permission. The operator needs it because a credentials Secret can be in any namespace, and it is the reason
the operator is the only component that gets it.

A risk to name: Pepr stores the built module in a Kubernetes Secret, which is limited to 1 MiB. The AWS SDK is large. If
the build or the deploy reports that the module is too large, stop and tell the user; the fallback is a small request
signer in place of the SDK, and that is a design choice for the user.

**Files:**

- Create: `packages/core/src/plan.ts`, `packages/core/test/plan.test.ts`, `packages/operator/src/cluster.ts`,
  `packages/operator/src/s3.ts`, `packages/operator/src/reconcile.ts`, `packages/operator/test/s3.test.ts`,
  `packages/operator/test/cluster.test.ts`
- Modify: `packages/core/src/types.ts`, `packages/core/src/index.ts`, `packages/operator/src/kinds.ts`,
  `packages/operator/src/capability.ts`, `packages/operator/package.json`

**Interfaces:**

- Consumes: `resolveConfigSync`, `findStore`, `storeKeys`, `storeLabel`, `buildOutputs`, `SourceParseError` from
  `@kmo/core`; the kinds and the store from Task 3.
- Produces, from `@kmo/core`:
  - `type FailureReason = "InvalidSpec" | "StoreNotFound" | "CredentialsMissing" | "StoreUnreachable" | "SourceUnparsable" | "OutputTaken" | "InternalError"`
  - `interface Failure { reason: FailureReason; message: string }`
  - `interface PlannedSource { store: Store; keys: Partial<Record<SourceName, string>> }`
  - `type SyncPlan = { ok: true; sync: ResolvedConfigSync; sources: PlannedSource[] } | ({ ok: false } & Failure)`
  - `planSync(sync: ConfigSync, stores: Store[]): SyncPlan`
  - `interface SourceStatus { store: string; key: string; found: boolean; versionId?: string }`
- Produces, from `packages/operator/src/kinds.ts`: `ConfigSyncKind`, `ConfigStoreKind`, `ClusterConfigStoreKind`,
  `toCore(sync: ConfigSyncKind): ConfigSync`.
- Produces, from `packages/operator/src/cluster.ts`: `getOrUndefined`, `listStores(): Promise<Store[]>`,
  `credentialsFrom(data, where): StoreCredentials`, `readCredentials(store: Store): Promise<StoreCredentials>`,
  `class SyncFailure extends Error` with `readonly reason: FailureReason`.
- Produces, from `packages/operator/src/s3.ts`: `type GetObject`,
  `interface FetchedSources { texts: SourceTexts; sources: SourceStatus[] }`,
  `fetchSources(get: GetObject, store: string, bucket: string, keys: Partial<Record<SourceName, string>>): Promise<FetchedSources>`
  (the files of one source; `store` is the store's label),
  `s3GetObject(store: Store, credentials: StoreCredentials): GetObject`.
- Produces, from `packages/operator/src/reconcile.ts`: `reconcile(sync: ConfigSyncKind): Promise<void>`, and
  `readSources(planned: PlannedSource[]): Promise<{ inputs: SourceInput[]; sources: SourceStatus[] }>`, which reads the
  files of every source in order.

- [x] **Step 1: Write the failing test for the plan**

`packages/core/test/plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planSync } from "../src/plan";
import type { ConfigSync, S3Location, Store } from "../src/types";

const sync = (spec: ConfigSync["spec"] = {}): ConfigSync => ({
  metadata: { name: "orders-api", namespace: "shop" },
  spec,
});

const clusterStore = (name = "default", s3: Partial<S3Location> = {}, allowedNamespaces = ["*"]): Store => ({
  kind: "ClusterConfigStore",
  metadata: { name },
  spec: {
    s3: {
      bucket: "kmo-config",
      region: "us-east-1",
      credentialsSecretRef: { name: "creds", namespace: "kmo-system" },
      ...s3,
    },
    allowedNamespaces,
  },
});

describe("the plan for a sync", () => {
  it("names the store and the full key of each of the four files", () => {
    const plan = planSync(sync(), [clusterStore("default", { keyPrefix: "prod/" })]);
    expect(plan).toMatchObject({
      ok: true,
      sources: [
        {
          store: { metadata: { name: "default" } },
          keys: {
            config: "prod/shop/orders-api/config.env",
            secrets: "prod/shop/orders-api/secrets.env",
            commonConfig: "prod/_common/config.env",
            commonSecrets: "prod/_common/secrets.env",
          },
        },
      ],
    });
  });

  it("lists the sources in the order of the spec, without the common files where a source turns them off", () => {
    const company = { kind: "ClusterConfigStore", name: "company" } as const;
    const overlay = { kind: "ClusterConfigStore", name: "overlay" } as const;
    const plan = planSync(sync({ sources: [{ storeRef: company }, { storeRef: overlay, common: false }] }), [
      clusterStore("overlay", { bucket: "overlay-bucket" }),
      clusterStore("company"),
    ]);
    expect(plan).toMatchObject({
      ok: true,
      sources: [
        { store: { metadata: { name: "company" } }, keys: { commonConfig: "_common/config.env" } },
        {
          store: { metadata: { name: "overlay" } },
          keys: { config: "shop/orders-api/config.env", secrets: "shop/orders-api/secrets.env" },
        },
      ],
    });
    expect(plan.ok && plan.sources[1]?.keys).not.toHaveProperty("commonConfig");
  });

  it("fails when no store can be found", () => {
    expect(planSync(sync(), [])).toMatchObject({ ok: false, reason: "StoreNotFound" });
  });

  it("fails as a whole when one store of several cannot be found", () => {
    const sources = [
      { storeRef: { kind: "ClusterConfigStore", name: "default" } as const },
      { storeRef: { name: "gone" } },
    ];
    expect(planSync(sync({ sources }), [clusterStore()])).toMatchObject({
      ok: false,
      reason: "StoreNotFound",
      message: 'ConfigStore "gone" was not found in namespace "shop"',
    });
  });

  it("fails when the store does not allow the namespace", () => {
    const plan = planSync(sync({ sources: [{ storeRef: { kind: "ClusterConfigStore", name: "default" } }] }), [
      clusterStore("default", {}, ["billing"]),
    ]);
    expect(plan).toMatchObject({ ok: false, reason: "StoreNotFound" });
  });

  it("fails with the reason when the spec cannot be used", () => {
    const plan = planSync(sync({ refreshInterval: "30s" }), [clusterStore()]);
    expect(plan).toMatchObject({
      ok: false,
      reason: "InvalidSpec",
      message: "the refresh interval must be at least one minute",
    });
  });
});
```

- [x] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/core/test/plan.test.ts` Expected: FAIL, the module `../src/plan` does not exist.

- [x] **Step 3: Write the plan**

`packages/core/src/types.ts` already holds the shapes of the two resources: `ConfigSyncSpec` with its ordered `sources`,
and `StoreSpec` with its `s3` block (`S3Location`), which carries the location, the two folders and the identity. Append
to that file:

```ts
/** Why a reconcile stopped without writing anything. */
export type FailureReason =
  | "InvalidSpec"
  | "StoreNotFound"
  | "CredentialsMissing"
  | "StoreUnreachable"
  | "SourceUnparsable"
  | "OutputTaken"
  | "InternalError";

/** A failed reconcile: a reason for machines and a message for people. */
export interface Failure {
  /** The reason, for machines. */
  reason: FailureReason;
  /** What went wrong, for people; never a value. */
  message: string;
}

/** One source file as recorded in a ConfigSync's status. */
export interface SourceStatus {
  /** The store it was read from, such as ClusterConfigStore/default. */
  store: string;
  /** Full key in the bucket. */
  key: string;
  /** Whether the file exists. */
  found: boolean;
  /** Version of the file that was read, when the bucket keeps versions. */
  versionId?: string;
}
```

`planSync` asks `findStore` for the store of each source and `storeKeys` for the files that store holds for the
ConfigSync. A store that cannot be found fails the whole plan.

`packages/core/src/plan.ts`:

```ts
import { ConfigSyncSpecError, resolveConfigSync, type ResolvedConfigSync } from "./defaults";
import { findStore, storeKeys } from "./store";
import type { ConfigSync, Failure, SourceName, Store } from "./types";

/** One source of a ConfigSync, ready to be read. */
export interface PlannedSource {
  /** The store to read from. */
  store: Store;
  /** The full key in the bucket of each file to read. */
  keys: Partial<Record<SourceName, string>>;
}

/** What a reconcile must read, or why it cannot start. */
export type SyncPlan = { ok: true; sync: ResolvedConfigSync; sources: PlannedSource[] } | ({ ok: false } & Failure);

/**
 * Works out what a ConfigSync reads and from where.
 * @param sync The resource as stored in the cluster.
 * @param stores Every ConfigStore and ClusterConfigStore in the cluster.
 * @returns The resolved resource and its sources in order, each with its store and keys, or the failure.
 */
export function planSync(sync: ConfigSync, stores: Store[]): SyncPlan {
  let resolved: ResolvedConfigSync;
  try {
    resolved = resolveConfigSync(sync);
  } catch (error) {
    if (error instanceof ConfigSyncSpecError) return { ok: false, reason: "InvalidSpec", message: error.message };
    throw error;
  }

  const sources: PlannedSource[] = [];
  for (const source of resolved.sources) {
    const lookup = findStore(resolved.namespace, source.storeRef, stores);
    if (!lookup.ok) return { ok: false, reason: "StoreNotFound", message: lookup.reason };
    const keys = storeKeys(lookup.store, resolved.namespace, resolved.name, source.common);
    sources.push({ store: lookup.store, keys });
  }
  return { ok: true, sync: resolved, sources };
}
```

Add `export * from "./plan";` to `packages/core/src/index.ts`.

Run: `npx vitest run packages/core/test/plan.test.ts` Expected: PASS, 6 tests.

- [x] **Step 4: Write the failing tests for fetching and for credentials**

`packages/operator/test/s3.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SyncFailure } from "../src/cluster";
import { fetchSources, type GetObject } from "../src/s3";

const keys = {
  config: "shop/orders-api/config.env",
  secrets: "shop/orders-api/secrets.env",
  commonConfig: "_common/config.env",
  commonSecrets: "_common/secrets.env",
};

const store = "ClusterConfigStore/default";

/** A bucket held in memory. */
function bucketWith(files: Record<string, string>): GetObject {
  return async (_bucket, key) => (key in files ? { text: files[key] ?? "", versionId: `v-${key}` } : undefined);
}

describe("fetching the source files", () => {
  it("returns the text and the version of each file that exists", async () => {
    const fetched = await fetchSources(bucketWith({ [keys.config]: "A=1" }), store, "kmo-config", keys);
    expect(fetched.texts).toEqual({ config: "A=1" });
    expect(fetched.sources).toContainEqual({ store, key: keys.config, found: true, versionId: `v-${keys.config}` });
  });

  it("records a missing file as not found and goes on", async () => {
    const fetched = await fetchSources(bucketWith({}), store, "kmo-config", keys);
    expect(fetched.texts).toEqual({});
    expect(fetched.sources).toHaveLength(4);
    expect(fetched.sources.every((source) => !source.found)).toBe(true);
  });

  it("asks only for the files it is given, so a source without common files reads two", async () => {
    const asked: string[] = [];
    const get: GetObject = async (_bucket, key) => void asked.push(key);
    const fetched = await fetchSources(get, store, "kmo-config", { config: keys.config, secrets: keys.secrets });
    expect(asked.sort()).toEqual([keys.config, keys.secrets]);
    expect(fetched.sources).toHaveLength(2);
  });

  it("fails as a whole when one file cannot be read, and names the key", async () => {
    const get: GetObject = async (_bucket, key) => {
      if (key === keys.secrets)
        throw Object.assign(new Error("denied by secret-access-key-123"), { name: "AccessDenied" });
      return { text: "A=1" };
    };
    const failure = await fetchSources(get, store, "kmo-config", keys).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SyncFailure);
    expect((failure as SyncFailure).reason).toBe("StoreUnreachable");
    expect((failure as SyncFailure).message).toBe(
      'could not read "shop/orders-api/secrets.env" from bucket "kmo-config": AccessDenied',
    );
  });
});
```

`packages/operator/test/cluster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SyncFailure, credentialsFrom } from "../src/cluster";

const base64 = (text: string) => Buffer.from(text).toString("base64");

describe("store credentials", () => {
  it("are read from the two keys of the Secret", () => {
    const data = { accessKeyId: base64("kmoadmin"), secretAccessKey: base64("s3cret") };
    expect(credentialsFrom(data, "Secret kmo-system/creds")).toEqual({ accessKeyId: "kmoadmin", secretAccessKey: "s3cret" });
  });

  it("are refused when a key is missing, naming the key and never a value", () => {
    const attempt = () => credentialsFrom({ accessKeyId: base64("kmoadmin") }, "Secret kmo-system/creds");
    expect(attempt).toThrow(SyncFailure);
    expect(attempt).toThrow('Secret kmo-system/creds has no key "secretAccessKey"');
  });
});
```

Run: `npx vitest run packages/operator/test/s3.test.ts packages/operator/test/cluster.test.ts` Expected: FAIL, the
modules do not exist.

- [x] **Step 5: Write the kinds, the cluster reads and the store reads**

Run: `npm install --save-exact --workspace packages/operator @aws-sdk/client-s3@3.1149.0`

Append to `packages/operator/src/kinds.ts`:

```ts
import type { ConfigSyncSpec, ConfigSyncStatus, StoreSpec } from "@kmo/core";

/** A ConfigSync as the client returns it. */
export class ConfigSyncKind extends kind.GenericKind {
  spec?: ConfigSyncSpec;
  status?: ConfigSyncStatus;
}
RegisterKind(ConfigSyncKind, { group: "kmo.isntall.net", version: "v1alpha1", kind: "ConfigSync", plural: "configsyncs" });

/** A ConfigStore as the client returns it. */
export class ConfigStoreKind extends kind.GenericKind {
  spec?: StoreSpec;
  status?: { conditions?: unknown[] };
}
RegisterKind(ConfigStoreKind, { group: "kmo.isntall.net", version: "v1alpha1", kind: "ConfigStore", plural: "configstores" });

/** A ClusterConfigStore as the client returns it. */
export class ClusterConfigStoreKind extends kind.GenericKind {
  spec?: StoreSpec;
  status?: { conditions?: unknown[] };
}
RegisterKind(ClusterConfigStoreKind, {
  group: "kmo.isntall.net",
  version: "v1alpha1",
  kind: "ClusterConfigStore",
  plural: "clusterconfigstores",
});
```

Also append the function that turns the client's object into the shape core reads:

```ts
/**
 * Reduces a ConfigSync from the cluster to what the core logic reads.
 * @param sync The resource as the client returns it.
 * @returns The same resource with a name and a namespace that are known to be set.
 */
export function toCore(sync: ConfigSyncKind): ConfigSync {
  return {
    metadata: { name: sync.metadata?.name ?? "", namespace: sync.metadata?.namespace ?? "" },
    spec: sync.spec,
  };
}
```

Move the new `import type` line to the top of the file and add `ConfigSync` to it. `ConfigSyncStatus` arrives in Task 7;
until then add this to `packages/core/src/types.ts`, which Task 7 replaces:

```ts
/** The status of a ConfigSync. */
export interface ConfigSyncStatus {
  observedGeneration?: number;
}
```

`packages/operator/src/cluster.ts`:

```ts
import type { FailureReason, Store } from "@kmo/core";
import type { GenericClass } from "kubernetes-fluent-client";
import { K8s, a } from "pepr";
import { ClusterConfigStoreKind, ConfigStoreKind } from "./kinds";

/** The keys to one store. */
export interface StoreCredentials {
  /** The public half of the key pair. */
  accessKeyId: string;
  /** The secret half of the key pair. */
  secretAccessKey: string;
}

/** Raised when a reconcile must stop without writing anything. */
export class SyncFailure extends Error {
  /**
   * @param reason The machine-readable reason.
   * @param message What went wrong, without any value from a file or a credential.
   */
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
    this.name = "SyncFailure";
  }
}

/**
 * Gets one object, treating "not found" as an answer.
 * @param model The kind to read.
 * @param name The object's name.
 * @param namespace Its namespace, for namespaced kinds.
 * @returns The object, or undefined when it or its kind does not exist.
 */
export async function getOrUndefined<T extends GenericClass>(
  model: T,
  name: string,
  namespace?: string,
): Promise<InstanceType<T> | undefined> {
  try {
    const client = namespace ? K8s(model).InNamespace(namespace) : K8s(model);
    return (await client.Get(name)) as InstanceType<T>;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined;
    throw error;
  }
}

/**
 * Lists every store in the cluster.
 * @returns Namespace stores and cluster-wide stores, in the shape the core logic reads.
 */
export async function listStores(): Promise<Store[]> {
  const [own, clusterWide] = await Promise.all([K8s(ConfigStoreKind).Get(), K8s(ClusterConfigStoreKind).Get()]);
  const usable = (item: ConfigStoreKind | ClusterConfigStoreKind) => item.spec !== undefined && item.metadata?.name;
  return [
    ...own.items.filter(usable).map((item): Store => ({
      kind: "ConfigStore",
      metadata: { name: item.metadata!.name!, namespace: item.metadata!.namespace },
      spec: item.spec!,
    })),
    ...clusterWide.items.filter(usable).map((item): Store => ({
      kind: "ClusterConfigStore",
      metadata: { name: item.metadata!.name! },
      spec: item.spec!,
    })),
  ];
}

/**
 * Reads a store's keys out of the data of its credentials Secret.
 * @param data The Secret's data, base64-encoded as the API server returns it.
 * @param where A name for the Secret, used in the error.
 * @returns The decoded keys.
 * @throws SyncFailure with reason CredentialsMissing when a key is absent or empty.
 */
export function credentialsFrom(data: Record<string, string> | undefined, where: string): StoreCredentials {
  const read = (key: keyof StoreCredentials) => {
    const value = Buffer.from(data?.[key] ?? "", "base64").toString("utf8");
    if (value === "") throw new SyncFailure("CredentialsMissing", `${where} has no key "${key}"`);
    return value;
  };
  return { accessKeyId: read("accessKeyId"), secretAccessKey: read("secretAccessKey") };
}

/**
 * Reads the credentials Secret of a store.
 * @param store The store.
 * @returns Its keys.
 * @throws SyncFailure with reason CredentialsMissing when the Secret or one of its keys is absent.
 */
export async function readCredentials(store: Store): Promise<StoreCredentials> {
  const ref = store.spec.s3.credentialsSecretRef;
  if (!ref) throw new SyncFailure("CredentialsMissing", "the store names no credentials Secret");
  const namespace = store.kind === "ConfigStore" ? store.metadata.namespace : ref.namespace;
  const where = `Secret ${namespace}/${ref.name}`;
  const secret = namespace ? await getOrUndefined(a.Secret, ref.name, namespace) : undefined;
  if (!secret) throw new SyncFailure("CredentialsMissing", `${where} was not found`);
  return credentialsFrom(secret.data, where);
}
```

`packages/operator/src/s3.ts`:

```ts
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { SourceName, SourceStatus, SourceTexts, Store } from "@kmo/core";
import { SyncFailure, type StoreCredentials } from "./cluster";

/** Reads one object; undefined means the object does not exist. */
export type GetObject = (bucket: string, key: string) => Promise<{ text: string; versionId?: string } | undefined>;

/** The files of one source of a ConfigSync as read from its store. */
export interface FetchedSources {
  /** Text of each file that exists. */
  texts: SourceTexts;
  /** A record of every file asked for, found or not. */
  sources: SourceStatus[];
}

const SOURCES: SourceName[] = ["config", "secrets", "commonConfig", "commonSecrets"];

/**
 * Fetches the files of one source of a ConfigSync.
 * @param get How one object is read.
 * @param store The store's label, such as ClusterConfigStore/default.
 * @param bucket The store's bucket.
 * @param keys The full key of each file to read.
 * @returns The text of each file that exists, and a record of every file asked for.
 * @throws SyncFailure with reason StoreUnreachable when any file cannot be read; nothing is returned in that case.
 */
export async function fetchSources(
  get: GetObject,
  store: string,
  bucket: string,
  keys: Partial<Record<SourceName, string>>,
): Promise<FetchedSources> {
  const texts: SourceTexts = {};
  const sources = await Promise.all(
    SOURCES.flatMap((name) => {
      const key = keys[name];
      return key === undefined ? [] : [{ name, key }];
    }).map(async ({ name, key }): Promise<SourceStatus> => {
      try {
        const object = await get(bucket, key);
        if (!object) return { store, key, found: false };
        texts[name] = object.text;
        return { store, key, found: true, ...(object.versionId ? { versionId: object.versionId } : {}) };
      } catch (error) {
        const code = (error as { name?: string }).name ?? "unknown error";
        throw new SyncFailure("StoreUnreachable", `could not read "${key}" from bucket "${bucket}": ${code}`);
      }
    }),
  );
  return { texts, sources };
}

/**
 * Builds the client for one store.
 * @param store The store.
 * @param credentials Its keys.
 * @returns An S3 client for the store's endpoint and addressing style.
 */
export function s3Client(store: Store, credentials: StoreCredentials): S3Client {
  return new S3Client({
    region: store.spec.s3.region,
    endpoint: store.spec.s3.endpoint || undefined,
    forcePathStyle: store.spec.s3.addressingStyle === "Path",
    credentials,
  });
}

/**
 * Makes the reader for one store.
 * @param store The store.
 * @param credentials Its keys.
 * @returns A function that reads one object and answers undefined for a key that does not exist.
 */
export function s3GetObject(store: Store, credentials: StoreCredentials): GetObject {
  const client = s3Client(store, credentials);
  return async (bucket, key) => {
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return { text: (await response.Body?.transformToString("utf-8")) ?? "", versionId: response.VersionId };
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return undefined;
      throw error;
    }
  };
}
```

Run: `npx vitest run packages/operator/test/s3.test.ts packages/operator/test/cluster.test.ts` Expected: PASS, 6 tests.
The last fetch test is the one that keeps secrets out of messages: only the error's name is used, never its text.

- [x] **Step 6: Write the first reconcile and bind it**

`packages/operator/src/reconcile.ts`:

```ts
import {
  SourceParseError,
  buildOutputs,
  planSync,
  storeLabel,
  type PlannedSource,
  type SourceInput,
  type SourceStatus,
} from "@kmo/core";
import { Log } from "pepr";
import { SyncFailure, listStores, readCredentials } from "./cluster";
import { toCore, type ConfigSyncKind } from "./kinds";
import { fetchSources, s3GetObject } from "./s3";

/**
 * Reads the files of every source of a ConfigSync.
 * @param planned The sources in order, each with its store and keys.
 * @returns The texts for merging, and a record of every file asked for.
 * @throws SyncFailure when a store's credentials or one of its files cannot be read.
 */
export async function readSources(
  planned: PlannedSource[],
): Promise<{ inputs: SourceInput[]; sources: SourceStatus[] }> {
  const inputs: SourceInput[] = [];
  const sources: SourceStatus[] = [];
  for (const { store, keys } of planned) {
    const label = storeLabel(store);
    const get = s3GetObject(store, await readCredentials(store));
    const read = await fetchSources(get, label, store.spec.s3.bucket, keys);
    inputs.push({ store: label, texts: read.texts });
    sources.push(...read.sources);
  }
  return { inputs, sources };
}

/**
 * Reconciles one ConfigSync.
 * @param sync The resource Pepr delivered.
 */
export async function reconcile(sync: ConfigSyncKind): Promise<void> {
  const where = { namespace: sync.metadata?.namespace, name: sync.metadata?.name };
  try {
    const plan = planSync(toCore(sync), await listStores());
    if (!plan.ok) throw new SyncFailure(plan.reason, plan.message);

    const read = await readSources(plan.sources);
    const outputs = buildOutputs(read.inputs);

    Log.info(
      {
        ...where,
        sources: read.sources,
        configKeys: Object.keys(outputs.configMapData).length,
        secretKeys: Object.keys(outputs.secretData).length,
        configHash: outputs.configHash,
      },
      "KMO read the store",
    );
  } catch (error) {
    if (error instanceof SyncFailure)
      return void Log.warn({ ...where, reason: error.reason }, `KMO sync failed: ${error.message}`);
    if (error instanceof SourceParseError)
      return void Log.warn({ ...where, reason: "SourceUnparsable" }, `KMO sync failed: ${error.message}`);
    throw error;
  }
}
```

In `packages/operator/src/capability.ts`, add the imports and the binding:

```ts
import { ConfigSyncKind, Rollout } from "./kinds";
import { reconcile } from "./reconcile";
```

```ts
When(ConfigSyncKind).IsCreatedOrUpdated().Reconcile(reconcile);
```

Add to `pepr.rbac` in `packages/operator/package.json`:

```json
      {
        "apiGroups": ["kmo.isntall.net"],
        "resources": ["configsyncs", "configstores", "clusterconfigstores"],
        "verbs": ["get", "list", "watch"]
      },
      {
        "apiGroups": [""],
        "resources": ["secrets"],
        "verbs": ["get"]
      }
```

- [x] **Step 7: Check, deploy and look**

Run: `mise run lint && mise run test && mise run operator:deploy` Expected: clean, all tests pass, both rollouts
complete. If the build or the deploy says the module is too large, stop as described in the Before note.

Run: `mise run operator:logs | grep "KMO read the store"` Expected: five lines, one for each ConfigSync in `shop`. Each
lists four sources with their store, `found: true` and a version ID, key counts above zero and a 64-character hash. No value from a
file appears anywhere in the log; check with `mise run operator:logs | grep -c -e orders-api-password -e common-token`,
which must print `0`.

- [x] **Step 8: After (show, then pause)**

Show the user the five log lines. Then show two failures, and that nothing crashes:

```bash
kubectl apply -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: missing-store, namespace: shop }
spec: { sources: [{ storeRef: { kind: ClusterConfigStore, name: default } }, { storeRef: { name: gone } }] }
EOF
mise run store -- s3 cp - s3://kmo-config/shop/orders-api/config.env <<< 'this line is not an assignment'
kubectl annotate csync orders-api -n shop demo=1 --overwrite
sleep 5 && mise run operator:logs | grep "KMO sync failed"
```

Expected: `StoreNotFound` for `missing-store` (one store of the two is missing, so nothing is read from the other
either) and `SourceUnparsable` for `orders-api` with `ClusterConfigStore/default config, line 1: expected KEY=value`.
Restore:

```bash
kubectl delete csync missing-store -n shop
mise run store -- s3 cp dev/store-files/shop/orders-api/config.env s3://kmo-config/shop/orders-api/config.env
```

Update `CLAUDE.md` (the operator reads the store and writes nothing yet). Pause for questions.

- [x] **Step 9: Commit (waits for the user)**

```bash
npm run format
git add package.json package-lock.json packages CLAUDE.md
git commit -m "feat: read the source files of a ConfigSync from its store"
```



### Task 5: Syncing: write the outputs

**Before (explain to the user):** The second half of a reconcile writes the ConfigMap and the Secret. Three Kubernetes
ideas are new. A **label** is a searchable tag: `app.kubernetes.io/managed-by: kmo` marks the objects KMO wrote, and KMO
refuses to touch an object without it. An **owner reference** tells Kubernetes that an object belongs to another: when
the ConfigSync is deleted, the garbage collector deletes its two objects. And a Secret's `data` is **base64-encoded**,
which is an encoding, not encryption. Addition to the spec to mention: the outputs are replaced whole, so a key that
someone added by hand is removed, not only a changed value.

**Files:**

- Create: `packages/core/src/outputs.ts`, `packages/core/test/outputs.test.ts`, `packages/operator/src/outputs.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/types.ts`, `packages/operator/src/reconcile.ts`,
  `packages/operator/package.json`, `dev/kustomization.yaml`, `dev/README.md`, `docs/getting-started.md`, `CLAUDE.md`

**Interfaces:**

- Consumes: `ResolvedConfigSync`, `Outputs`, `SyncFailure`, `getOrUndefined`, `reconcile` from earlier tasks.
- Produces, from `@kmo/core`:
  - `MANAGED_BY_LABEL = "app.kubernetes.io/managed-by"`, `MANAGED_BY = "kmo"`,
    `RELOADER_IGNORE_ANNOTATION = "reloader.stakater.com/ignore"`
  - `interface Owner { apiVersion: string; kind: string; name: string; uid: string }` -
    `interface OutputObject { apiVersion: "v1"; kind: "ConfigMap" | "Secret"; type?: "Opaque"; metadata: {...}; data: EnvValues }`
    -
    `interface ExistingObject { metadata?: { labels?: Record<string, string>; annotations?: Record<string, string>; ownerReferences?: { uid?: string }[] }; data?: Record<string, string> }`
    -
    `outputObjects(sync: ResolvedConfigSync, outputs: Outputs, owner: Owner): { configMap: OutputObject; secret: OutputObject }`
  - `takeoverProblem(wanted: OutputObject, existing: ExistingObject | undefined, owner: Owner): string | undefined`
  - `outputPatch(wanted: OutputObject, existing: ExistingObject): PatchOperation[]`
  - `interface PatchOperation { op: "add"; path: string; value: unknown }`
  - `ConfigSync.metadata` gains optional `uid`, `generation` and `annotations`.
- Produces, from `packages/operator/src/outputs.ts`:
  `writeOutputs(wanted: { configMap: OutputObject; secret: OutputObject }, owner: Owner): Promise<void>`.
- Produces, from `packages/operator/src/kinds.ts`: `ownerOf(sync: ConfigSyncKind): Owner`.

- [x] **Step 1: Write the failing tests**

`packages/core/test/outputs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveConfigSync } from "../src/defaults";
import { outputObjects, outputPatch, takeoverProblem } from "../src/outputs";
import type { EnvValues } from "../src/types";

const owner = { apiVersion: "kmo.isntall.net/v1alpha1", kind: "ConfigSync", name: "orders-api", uid: "uid-1" };
const sync = resolveConfigSync({ metadata: { name: "orders-api", namespace: "shop" } });
const decode = (value: string | undefined) => Buffer.from(value ?? "", "base64").toString("utf8");

function objects(
  configMapData: EnvValues = { GREETING: "hello" },
  secretData: EnvValues = { DB_PASSWORD: "pässwörd" },
) {
  return outputObjects(sync, { configMapData, secretData, configHash: "abc" }, owner);
}

describe("the two output objects", () => {
  it("are a ConfigMap and a Secret named after the ConfigSync, in its namespace", () => {
    const { configMap, secret } = objects();
    expect(configMap).toMatchObject({ kind: "ConfigMap", metadata: { name: "orders-api-kmo", namespace: "shop" } });
    expect(secret).toMatchObject({
      kind: "Secret",
      type: "Opaque",
      metadata: { name: "orders-api-kmo", namespace: "shop" },
    });
  });

  it("carry KMO's label, the mark that tells Stakater Reloader to leave them alone, and their owner", () => {
    for (const object of Object.values(objects())) {
      expect(object.metadata.labels).toEqual({ "app.kubernetes.io/managed-by": "kmo" });
      expect(object.metadata.annotations).toEqual({ "reloader.stakater.com/ignore": "true" });
      expect(object.metadata.ownerReferences).toEqual([{ ...owner, controller: true, blockOwnerDeletion: true }]);
    }
  });

  it("hold config values as text and secret values base64-encoded, non-ASCII characters included", () => {
    const { configMap, secret } = objects();
    expect(configMap.data).toEqual({ GREETING: "hello" });
    expect(decode(secret.data.DB_PASSWORD)).toBe("pässwörd");
  });

  it("are both built even when there is nothing to put in them", () => {
    const { configMap, secret } = objects({}, {});
    expect(configMap.data).toEqual({});
    expect(secret.data).toEqual({});
  });
});

describe("an object that already holds an output name", () => {
  const wanted = objects().configMap;
  const labels = { "app.kubernetes.io/managed-by": "kmo" };

  it("is no problem when there is none", () => {
    expect(takeoverProblem(wanted, undefined, owner)).toBeUndefined();
  });

  it("is no problem when this ConfigSync wrote it", () => {
    expect(
      takeoverProblem(wanted, { metadata: { labels, ownerReferences: [{ uid: "uid-1" }] } }, owner),
    ).toBeUndefined();
  });

  it("is never taken over when it lacks KMO's label", () => {
    expect(takeoverProblem(wanted, { metadata: {} }, owner)).toBe(
      'ConfigMap "orders-api-kmo" already exists and was not written by KMO',
    );
  });

  it("is never taken over when another ConfigSync owns it", () => {
    expect(takeoverProblem(wanted, { metadata: { labels, ownerReferences: [{ uid: "uid-2" }] } }, owner)).toBe(
      'ConfigMap "orders-api-kmo" already belongs to another ConfigSync',
    );
  });
});

describe("the change to an existing output object", () => {
  const wanted = objects().configMap;
  const asWritten = { metadata: wanted.metadata, data: { GREETING: "hello" } };

  it("is nothing when the object is already as wanted", () => {
    expect(outputPatch(wanted, asWritten)).toEqual([]);
  });

  it("replaces the data whole, so a key added by hand goes away", () => {
    const edited = { ...asWritten, data: { GREETING: "hello", EXTRA: "by hand" } };
    expect(outputPatch(wanted, edited)).toContainEqual({ op: "add", path: "/data", value: { GREETING: "hello" } });
  });

  it("puts back a label that was removed", () => {
    const edited = { metadata: { ...wanted.metadata, labels: {} }, data: asWritten.data };
    expect(outputPatch(wanted, edited)).toContainEqual({
      op: "add",
      path: "/metadata/labels",
      value: wanted.metadata.labels,
    });
  });

  it("keeps labels and annotations that others added", () => {
    const edited = {
      metadata: { ...wanted.metadata, labels: { ...wanted.metadata.labels, team: "orders" } },
      data: asWritten.data,
    };
    expect(outputPatch(wanted, edited)).toEqual([]);
  });
});
```

Run: `npx vitest run packages/core/test/outputs.test.ts` Expected: FAIL, the module `../src/outputs` does not exist.

- [x] **Step 2: Write the core module**

In `packages/core/src/types.ts`, replace the `ConfigSync` interface:

```ts
/** A ConfigSync resource, reduced to what the core logic reads. */
export interface ConfigSync {
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    generation?: number;
    annotations?: Record<string, string>;
  };
  spec?: ConfigSyncSpec;
  status?: ConfigSyncStatus;
}
```

`packages/core/src/outputs.ts`:

```ts
import type { ResolvedConfigSync } from "./defaults";
import type { Outputs } from "./render";
import type { EnvValues } from "./types";

/** Label that marks an object as written by KMO. */
export const MANAGED_BY_LABEL = "app.kubernetes.io/managed-by";
/** Value of that label. */
export const MANAGED_BY = "kmo";
/** Annotation that tells Stakater Reloader to ignore an object. */
export const RELOADER_IGNORE_ANNOTATION = "reloader.stakater.com/ignore";

/** The ConfigSync that owns a pair of output objects. */
export interface Owner {
  /** API group and version of the owner. */
  apiVersion: string;
  /** Kind of the owner. */
  kind: string;
  /** Name of the owner. */
  name: string;
  /** Unique ID that the cluster gave the owner. */
  uid: string;
}

/** A ConfigMap or Secret as KMO writes it. */
export interface OutputObject {
  /** Both kinds are in the core API. */
  apiVersion: "v1";
  /** Which of the two objects this is. */
  kind: "ConfigMap" | "Secret";
  /** Set on a Secret only. */
  type?: "Opaque";
  /** Name, namespace, KMO's label and annotation, and the owner. */
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    ownerReferences: (Owner & { controller: true; blockOwnerDeletion: true })[];
  };
  /** Plain text for a ConfigMap, base64 for a Secret. */
  data: EnvValues;
}

/** The parts of an object in the cluster that the output rules read. */
export interface ExistingObject {
  /** Its labels, annotations and owners. */
  metadata?: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: { uid?: string }[];
  };
  /** Its values as the cluster holds them. */
  data?: Record<string, string>;
}

/** One JSON Patch operation. */
export interface PatchOperation {
  /** Add sets a field, whether it exists or not. */
  op: "add";
  /** JSON Pointer to the field. */
  path: string;
  /** The new value of the field. */
  value: unknown;
}

/**
 * Builds the ConfigMap and the Secret of a ConfigSync.
 * @param sync The resolved ConfigSync.
 * @param outputs The merged values.
 * @param owner The ConfigSync, as the owner of both objects.
 * @returns Both objects, each built even when it holds no values.
 */
export function outputObjects(
  sync: ResolvedConfigSync,
  outputs: Outputs,
  owner: Owner,
): { configMap: OutputObject; secret: OutputObject } {
  const metadata = (name: string): OutputObject["metadata"] => ({
    name,
    namespace: sync.namespace,
    labels: { [MANAGED_BY_LABEL]: MANAGED_BY },
    annotations: { [RELOADER_IGNORE_ANNOTATION]: "true" },
    ownerReferences: [{ ...owner, controller: true, blockOwnerDeletion: true }],
  });
  const encoded = Object.fromEntries(
    Object.entries(outputs.secretData).map(([key, value]) => [key, Buffer.from(value, "utf8").toString("base64")]),
  );
  return {
    configMap: {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: metadata(sync.output.configMapName),
      data: outputs.configMapData,
    },
    secret: {
      apiVersion: "v1",
      kind: "Secret",
      type: "Opaque",
      metadata: metadata(sync.output.secretName),
      data: encoded,
    },
  };
}

/**
 * Tells whether an object that already holds an output name blocks the write.
 * @param wanted The object KMO wants to write.
 * @param existing The object in the cluster with that name, if any.
 * @param owner The ConfigSync that wants to write.
 * @returns The problem, or undefined when the name is free or the object is this ConfigSync's own.
 */
export function takeoverProblem(
  wanted: OutputObject,
  existing: ExistingObject | undefined,
  owner: Owner,
): string | undefined {
  if (!existing) return undefined;
  const what = `${wanted.kind} "${wanted.metadata.name}"`;
  if (existing.metadata?.labels?.[MANAGED_BY_LABEL] !== MANAGED_BY)
    return `${what} already exists and was not written by KMO`;
  const owners = existing.metadata.ownerReferences ?? [];
  if (owners.length > 0 && !owners.some((reference) => reference.uid === owner.uid)) {
    return `${what} already belongs to another ConfigSync`;
  }
  return undefined;
}

/**
 * Works out the change that makes an existing output object as wanted.
 * @param wanted The object KMO wants.
 * @param existing The object in the cluster.
 * @returns JSON Patch operations, empty when nothing has to change. Labels and annotations added by others are kept.
 */
export function outputPatch(wanted: OutputObject, existing: ExistingObject): PatchOperation[] {
  const operations: PatchOperation[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  const holds = (all: Record<string, string> | undefined, part: Record<string, string>) =>
    Object.entries(part).every(([key, value]) => all?.[key] === value);

  if (!same(existing.data ?? {}, wanted.data)) operations.push({ op: "add", path: "/data", value: wanted.data });
  if (!holds(existing.metadata?.labels, wanted.metadata.labels)) {
    operations.push({
      op: "add",
      path: "/metadata/labels",
      value: { ...existing.metadata?.labels, ...wanted.metadata.labels },
    });
  }
  if (!holds(existing.metadata?.annotations, wanted.metadata.annotations)) {
    operations.push({
      op: "add",
      path: "/metadata/annotations",
      value: { ...existing.metadata?.annotations, ...wanted.metadata.annotations },
    });
  }
  const ownerUid = wanted.metadata.ownerReferences[0]?.uid;
  if (!(existing.metadata?.ownerReferences ?? []).some((reference) => reference.uid === ownerUid)) {
    operations.push({ op: "add", path: "/metadata/ownerReferences", value: wanted.metadata.ownerReferences });
  }
  return operations;
}

function sorted(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
```

The test "puts back a label that was removed" expects the value `wanted.metadata.labels`; with an empty existing map the
merged value is equal to it.

Add `export * from "./outputs";` to `packages/core/src/index.ts`.

Run: `npx vitest run packages/core/test/outputs.test.ts` Expected: PASS, 12 tests.

- [x] **Step 3: Write the operator's side**

`packages/operator/src/outputs.ts`. Both names are checked before either object is written.

```ts
import { outputPatch, takeoverProblem, type ExistingObject, type OutputObject, type Owner } from "@kmo/core";
import { K8s, a } from "pepr";
import { SyncFailure, getOrUndefined } from "./cluster";

/**
 * Writes the ConfigMap and the Secret of a ConfigSync.
 * @param wanted Both objects as they must be.
 * @param owner The ConfigSync that owns them.
 * @throws SyncFailure with reason OutputTaken, before anything is written, when a name is held by a foreign object.
 */
export async function writeOutputs(wanted: { configMap: OutputObject; secret: OutputObject }, owner: Owner): Promise<void> {
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

async function patch(model: typeof a.ConfigMap | typeof a.Secret, wanted: OutputObject, existing: ExistingObject): Promise<void> {
  const operations = outputPatch(wanted, existing);
  if (operations.length === 0) return;
  await K8s(model, { name: wanted.metadata.name, namespace: wanted.metadata.namespace }).Patch(operations);
}
```

In `packages/operator/src/kinds.ts`, make `toCore` carry the new metadata and add `ownerOf` (import `type Owner` from
`@kmo/core`):

```ts
export function toCore(sync: ConfigSyncKind): ConfigSync {
  return {
    metadata: {
      name: sync.metadata?.name ?? "",
      namespace: sync.metadata?.namespace ?? "",
      uid: sync.metadata?.uid,
      generation: sync.metadata?.generation,
      annotations: sync.metadata?.annotations,
    },
    spec: sync.spec,
    status: sync.status,
  };
}

/**
 * Names a ConfigSync as the owner of its output objects.
 * @param sync The resource as the client returns it.
 * @returns The owner reference fields.
 */
export function ownerOf(sync: ConfigSyncKind): Owner {
  return {
    apiVersion: "kmo.isntall.net/v1alpha1",
    kind: "ConfigSync",
    name: sync.metadata?.name ?? "",
    uid: sync.metadata?.uid ?? "",
  };
}
```

In `reconcile` in `packages/operator/src/reconcile.ts`, after `const outputs = buildOutputs(read.inputs);`:

```ts
    const owner = ownerOf(sync);
    await writeOutputs(outputObjects(plan.sync, outputs, owner), owner);
```

Change the log message from `"KMO read the store"` to `"KMO synced"`. Add the imports `outputObjects` from `@kmo/core`,
`ownerOf` from `./kinds` and `writeOutputs` from `./outputs`.

Add to `pepr.rbac` in `packages/operator/package.json`, and remove the earlier `secrets` rule that had only `get`:

```json
      {
        "apiGroups": [""],
        "resources": ["configmaps", "secrets"],
        "verbs": ["get", "create", "patch"]
      }
```

- [x] **Step 4: Check and deploy, and see KMO refuse the stand-ins**

Run: `mise run lint && mise run test && mise run operator:deploy`

The cluster still holds the `<name>-kmo` objects that `dev/kustomization.yaml` generated by hand. They have no KMO
label.

Run: `mise run operator:logs | grep "KMO sync failed"` Expected: five lines with the reason `OutputTaken` and
`ConfigMap "orders-api-kmo" already exists and was not written by KMO`. This is the takeover rule at work: KMO never
adopts an object it did not write.

- [x] **Step 5: Remove the stand-ins**

The sample pods now wait for the operator's objects. So in `mise.toml`, move the line that waits for the rollout of
`orders-api` from the `deploy` task to the end of `operator:deploy`, and make `mise run operator:deploy` the fourth
step in `docs/getting-started.md`.

In `dev/kustomization.yaml`, delete the five `<name>-kmo` entries under `configMapGenerator` (keep `store-seed-files`)
and delete the whole `secretGenerator` block. In `dev/README.md`, delete the "Stand-ins" section and change the
`kustomization.yaml` line: it now generates only the ConfigMap of seed files.

Run:

```bash
for name in orders-api inventory node-agent nightly-report checkout; do
  kubectl delete configmap,secret "$name-kmo" -n shop
  kubectl annotate csync "$name" -n shop demo="$(date +%s)" --overwrite
done
sleep 10
kubectl get configmap,secret -n shop -l app.kubernetes.io/managed-by=kmo
```

Expected: five ConfigMaps and five Secrets, written by the operator.

- [x] **Step 6: After (show, then pause)**

Show the user:

```bash
kubectl get configmap orders-api-kmo -n shop -o yaml
kubectl get secret orders-api-kmo -n shop -o jsonpath='{.data}' ; echo
```

Point out: the label, the annotation, the owner reference, and that the data now also holds the keys of the `_common`
files, which the stand-ins never had. Then show a hand edit being reverted, a hand-added key included:

```bash
kubectl patch configmap orders-api-kmo -n shop --type merge -p '{"data":{"GREETING":"edited","EXTRA":"by hand"}}'
kubectl annotate csync orders-api -n shop demo="$(date +%s)" --overwrite
sleep 5 && kubectl get configmap orders-api-kmo -n shop -o jsonpath='{.data}' ; echo
```

Expected: `GREETING` is back to the value in the store and `EXTRA` is gone. Then show the owner reference at work:

```bash
kubectl delete csync inventory -n shop
sleep 5 && kubectl get configmap,secret inventory-kmo -n shop
kubectl apply -f dev/workloads/configsyncs.yaml
```

Expected: both objects are gone, deleted by the garbage collector, and come back when the ConfigSync is recreated. Say
what does not work yet: the pods still run with their old values, because nothing restarts them; and a hand edit is
reverted only when something triggers a reconcile. Update `docs/getting-started.md` (the operator writes the objects;
pods are not restarted yet) and `CLAUDE.md` (step 6 done; the stand-ins are gone). Pause for questions.

- [x] **Step 7: Commit (waits for the user)**

```bash
npm run format
git add packages dev docs CLAUDE.md
git commit -m "feat: write the ConfigMap and Secret of a ConfigSync"
```



### Task 6: Rolling updates

**Before (explain to the user):** A Deployment does not notice that a ConfigMap it uses has changed. It starts a
**rolling update**, replacing pods a few at a time, only when its **pod template** changes. So KMO writes a hash of the
config into an annotation on the pod template. When the values change the hash changes, the template changes, and
Kubernetes rolls the workload by itself. When the values are the same the hash is the same and nothing happens, which is
why a hash is used and not a timestamp. The change is made with **server-side apply**: KMO sends only the one field it
owns, and the API server merges it and records KMO as that field's manager. Each workload kind has its own way to roll:
a CronJob only uses the new template for its next run, and an Argo Rollout goes through its canary steps.

**Files:**

- Create: `packages/core/src/workload.ts`, `packages/core/test/workload.test.ts`, `packages/operator/src/targets.ts`
- Modify: `packages/core/src/index.ts`, `packages/operator/src/reconcile.ts`, `packages/operator/package.json`,
  `docs/getting-started.md`, `CLAUDE.md`

**Interfaces:**

- Consumes: `TargetKind`, `ResolvedConfigSync`, `getOrUndefined`, `Rollout`, `reconcile`.
- Produces, from `@kmo/core`:
  - `CONFIG_HASH_ANNOTATION = "kmo.isntall.net/config-hash"`
  - `TARGET_API_VERSION: Record<TargetKind, string>`
  - `interface PodTemplate { metadata?: { annotations?: Record<string, string> }; spec?: PodSpec }` and
    `interface PodSpec` (containers, initContainers, volumes; see the code)
  - `podTemplate(kind: TargetKind, workload: unknown): PodTemplate | undefined`
  - `borrowsTemplate(kind: TargetKind, workload: unknown): boolean`
  - `hashStamp(kind: TargetKind, name: string, namespace: string, hash: string): object`
  - `type TargetState = "stamped" | "unchanged" | "missing" | "borrowed"`
  - `interface TargetReport { kind: TargetKind; name: string; state: TargetState; podSpec?: PodSpec }`
- Produces, from `packages/operator/src/targets.ts`:
  `stampTargets(sync: ResolvedConfigSync, hash: string): Promise<TargetReport[]>` and
  `TARGET_MODELS: Record<TargetKind, GenericClass>`.

- [x] **Step 1: Write the failing tests**

`packages/core/test/workload.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { borrowsTemplate, hashStamp, podTemplate } from "../src/workload";

const template = { metadata: { annotations: { "kmo.isntall.net/config-hash": "abc" } }, spec: { containers: [] } };

describe("the pod template of a workload", () => {
  it.each(["Deployment", "StatefulSet", "DaemonSet", "Rollout"] as const)("is spec.template for a %s", (kind) => {
    expect(podTemplate(kind, { spec: { template } })).toBe(template);
  });

  it("is one level deeper for a CronJob, inside its job template", () => {
    expect(podTemplate("CronJob", { spec: { jobTemplate: { spec: { template } } } })).toBe(template);
  });

  it("is absent for a Rollout that borrows its template from a Deployment", () => {
    const rollout = { spec: { workloadRef: { kind: "Deployment", name: "checkout" } } };
    expect(podTemplate("Rollout", rollout)).toBeUndefined();
    expect(borrowsTemplate("Rollout", rollout)).toBe(true);
  });
});

describe("the hash stamp", () => {
  it("is the smallest object that sets the annotation on a Deployment's pod template", () => {
    expect(hashStamp("Deployment", "orders-api", "shop", "abc")).toEqual({
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "orders-api", namespace: "shop" },
      spec: { template: { metadata: { annotations: { "kmo.isntall.net/config-hash": "abc" } } } },
    });
  });

  it("goes on the job template of a CronJob, so each run records the config it used", () => {
    expect(hashStamp("CronJob", "nightly-report", "shop", "abc")).toMatchObject({
      apiVersion: "batch/v1",
      spec: { jobTemplate: { spec: { template: { metadata: { annotations: { "kmo.isntall.net/config-hash": "abc" } } } } } },
    });
  });

  it("uses the Argo Rollouts API for a Rollout", () => {
    expect(hashStamp("Rollout", "checkout", "shop", "abc")).toMatchObject({ apiVersion: "argoproj.io/v1alpha1", kind: "Rollout" });
  });
});
```

Run: `npx vitest run packages/core/test/workload.test.ts` Expected: FAIL, the module `../src/workload` does not exist.

- [x] **Step 2: Write the core module**

`packages/core/src/workload.ts`:

```ts
import type { TargetKind } from "./types";

/** Annotation on a pod template that holds the hash of the config the pods received. */
export const CONFIG_HASH_ANNOTATION = "kmo.isntall.net/config-hash";

/** The API version of each kind of target. */
export const TARGET_API_VERSION: Record<TargetKind, string> = {
  Deployment: "apps/v1",
  StatefulSet: "apps/v1",
  DaemonSet: "apps/v1",
  CronJob: "batch/v1",
  Rollout: "argoproj.io/v1alpha1",
};

/** A reference from a container to a ConfigMap or Secret. */
interface ObjectReference {
  name?: string;
}

/** A container, reduced to how it can use a ConfigMap or Secret. */
export interface Container {
  /** Whole objects loaded as environment variables. */
  envFrom?: { configMapRef?: ObjectReference; secretRef?: ObjectReference }[];
  /** Single environment variables, each of which may take its value from an object. */
  env?: { valueFrom?: { configMapKeyRef?: ObjectReference; secretKeyRef?: ObjectReference } }[];
}

/** A pod spec, reduced to what the wiring check reads. */
export interface PodSpec {
  /** The containers that run for the life of the pod. */
  containers?: Container[];
  /** The containers that run before them. */
  initContainers?: Container[];
  /** Volumes, each of which may be filled from an object. */
  volumes?: {
    configMap?: ObjectReference;
    secret?: { secretName?: string };
    projected?: { sources?: { configMap?: ObjectReference; secret?: ObjectReference }[] };
  }[];
}

/** A pod template, reduced to what KMO reads. */
export interface PodTemplate {
  /** Where the config hash is stamped. */
  metadata?: { annotations?: Record<string, string> };
  /** What the pods run. */
  spec?: PodSpec;
}

/** What happened to one target of a ConfigSync. */
export type TargetState = "stamped" | "unchanged" | "missing" | "borrowed";

/** One target after a reconcile. */
export interface TargetReport {
  /** Kind of the workload. */
  kind: TargetKind;
  /** Name of the workload. */
  name: string;
  /** What happened to it. */
  state: TargetState;
  /** Absent for a missing target and for a Rollout that borrows its template. */
  podSpec?: PodSpec;
}

interface WorkloadShape {
  spec?: {
    template?: PodTemplate;
    jobTemplate?: { spec?: { template?: PodTemplate } };
    workloadRef?: unknown;
  };
}

/**
 * Finds the pod template of a workload.
 * @param kind The workload's kind.
 * @param workload The workload as the API server returns it.
 * @returns The template, or undefined when the workload has none of its own.
 */
export function podTemplate(kind: TargetKind, workload: unknown): PodTemplate | undefined {
  const spec = (workload as WorkloadShape).spec;
  return kind === "CronJob" ? spec?.jobTemplate?.spec?.template : spec?.template;
}

/**
 * Tells whether a Rollout takes its pod template from a Deployment.
 * @param kind The workload's kind.
 * @param workload The workload as the API server returns it.
 * @returns True for a Rollout with a workload reference and no template of its own.
 */
export function borrowsTemplate(kind: TargetKind, workload: unknown): boolean {
  const spec = (workload as WorkloadShape).spec;
  return kind === "Rollout" && spec?.workloadRef !== undefined && spec.template === undefined;
}

/**
 * Builds the object that sets the config hash on a workload's pod template.
 * @param kind The workload's kind.
 * @param name The workload's name.
 * @param namespace The workload's namespace.
 * @param hash The config hash.
 * @returns A partial workload for server-side apply, holding only that annotation.
 */
export function hashStamp(kind: TargetKind, name: string, namespace: string, hash: string): object {
  const template = { metadata: { annotations: { [CONFIG_HASH_ANNOTATION]: hash } } };
  return {
    apiVersion: TARGET_API_VERSION[kind],
    kind,
    metadata: { name, namespace },
    spec: kind === "CronJob" ? { jobTemplate: { spec: { template } } } : { template },
  };
}
```

Add `export * from "./workload";` to `packages/core/src/index.ts`.

Run: `npx vitest run packages/core/test/workload.test.ts` Expected: PASS, 9 tests.

- [x] **Step 3: Write the operator's side**

`packages/operator/src/targets.ts`:

```ts
import {
  CONFIG_HASH_ANNOTATION,
  borrowsTemplate,
  hashStamp,
  podTemplate,
  type ResolvedConfigSync,
  type TargetKind,
  type TargetReport,
} from "@kmo/core";
import type { GenericClass } from "kubernetes-fluent-client";
import { K8s, a } from "pepr";
import { getOrUndefined } from "./cluster";
import { Rollout } from "./kinds";

/** The client model of each kind of target. */
export const TARGET_MODELS: Record<TargetKind, GenericClass> = {
  Deployment: a.Deployment,
  StatefulSet: a.StatefulSet,
  DaemonSet: a.DaemonSet,
  CronJob: a.CronJob,
  Rollout,
};

/**
 * Sets the config hash on the pod template of each target that does not carry it yet.
 * @param sync The resolved ConfigSync.
 * @param hash The config hash.
 * @returns What happened to each target. A target whose hash is current is not touched.
 */
export async function stampTargets(sync: ResolvedConfigSync, hash: string): Promise<TargetReport[]> {
  return Promise.all(
    sync.targets.map(async ({ kind, name }): Promise<TargetReport> => {
      const model = TARGET_MODELS[kind];
      const workload = await getOrUndefined(model, name, sync.namespace);
      if (!workload) return { kind, name, state: "missing" };
      if (borrowsTemplate(kind, workload)) return { kind, name, state: "borrowed" };

      const template = podTemplate(kind, workload);
      const podSpec = template?.spec;
      if (template?.metadata?.annotations?.[CONFIG_HASH_ANNOTATION] === hash) return { kind, name, state: "unchanged", podSpec };

      await K8s(model).Apply(hashStamp(kind, name, sync.namespace, hash), { force: true });
      return { kind, name, state: "stamped", podSpec };
    }),
  );
}
```

On a cluster without Argo Rollouts, `getOrUndefined` answers undefined for a Rollout, because the API server answers 404
for an unknown kind. The spec asks for exactly that: a Rollout target is reported as a workload that does not exist.

In `reconcile`, after `writeOutputs(...)`:

```ts
    const targets = await stampTargets(plan.sync, outputs.configHash);
```

and add `targets: targets.map(({ kind, name, state }) => ({ kind, name, state }))` to the object that is logged with
`"KMO synced"`. Import `stampTargets` from `./targets`.

Replace the Rollout rule in `pepr.rbac` and add the built-in workload kinds:

```json
      {
        "apiGroups": ["argoproj.io"],
        "resources": ["rollouts"],
        "verbs": ["get", "list", "watch", "patch"]
      },
      {
        "apiGroups": ["apps"],
        "resources": ["deployments", "statefulsets", "daemonsets"],
        "verbs": ["get", "patch"]
      },
      {
        "apiGroups": ["batch"],
        "resources": ["cronjobs"],
        "verbs": ["get", "patch"]
      }
```

- [x] **Step 4: Check and deploy**

Run: `mise run lint && mise run test && mise run operator:deploy`

Run: `kubectl rollout status deployment/orders-api -n shop && mise run operator:logs | grep "KMO synced" | tail -5`
Expected: every target `stamped` the first time. The pods roll once, because the template had no hash before, and now
log the merged values, `_common` keys included: `kubectl logs -n shop deployment/orders-api`.

- [x] **Step 5: Prove a restart of the operator rolls nothing**

Run:

```bash
kubectl get pods -n shop -o name | grep -v nightly-report | sort > /tmp/kmo-pods-before
kubectl rollout restart deployment/pepr-kmo-watcher -n pepr-system
kubectl rollout status deployment/pepr-kmo-watcher -n pepr-system
sleep 20
kubectl get pods -n shop -o name | grep -v nightly-report | sort | diff /tmp/kmo-pods-before - && echo "no pod was replaced"
mise run operator:logs | grep "KMO synced" | tail -5
```

Expected: `no pod was replaced`, and every target `unchanged`. The pods of `nightly-report` are left out of the
comparison, because the CronJob starts a new one every two minutes. Each watcher start reconciles every ConfigSync once; the
hash is what makes that harmless.

- [x] **Step 6: After (show, then pause)**

There is no receiver yet, so a sync is asked for by hand with the annotation the receiver will set. Define a helper in
the shell for the demonstration:

```bash
sync() { kubectl annotate csync "$1" -n shop kmo.isntall.net/sync-requested-at="$(date -u +%FT%T.%3NZ)" --overwrite; }
```

Show the user, one at a time:

1. A changed value rolls the workload:

   ```bash
   printf 'GREETING=good morning\nLOG_LEVEL=debug\n' | mise run store -- s3 cp - s3://kmo-config/shop/orders-api/config.env
   sync orders-api && kubectl rollout status deployment/orders-api -n shop
   kubectl logs -n shop deployment/orders-api | head -5
   ```

2. A change that leaves the effective values unchanged rolls nothing. `orders-api` sets `LOG_LEVEL` itself, so a new
   common value for it changes nothing for this workload:

   ```bash
   kubectl get pods -n shop -l app=orders-api -o name | sort > /tmp/kmo-pods-before
   mise run store -- s3 cp s3://kmo-config/_common/config.env - | sed 's/^LOG_LEVEL=.*/LOG_LEVEL=trace/' \
     | mise run store -- s3 cp - s3://kmo-config/_common/config.env
   sync orders-api && sleep 10
   kubectl get pods -n shop -l app=orders-api -o name | sort | diff /tmp/kmo-pods-before - && echo "no pod was replaced"
   ```

3. Each of the other four kinds: `sync inventory`, `sync node-agent`, `sync nightly-report`, `sync checkout` after the
   common change above, then `kubectl rollout status statefulset/inventory -n shop`,
   `kubectl rollout status daemonset/node-agent -n shop`,
   `kubectl get cronjob nightly-report -n shop -o jsonpath='{.spec.jobTemplate.spec.template.metadata.annotations}'` and
   `kubectl argo rollouts get rollout checkout -n shop` (or `kubectl get rollout checkout -n shop -o yaml` when the
   plugin is not installed). Explain how each kind rolls differently.

Restore the store: `mise run deploy` runs the seed Job again. Update `docs/getting-started.md` (a manual sync request
now rolls workloads; the automatic trigger comes with the receiver) and `CLAUDE.md` (step 7 done). Pause for questions.

- [x] **Step 7: Commit (waits for the user)**

```bash
npm run format
git add packages docs CLAUDE.md
git commit -m "feat: stamp the config hash on targets so they roll"
```



### Task 7: Reporting

**Before (explain to the user):** Until now the operator spoke only in its own log. Kubernetes has two standard places
for a controller to report. **Status** is the second half of a resource: the controller writes what is true now, and
**conditions** in it are small named facts (`Ready`, `SourcesFound`, `TargetsWired`, `Suspended`), each with a state, a
reason for machines, a message for people and the time it last changed. An **Event** is a dated note attached to a
resource; `kubectl describe` shows it. A condition tells you the state now; an Event tells you that something happened.

Writing status has a trap, found in the spike: the status write is itself a change to the ConfigSync, so Pepr delivers
it back and the operator would reconcile forever. The fix is in this task. The API server counts spec changes in
`metadata.generation`. The operator records the generation it acted on in `status.observedGeneration`, and the sync
request it acted on in `status.lastHandledSyncRequest` (an addition to the spec; Flux does the same). An update where
both still match is only the operator's own echo, and it returns at once.

**Files:**

- Create: `packages/core/src/status.ts`, `packages/core/src/trigger.ts`, `packages/core/test/status.test.ts`,
  `packages/core/test/trigger.test.ts`, `packages/core/test/wiring.test.ts`, `packages/operator/src/report.ts`
- Modify: `packages/core/src/types.ts`, `packages/core/src/workload.ts`, `packages/core/src/index.ts`,
  `packages/operator/src/reconcile.ts`, `packages/operator/package.json`, `docs/getting-started.md`, `CLAUDE.md`

**Interfaces:**

- Consumes: `Failure`, `SourceStatus`, `TargetReport`, `PodSpec`, `Outputs`, `ResolvedConfigSync`, `toCore`,
  `SyncFailure`.
- Produces, from `@kmo/core`:
  - `type ConditionType = "Ready" | "SourcesFound" | "TargetsWired" | "Suspended"` -
    `interface Condition { type: ConditionType; status: "True" | "False"; reason: string; message: string; lastTransitionTime: string }`
    -
    `interface ConfigSyncStatus { observedGeneration?; lastHandledSyncRequest?; lastSyncTime?; configHash?; stores?; sources?; conditions? }`
    -
    `type SyncOutcome = ({ result: "failed" } & Failure) | { result: "synced"; stores: string[]; sources: SourceStatus[]; configHash: string; empty: boolean; wiringProblems: string[] } | { result: "suspended" }`
  - `interface Observed { generation?: number; syncRequest?: string; now: string }`
  - `withCondition(conditions: Condition[], next: Omit<Condition, "lastTransitionTime">, now: string): Condition[]`
  - `nextStatus(previous: ConfigSyncStatus | undefined, outcome: SyncOutcome, observed: Observed): ConfigSyncStatus`
  - `interface EventNote { type: "Normal" | "Warning"; reason: string; message: string }`
  - `eventsFor(previous: ConfigSyncStatus | undefined, next: ConfigSyncStatus): EventNote[]`
  - `SYNC_REQUESTED_ANNOTATION = "kmo.isntall.net/sync-requested-at"`,
    `syncRequest(sync: ConfigSync): string | undefined`, `needsReconcile(sync: ConfigSync): boolean`
  - `referencesObject(podSpec: PodSpec | undefined, kind: "ConfigMap" | "Secret", name: string): boolean`
  - `wiringProblems(sync: ResolvedConfigSync, outputs: Outputs, targets: TargetReport[]): string[]`
- Produces, from the operator: `runSync(sync: ConfigSyncKind): Promise<SyncOutcome>` in `reconcile.ts`;
  `report(sync: ConfigSyncKind, outcome: SyncOutcome): Promise<void>` in `report.ts`.

- [x] **Step 1: Write the failing tests**

`packages/core/test/wiring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveConfigSync } from "../src/defaults";
import { referencesObject, wiringProblems, type PodSpec } from "../src/workload";

const sync = resolveConfigSync({ metadata: { name: "orders-api", namespace: "shop" } });
const full = { configMapData: { A: "1" }, secretData: { B: "2" }, configHash: "abc" };
const wired: PodSpec = {
  containers: [{ envFrom: [{ configMapRef: { name: "orders-api-kmo" } }, { secretRef: { name: "orders-api-kmo" } }] }],
};

describe("a pod that uses an object", () => {
  it("may take all its keys with envFrom", () => {
    expect(referencesObject(wired, "ConfigMap", "orders-api-kmo")).toBe(true);
    expect(referencesObject(wired, "Secret", "orders-api-kmo")).toBe(true);
  });

  it("may take one key with an env entry", () => {
    const pod: PodSpec = { containers: [{ env: [{ valueFrom: { secretKeyRef: { name: "orders-api-kmo" } } }] }] };
    expect(referencesObject(pod, "Secret", "orders-api-kmo")).toBe(true);
    expect(referencesObject(pod, "ConfigMap", "orders-api-kmo")).toBe(false);
  });

  it("may mount it as a volume", () => {
    const pod: PodSpec = { volumes: [{ configMap: { name: "orders-api-kmo" } }, { secret: { secretName: "orders-api-kmo" } }] };
    expect(referencesObject(pod, "ConfigMap", "orders-api-kmo")).toBe(true);
    expect(referencesObject(pod, "Secret", "orders-api-kmo")).toBe(true);
  });

  it("may use it from an init container only", () => {
    const pod: PodSpec = { initContainers: [{ envFrom: [{ configMapRef: { name: "orders-api-kmo" } }] }] };
    expect(referencesObject(pod, "ConfigMap", "orders-api-kmo")).toBe(true);
  });

  it("does not use an object it never names", () => {
    expect(referencesObject({ containers: [{}] }, "ConfigMap", "orders-api-kmo")).toBe(false);
  });
});

describe("the wiring of a ConfigSync's targets", () => {
  it("is fine when each target uses both objects", () => {
    expect(wiringProblems(sync, full, [{ kind: "Deployment", name: "orders-api", state: "stamped", podSpec: wired }])).toEqual([]);
  });

  it("reports a target that does not exist", () => {
    expect(wiringProblems(sync, full, [{ kind: "Deployment", name: "orders-api", state: "missing" }])).toEqual([
      'Deployment "orders-api" does not exist',
    ]);
  });

  it("reports a Rollout that takes its pod template from a Deployment", () => {
    expect(wiringProblems(sync, full, [{ kind: "Rollout", name: "checkout", state: "borrowed" }])).toEqual([
      'Rollout "checkout" takes its pod template from a Deployment; name that Deployment as the target',
    ]);
  });

  it("reports an object that holds values but is not used by a target", () => {
    const target = { kind: "Deployment" as const, name: "orders-api", state: "unchanged" as const, podSpec: { containers: [{}] } };
    expect(wiringProblems(sync, full, [target])).toEqual([
      'Deployment "orders-api" does not use ConfigMap "orders-api-kmo"',
      'Deployment "orders-api" does not use Secret "orders-api-kmo"',
    ]);
  });

  it("does not report an empty object that is not used", () => {
    const empty = { configMapData: {}, secretData: {}, configHash: "abc" };
    const target = { kind: "Deployment" as const, name: "orders-api", state: "unchanged" as const, podSpec: { containers: [{}] } };
    expect(wiringProblems(sync, empty, [target])).toEqual([]);
  });
});
```

`packages/core/test/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eventsFor, nextStatus, type SyncOutcome } from "../src/status";
import type { ConfigSyncStatus } from "../src/types";

const at = (minute: number) => `2026-10-11T09:${String(minute).padStart(2, "0")}:00.000Z`;
const observed = (minute: number, generation = 1, syncRequest?: string) => ({ generation, syncRequest, now: at(minute) });
const synced: SyncOutcome = {
  result: "synced",
  stores: ["ClusterConfigStore/default"],
  sources: [{ store: "ClusterConfigStore/default", key: "shop/orders-api/config.env", found: true, versionId: "v1" }],
  configHash: "abc",
  empty: false,
  wiringProblems: [],
};
const failed: SyncOutcome = { result: "failed", reason: "SourceUnparsable", message: "ClusterConfigStore/default config, line 3: expected KEY=value" };
const condition = (status: ConfigSyncStatus, type: string) => status.conditions?.find((c) => c.type === type);

describe("the status after a sync", () => {
  it("records what was read, when, and that the resource is ready", () => {
    const status = nextStatus(undefined, synced, observed(1, 4, "request-1"));
    expect(status).toMatchObject({
      observedGeneration: 4,
      lastHandledSyncRequest: "request-1",
      lastSyncTime: at(1),
      configHash: "abc",
      stores: ["ClusterConfigStore/default"],
      sources: synced.sources,
    });
    expect(condition(status, "Ready")).toMatchObject({ status: "True", reason: "Synced" });
    expect(condition(status, "SourcesFound")).toMatchObject({ status: "True" });
    expect(condition(status, "TargetsWired")).toMatchObject({ status: "True" });
    expect(condition(status, "Suspended")).toMatchObject({ status: "False" });
  });

  it("warns when every file is missing or empty, and is still ready", () => {
    const status = nextStatus(undefined, { ...synced, empty: true }, observed(1));
    expect(condition(status, "SourcesFound")).toMatchObject({ status: "False", reason: "NoSources" });
    expect(condition(status, "Ready")).toMatchObject({ status: "True" });
  });

  it("warns about targets that are not wired, and is still ready", () => {
    const status = nextStatus(undefined, { ...synced, wiringProblems: ['Deployment "x" does not exist'] }, observed(1));
    expect(condition(status, "TargetsWired")).toMatchObject({ status: "False", message: 'Deployment "x" does not exist' });
    expect(condition(status, "Ready")).toMatchObject({ status: "True" });
  });
});

describe("the status after a failure", () => {
  it("is not ready, with the reason, and keeps what the last good sync recorded", () => {
    const good = nextStatus(undefined, synced, observed(1));
    const status = nextStatus(good, failed, observed(2, 2));
    expect(condition(status, "Ready")).toMatchObject({ status: "False", reason: "SourceUnparsable", message: failed.message });
    expect(status).toMatchObject({ observedGeneration: 2, lastSyncTime: at(1), configHash: "abc", sources: synced.sources });
  });
});

describe("the status of a suspended resource", () => {
  it("keeps its last values and says that it is suspended", () => {
    const good = nextStatus(undefined, synced, observed(1));
    const status = nextStatus(good, { result: "suspended" }, observed(2, 2));
    expect(condition(status, "Suspended")).toMatchObject({ status: "True" });
    expect(status).toMatchObject({ observedGeneration: 2, lastSyncTime: at(1), configHash: "abc" });
    expect(condition(status, "Ready")).toMatchObject({ status: "True" });
  });
});

describe("a condition", () => {
  it("keeps the time it last changed for as long as its state holds", () => {
    const first = nextStatus(undefined, synced, observed(1));
    const second = nextStatus(first, synced, observed(2));
    const third = nextStatus(second, failed, observed(3));
    expect(condition(second, "Ready")?.lastTransitionTime).toBe(at(1));
    expect(condition(third, "Ready")?.lastTransitionTime).toBe(at(3));
  });
});

describe("the Events of a reconcile", () => {
  const good = nextStatus(undefined, synced, observed(1));

  it("are none when nothing changed", () => {
    expect(eventsFor(good, nextStatus(good, synced, observed(2)))).toEqual([]);
  });

  it("include a warning for a failure, once, however often it repeats", () => {
    const bad = nextStatus(good, failed, observed(2));
    expect(eventsFor(good, bad)).toEqual([{ type: "Warning", reason: "SourceUnparsable", message: failed.message }]);
    expect(eventsFor(bad, nextStatus(bad, failed, observed(3)))).toEqual([]);
  });

  it("say so when a failed resource is ready again", () => {
    const bad = nextStatus(good, failed, observed(2));
    expect(eventsFor(bad, nextStatus(bad, synced, observed(3)))).toEqual([
      { type: "Normal", reason: "Synced", message: "the outputs match the store" },
    ]);
  });

  it("include a warning for each warning condition", () => {
    const next = nextStatus(good, { ...synced, empty: true, wiringProblems: ['Deployment "x" does not exist'] }, observed(2));
    expect(eventsFor(good, next)).toEqual([
      { type: "Warning", reason: "NoSources", message: "every source file is missing or empty" },
      { type: "Warning", reason: "NotWired", message: 'Deployment "x" does not exist' },
    ]);
  });

  it("record suspending and resuming", () => {
    const paused = nextStatus(good, { result: "suspended" }, observed(2));
    expect(eventsFor(good, paused)).toEqual([{ type: "Normal", reason: "Suspended", message: "syncing is suspended" }]);
    expect(eventsFor(paused, nextStatus(paused, synced, observed(3)))).toEqual([
      { type: "Normal", reason: "Resumed", message: "syncing is active" },
    ]);
  });

  it("say nothing about a new resource that is simply ready", () => {
    expect(eventsFor(undefined, good)).toEqual([]);
  });
});
```

`packages/core/test/trigger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { needsReconcile } from "../src/trigger";
import type { ConfigSync } from "../src/types";

const sync = (generation: number, request: string | undefined, status: ConfigSync["status"]): ConfigSync => ({
  metadata: {
    name: "orders-api",
    namespace: "shop",
    generation,
    annotations: request ? { "kmo.isntall.net/sync-requested-at": request } : {},
  },
  status,
});

describe("a ConfigSync needs a reconcile", () => {
  it("when it is new", () => {
    expect(needsReconcile(sync(1, undefined, undefined))).toBe(true);
  });

  it("when its spec changed", () => {
    expect(needsReconcile(sync(2, undefined, { observedGeneration: 1 }))).toBe(true);
  });

  it("when a sync was requested that has not been handled", () => {
    expect(needsReconcile(sync(1, "request-2", { observedGeneration: 1, lastHandledSyncRequest: "request-1" }))).toBe(true);
  });

  it("but not when the only change is the operator's own status update", () => {
    expect(needsReconcile(sync(1, "request-1", { observedGeneration: 1, lastHandledSyncRequest: "request-1" }))).toBe(false);
    expect(needsReconcile(sync(1, undefined, { observedGeneration: 1 }))).toBe(false);
  });
});
```

Run:
`npx vitest run packages/core/test/wiring.test.ts packages/core/test/status.test.ts packages/core/test/trigger.test.ts`
Expected: FAIL, the modules and functions do not exist.

- [x] **Step 2: Write the core code**

In `packages/core/src/types.ts`, replace the temporary `ConfigSyncStatus` from Task 4:

```ts
/** The conditions a ConfigSync reports. */
export type ConditionType = "Ready" | "SourcesFound" | "TargetsWired" | "Suspended";

/** One named fact in a resource's status. */
export interface Condition {
  type: ConditionType;
  status: "True" | "False";
  /** Short and stable, for machines. */
  reason: string;
  /** For people. */
  message: string;
  /** When the status last changed between True and False. */
  lastTransitionTime: string;
}

/** The status of a ConfigSync. */
export interface ConfigSyncStatus {
  observedGeneration?: number;
  /** Value of the sync annotation that the last reconcile handled. */
  lastHandledSyncRequest?: string;
  lastSyncTime?: string;
  configHash?: string;
  /** Kind and name of each store that was read, in the order of the sources. */
  stores?: string[];
  sources?: SourceStatus[];
  conditions?: Condition[];
}
```

Append to `packages/core/src/workload.ts`, and add `import type { ResolvedConfigSync } from "./defaults";` and
`import type { Outputs } from "./render";` at its top:

```ts
/**
 * Tells whether a pod uses a ConfigMap or Secret.
 * @param podSpec The pod spec of a workload.
 * @param kind The kind of object.
 * @param name The object's name.
 * @returns True when a container or init container uses it through envFrom or an env entry, or a volume mounts it.
 */
export function referencesObject(podSpec: PodSpec | undefined, kind: "ConfigMap" | "Secret", name: string): boolean {
  const isConfigMap = kind === "ConfigMap";
  const containers = [...(podSpec?.containers ?? []), ...(podSpec?.initContainers ?? [])];
  const byContainer = containers.some(
    (container) =>
      (container.envFrom ?? []).some((from) => (isConfigMap ? from.configMapRef : from.secretRef)?.name === name) ||
      (container.env ?? []).some(
        (entry) => (isConfigMap ? entry.valueFrom?.configMapKeyRef : entry.valueFrom?.secretKeyRef)?.name === name,
      ),
  );
  const byVolume = (podSpec?.volumes ?? []).some(
    (volume) =>
      (isConfigMap ? volume.configMap?.name : volume.secret?.secretName) === name ||
      (volume.projected?.sources ?? []).some((source) => (isConfigMap ? source.configMap : source.secret)?.name === name),
  );
  return byContainer || byVolume;
}

/**
 * Lists what is wrong with how a ConfigSync's targets are wired to its outputs.
 * @param sync The resolved ConfigSync.
 * @param outputs The merged values.
 * @param targets What the reconcile found for each target.
 * @returns One line for each problem; empty when all is well. An empty output object need not be used.
 */
export function wiringProblems(sync: ResolvedConfigSync, outputs: Outputs, targets: TargetReport[]): string[] {
  const problems: string[] = [];
  for (const target of targets) {
    const what = `${target.kind} "${target.name}"`;
    if (target.state === "missing") {
      problems.push(`${what} does not exist`);
    } else if (target.state === "borrowed") {
      problems.push(`${what} takes its pod template from a Deployment; name that Deployment as the target`);
    } else {
      const { configMapName, secretName } = sync.output;
      if (Object.keys(outputs.configMapData).length > 0 && !referencesObject(target.podSpec, "ConfigMap", configMapName)) {
        problems.push(`${what} does not use ConfigMap "${configMapName}"`);
      }
      if (Object.keys(outputs.secretData).length > 0 && !referencesObject(target.podSpec, "Secret", secretName)) {
        problems.push(`${what} does not use Secret "${secretName}"`);
      }
    }
  }
  return problems;
}
```

`packages/core/src/status.ts`:

```ts
import type { Condition, ConditionType, ConfigSyncStatus, Failure, SourceStatus } from "./types";

/** How one reconcile ended. */
export type SyncOutcome =
  | ({ result: "failed" } & Failure)
  | {
      result: "synced";
      /** Labels of the stores that were read, in the order of the sources. */
      stores: string[];
      sources: SourceStatus[];
      configHash: string;
      /** True when every file is missing or holds no values. */
      empty: boolean;
      wiringProblems: string[];
    }
  | { result: "suspended" };

/** What the reconcile saw of the resource it acted on. */
export interface Observed {
  generation?: number;
  syncRequest?: string;
  /** The current time, ISO 8601. */
  now: string;
}

/** An Event to record on a ConfigSync. */
export interface EventNote {
  type: "Normal" | "Warning";
  reason: string;
  message: string;
}

/**
 * Sets one condition in a list.
 * @param conditions The current conditions.
 * @param next The condition to set.
 * @param now The current time, used only when the condition's status changes.
 * @returns A new list with the condition in place.
 */
export function withCondition(conditions: Condition[], next: Omit<Condition, "lastTransitionTime">, now: string): Condition[] {
  const current = conditions.find((condition) => condition.type === next.type);
  const lastTransitionTime = current?.status === next.status ? current.lastTransitionTime : now;
  return [...conditions.filter((condition) => condition.type !== next.type), { ...next, lastTransitionTime }];
}

/**
 * Builds the status of a ConfigSync after a reconcile.
 * @param previous The status before the reconcile.
 * @param outcome How the reconcile ended.
 * @param observed The generation and sync request that were acted on, and the time.
 * @returns The new status. A failure or a suspension keeps what the last good sync recorded.
 */
export function nextStatus(previous: ConfigSyncStatus | undefined, outcome: SyncOutcome, observed: Observed): ConfigSyncStatus {
  const status: ConfigSyncStatus = {
    ...previous,
    observedGeneration: observed.generation,
    lastHandledSyncRequest: observed.syncRequest,
  };
  let conditions = previous?.conditions ?? [];
  const set = (type: ConditionType, ok: boolean, reason: string, message: string) => {
    conditions = withCondition(conditions, { type, status: ok ? "True" : "False", reason, message }, observed.now);
  };

  if (outcome.result === "suspended") {
    set("Suspended", true, "Suspended", "syncing is suspended");
  } else if (outcome.result === "failed") {
    set("Ready", false, outcome.reason, outcome.message);
    set("Suspended", false, "Active", "syncing is active");
  } else {
    status.lastSyncTime = observed.now;
    status.configHash = outcome.configHash;
    status.stores = outcome.stores;
    status.sources = outcome.sources;
    set("Ready", true, "Synced", "the outputs match the store");
    if (outcome.empty) set("SourcesFound", false, "NoSources", "every source file is missing or empty");
    else set("SourcesFound", true, "Found", "at least one source file holds values");
    if (outcome.wiringProblems.length > 0) set("TargetsWired", false, "NotWired", outcome.wiringProblems.join("; "));
    else set("TargetsWired", true, "Wired", "every target exists and uses the outputs that hold values");
    set("Suspended", false, "Active", "syncing is active");
  }
  return { ...status, conditions };
}

/**
 * Works out which Events a reconcile must record.
 * @param previous The status before the reconcile.
 * @param next The status after it.
 * @returns One note for each condition that changed to something worth telling; none when nothing changed.
 */
export function eventsFor(previous: ConfigSyncStatus | undefined, next: ConfigSyncStatus): EventNote[] {
  const notes: EventNote[] = [];
  for (const type of ["Ready", "SourcesFound", "TargetsWired", "Suspended"] as const) {
    const before = previous?.conditions?.find((condition) => condition.type === type);
    const after = next.conditions?.find((condition) => condition.type === type);
    if (!after || (before?.status === after.status && before.message === after.message)) continue;

    const note = (kind: EventNote["type"]) => notes.push({ type: kind, reason: after.reason, message: after.message });
    if (type === "Suspended") {
      if (after.status === "True") note("Normal");
      else if (before?.status === "True") notes.push({ type: "Normal", reason: "Resumed", message: after.message });
    } else if (after.status === "False") {
      note("Warning");
    } else if (type === "Ready" && before?.status === "False") {
      note("Normal");
    }
  }
  return notes;
}
```

`packages/core/src/trigger.ts`:

```ts
import type { ConfigSync } from "./types";

/** Annotation that asks for a sync; its value only has to change. */
export const SYNC_REQUESTED_ANNOTATION = "kmo.isntall.net/sync-requested-at";

/**
 * Reads the sync request of a ConfigSync.
 * @param sync The resource.
 * @returns The value of the sync annotation, or undefined when there is none.
 */
export function syncRequest(sync: ConfigSync): string | undefined {
  return sync.metadata.annotations?.[SYNC_REQUESTED_ANNOTATION];
}

/**
 * Tells whether a ConfigSync has changed in a way the operator has not acted on.
 * @param sync The resource as it is in the cluster now.
 * @returns False when neither its spec nor its sync request changed since the last reconcile.
 */
export function needsReconcile(sync: ConfigSync): boolean {
  const status = sync.status;
  return status?.observedGeneration !== sync.metadata.generation || status?.lastHandledSyncRequest !== syncRequest(sync);
}
```

Add `export * from "./status";` and `export * from "./trigger";` to `packages/core/src/index.ts`.

Run: `npx vitest run packages/core` Expected: PASS; 10 wiring tests, 12 status tests and 4 trigger tests are new.

- [x] **Step 3: Split the reconcile into "do" and "report"**

Replace `packages/operator/src/reconcile.ts`:

```ts
import {
  SourceParseError,
  buildOutputs,
  needsReconcile,
  outputObjects,
  planSync,
  storeLabel,
  wiringProblems,
  type PlannedSource,
  type SourceInput,
  type SourceStatus,
  type SyncOutcome,
} from "@kmo/core";
import { Log } from "pepr";
import { SyncFailure, getOrUndefined, listStores, readCredentials } from "./cluster";
import { ConfigSyncKind, ownerOf, toCore } from "./kinds";
import { writeOutputs } from "./outputs";
import { report } from "./report";
import { fetchSources, s3GetObject } from "./s3";
import { stampTargets } from "./targets";

/**
 * Reads the files of every source of a ConfigSync.
 * @param planned The sources in order, each with its store and keys.
 * @returns The texts for merging, and a record of every file asked for.
 * @throws SyncFailure when a store's credentials or one of its files cannot be read.
 */
export async function readSources(
  planned: PlannedSource[],
): Promise<{ inputs: SourceInput[]; sources: SourceStatus[] }> {
  const inputs: SourceInput[] = [];
  const sources: SourceStatus[] = [];
  for (const { store, keys } of planned) {
    const label = storeLabel(store);
    const get = s3GetObject(store, await readCredentials(store));
    const read = await fetchSources(get, label, store.spec.s3.bucket, keys);
    inputs.push({ store: label, texts: read.texts });
    sources.push(...read.sources);
  }
  return { inputs, sources };
}

/**
 * Does the work of one reconcile.
 * @param sync The resource as it is in the cluster now.
 * @returns How it ended. Expected failures are returned, never thrown.
 */
export async function runSync(sync: ConfigSyncKind): Promise<SyncOutcome> {
  try {
    const plan = planSync(toCore(sync), await listStores());
    if (!plan.ok) return { result: "failed", reason: plan.reason, message: plan.message };

    const read = await readSources(plan.sources);
    const outputs = buildOutputs(read.inputs);

    const owner = ownerOf(sync);
    await writeOutputs(outputObjects(plan.sync, outputs, owner), owner);
    const targets = await stampTargets(plan.sync, outputs.configHash);

    return {
      result: "synced",
      stores: plan.sources.map((source) => storeLabel(source.store)),
      sources: read.sources,
      configHash: outputs.configHash,
      empty: Object.keys(outputs.configMapData).length + Object.keys(outputs.secretData).length === 0,
      wiringProblems: wiringProblems(plan.sync, outputs, targets),
    };
  } catch (error) {
    if (error instanceof SyncFailure) return { result: "failed", reason: error.reason, message: error.message };
    if (error instanceof SourceParseError) return { result: "failed", reason: "SourceUnparsable", message: error.message };
    Log.error(error, "KMO sync failed unexpectedly");
    const name = error instanceof Error ? error.name : "unknown";
    return { result: "failed", reason: "InternalError", message: `unexpected error (${name}); see the operator log` };
  }
}

/**
 * Reconciles one ConfigSync.
 * @param delivered The resource Pepr delivered; it is read again, so queued duplicates find nothing to do.
 */
export async function reconcile(delivered: ConfigSyncKind): Promise<void> {
  const sync = await getOrUndefined(ConfigSyncKind, delivered.metadata?.name ?? "", delivered.metadata?.namespace);
  if (!sync || !needsReconcile(toCore(sync))) return;

  const outcome = await runSync(sync);
  await report(sync, outcome);
  Log.info({ namespace: sync.metadata?.namespace, name: sync.metadata?.name, result: outcome.result }, "KMO reconciled");
}
```

`packages/operator/src/report.ts`:

```ts
import { eventsFor, nextStatus, syncRequest, type SyncOutcome } from "@kmo/core";
import { K8s, sdk } from "pepr";
import { ConfigSyncKind, toCore } from "./kinds";

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
    status,
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
```

Add to `pepr.rbac`:

```json
      {
        "apiGroups": ["kmo.isntall.net"],
        "resources": ["configsyncs/status"],
        "verbs": ["get", "patch"]
      },
      {
        "apiGroups": [""],
        "resources": ["events"],
        "verbs": ["create"]
      }
```

- [x] **Step 4: Check, deploy, and prove there is no loop**

Run: `mise run lint && mise run test && mise run operator:deploy`

Run: `sleep 60 && mise run operator:logs | grep -c "KMO reconciled"` Expected: `5`, one for each ConfigSync, and the
number does not grow when the command is run again a minute later. If it grows, the guard does not work: stop and debug
before going on, because every extra reconcile reads every file of every source again.

- [x] **Step 5: After (show, then pause)**

Show the user, with the `sync` shell helper from Task 6:

```bash
kubectl get csync -n shop
kubectl get csync orders-api -n shop -o jsonpath='{.status}' | jq
```

Expected: the `Ready`, `Stores` and `Last sync` columns are filled now, and the status lists the four files with their
store and version IDs. Then one failure and one warning:

```bash
echo 'not an assignment' | mise run store -- s3 cp - s3://kmo-config/shop/orders-api/secrets.env
sync orders-api && sleep 5
kubectl get csync orders-api -n shop
kubectl describe csync orders-api -n shop | tail -8
kubectl get secret orders-api-kmo -n shop -o jsonpath='{.data}' ; echo
```

Expected: `Ready` is `False`, a Warning Event `SourceUnparsable` says `secrets, line 1: expected KEY=value`, and the
Secret still holds its old values: a failure never writes a partial result. Restore the file
(`mise run store -- s3 cp dev/store-files/shop/orders-api/secrets.env s3://kmo-config/shop/orders-api/secrets.env`, then
`sync orders-api`) and show the Normal Event `Synced`. Then the warning:

```bash
kubectl apply -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: nobody, namespace: shop }
EOF
sleep 5 && kubectl get csync nobody -n shop -o jsonpath='{.status.conditions}' | jq
kubectl delete csync nobody -n shop
```

Expected: `Ready` is `True` (the two empty objects were written), `SourcesFound` is `False` and `TargetsWired` is
`False` because the Deployment `nobody` does not exist. Also apply a ConfigSync with `refreshInterval: 30s` and show
`Ready` `False` with the reason `InvalidSpec`, while the other ConfigSyncs stay ready; delete it afterwards.

Say what does not work yet: a failed sync is not retried by itself, and nothing but a manual request starts a sync.
Update `docs/getting-started.md` (how to read a ConfigSync's state) and `CLAUDE.md` (step 8 done; the status-update
consequence is done). Pause for questions.

- [x] **Step 6: Commit (waits for the user)**

```bash
npm run format
git add packages docs CLAUDE.md
git commit -m "feat: report status, conditions and Events on a ConfigSync"
```



### Task 8: Staying in step

**Before (explain to the user):** A controller must not depend on being told about every change. Events get lost, the
operator restarts, people edit objects by hand. So a controller is **level-triggered**: it looks at how things are, not
at what happened, and it also looks again from time to time. This task adds the remaining reasons to look: a timer, a
change to an output object, a change to a target workload, and a change to a store. And it adds `suspend`, the switch
that makes KMO leave a resource alone.

Two additions to the spec to mention. First, none of these triggers reconciles by itself. Each one sets the sync
annotation on the ConfigSync, exactly as the receiver will, so there is one path into a reconcile and Pepr's queue runs
them one at a time for each resource. Second, the timer also asks again for every ConfigSync that is not ready, which is
how failures are retried.

Each trigger must also not fire for the operator's own writes, or one real change would cost several reconciles. An
output change is ignored when the two objects still hash to `status.configHash`. A workload change is ignored when its
spec generation did not change, or when its stamped hash is current and its wiring was fine. A store change is ignored
when its spec generation did not change.

Known limit to say out loud: if someone removes the reference to an output object from a wired workload, the
`TargetsWired` warning appears at the next sync, not at once. And a known cost: when the watcher starts, each workload
in the cluster causes one list of the ConfigSyncs in its namespace.

**Files:**

- Create: `packages/operator/src/generation-gate.ts`, `packages/operator/src/triggers.ts`,
  `packages/operator/test/generation-gate.test.ts`, `packages/core/test/triggers.test.ts`
- Modify: `packages/core/src/trigger.ts`, `packages/operator/src/reconcile.ts`, `packages/operator/src/capability.ts`,
  `packages/operator/package.json`, `docs/getting-started.md`, `CLAUDE.md`

**Interfaces:**

- Consumes: everything from Task 7; `ExistingObject`, `configHash`, `planSync`, `storeLabel`, `podTemplate`,
  `CONFIG_HASH_ANNOTATION`, `TARGET_MODELS`, `guardKind`, `ROLLOUT_GUARD`.
- Produces, from `@kmo/core` (`trigger.ts`):
  - `isSuspended(sync: ConfigSync): boolean`
  - `syncDue(sync: ConfigSync, now: Date): boolean` -
    `outputsDrifted(sync: ConfigSync, configMap: ExistingObject | undefined, secret: ExistingObject | undefined): boolean`
  - `targetNeedsSync(sync: ConfigSync, stampedHash: string | undefined): boolean`
  - `syncsTargeting(kind: TargetKind, name: string, syncs: ConfigSync[]): ConfigSync[]`
  - `syncsUsingStore(store: Store, syncs: ConfigSync[], stores: Store[]): ConfigSync[]`
- Produces, from the operator: `class GenerationGate` with `changed(object): boolean` and `forget(object): void`;
  `requestSync(sync: ConfigSync, why: string): Promise<void>`, `onTick()`, `onOutputChange(object)`,
  `onTargetChange(kind)`, `onStoreChange(kind)`, `onStoreDelete(kind)` in `triggers.ts`.

- [x] **Step 1: Write the failing tests**

`packages/core/test/triggers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { configHash } from "../src/hash";
import { nextStatus } from "../src/status";
import { outputsDrifted, syncDue, syncsTargeting, syncsUsingStore, targetNeedsSync } from "../src/trigger";
import type { ConfigSync, Store } from "../src/types";

const base64 = (text: string) => Buffer.from(text).toString("base64");
const hash = configHash({ A: "1" }, { B: "2" });
const syncedAt = (time: string, wiringProblems: string[] = []) =>
  nextStatus(
    undefined,
    { result: "synced", stores: ["ClusterConfigStore/default"], sources: [], configHash: hash, empty: false, wiringProblems },
    { generation: 1, now: time },
  );
const sync = (name: string, spec: ConfigSync["spec"] = {}, status = syncedAt("2026-10-11T09:00:00.000Z")): ConfigSync => ({
  metadata: { name, namespace: "shop", generation: 1 },
  spec,
  status,
});
const clusterStore = (name: string, allowedNamespaces = ["*"]): Store => ({
  kind: "ClusterConfigStore",
  metadata: { name },
  spec: { s3: { bucket: "b", region: "r", credentialsSecretRef: { name: "c", namespace: "kmo-system" } }, allowedNamespaces },
});

describe("a sync is due", () => {
  const now = (time: string) => new Date(`2026-10-11T${time}.000Z`);

  it("when the refresh interval has passed since the last sync", () => {
    expect(syncDue(sync("a"), now("09:29:59"))).toBe(false);
    expect(syncDue(sync("a"), now("09:30:00"))).toBe(true);
    expect(syncDue(sync("a", { refreshInterval: "5m" }), now("09:05:00"))).toBe(true);
  });

  it("when the resource has never been synced", () => {
    expect(syncDue({ metadata: { name: "a", namespace: "shop" } }, now("09:00:00"))).toBe(true);
  });

  it("at every check while the resource is not ready, so a failure is retried", () => {
    const failed = nextStatus(
      syncedAt("2026-10-11T09:00:00.000Z"),
      { result: "failed", reason: "StoreUnreachable", message: "m" },
      { generation: 1, now: "2026-10-11T09:01:00.000Z" },
    );
    expect(syncDue(sync("a", {}, failed), now("09:02:00"))).toBe(true);
  });

  it("never while the resource is suspended", () => {
    expect(syncDue(sync("a", { suspend: true }), now("12:00:00"))).toBe(false);
  });

  it("never while its spec cannot be used, since asking again changes nothing", () => {
    expect(syncDue(sync("a", { refreshInterval: "30s" }), now("12:00:00"))).toBe(false);
  });
});

describe("the output objects have drifted", () => {
  const configMap = { data: { A: "1" } };
  const secret = { data: { B: base64("2") } };

  it("not when they still hold what the last sync wrote", () => {
    expect(outputsDrifted(sync("a"), configMap, secret)).toBe(false);
  });

  it("when a value was edited by hand", () => {
    expect(outputsDrifted(sync("a"), { data: { A: "edited" } }, secret)).toBe(true);
    expect(outputsDrifted(sync("a"), configMap, { data: { B: base64("edited") } })).toBe(true);
  });

  it("when one of them was deleted", () => {
    expect(outputsDrifted(sync("a"), undefined, secret)).toBe(true);
  });
});

describe("a changed target needs a sync", () => {
  it("when it does not carry the current hash, as a new workload does not", () => {
    expect(targetNeedsSync(sync("a"), undefined)).toBe(true);
    expect(targetNeedsSync(sync("a"), "old")).toBe(true);
  });

  it("not when its hash is current and its wiring was fine", () => {
    expect(targetNeedsSync(sync("a"), hash)).toBe(false);
  });

  it("when its wiring was reported as wrong, because the change may have fixed it", () => {
    const status = syncedAt("2026-10-11T09:00:00.000Z", ['Deployment "a" does not exist']);
    expect(targetNeedsSync(sync("a", {}, status), hash)).toBe(true);
  });
});

describe("the ConfigSyncs behind a workload", () => {
  it("are those that name it as a target, by default or explicitly", () => {
    const syncs = [sync("orders-api"), sync("batch", { targets: [{ kind: "CronJob", name: "orders-api" }] }), sync("other")];
    expect(syncsTargeting("Deployment", "orders-api", syncs).map((s) => s.metadata.name)).toEqual(["orders-api"]);
    expect(syncsTargeting("CronJob", "orders-api", syncs).map((s) => s.metadata.name)).toEqual(["batch"]);
  });
});

describe("the ConfigSyncs behind a store", () => {
  it("are those that would use it now", () => {
    const store = clusterStore("default");
    const named = sync("named", { sources: [{ storeRef: { kind: "ClusterConfigStore", name: "other" } }] }, {});
    const result = syncsUsingStore(store, [sync("a", {}, {}), named], [store, clusterStore("other")]);
    expect(result.map((s) => s.metadata.name)).toEqual(["a"]);
  });

  it("include those that list it as one of several sources", () => {
    const other = clusterStore("other");
    const sources = [{ storeRef: { kind: "ClusterConfigStore", name: "default" } as const }, { storeRef: { kind: "ClusterConfigStore", name: "other" } as const }];
    const result = syncsUsingStore(other, [sync("both", { sources }, {})], [clusterStore("default"), other]);
    expect(result.map((s) => s.metadata.name)).toEqual(["both"]);
  });

  it("include those that used it last time, so they notice when it is deleted", () => {
    expect(syncsUsingStore(clusterStore("default"), [sync("a")], []).map((s) => s.metadata.name)).toEqual(["a"]);
  });
});
```

`packages/operator/test/generation-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GenerationGate } from "../src/generation-gate";

const object = (generation: number, uid = "uid-1") => ({ metadata: { uid, generation } });

describe("the generation gate", () => {
  it("lets an object through the first time it is seen", () => {
    expect(new GenerationGate().changed(object(1))).toBe(true);
  });

  it("stops an update that left the spec as it was, such as a status update", () => {
    const gate = new GenerationGate();
    gate.changed(object(1));
    expect(gate.changed(object(1))).toBe(false);
  });

  it("lets an object through again when its spec changed", () => {
    const gate = new GenerationGate();
    gate.changed(object(1));
    expect(gate.changed(object(2))).toBe(true);
  });

  it("tells objects apart", () => {
    const gate = new GenerationGate();
    gate.changed(object(1, "uid-1"));
    expect(gate.changed(object(1, "uid-2"))).toBe(true);
  });

  it("forgets an object that was deleted", () => {
    const gate = new GenerationGate();
    gate.changed(object(1));
    gate.forget(object(1));
    expect(gate.changed(object(1))).toBe(true);
  });
});
```

Run: `npx vitest run packages/core/test/triggers.test.ts packages/operator/test/generation-gate.test.ts` Expected: FAIL,
the functions and the class do not exist.

- [x] **Step 2: Write the core functions**

Append to `packages/core/src/trigger.ts`, and replace its imports with:

```ts
import { ConfigSyncSpecError, resolveConfigSync, type ResolvedConfigSync } from "./defaults";
import { configHash } from "./hash";
import type { ExistingObject } from "./outputs";
import { findStore, storeLabel } from "./store";
import type { ConfigSync, Store, TargetKind } from "./types";
```

```ts
function resolveOrUndefined(sync: ConfigSync): ResolvedConfigSync | undefined {
  try {
    return resolveConfigSync(sync);
  } catch (error) {
    if (error instanceof ConfigSyncSpecError) return undefined;
    throw error;
  }
}

/**
 * Tells whether a ConfigSync is suspended.
 * @param sync The resource.
 * @returns True when its spec sets suspend.
 */
export function isSuspended(sync: ConfigSync): boolean {
  return sync.spec?.suspend === true;
}

/**
 * Tells whether the timer must ask for a sync of a ConfigSync.
 * @param sync The resource.
 * @param now The current time.
 * @returns True when it was never synced, is not ready, or its refresh interval has passed. Never for a suspended
 *   resource or one whose spec cannot be used.
 */
export function syncDue(sync: ConfigSync, now: Date): boolean {
  const resolved = resolveOrUndefined(sync);
  if (!resolved || resolved.suspend) return false;
  const ready = sync.status?.conditions?.find((condition) => condition.type === "Ready");
  if (ready?.status === "False" || !sync.status?.lastSyncTime) return true;
  return now.getTime() - new Date(sync.status.lastSyncTime).getTime() >= resolved.refreshIntervalMs;
}

/**
 * Tells whether the output objects differ from what the last sync wrote.
 * @param sync The ConfigSync that owns them.
 * @param configMap The ConfigMap in the cluster, if it exists.
 * @param secret The Secret in the cluster, if it exists, with base64 data.
 * @returns True when one is missing or their contents no longer hash to the recorded config hash.
 */
export function outputsDrifted(sync: ConfigSync, configMap: ExistingObject | undefined, secret: ExistingObject | undefined): boolean {
  if (!configMap || !secret) return true;
  const decoded = Object.fromEntries(
    Object.entries(secret.data ?? {}).map(([key, value]) => [key, Buffer.from(value, "base64").toString("utf8")]),
  );
  return configHash(configMap.data ?? {}, decoded) !== sync.status?.configHash;
}

/**
 * Tells whether a change to a target workload calls for a sync.
 * @param sync A ConfigSync that targets the workload.
 * @param stampedHash The config hash on the workload's pod template, if any.
 * @returns True when the hash is not current, or the last sync reported a wiring problem.
 */
export function targetNeedsSync(sync: ConfigSync, stampedHash: string | undefined): boolean {
  const wired = sync.status?.conditions?.find((condition) => condition.type === "TargetsWired");
  return stampedHash !== sync.status?.configHash || wired?.status !== "True";
}

/**
 * Finds the ConfigSyncs that target a workload.
 * @param kind The workload's kind.
 * @param name The workload's name.
 * @param syncs The ConfigSyncs of the workload's namespace.
 * @returns Those whose resolved targets include the workload.
 */
export function syncsTargeting(kind: TargetKind, name: string, syncs: ConfigSync[]): ConfigSync[] {
  return syncs.filter((sync) =>
    resolveOrUndefined(sync)?.targets.some((target) => target.kind === kind && target.name === name),
  );
}

/**
 * Finds the ConfigSyncs that a change to a store can affect.
 * @param store The store that was created, changed or deleted.
 * @param syncs Every ConfigSync in the cluster.
 * @param stores Every store in the cluster now.
 * @returns Those that read the store at their last sync, or that have a source that resolves to it now.
 */
export function syncsUsingStore(store: Store, syncs: ConfigSync[], stores: Store[]): ConfigSync[] {
  const same = (other: Store) =>
    other.kind === store.kind && other.metadata.name === store.metadata.name && other.metadata.namespace === store.metadata.namespace;
  return syncs.filter((sync) => {
    const inReach = store.kind === "ClusterConfigStore" || store.metadata.namespace === sync.metadata.namespace;
    if (!inReach) return false;
    if (sync.status?.stores?.includes(storeLabel(store))) return true;
    const resolved = resolveOrUndefined(sync);
    if (!resolved) return false;
    return resolved.sources.some((source) => {
      const lookup = findStore(resolved.namespace, source.storeRef, stores);
      return lookup.ok && same(lookup.store);
    });
  });
}
```

Run: `npx vitest run packages/core/test/triggers.test.ts` Expected: PASS, 15 tests.

- [x] **Step 3: Write the gate and the triggers**

`packages/operator/src/generation-gate.ts`:

```ts
/** The parts of an object the gate reads. */
interface Versioned {
  metadata?: { uid?: string; generation?: number };
}

/** Remembers the spec generation last seen of each object, to tell spec changes from other updates. */
export class GenerationGate {
  readonly #seen = new Map<string, number>();

  /**
   * Records an object and tells whether its spec changed since it was last seen.
   * @param object The object a watch delivered.
   * @returns True the first time, and whenever the generation differs from the one recorded.
   */
  changed(object: Versioned): boolean {
    const uid = object.metadata?.uid ?? "";
    const generation = object.metadata?.generation ?? 0;
    if (this.#seen.get(uid) === generation) return false;
    this.#seen.set(uid, generation);
    return true;
  }

  /**
   * Drops what is remembered of an object.
   * @param object The object that was deleted.
   */
  forget(object: Versioned): void {
    this.#seen.delete(object.metadata?.uid ?? "");
  }
}
```

`packages/operator/src/triggers.ts`:

```ts
import {
  CONFIG_HASH_ANNOTATION,
  SYNC_REQUESTED_ANNOTATION,
  isSuspended,
  outputsDrifted,
  podTemplate,
  resolveConfigSync,
  syncDue,
  syncsTargeting,
  syncsUsingStore,
  targetNeedsSync,
  type ConfigSync,
  type ExistingObject,
  type Store,
  type StoreKind,
  type TargetKind,
} from "@kmo/core";
import type { KubernetesObject } from "kubernetes-fluent-client";
import { K8s, Log, a } from "pepr";
import { getOrUndefined, listStores } from "./cluster";
import { GenerationGate } from "./generation-gate";
import { ClusterConfigStoreKind, ConfigStoreKind, ConfigSyncKind, toCore } from "./kinds";

const targetGate = new GenerationGate();
const storeGate = new GenerationGate();

/**
 * Asks for a sync of a ConfigSync, the same way the receiver does.
 * @param sync The resource.
 * @param why The trigger, for the log.
 */
export async function requestSync(sync: ConfigSync, why: string): Promise<void> {
  const { name, namespace } = sync.metadata;
  await K8s(ConfigSyncKind).Apply(
    { metadata: { name, namespace, annotations: { [SYNC_REQUESTED_ANNOTATION]: new Date().toISOString() } } },
    { force: true },
  );
  Log.info({ namespace, name, why }, "KMO requested a sync");
}

async function listSyncs(namespace?: string): Promise<ConfigSync[]> {
  const client = namespace ? K8s(ConfigSyncKind).InNamespace(namespace) : K8s(ConfigSyncKind);
  return (await client.Get()).items.map(toCore);
}

/** Asks for a sync of every ConfigSync that is due. Run once a minute. */
export async function onTick(): Promise<void> {
  const now = new Date();
  for (const sync of await listSyncs()) {
    if (syncDue(sync, now)) await requestSync(sync, "timer");
  }
}

/**
 * Reacts to a created, changed or deleted output object.
 * @param object The ConfigMap or Secret a watch delivered.
 */
export async function onOutputChange(object: KubernetesObject): Promise<void> {
  const owner = object.metadata?.ownerReferences?.find((reference) => reference.kind === "ConfigSync");
  const namespace = object.metadata?.namespace;
  if (!owner || !namespace) return;

  const found = await getOrUndefined(ConfigSyncKind, owner.name, namespace);
  if (!found || found.metadata?.deletionTimestamp) return;
  const sync = toCore(found);
  if (isSuspended(sync)) return;

  let output;
  try {
    output = resolveConfigSync(sync).output;
  } catch {
    return;
  }
  const [configMap, secret] = await Promise.all([
    getOrUndefined(a.ConfigMap, output.configMapName, namespace),
    getOrUndefined(a.Secret, output.secretName, namespace),
  ]);
  if (outputsDrifted(sync, configMap as ExistingObject | undefined, secret as ExistingObject | undefined)) {
    await requestSync(sync, "output changed");
  }
}

/**
 * Makes the handler for created or changed workloads of one kind.
 * @param kind The workload kind.
 * @returns A watch callback.
 */
export function onTargetChange(kind: TargetKind) {
  return async (workload: KubernetesObject): Promise<void> => {
    const { name, namespace } = workload.metadata ?? {};
    if (!name || !namespace || !targetGate.changed(workload)) return;

    const stamped = podTemplate(kind, workload)?.metadata?.annotations?.[CONFIG_HASH_ANNOTATION];
    for (const sync of syncsTargeting(kind, name, await listSyncs(namespace))) {
      if (!isSuspended(sync) && targetNeedsSync(sync, stamped)) await requestSync(sync, `${kind} changed`);
    }
  };
}

function toStore(kind: StoreKind, object: ConfigStoreKind | ClusterConfigStoreKind): Store | undefined {
  const name = object.metadata?.name;
  if (!name || !object.spec) return undefined;
  const namespace = kind === "ConfigStore" ? object.metadata?.namespace : undefined;
  return { kind, metadata: { name, namespace }, spec: object.spec };
}

async function syncUsersOf(store: Store, why: string): Promise<void> {
  const [syncs, stores] = await Promise.all([listSyncs(), listStores()]);
  for (const sync of syncsUsingStore(store, syncs, stores)) {
    if (!isSuspended(sync)) await requestSync(sync, why);
  }
}

/**
 * Makes the handler for created or changed stores of one kind.
 * @param kind The store kind.
 * @returns A watch callback.
 */
export function onStoreChange(kind: StoreKind) {
  return async (object: ConfigStoreKind | ClusterConfigStoreKind): Promise<void> => {
    const store = toStore(kind, object);
    if (store && storeGate.changed(object)) await syncUsersOf(store, "store changed");
  };
}

/**
 * Makes the handler for deleted stores of one kind.
 * @param kind The store kind.
 * @returns A watch callback.
 */
export function onStoreDelete(kind: StoreKind) {
  return async (object: ConfigStoreKind | ClusterConfigStoreKind): Promise<void> => {
    const store = toStore(kind, object);
    storeGate.forget(object);
    if (store) await syncUsersOf(store, "store deleted");
  };
}
```

Run: `npx vitest run packages/operator/test/generation-gate.test.ts` Expected: PASS, 5 tests.

- [x] **Step 4: Suspend, and bind the triggers**

In `runSync` in `packages/operator/src/reconcile.ts`, add as the first lines inside `try`, and import `isSuspended` from
`@kmo/core`. It comes before the plan, so a suspended resource causes no read of any kind:

```ts
    if (isSuspended(toCore(sync))) return { result: "suspended" };
```

Replace the bindings in `packages/operator/src/capability.ts` below the `Kmo` capability (keep the imports it needs:
`MANAGED_BY`, `MANAGED_BY_LABEL` from `@kmo/core`; `ClusterConfigStoreKind`, `ConfigStoreKind`, `ConfigSyncKind`,
`Rollout` from `./kinds`; the trigger handlers from `./triggers`):

```ts
const { When, OnSchedule } = Kmo;

When(ConfigSyncKind).IsCreatedOrUpdated().Reconcile(reconcile);

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
```

The schedule still logs `KMO tick`, because `test/e2e/rollout-guard.sh` counts those lines.

In `pepr.rbac`, the rules now need these verbs (replace the earlier rules for the same resources):

```json
      {
        "apiGroups": ["kmo.isntall.net"],
        "resources": ["configsyncs"],
        "verbs": ["get", "list", "watch", "patch"]
      },
      {
        "apiGroups": ["kmo.isntall.net"],
        "resources": ["configstores", "clusterconfigstores"],
        "verbs": ["get", "list", "watch"]
      },
      {
        "apiGroups": [""],
        "resources": ["configmaps", "secrets"],
        "verbs": ["get", "list", "watch", "create", "patch"]
      },
      {
        "apiGroups": ["apps"],
        "resources": ["deployments", "statefulsets", "daemonsets"],
        "verbs": ["get", "list", "watch", "patch"]
      },
      {
        "apiGroups": ["batch"],
        "resources": ["cronjobs"],
        "verbs": ["get", "list", "watch", "patch"]
      }
```

- [x] **Step 5: Check, deploy, and prove the triggers do not feed themselves**

Run: `mise run lint && mise run test && mise run operator:deploy`

Run:
`sleep 150 && mise run operator:logs | grep -c "KMO requested a sync"; mise run operator:logs | grep -c "KMO reconciled"`
Expected: both numbers are small (at most one request and one reconcile for each ConfigSync from the restart) and do not
grow when the command is run again two minutes later. If they grow, a trigger reacts to the operator's own writes: find
which `why` repeats in the log and fix that trigger's test and rule before going on.

Run: `mise run check:rollout-guard` Expected: all checks pass. The Rollout watch now does real work, so the proof is
repeated.

- [x] **Step 6: After (show, then pause)**

Show the user, one at a time, each followed by `mise run operator:logs | grep "KMO requested a sync" | tail -3`:

1. **A hand edit is reverted at once.**
   `kubectl patch configmap orders-api-kmo -n shop --type merge -p '{"data":{"GREETING":"edited"}}'`, then after a few
   seconds `kubectl get configmap orders-api-kmo -n shop -o jsonpath='{.data.GREETING}'` shows the value of the store.
2. **A deleted output comes back.** `kubectl delete secret orders-api-kmo -n shop`, then `kubectl get secret -n shop`.
3. **A workload created after its ConfigSync is stamped.** Apply a ConfigSync named `late` in `shop`, show
   `TargetsWired` `False`, then create a Deployment `late` (copy `dev/workloads/orders-api.yaml` with the name and the
   two references changed to `late` and `late-kmo`) and show `TargetsWired` become `True` and the hash annotation on its
   pod template. Delete both afterwards.
4. **A store that appears after its ConfigSync.** Apply a ConfigSync named `waiting` in `shop` with
   `sources: [{ storeRef: { kind: ClusterConfigStore, name: later } }]`; show `Ready` `False`, reason `StoreNotFound`. Apply a
   ClusterConfigStore `later` that is a copy of `default`; show `Ready` become `True` with no manual request. Delete
   both afterwards.
5. **A failure is retried.** Scale the store down (`kubectl scale deployment rustfs -n kmo-dev --replicas=0`), run
   `sync orders-api`, show `Ready` `False` with `StoreUnreachable` and that the objects are untouched. Scale it up and
   run `mise run deploy` (the store's data is in memory, so the seed Job must run again). Within about a minute `Ready`
   is `True` again without a request by hand.
6. **Suspend.** `kubectl patch csync orders-api -n shop --type merge -p '{"spec":{"suspend":true}}'`. Show the
   `Suspended` column and condition and the Event. Edit the ConfigMap by hand as in item 1: this time it stays edited,
   and `sync orders-api` changes nothing. Then set `suspend` to `false`: the edit is reverted at once.

Say what is still missing for the full loop: the receiver, which turns a change in the store into a sync request within
seconds. Until then the refresh interval, 30 minutes by default, is what picks up a changed file. Update
`docs/getting-started.md` and `CLAUDE.md` (step 9 done). Pause for questions.

- [x] **Step 7: Commit (waits for the user)**

```bash
npm run format
git add packages docs CLAUDE.md
git commit -m "feat: keep ConfigSyncs in step by timer and on changes, and add suspend"
```



### Task 9: Guarding

**Before (explain to the user):** Two ConfigSyncs that claim the same workload, or the same output name, would overwrite
each other's work and restart the workload again and again. The place to stop that is **admission**: before the API
server stores a change, it can ask a webhook, and the webhook can say no with a message. The person who makes the
mistake sees it at once, in the output of `kubectl apply`. Pepr runs this webhook in its admission pods, a separate
Deployment from the watcher. Two limits to say out loud: two conflicting resources created at the same instant can both
pass, which the spec accepts; and the webhook's failure policy is `reject`, so while the admission pods are down no
ConfigSync can be created or changed, and that includes the operator's own sync requests.

**Files:**

- Create: `packages/core/src/claims.ts`, `packages/core/test/claims.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/operator/src/capability.ts`, `docs/getting-started.md`, `CLAUDE.md`

**Interfaces:**

- Consumes: `resolveConfigSync`, `ConfigSyncSpecError`, `ConfigSyncKind`, `toCore`, `reconcile`.
- Produces, from `@kmo/core`: `findClaimConflict(candidate: ConfigSync, others: ConfigSync[]): string | undefined`.

- [x] **Step 1: Write the failing test**

`packages/core/test/claims.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findClaimConflict } from "../src/claims";
import type { ConfigSync } from "../src/types";

const sync = (name: string, spec: ConfigSync["spec"] = {}): ConfigSync => ({ metadata: { name, namespace: "shop" }, spec });

describe("a ConfigSync conflicts with another", () => {
  it("when both target the same workload", () => {
    const candidate = sync("second", { targets: [{ name: "orders-api" }] });
    expect(findClaimConflict(candidate, [sync("orders-api")])).toBe(
      'Deployment "orders-api" is already a target of ConfigSync "orders-api"',
    );
  });

  it("when both write a ConfigMap with the same name", () => {
    const candidate = sync("second", { output: { configMapName: "orders-api-kmo" } });
    expect(findClaimConflict(candidate, [sync("orders-api")])).toBe(
      'ConfigMap "orders-api-kmo" is already an output of ConfigSync "orders-api"',
    );
  });

  it("when both write a Secret with the same name", () => {
    const candidate = sync("second", { output: { secretName: "orders-api-kmo" } });
    expect(findClaimConflict(candidate, [sync("orders-api")])).toBe(
      'Secret "orders-api-kmo" is already an output of ConfigSync "orders-api"',
    );
  });

  it("even when the other one is suspended, because it keeps its claims", () => {
    const candidate = sync("second", { targets: [{ name: "orders-api" }] });
    expect(findClaimConflict(candidate, [sync("orders-api", { suspend: true })])).toBeDefined();
  });
});

describe("a ConfigSync does not conflict", () => {
  it("with one that targets a workload of the same name but another kind", () => {
    const candidate = sync("second", { targets: [{ kind: "CronJob", name: "orders-api" }] });
    expect(findClaimConflict(candidate, [sync("orders-api")])).toBeUndefined();
  });

  it("with an earlier version of itself", () => {
    expect(findClaimConflict(sync("orders-api", { suspend: true }), [sync("orders-api")])).toBeUndefined();
  });

  it("when it serves several workloads that nothing else claims", () => {
    const candidate = sync("shared", { targets: [{ name: "one" }, { kind: "CronJob", name: "two" }] });
    expect(findClaimConflict(candidate, [sync("orders-api")])).toBeUndefined();
  });

  it("with a ConfigSync whose spec cannot be read; that one reports its own problem", () => {
    expect(findClaimConflict(sync("second"), [sync("broken", { refreshInterval: "soon" })])).toBeUndefined();
  });
});
```

Run: `npx vitest run packages/core/test/claims.test.ts` Expected: FAIL, the module `../src/claims` does not exist.

- [x] **Step 2: Write the rule**

`packages/core/src/claims.ts`:

```ts
import { ConfigSyncSpecError, resolveConfigSync, type ResolvedConfigSync } from "./defaults";
import type { ConfigSync } from "./types";

function resolveOrUndefined(sync: ConfigSync): ResolvedConfigSync | undefined {
  try {
    return resolveConfigSync(sync);
  } catch (error) {
    if (error instanceof ConfigSyncSpecError) return undefined;
    throw error;
  }
}

/**
 * Looks for a target or output name that a ConfigSync shares with another.
 * @param candidate The ConfigSync being created or changed.
 * @param others The ConfigSyncs of the same namespace; an entry with the candidate's name is ignored.
 * @returns A message naming the first shared claim and its holder, or undefined when there is none.
 */
export function findClaimConflict(candidate: ConfigSync, others: ConfigSync[]): string | undefined {
  const mine = resolveOrUndefined(candidate);
  if (!mine) return undefined;

  for (const other of others) {
    if (other.metadata.name === candidate.metadata.name) continue;
    const theirs = resolveOrUndefined(other);
    if (!theirs) continue;
    const holder = `ConfigSync "${theirs.name}"`;

    const shared = mine.targets.find((target) =>
      theirs.targets.some((taken) => taken.kind === target.kind && taken.name === target.name),
    );
    if (shared) return `${shared.kind} "${shared.name}" is already a target of ${holder}`;
    if (mine.output.configMapName === theirs.output.configMapName) {
      return `ConfigMap "${mine.output.configMapName}" is already an output of ${holder}`;
    }
    if (mine.output.secretName === theirs.output.secretName) {
      return `Secret "${mine.output.secretName}" is already an output of ${holder}`;
    }
  }
  return undefined;
}
```

Add `export * from "./claims";` to `packages/core/src/index.ts`.

Run: `npx vitest run packages/core/test/claims.test.ts` Expected: PASS, 8 tests.

- [x] **Step 3: Bind the admission check**

In `packages/operator/src/capability.ts`, replace the ConfigSync binding, and import `findClaimConflict` from
`@kmo/core`, `K8s` from `pepr` and `toCore` from `./kinds`:

```ts
When(ConfigSyncKind)
  .IsCreatedOrUpdated()
  .Validate(async (request) => {
    const namespace = request.Raw.metadata?.namespace ?? "";
    const others = await K8s(ConfigSyncKind).InNamespace(namespace).Get();
    const conflict = findClaimConflict(toCore(request.Raw), others.items.map(toCore));
    return conflict ? request.Deny(conflict) : request.Approve();
  })
  .Reconcile(reconcile);
```

No new RBAC rule is needed: the admission pods use the same ServiceAccount, which may already list ConfigSyncs.

- [x] **Step 4: Check and deploy**

Run: `mise run lint && mise run test && mise run operator:deploy`

Run: `kubectl get validatingwebhookconfiguration pepr-kmo -o jsonpath='{.webhooks[*].rules}' | jq` Expected: a rule for
`configsyncs` in `kmo.isntall.net`. This is what tells the API server to ask the operator.

- [x] **Step 5: After (show, then pause)**

Show the user:

```bash
kubectl apply -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: second, namespace: shop }
spec: { targets: [{ name: orders-api }] }
EOF
kubectl apply -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: second, namespace: shop }
spec: { targets: [{ name: nothing-else-uses-this }], output: { secretName: orders-api-kmo } }
EOF
kubectl patch csync orders-api -n shop --type merge -p '{"spec":{"suspend":true}}'
kubectl apply -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: second, namespace: shop }
spec: { targets: [{ name: orders-api }] }
EOF
kubectl patch csync orders-api -n shop --type merge -p '{"spec":{"suspend":false}}'
kubectl get csync -n shop
```

Expected: the first is denied with `Deployment "orders-api" is already a target of ConfigSync "orders-api"`, the second
with `Secret "orders-api-kmo" is already an output of ConfigSync "orders-api"`, the third is denied although
`orders-api` is suspended, and no ConfigSync `second` exists. Also show that the operator still works behind its own
webhook: `sync orders-api` is accepted. Update `docs/getting-started.md` and `CLAUDE.md` (step 10 done). Pause for
questions.

- [x] **Step 6: Commit (waits for the user)**

```bash
npm run format
git add packages docs CLAUDE.md
git commit -m "feat: reject a ConfigSync that conflicts with another"
```



### Task 10: Tenants

**Before (explain to the user):** A **tenant** is a team that shares the cluster with others. Kubernetes separates
tenants by **namespace**: RBAC decides who may read or write what in which namespace. One thing it cannot do is hide a
Secret from people who can run pods in the Secret's namespace, because a pod can mount it. So KMO has two kinds of
store. A trusted team keeps a ConfigStore and its credentials in its own namespace. For a team that must not see
credentials, an administrator creates a ClusterConfigStore whose credentials live in `kmo-system`, and lists which
namespaces may use it. A ConfigSync on such a shared store reads only its own namespace's folder and the common
folder: it cannot name a key, and the definition refuses a cluster-wide store whose service folder lacks `{namespace}`.
The rules themselves are in `@kmo/core` (`findStore`, `allowsNamespace`, `storeKeys`). This task gives the local environment two tenants to prove them on the cluster, and adds the
last missing report: the `Ready` condition of a store.

**Files:**

- Create: `dev/tenants/payments.yaml`, `dev/tenants/partners.yaml`, `dev/store-files/partners-store/_common/config.env`,
  `dev/store-files/partners-store/partners/portal/config.env`, `dev/store-files-tenant/_common/config.env`,
  `dev/store-files-tenant/payments/ledger/config.env`, `packages/operator/src/store-status.ts`,
  `packages/core/test/store-status.test.ts`
- Modify: `packages/core/src/status.ts`, `packages/operator/src/s3.ts`, `packages/operator/src/triggers.ts`,
  `packages/operator/src/kinds.ts`, `packages/operator/package.json`, `dev/kustomization.yaml`,
  `dev/store/seed-job.yaml`, `dev/README.md`, `docs/getting-started.md`, `README.md`, `CLAUDE.md`

**Interfaces:**

- Consumes: `withCondition`, `Condition`, `s3Client`, `readCredentials`, `SyncFailure`, `listStores`, `onTick`,
  `onStoreChange`.
- Produces, from `@kmo/core`:
  `storeConditions(previous: Condition[] | undefined, problem: string | undefined, now: string): Condition[]`.
- Produces, from the operator: `checkBucket(store: Store, credentials: StoreCredentials): Promise<void>` in `s3.ts`;
  `reportStore(store: Store, previous: Condition[] | undefined): Promise<void>` and `checkAllStores(): Promise<void>` in
  `store-status.ts`.
- Produces in the cluster: the namespace `payments` with its own ConfigStore `default` on the bucket `kmo-tenant`; the
  namespace `partners`, served by the ClusterConfigStore `partners` on the bucket `kmo-config` under the key prefix
  `partners-store`.

- [x] **Step 1: Write the failing test for the store's condition**

`packages/core/test/store-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { storeConditions } from "../src/status";

describe("the Ready condition of a store", () => {
  it("is true when the bucket can be reached with the store's credentials", () => {
    expect(storeConditions(undefined, undefined, "2026-10-11T09:00:00.000Z")).toEqual([
      {
        type: "Ready",
        status: "True",
        reason: "Reachable",
        message: "the bucket can be reached",
        lastTransitionTime: "2026-10-11T09:00:00.000Z",
      },
    ]);
  });

  it("is false with the problem when it cannot", () => {
    const [ready] = storeConditions(undefined, 'Secret kmo-system/creds was not found', "2026-10-11T09:00:00.000Z");
    expect(ready).toMatchObject({ status: "False", reason: "NotReachable", message: "Secret kmo-system/creds was not found" });
  });

  it("keeps the time it last changed while the store stays reachable", () => {
    const first = storeConditions(undefined, undefined, "2026-10-11T09:00:00.000Z");
    const [ready] = storeConditions(first, undefined, "2026-10-11T09:01:00.000Z");
    expect(ready?.lastTransitionTime).toBe("2026-10-11T09:00:00.000Z");
  });
});
```

Run: `npx vitest run packages/core/test/store-status.test.ts` Expected: FAIL, `storeConditions` does not exist.

- [x] **Step 2: Write the condition and the bucket check**

Append to `packages/core/src/status.ts`:

```ts
/**
 * Builds the conditions of a store after a check of its bucket.
 * @param previous The store's conditions before the check.
 * @param problem Why the bucket cannot be reached, or undefined when it can.
 * @param now The current time, used only when the condition's status changes.
 * @returns The store's conditions, with Ready set.
 */
export function storeConditions(previous: Condition[] | undefined, problem: string | undefined, now: string): Condition[] {
  const next = problem
    ? { type: "Ready" as const, status: "False" as const, reason: "NotReachable", message: problem }
    : { type: "Ready" as const, status: "True" as const, reason: "Reachable", message: "the bucket can be reached" };
  return withCondition(previous ?? [], next, now);
}
```

Run: `npx vitest run packages/core/test/store-status.test.ts` Expected: PASS, 3 tests.

Append to `packages/operator/src/s3.ts`, and add `HeadBucketCommand` to its import from `@aws-sdk/client-s3`:

```ts
/**
 * Checks that a store's bucket can be reached with its credentials.
 * @param store The store.
 * @param credentials Its keys.
 * @throws SyncFailure with reason StoreUnreachable, naming the bucket and the error's name only.
 */
export async function checkBucket(store: Store, credentials: StoreCredentials): Promise<void> {
  try {
    await s3Client(store, credentials).send(new HeadBucketCommand({ Bucket: store.spec.s3.bucket }));
  } catch (error) {
    const code = (error as { name?: string }).name ?? "unknown error";
    throw new SyncFailure("StoreUnreachable", `could not reach bucket "${store.spec.s3.bucket}": ${code}`);
  }
}
```

In `packages/operator/src/kinds.ts`, change the `status` of `ConfigStoreKind` and `ClusterConfigStoreKind` to
`status?: { conditions?: Condition[] };` and import `type Condition` from `@kmo/core`.

`packages/operator/src/store-status.ts`:

```ts
import { storeConditions, type Condition, type Store } from "@kmo/core";
import { K8s, Log } from "pepr";
import { SyncFailure, readCredentials } from "./cluster";
import { ClusterConfigStoreKind, ConfigStoreKind } from "./kinds";
import { checkBucket } from "./s3";

/**
 * Checks one store's bucket and writes the result to the store's Ready condition.
 * @param store The store.
 * @param previous The store's conditions before the check.
 */
export async function reportStore(store: Store, previous: Condition[] | undefined): Promise<void> {
  let problem: string | undefined;
  try {
    await checkBucket(store, await readCredentials(store));
  } catch (error) {
    if (!(error instanceof SyncFailure)) throw error;
    problem = error.message;
  }

  const conditions = storeConditions(previous, problem, new Date().toISOString());
  const same = previous?.[0]?.status === conditions[0]?.status && previous?.[0]?.message === conditions[0]?.message;
  if (same) return;

  const { name, namespace } = store.metadata;
  if (store.kind === "ConfigStore") {
    await K8s(ConfigStoreKind).PatchStatus({ metadata: { name, namespace }, status: { conditions } });
  } else {
    await K8s(ClusterConfigStoreKind).PatchStatus({ metadata: { name }, status: { conditions } });
  }
  Log.info({ kind: store.kind, namespace, name, ready: !problem }, "KMO checked a store");
}

/** Checks every store in the cluster. Run once a minute. */
export async function checkAllStores(): Promise<void> {
  const [own, clusterWide] = await Promise.all([K8s(ConfigStoreKind).Get(), K8s(ClusterConfigStoreKind).Get()]);
  for (const item of own.items) {
    if (!item.spec || !item.metadata?.name) continue;
    const metadata = { name: item.metadata.name, namespace: item.metadata.namespace };
    await reportStore({ kind: "ConfigStore", metadata, spec: item.spec }, item.status?.conditions);
  }
  for (const item of clusterWide.items) {
    if (!item.spec || !item.metadata?.name) continue;
    await reportStore({ kind: "ClusterConfigStore", metadata: { name: item.metadata.name }, spec: item.spec }, item.status?.conditions);
  }
}
```

A status write does not change a store's `metadata.generation`, so the store watch's generation gate ignores it.

In `packages/operator/src/triggers.ts`, check a store when its spec changes and all stores on each tick. In
`onStoreChange`, replace the last line of the callback, and import `reportStore` and `checkAllStores` from
`./store-status`:

```ts
    if (!store || !storeGate.changed(object)) return;
    await reportStore(store, object.status?.conditions);
    await syncUsersOf(store, "store changed");
```

and add as the first line of `onTick`:

```ts
  await checkAllStores();
```

Add to `pepr.rbac`:

```json
      {
        "apiGroups": ["kmo.isntall.net"],
        "resources": ["configstores/status", "clusterconfigstores/status"],
        "verbs": ["get", "patch"]
      }
```

- [x] **Step 3: Add the two tenants to the local environment**

`dev/store-files-tenant/_common/config.env`:

```dotenv
LOG_LEVEL=warn
REGION=eu-central-1
```

`dev/store-files-tenant/payments/ledger/config.env`:

```dotenv
GREETING=hello from ledger, in the payments team's own bucket
```

`dev/store-files/partners-store/_common/config.env`:

```dotenv
LOG_LEVEL=error
REGION=partner-zone
```

`dev/store-files/partners-store/partners/portal/config.env`:

```dotenv
GREETING=hello from portal, under the partners prefix
```

`dev/tenants/payments.yaml`, the trusted tenant: its own store, its own credentials Secret, in its own namespace.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments
---
apiVersion: v1
kind: Secret
metadata:
  name: payments-store-credentials
  namespace: payments
stringData:
  accessKeyId: kmoadmin
  secretAccessKey: kmo-local-secret
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigStore
metadata:
  name: default
  namespace: payments
spec:
  s3:
    bucket: kmo-tenant
    region: us-east-1
    endpoint: http://rustfs.kmo-dev.svc:9000
    addressingStyle: Path
    credentialsSecretRef:
      name: payments-store-credentials
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata:
  name: ledger
  namespace: payments
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ledger
  namespace: payments
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ledger
  template:
    metadata:
      labels:
        app: ledger
    spec:
      terminationGracePeriodSeconds: 2
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c"]
          args:
            - |
              env | grep -E '^(GREETING|LOG_LEVEL|REGION)=' | sort
              while true; do sleep 3600; done
          envFrom:
            - configMapRef:
                name: ledger-kmo
            - secretRef:
                name: ledger-kmo
```

`dev/tenants/partners.yaml`, the untrusted tenant: the store is cluster-wide, allows only `partners`, and keeps its
credentials in `kmo-system`.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: partners
---
apiVersion: v1
kind: Secret
metadata:
  name: partners-store-credentials
  namespace: kmo-system
stringData:
  accessKeyId: kmoadmin
  secretAccessKey: kmo-local-secret
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ClusterConfigStore
metadata:
  name: partners
spec:
  s3:
    bucket: kmo-config
    keyPrefix: partners-store
    region: us-east-1
    endpoint: http://rustfs.kmo-dev.svc:9000
    addressingStyle: Path
    credentialsSecretRef:
      name: partners-store-credentials
      namespace: kmo-system
  allowedNamespaces: [partners]
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata:
  name: portal
  namespace: partners
spec:
  sources:
    - storeRef:
        kind: ClusterConfigStore
        name: partners
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: portal
  namespace: partners
spec:
  replicas: 1
  selector:
    matchLabels:
      app: portal
  template:
    metadata:
      labels:
        app: portal
    spec:
      terminationGracePeriodSeconds: 2
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c"]
          args:
            - |
              env | grep -E '^(GREETING|LOG_LEVEL|REGION)=' | sort
              while true; do sleep 3600; done
          envFrom:
            - configMapRef:
                name: portal-kmo
            - secretRef:
                name: portal-kmo
```

In `dev/kustomization.yaml`, add `tenants/payments.yaml` and `tenants/partners.yaml` to `resources`, add two files to
the `store-seed-files` generator, and add a second generator for the tenant bucket:

```yaml
      - partners-store___common__config.env=store-files/partners-store/_common/config.env
      - partners-store__partners__portal__config.env=store-files/partners-store/partners/portal/config.env
```

```yaml
  - name: store-seed-files-tenant
    namespace: kmo-dev
    files:
      - _common__config.env=store-files-tenant/_common/config.env
      - payments__ledger__config.env=store-files-tenant/payments/ledger/config.env
```

In `dev/store/seed-job.yaml`, upload the second set to the second bucket. After the existing `for file in /seed/*` loop
add:

```sh
              for file in /seed-tenant/*; do
                key=$(basename "$file" | sed 's|__|/|g')
                aws s3 cp "$file" "s3://kmo-tenant/$key"
              done
```

and add the volume and its mount next to the existing ones:

```yaml
            - name: seed-tenant
              mountPath: /seed-tenant
```

```yaml
        - name: seed-tenant
          configMap:
            name: store-seed-files-tenant
```

The seed Job turns `__` into `/`, so the file name `partners-store___common__config.env` becomes the key
`partners-store/_common/config.env`: the first two underscores are the separator and the third belongs to `_common`.
Check this with `mise run store -- s3 ls s3://kmo-config --recursive` after the deploy; if the key is wrong, rename the
entry and say so.

Update `dev/README.md`: add lines for `tenants/` (a trusted tenant with its own store, an untrusted tenant on a
cluster-wide store) and `store-files-tenant/` (the sample files of the second bucket), and extend the `store-files/`
line (it also holds the folder `partners-store`, the key prefix of the partners store).

- [x] **Step 4: Find out whether the local store can give the untrusted tenant its own keys**

The spec asks for the partners store to have its own credentials. Both tenant Secrets above hold the local store's root
keys, which can read every bucket. That is enough to prove KMO's rules, but it is not real separation at the store.

Spend at most fifteen minutes on this: read the RustFS 1.0.1 documentation for access keys or users with a policy
limited to a bucket prefix, and try it on the local store.

- If it works: create the keys in the seed Job, limited to `kmo-config/partners-store/*`, put them in
  `partners-store-credentials`, and show in Step 6 that these keys cannot read `shop/orders-api/config.env`.
- If it does not: leave the root keys, and write one sentence in `dev/README.md` that the local store's tenants share
  the root keys and that real per-tenant keys come with the AWS integration.

Tell the user which of the two happened.

- [x] **Step 5: Check and deploy**

Run: `mise run lint && mise run test && mise run operator:deploy && mise run deploy`

Run: `kubectl get clusterconfigstore; kubectl get configstore -A; kubectl get csync -A` Expected: three stores, all with
`Ready` `True`; seven ConfigSyncs, all `Ready` `True`. `ledger` shows the store `ConfigStore/default` and `portal` shows
`ClusterConfigStore/partners` in the `Stores` column.

- [x] **Step 6: After (show, then pause)**

Show the user each rule on the cluster:

1. **A namespace store wins over the cluster-wide default.** `payments` has a ConfigStore named `default`, and the
   ClusterConfigStore `default` allows every namespace. `kubectl get csync ledger -n payments` shows
   `ConfigStore/default`, and `kubectl logs -n payments deployment/ledger` shows the values of the tenant bucket
   (`REGION=eu-central-1`).
2. **Two stores share a bucket, each with its own common folder.** `kubectl logs -n partners deployment/portal` shows
   `REGION=partner-zone`, from `partners-store/_common/`, not `eu-west-1` from `_common/` in the same bucket.
   `kubectl get csync portal -n partners -o jsonpath='{.status.sources[*].key}'` shows the prefix in every key.
3. **A namespace is refused a store that does not allow it.**

   ```bash
   kubectl apply -f - <<'EOF'
   apiVersion: kmo.isntall.net/v1alpha1
   kind: ConfigSync
   metadata: { name: intruder, namespace: shop }
   spec: { sources: [{ storeRef: { kind: ClusterConfigStore, name: partners } }] }
   EOF
   sleep 5 && kubectl get csync intruder -n shop -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}'; echo
   ```

   Expected: `ClusterConfigStore "partners" does not allow namespace "shop"`.
4. **A resource cannot ask for another namespace's files.** A ConfigSync names stores, never keys, so there is nothing
   to refuse at sync time. Show the two places where the API server stops an attempt:

   ```bash
   kubectl apply -f - <<'EOF'
   apiVersion: kmo.isntall.net/v1alpha1
   kind: ConfigSync
   metadata: { name: snoop, namespace: partners }
   spec:
     sources: [{ storeRef: { kind: ClusterConfigStore, name: partners } }]
     source: { secrets: shop/orders-api/secrets.env }
   EOF
   kubectl apply -f - <<'EOF'
   apiVersion: kmo.isntall.net/v1alpha1
   kind: ClusterConfigStore
   metadata: { name: flat }
   spec:
     s3:
       bucket: kmo-config
       region: us-east-1
       serviceFolder: "{name}"
       credentialsSecretRef: { name: partners-store-credentials, namespace: kmo-system }
     allowedNamespaces: ["*"]
   EOF
   ```

   Expected: the first is refused with `unknown field "spec.source"`. The second is refused by the CEL rule:
   `serviceFolder must contain {namespace}`. Also explain the second fence: every key is built under the store's prefix,
   so `portal` reads `partners-store/partners/portal/`, never outside it.
5. **One ConfigSync, two stores, in order.** `ledger` reads the shared store first and its own store second:

   ```bash
   kubectl patch csync ledger -n payments --type merge -p \
     '{"spec":{"sources":[{"storeRef":{"kind":"ClusterConfigStore","name":"default"}},{"storeRef":{"name":"default"}}]}}'
   sleep 5 && kubectl get csync ledger -n payments -o jsonpath='{.status.stores}{"\n"}{range .status.sources[*]}{.store} {.key} {.found}{"\n"}{end}'
   kubectl logs -n payments deployment/ledger | tail -3
   ```

   Expected: both stores in `status.stores`, eight files, and `REGION=eu-central-1`: the tenant store is later in the
   list, so its common value wins over the shared store's `eu-west-1`. Add `"common":false` to the second source and
   show `REGION=eu-west-1`. `mise run deploy` puts the ConfigSync back.
6. **A store that cannot be reached is not ready.** `kubectl delete secret partners-store-credentials -n kmo-system`,
   wait a minute, then `kubectl get ccstore` shows `partners` with `Ready` `False`. Run `mise run deploy` to put the
   Secret back and show it become `True` again.

Delete `intruder`. Explain what KMO does not do here: who may create a ConfigStore or read a Secret is
decided by the cluster's RBAC for people, which an administrator sets up; the docs page on tenants in the last plan
describes it.

Update `docs/getting-started.md` (the two tenants), `README.md` and `CLAUDE.md` (tenants and store readiness are done;
Task 11 is left). Pause for questions.

- [x] **Step 7: Commit (waits for the user)**

```bash
npm run format
git add packages dev docs README.md CLAUDE.md
git commit -m "feat: serve tenants from their own stores and report store readiness"
```



### Task 11: Stores without stored keys

**Before (explain to the user):** Until now a store proved who it is with an access key and a secret key kept in a
Secret. Those are a username and a password: they do not expire, and anyone who can read the Secret has them. For AWS
there is a better way, and it starts with a Kubernetes idea. A **ServiceAccount** is an identity in the cluster, and
the API server can sign a short-lived **token** for one: a small document that says "this is ServiceAccount X in
namespace Y", valid for a few minutes, for one named audience. The cluster publishes the public half of its signing
key, so anyone can check such a token, and AWS can too. This is **OIDC federation**. An IAM role says "I trust tokens
from this cluster for this ServiceAccount", and AWS STS exchanges such a token for keys that last an hour. In EKS this
is called IRSA, and EKS tells AWS about the cluster's signing keys by itself. Outside EKS the same exchange works once
the keys are published at a public address and registered in IAM.

The operator does not use its own identity. A store names a ServiceAccount in its own namespace (or, for a cluster-wide
store, in a namespace the administrator chooses), the operator asks Kubernetes for a token **for that ServiceAccount**,
and exchanges it. A tenant therefore cannot borrow another tenant's role: AWS refuses the token.

Three things to say out loud:

- To do this the operator needs permission to create a token for any ServiceAccount in the cluster. That is a strong
  permission, comparable to reading every Secret, which it already has. External Secrets Operator needs the same.
- The local RustFS store cannot take part, so the unit tests use stand-ins and **the proof needs a real AWS account**.
  Step 8 creates real resources there: two S3 buckets (one of them public, holding only the cluster's public keys), an
  IAM OIDC provider and an IAM role. They cost almost nothing, and Step 10 removes them. Do not run Step 7 or later
  without the user's go-ahead in this session, and let the user choose the AWS profile and region.
- The k3d cluster stands in for "a cluster outside EKS". The proof inside EKS waits for the packaging spec; the
  operator's code is the same there.

**Files:**

- Create: `packages/core/src/identity.ts`, `packages/core/test/identity.test.ts`,
  `packages/operator/src/web-identity.ts`, `packages/operator/src/credentials.ts`,
  `packages/operator/test/web-identity.test.ts`, `test/e2e/aws/issuer.sh`, `test/e2e/aws/setup.sh`,
  `test/e2e/aws/teardown.sh`, `docs/aws-identity.md`
- Modify: `packages/core/src/index.ts`, `packages/operator/src/cluster.ts`, `packages/operator/src/reconcile.ts`,
  `packages/operator/src/store-status.ts`, `packages/operator/package.json`, `mise.toml`, `.gitignore`,
  `docs/index.md`, `docs/getting-started.md`, `README.md`, `CLAUDE.md`

**Interfaces:**

- Consumes: `Store`, `SyncFailure`, `StoreCredentials`, `getOrUndefined`, `credentialsFrom`, `readCredentials`,
  `s3Client`.
- Produces, from `@kmo/core`:
  - `ROLE_ARN_ANNOTATION = "eks.amazonaws.com/role-arn"`, `TOKEN_AUDIENCE = "sts.amazonaws.com"`
  - `type StoreIdentity = { method: "serviceAccount" | "secret"; namespace: string; name: string }`
  - `storeIdentity(store: Store): { ok: true; identity: StoreIdentity } | { ok: false; reason: string }`
  - `sessionName(store: Store): string`
- Produces, from the operator:
  - `StoreCredentials` gains `sessionToken?: string`
  - `interface TimedCredentials extends StoreCredentials { expiresAt: Date }`
  - `interface WebIdentityDeps { roleArnOf; requestToken; assumeRole; now }` and
    `class WebIdentity { credentials(store: Store, identity: StoreIdentity): Promise<StoreCredentials> }` in
    `web-identity.ts`
  - `readSecretCredentials(namespace: string, name: string): Promise<StoreCredentials>` in `cluster.ts`, which replaces
    `readCredentials` there
  - `readCredentials(store: Store): Promise<StoreCredentials>` in `credentials.ts`

- [x] **Step 1: Write the failing tests**

`packages/core/test/identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sessionName, storeIdentity } from "../src/identity";
import type { S3Location, Store } from "../src/types";

const own = (s3: Partial<S3Location>): Store => ({
  kind: "ConfigStore",
  metadata: { name: "default", namespace: "payments" },
  spec: { s3: { bucket: "b", region: "eu-west-1", ...s3 } },
});
const clusterWide = (s3: Partial<S3Location>): Store => ({
  kind: "ClusterConfigStore",
  metadata: { name: "partners" },
  spec: { s3: { bucket: "b", region: "eu-west-1", ...s3 }, allowedNamespaces: ["partners"] },
});

describe("the identity of a store", () => {
  it("is a ServiceAccount when the store names one", () => {
    expect(storeIdentity(own({ serviceAccountRef: { name: "store" } }))).toEqual({
      ok: true,
      identity: { method: "serviceAccount", namespace: "payments", name: "store" },
    });
  });

  it("is a Secret with stored keys when the store names one", () => {
    expect(storeIdentity(own({ credentialsSecretRef: { name: "keys" } }))).toMatchObject({
      identity: { method: "secret", namespace: "payments", name: "keys" },
    });
  });

  it("always lives in the namespace of a namespace store, whatever the reference says", () => {
    const store = own({ serviceAccountRef: { name: "store", namespace: "kmo-system" } });
    expect(storeIdentity(store)).toMatchObject({ identity: { namespace: "payments" } });
  });

  it("lives in the namespace a cluster-wide store names", () => {
    const store = clusterWide({ serviceAccountRef: { name: "store", namespace: "kmo-system" } });
    expect(storeIdentity(store)).toMatchObject({ identity: { namespace: "kmo-system", name: "store" } });
  });

  it("is unusable when a cluster-wide store does not say where it lives", () => {
    expect(storeIdentity(clusterWide({ serviceAccountRef: { name: "store" } }))).toEqual({
      ok: false,
      reason: "the store's serviceAccountRef names no namespace",
    });
  });

  it("is unusable when the store names none, or both", () => {
    expect(storeIdentity(own({}))).toMatchObject({ ok: false });
    const both = own({ serviceAccountRef: { name: "store" }, credentialsSecretRef: { name: "keys" } });
    expect(storeIdentity(both)).toMatchObject({ ok: false });
  });
});

describe("the name of a store's session in AWS", () => {
  it("says which store asked, so it can be found in CloudTrail", () => {
    expect(sessionName(own({}))).toBe("kmo-payments-default");
    expect(sessionName(clusterWide({}))).toBe("kmo-cluster-partners");
  });

  it("is never longer than AWS allows", () => {
    const long = own({});
    long.metadata.name = "x".repeat(100);
    expect(sessionName(long)).toHaveLength(64);
  });
});
```

`packages/operator/test/web-identity.test.ts`:

```ts
import type { Store, StoreIdentity } from "@kmo/core";
import { describe, expect, it } from "vitest";
import { SyncFailure } from "../src/cluster";
import { WebIdentity, type WebIdentityDeps } from "../src/web-identity";

const store: Store = {
  kind: "ConfigStore",
  metadata: { name: "default", namespace: "payments" },
  spec: { s3: { bucket: "b", region: "eu-west-1", serviceAccountRef: { name: "store" } } },
};
const identity: StoreIdentity = { method: "serviceAccount", namespace: "payments", name: "store" };
const ROLE = "arn:aws:iam::123456789012:role/payments-config";

/** Kubernetes and AWS, replaced by stand-ins that record what they were asked. */
function world(overrides: Partial<WebIdentityDeps> = {}) {
  const calls: string[] = [];
  let clock = new Date("2026-10-11T09:00:00Z");
  const deps: WebIdentityDeps = {
    roleArnOf: async () => ROLE,
    requestToken: async (namespace, name) => {
      calls.push(`token for ${namespace}/${name}`);
      return "signed-token";
    },
    assumeRole: async ({ roleArn, token, region, sessionName }) => {
      calls.push(`assume ${roleArn} in ${region} as ${sessionName} with ${token}`);
      return {
        accessKeyId: "ASIA-TEMP",
        secretAccessKey: "temp-secret",
        sessionToken: "temp-session",
        expiresAt: new Date(clock.getTime() + 60 * 60_000),
      };
    },
    now: () => clock,
    ...overrides,
  };
  return { calls, deps, advanceMinutes: (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000)) };
}

describe("a store that is reached as a ServiceAccount", () => {
  it("gets short-lived keys in exchange for a token of that ServiceAccount", async () => {
    const { calls, deps } = world();
    const credentials = await new WebIdentity(deps).credentials(store, identity);
    expect(credentials).toEqual({ accessKeyId: "ASIA-TEMP", secretAccessKey: "temp-secret", sessionToken: "temp-session" });
    expect(calls).toEqual([
      "token for payments/store",
      `assume ${ROLE} in eu-west-1 as kmo-payments-default with signed-token`,
    ]);
  });

  it("keeps the keys in memory and uses them again while they are valid", async () => {
    const { calls, deps, advanceMinutes } = world();
    const webIdentity = new WebIdentity(deps);
    await webIdentity.credentials(store, identity);
    advanceMinutes(50);
    await webIdentity.credentials(store, identity);
    expect(calls).toHaveLength(2);
  });

  it("gets new keys shortly before the old ones expire", async () => {
    const { calls, deps, advanceMinutes } = world();
    const webIdentity = new WebIdentity(deps);
    await webIdentity.credentials(store, identity);
    advanceMinutes(56);
    await webIdentity.credentials(store, identity);
    expect(calls).toHaveLength(4);
  });

  it("gets new keys at once when the ServiceAccount names another role", async () => {
    let role = ROLE;
    const { calls, deps } = world({ roleArnOf: async () => role });
    const webIdentity = new WebIdentity(deps);
    await webIdentity.credentials(store, identity);
    role = "arn:aws:iam::123456789012:role/other";
    await webIdentity.credentials(store, identity);
    expect(calls).toHaveLength(4);
  });
});

describe("a store whose ServiceAccount cannot be used", () => {
  const failure = (deps: WebIdentityDeps) =>
    new WebIdentity(deps).credentials(store, identity).catch((error: unknown) => error as SyncFailure);

  it("fails when the ServiceAccount names no role", async () => {
    const error = await failure(world({ roleArnOf: async () => undefined }).deps);
    expect(error).toBeInstanceOf(SyncFailure);
    expect(error.reason).toBe("CredentialsMissing");
    expect(error.message).toBe('ServiceAccount payments/store has no annotation "eks.amazonaws.com/role-arn"');
  });

  it("fails when Kubernetes gives no token, naming the ServiceAccount", async () => {
    const requestToken = async () => {
      throw Object.assign(new Error("serviceaccounts \"store\" not found"), { name: "NotFound" });
    };
    const error = await failure(world({ requestToken }).deps);
    expect(error.message).toBe("could not get a token for ServiceAccount payments/store: NotFound");
  });

  it("fails when AWS refuses the role, naming the role and never the token", async () => {
    const assumeRole = async () => {
      throw Object.assign(new Error("Not authorized, token signed-token"), { name: "AccessDenied" });
    };
    const error = await failure(world({ assumeRole }).deps);
    expect(error.message).toBe(`AWS refused role "${ROLE}" for ServiceAccount payments/store: AccessDenied`);
  });
});
```

Run: `npx vitest run packages/core/test/identity.test.ts packages/operator/test/web-identity.test.ts`
Expected: FAIL, the modules do not exist.

- [x] **Step 2: Write the core rule**

`packages/core/src/identity.ts`:

```ts
import type { Store } from "./types";

/** Annotation on a ServiceAccount that names the IAM role it may assume. The same one IRSA uses. */
export const ROLE_ARN_ANNOTATION = "eks.amazonaws.com/role-arn";
/** Audience of the token that is sent to AWS STS. */
export const TOKEN_AUDIENCE = "sts.amazonaws.com";

/** How a store proves who is asking, and where that identity lives. */
export interface StoreIdentity {
  method: "serviceAccount" | "secret";
  namespace: string;
  name: string;
}

/**
 * Works out the identity a store uses.
 * @param store The store.
 * @returns The ServiceAccount or Secret and its namespace, or the reason the store names no usable identity. For a
 *   ConfigStore the namespace is always the store's own.
 */
export function storeIdentity(store: Store): { ok: true; identity: StoreIdentity } | { ok: false; reason: string } {
  const { serviceAccountRef, credentialsSecretRef } = store.spec.s3;
  if (serviceAccountRef && credentialsSecretRef) {
    return { ok: false, reason: "the store names both a ServiceAccount and a credentials Secret" };
  }
  const method = serviceAccountRef ? "serviceAccount" : "secret";
  const field = serviceAccountRef ? "serviceAccountRef" : "credentialsSecretRef";
  const ref = serviceAccountRef ?? credentialsSecretRef;
  if (!ref) return { ok: false, reason: "the store names neither a ServiceAccount nor a credentials Secret" };

  const namespace = store.kind === "ConfigStore" ? store.metadata.namespace : ref.namespace;
  if (!namespace) return { ok: false, reason: `the store's ${field} names no namespace` };
  return { ok: true, identity: { method, namespace, name: ref.name } };
}

/**
 * Names the AWS session of a store, as it appears in CloudTrail.
 * @param store The store.
 * @returns "kmo-", the store's namespace or "cluster", and its name; at most 64 characters, all allowed by AWS.
 */
export function sessionName(store: Store): string {
  const raw = `kmo-${store.metadata.namespace ?? "cluster"}-${store.metadata.name}`;
  return raw.replace(/[^\w+=,.@-]/g, "-").slice(0, 64);
}
```

Add `export * from "./identity";` to `packages/core/src/index.ts`.

Run: `npx vitest run packages/core/test/identity.test.ts`
Expected: PASS, 8 tests.

- [x] **Step 3: Write the exchange**

Run:

```bash
npm install --save-exact --workspace packages/operator @aws-sdk/client-sts@3.1149.0 @kubernetes/client-node@1.4.0
```

In `packages/operator/src/cluster.ts`, add `sessionToken?: string;` to `StoreCredentials`, and replace
`readCredentials` with a function that only knows about Secrets:

```ts
/**
 * Reads stored keys from a credentials Secret.
 * @param namespace The Secret's namespace.
 * @param name The Secret's name.
 * @returns The keys.
 * @throws SyncFailure with reason CredentialsMissing when the Secret or one of its keys is absent.
 */
export async function readSecretCredentials(namespace: string, name: string): Promise<StoreCredentials> {
  const where = `Secret ${namespace}/${name}`;
  const secret = await getOrUndefined(a.Secret, name, namespace);
  if (!secret) throw new SyncFailure("CredentialsMissing", `${where} was not found`);
  return credentialsFrom(secret.data, where);
}
```

`packages/operator/src/web-identity.ts`:

```ts
import { AssumeRoleWithWebIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { ROLE_ARN_ANNOTATION, TOKEN_AUDIENCE, sessionName, type Store, type StoreIdentity } from "@kmo/core";
import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { a } from "pepr";
import { SyncFailure, getOrUndefined, type StoreCredentials } from "./cluster";

/** Keys that stop working at a known time. */
export interface TimedCredentials extends StoreCredentials {
  expiresAt: Date;
}

/** What the exchange needs from Kubernetes and AWS; replaced in tests. */
export interface WebIdentityDeps {
  /** Reads the role a ServiceAccount names; undefined when it names none. */
  roleArnOf(namespace: string, name: string): Promise<string | undefined>;
  /** Asks Kubernetes for a short-lived token of a ServiceAccount, made out to AWS STS. */
  requestToken(namespace: string, name: string): Promise<string>;
  /** Exchanges a token for keys of a role. */
  assumeRole(request: { roleArn: string; token: string; region: string; sessionName: string }): Promise<TimedCredentials>;
  /** The current time. */
  now(): Date;
}

const REFRESH_MARGIN_MS = 5 * 60_000;
const TOKEN_SECONDS = 600;

let coreApi: CoreV1Api | undefined;
function core(): CoreV1Api {
  if (!coreApi) {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    coreApi = kubeConfig.makeApiClient(CoreV1Api);
  }
  return coreApi;
}

const clusterAndAws: WebIdentityDeps = {
  roleArnOf: async (namespace, name) =>
    (await getOrUndefined(a.ServiceAccount, name, namespace))?.metadata?.annotations?.[ROLE_ARN_ANNOTATION],
  requestToken: async (namespace, name) => {
    const body = { spec: { audiences: [TOKEN_AUDIENCE], expirationSeconds: TOKEN_SECONDS } };
    const response = await core().createNamespacedServiceAccountToken({ namespace, name, body });
    return response.status?.token ?? "";
  },
  assumeRole: async ({ roleArn, token, region, sessionName }) => {
    const response = await new STSClient({ region }).send(
      new AssumeRoleWithWebIdentityCommand({ RoleArn: roleArn, RoleSessionName: sessionName, WebIdentityToken: token }),
    );
    const keys = response.Credentials;
    if (!keys?.AccessKeyId || !keys.SecretAccessKey || !keys.Expiration) throw new Error("no credentials returned");
    return {
      accessKeyId: keys.AccessKeyId,
      secretAccessKey: keys.SecretAccessKey,
      sessionToken: keys.SessionToken,
      expiresAt: keys.Expiration,
    };
  },
  now: () => new Date(),
};

/** Reaches AWS as a store's ServiceAccount, and keeps the short-lived keys in memory until they are about to expire. */
export class WebIdentity {
  readonly #cache = new Map<string, TimedCredentials>();
  readonly #deps: WebIdentityDeps;

  /** @param deps Kubernetes and AWS; replaced in tests. */
  constructor(deps: WebIdentityDeps = clusterAndAws) {
    this.#deps = deps;
  }

  /**
   * Gets keys for a store.
   * @param store The store.
   * @param identity The store's ServiceAccount.
   * @returns Keys valid for at least five more minutes.
   * @throws SyncFailure with reason CredentialsMissing when the ServiceAccount names no role, Kubernetes gives no
   *   token, or AWS refuses the role. The message never holds the token.
   */
  async credentials(store: Store, identity: StoreIdentity): Promise<StoreCredentials> {
    const { namespace, name } = identity;
    const who = `ServiceAccount ${namespace}/${name}`;

    const roleArn = await this.#deps.roleArnOf(namespace, name);
    if (!roleArn) throw new SyncFailure("CredentialsMissing", `${who} has no annotation "${ROLE_ARN_ANNOTATION}"`);

    const key = `${namespace}/${name}|${roleArn}|${store.spec.s3.region}`;
    let timed = this.#cache.get(key);
    if (!timed || timed.expiresAt.getTime() - this.#deps.now().getTime() < REFRESH_MARGIN_MS) {
      const token = await this.#deps.requestToken(namespace, name).catch((error: unknown) => {
        throw new SyncFailure("CredentialsMissing", `could not get a token for ${who}: ${errorName(error)}`);
      });
      const request = { roleArn, token, region: store.spec.s3.region, sessionName: sessionName(store) };
      timed = await this.#deps.assumeRole(request).catch((error: unknown) => {
        throw new SyncFailure("CredentialsMissing", `AWS refused role "${roleArn}" for ${who}: ${errorName(error)}`);
      });
      this.#cache.set(key, timed);
    }
    const { accessKeyId, secretAccessKey, sessionToken } = timed;
    return { accessKeyId, secretAccessKey, sessionToken };
  }
}

function errorName(error: unknown): string {
  return (error as { name?: string }).name ?? "unknown error";
}
```

`packages/operator/src/credentials.ts`:

```ts
import { storeIdentity, type Store } from "@kmo/core";
import { SyncFailure, readSecretCredentials, type StoreCredentials } from "./cluster";
import { WebIdentity } from "./web-identity";

const webIdentity = new WebIdentity();

/**
 * Gets the keys to reach a store, by whichever identity the store names.
 * @param store The store.
 * @returns Short-lived keys of the store's ServiceAccount, or the stored keys of its credentials Secret.
 * @throws SyncFailure with reason CredentialsMissing when the identity cannot be used.
 */
export async function readCredentials(store: Store): Promise<StoreCredentials> {
  const resolved = storeIdentity(store);
  if (!resolved.ok) throw new SyncFailure("CredentialsMissing", resolved.reason);
  const { identity } = resolved;
  return identity.method === "serviceAccount"
    ? webIdentity.credentials(store, identity)
    : readSecretCredentials(identity.namespace, identity.name);
}
```

In `packages/operator/src/reconcile.ts` and `packages/operator/src/store-status.ts`, import `readCredentials` from
`./credentials` instead of `./cluster`. `s3Client` already passes the whole credentials object to the AWS SDK, so the
session token reaches it with no further change.

Add to `pepr.rbac` in `packages/operator/package.json`:

```json
      {
        "apiGroups": [""],
        "resources": ["serviceaccounts"],
        "verbs": ["get"]
      },
      {
        "apiGroups": [""],
        "resources": ["serviceaccounts/token"],
        "verbs": ["create"]
      }
```

Run: `npx vitest run packages/operator/test/web-identity.test.ts`
Expected: PASS, 9 tests.

- [x] **Step 4: Check and deploy, and see that the local stores still work**

Run: `mise run lint && mise run test && mise run operator:deploy`
Expected: clean. If the build or the deploy says the module is too large, stop and tell the user, as in Task 4.

Run: `sleep 90 && kubectl get clusterconfigstore; kubectl get configstore -A; kubectl get csync -A`
Expected: every store and every ConfigSync is still `Ready` `True`. Stored keys work as before.

- [x] **Step 5: See the failures that need no AWS account**

```bash
kubectl create serviceaccount no-role -n shop
kubectl apply -f - <<'EOF'
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigStore
metadata: { name: keyless, namespace: shop }
spec: { s3: { bucket: anything, region: eu-west-1, serviceAccountRef: { name: no-role } } }
EOF
sleep 10 && kubectl get cstore keyless -n shop -o jsonpath='{.status.conditions[0].message}'; echo
kubectl annotate serviceaccount no-role -n shop eks.amazonaws.com/role-arn=arn:aws:iam::000000000000:role/none
kubectl patch cstore keyless -n shop --type merge -p '{"spec":{"s3":{"keyPrefix":"x"}}}'
sleep 15 && kubectl get cstore keyless -n shop -o jsonpath='{.status.conditions[0].message}'; echo
kubectl delete cstore keyless -n shop; kubectl delete serviceaccount no-role -n shop
```

Expected: first `ServiceAccount shop/no-role has no annotation "eks.amazonaws.com/role-arn"`, then
`AWS refused role "arn:aws:iam::000000000000:role/none" for ServiceAccount shop/no-role: ` followed by the name of
AWS's error. The second message proves that the operator got a token from Kubernetes and that the call reached AWS STS
from inside the cluster. Show both to the user before any AWS resource is created.

- [x] **Step 6: Write the scripts for the proof on AWS**

All three scripts use the AWS CLI with the user's own profile and need `AWS_REGION` set. They never use the `store`
task, which points at the local RustFS.

`test/e2e/aws/issuer.sh` creates the bucket that will hold the cluster's public signing keys and prints the issuer
address. It runs before the cluster is created, because the API server must be started with that address.

```bash
#!/usr/bin/env bash
# Creates the bucket for the cluster's public signing keys and prints the issuer address.
set -euo pipefail
: "${AWS_REGION:?set AWS_REGION}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="kmo-oidc-$ACCOUNT-$AWS_REGION"

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" \
      --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
fi
echo "Put this in mise.local.toml under [env], then run: mise run cluster:down && mise run cluster:up"
echo "KMO_OIDC_ISSUER = \"https://$BUCKET.s3.$AWS_REGION.amazonaws.com\""
```

`test/e2e/aws/setup.sh` publishes the keys, registers the cluster in IAM, and creates one role, one private bucket
with two env files, and a demo namespace that uses them.

```bash
#!/usr/bin/env bash
# Proves a store without stored keys against a real AWS account, from the local cluster.
set -euo pipefail
: "${AWS_REGION:?set AWS_REGION}" "${KMO_OIDC_ISSUER:?set KMO_OIDC_ISSUER; see issuer.sh}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ISSUER_HOST=${KMO_OIDC_ISSUER#https://}
OIDC_BUCKET=${ISSUER_HOST%%.*}
CONFIG_BUCKET="kmo-aws-demo-$ACCOUNT-$AWS_REGION"
ROLE=kmo-aws-demo
PROVIDER_ARN="arn:aws:iam::$ACCOUNT:oidc-provider/$ISSUER_HOST"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

[ "$(kubectl get --raw /.well-known/openid-configuration | jq -r .issuer)" = "$KMO_OIDC_ISSUER" ] || {
  echo "The cluster does not sign tokens as $KMO_OIDC_ISSUER. Recreate it: mise run cluster:down && mise run cluster:up"
  exit 1
}

echo "1. Publish the cluster's public signing keys"
kubectl get --raw /.well-known/openid-configuration > "$TMP/discovery.json"
kubectl get --raw /openid/v1/jwks > "$TMP/jwks.json"
aws s3api put-public-access-block --bucket "$OIDC_BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false
aws s3api put-bucket-policy --bucket "$OIDC_BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{ \"Effect\": \"Allow\", \"Principal\": \"*\", \"Action\": \"s3:GetObject\",
                   \"Resource\": \"arn:aws:s3:::$OIDC_BUCKET/*\" }]}"
aws s3 cp "$TMP/discovery.json" "s3://$OIDC_BUCKET/.well-known/openid-configuration" --content-type application/json
aws s3 cp "$TMP/jwks.json" "s3://$OIDC_BUCKET/openid/v1/jwks" --content-type application/json

echo "2. Register the cluster in IAM"
aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" >/dev/null 2>&1 ||
  aws iam create-open-id-connect-provider --url "$KMO_OIDC_ISSUER" --client-id-list sts.amazonaws.com >/dev/null

echo "3. Create the private bucket with the env files"
if ! aws s3api head-bucket --bucket "$CONFIG_BUCKET" 2>/dev/null; then
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$CONFIG_BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$CONFIG_BUCKET" \
      --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
fi
aws s3api put-bucket-versioning --bucket "$CONFIG_BUCKET" --versioning-configuration Status=Enabled
printf 'GREETING=hello from a real S3 bucket, with no stored key\n' | aws s3 cp - "s3://$CONFIG_BUCKET/aws-demo/hello/config.env"
printf 'REGION=%s\n' "$AWS_REGION" | aws s3 cp - "s3://$CONFIG_BUCKET/_common/config.env"

echo "4. Create the role that trusts one ServiceAccount of this cluster"
cat > "$TMP/trust.json" <<EOF
{ "Version": "2012-10-17", "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "$PROVIDER_ARN" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": { "StringEquals": {
      "$ISSUER_HOST:sub": "system:serviceaccount:aws-demo:kmo-store",
      "$ISSUER_HOST:aud": "sts.amazonaws.com" } } }] }
EOF
cat > "$TMP/access.json" <<EOF
{ "Version": "2012-10-17", "Statement": [
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::$CONFIG_BUCKET" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion"], "Resource": "arn:aws:s3:::$CONFIG_BUCKET/*" }] }
EOF
aws iam get-role --role-name "$ROLE" >/dev/null 2>&1 ||
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document "file://$TMP/trust.json" >/dev/null
aws iam put-role-policy --role-name "$ROLE" --policy-name read-config --policy-document "file://$TMP/access.json"

echo "5. Create the demo namespace: a ServiceAccount, a store that names it, a ConfigSync and a workload"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata: { name: aws-demo }
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kmo-store
  namespace: aws-demo
  annotations: { eks.amazonaws.com/role-arn: "arn:aws:iam::$ACCOUNT:role/$ROLE" }
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigStore
metadata: { name: default, namespace: aws-demo }
spec:
  s3:
    bucket: $CONFIG_BUCKET
    region: $AWS_REGION
    serviceAccountRef: { name: kmo-store }
---
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata: { name: hello, namespace: aws-demo }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: hello, namespace: aws-demo }
spec:
  replicas: 1
  selector: { matchLabels: { app: hello } }
  template:
    metadata: { labels: { app: hello } }
    spec:
      terminationGracePeriodSeconds: 2
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c", "env | grep -E '^(GREETING|REGION)=' | sort; while true; do sleep 3600; done"]
          envFrom:
            - configMapRef: { name: hello-kmo }
            - secretRef: { name: hello-kmo }
EOF
echo "Done. IAM can take up to a minute to accept the new role."
```

`test/e2e/aws/teardown.sh`:

```bash
#!/usr/bin/env bash
# Removes everything that issuer.sh and setup.sh created, in the cluster and in AWS.
set -euo pipefail
: "${AWS_REGION:?set AWS_REGION}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
OIDC_BUCKET="kmo-oidc-$ACCOUNT-$AWS_REGION"
CONFIG_BUCKET="kmo-aws-demo-$ACCOUNT-$AWS_REGION"
ROLE=kmo-aws-demo
PROVIDER_ARN="arn:aws:iam::$ACCOUNT:oidc-provider/$OIDC_BUCKET.s3.$AWS_REGION.amazonaws.com"

kubectl delete namespace aws-demo --ignore-not-found
aws iam delete-role-policy --role-name "$ROLE" --policy-name read-config 2>/dev/null || true
aws iam delete-role --role-name "$ROLE" 2>/dev/null || true
aws iam delete-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" 2>/dev/null || true
aws s3 rm "s3://$OIDC_BUCKET" --recursive 2>/dev/null || true
aws s3api delete-bucket --bucket "$OIDC_BUCKET" 2>/dev/null || true
for kind in Versions DeleteMarkers; do
  aws s3api list-object-versions --bucket "$CONFIG_BUCKET" --query "$kind[].[Key,VersionId]" --output text 2>/dev/null |
    while read -r key version; do
      [ "$key" = "None" ] || aws s3api delete-object --bucket "$CONFIG_BUCKET" --key "$key" --version-id "$version" >/dev/null
    done
done
aws s3api delete-bucket --bucket "$CONFIG_BUCKET" 2>/dev/null || true
echo "Removed. Take KMO_OIDC_ISSUER out of mise.local.toml and recreate the cluster to return to the default issuer."
```

Make the three scripts executable. Add `mise.local.toml` to `.gitignore`. In `mise.toml`, add the tasks and let
`cluster:up` start the API server with the issuer when one is set:

```toml
[tasks."aws:issuer"]
description = "Create the bucket for the cluster's public signing keys in AWS and print the issuer address"
run = "test/e2e/aws/issuer.sh"

[tasks."aws:setup"]
description = "Prove a store without stored keys against a real AWS account (creates AWS resources)"
run = "test/e2e/aws/setup.sh"

[tasks."aws:teardown"]
description = "Remove everything aws:issuer and aws:setup created"
run = "test/e2e/aws/teardown.sh"
```

Replace the `run` of `tasks."cluster:up"`:

```toml
run = [
  "mkdir -p .kube",
  "k3d cluster create --config dev/k3d.yaml --wait ${KMO_OIDC_ISSUER:+--k3s-arg=--kube-apiserver-arg=service-account-issuer=$KMO_OIDC_ISSUER@server:0 --k3s-arg=--kube-apiserver-arg=service-account-jwks-uri=$KMO_OIDC_ISSUER/openid/v1/jwks@server:0}",
]
```

Without `KMO_OIDC_ISSUER` the cluster is created exactly as before.

- [x] **Step 7: Ask the user, then recreate the cluster with a public issuer**

Stop here and ask the user for the go-ahead. The AWS profile and region belong to the user, not to the repository:
take them from `CLAUDE.local.md` when it names them, otherwise ask. Never write them, or an account ID, into a
committed file. Then, with `AWS_REGION` (and `AWS_PROFILE`, if one is used) set for each command:

```bash
mise run aws:issuer
```

The user puts the printed `KMO_OIDC_ISSUER` line in `mise.local.toml` under `[env]`. Then:

```bash
mise run cluster:down && mise run cluster:up && mise run deploy && mise run operator:deploy
kubectl get --raw /.well-known/openid-configuration | jq
```

Expected: `issuer` is the bucket's address and `jwks_uri` is that address plus `/openid/v1/jwks`. Explain what
changed: the cluster now signs its tokens under a public name, and that is the only change to the cluster. If the API
server does not start with these two arguments, show its log (`docker logs k3d-kmo-server-0`) and stop.

- [x] **Step 8: Run the proof**

```bash
mise run aws:setup
sleep 60
kubectl get cstore,csync -n aws-demo
kubectl get csync hello -n aws-demo -o jsonpath='{.status.sources}' | jq
kubectl logs -n aws-demo deployment/hello
kubectl get secret -n aws-demo
```

Expected: the store and the ConfigSync are `Ready` `True`, the sources carry S3 version IDs, the pod prints the
greeting from the real bucket, and the only Secret in the namespace is `hello-kmo`, the output. **No access key is
stored anywhere in the cluster.**

If the store stays not ready with `InvalidIdentityToken`, AWS could not fetch or match the published keys: compare
`curl -s $KMO_OIDC_ISSUER/.well-known/openid-configuration` with the cluster's own answer. If
`create-open-id-connect-provider` asks for a thumbprint, add `--thumbprint-list` with the SHA-1 fingerprint of the
certificate of the bucket's host, and tell the user.

- [x] **Step 9: Prove that AWS, not KMO, keeps tenants apart**

A second namespace names the same role. KMO does not stop that; AWS does, because the role trusts only
`aws-demo/kmo-store`.

```bash
ROLE_ARN=$(kubectl get serviceaccount kmo-store -n aws-demo -o jsonpath='{.metadata.annotations.eks\.amazonaws\.com/role-arn}')
BUCKET=$(kubectl get cstore default -n aws-demo -o jsonpath='{.spec.s3.bucket}')
kubectl create serviceaccount borrower -n shop
kubectl annotate serviceaccount borrower -n shop eks.amazonaws.com/role-arn="$ROLE_ARN"
kubectl apply -f - <<EOF
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigStore
metadata: { name: borrowed, namespace: shop }
spec: { s3: { bucket: $BUCKET, region: $AWS_REGION, serviceAccountRef: { name: borrower } } }
EOF
sleep 15 && kubectl get cstore borrowed -n shop -o jsonpath='{.status.conditions[0].message}'; echo
kubectl delete cstore borrowed -n shop; kubectl delete serviceaccount borrower -n shop
```

Expected: `AWS refused role "arn:aws:iam::…:role/kmo-aws-demo" for ServiceAccount shop/borrower: AccessDenied`.

- [x] **Step 10: After (show, then pause)**

Show the user the results of Steps 5, 8 and 9, and the session in AWS:
`aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity --max-results 3`
lists the calls with the session name `kmo-aws-demo-default` (CloudTrail can be some minutes behind).

Write `docs/aws-identity.md` and link it from `docs/index.md`. Keep it short and for people: what a store's
ServiceAccount is and why no key is stored; the annotation that names the role; what the role's trust policy must
say; that EKS registers the cluster's keys by itself and that elsewhere they are published and registered once, with a
pointer to `test/e2e/aws/` as a worked example; that the role needs `s3:ListBucket` as well as `s3:GetObject`, because
without it S3 answers "access denied" for a file that is only missing; that stored keys are for stores that cannot do
this; that the operator may create a token for any ServiceAccount, and why; and that the path is proven outside EKS and
not yet inside it.

Then ask the user whether to keep the AWS resources. Unless they want to keep them, run `mise run aws:teardown`, take
`KMO_OIDC_ISSUER` out of `mise.local.toml` and recreate the cluster
(`mise run cluster:down && mise run cluster:up && mise run deploy && mise run operator:deploy`).

Update `docs/getting-started.md`, `README.md` and `CLAUDE.md`: steps 5 to 11 are done, the operator exists, the
receiver does not; the next plan is the receiver and the finish (spec steps 12 and 13). Pause for questions.

- [x] **Step 11: Commit (waits for the user)**

```bash
npm run format
git add package.json package-lock.json packages test/e2e/aws mise.toml .gitignore docs README.md CLAUDE.md
git commit -m "feat: reach a store in AWS as a ServiceAccount, with no stored keys"
```

---

## What comes next

When this plan is done, write the plan for the receiver and the finish (spec steps 12 and 13): the receiver, the
end-to-end tests in `test/e2e/` with the Mise task `test:e2e`, the `demo` task and the full docs. Bring to it:

- **`test/e2e/rollout-guard.sh`** already exists and belongs in `test:e2e`. So do the demonstrations in the After step
  of each task of this plan: each is an end-to-end test that was run by hand.
- **The receiver must set the sync annotation the way `requestSync` does**, and use `findAffectedSyncs` from core. It
  must answer `HEAD /` without a token, because RustFS checks its target that way.
- **The known limits of this plan**: the late `TargetsWired` warning when a reference is removed, one list of
  ConfigSyncs for each workload when the watcher starts, and the operator's permission to read every Secret. The docs
  must state them.
- **Open notes carried from the foundations work**: the answer on several copies of a module in one cluster was read
  from generated names, not from the Pepr documentation; and EventBridge keys are assumed not to be URL-encoded, which
  the AWS integration spec must confirm against a live event.
- **The proof inside EKS** of stores without stored keys. Task 11 proves the path from a cluster outside EKS. The
  packaging spec brings the first EKS cluster and must repeat `test/e2e/aws/setup.sh` there, without the step that
  publishes the signing keys.
- **`docs/advisories.md`**, if Task 1 created it, is reviewed again when dependencies change.
