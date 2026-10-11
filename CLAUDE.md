# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## State of the repository

The design spec, `docs/superpowers/specs/2026-10-10-kmo-operator-core-design.md`, is the source of truth for every
design question; read it before proposing or building anything. The foundations plan,
`docs/superpowers/plans/2026-10-10-kmo-foundations.md`, is complete: the tooling, the local environment, the spike and
the core logic exist. The operator plan, `docs/superpowers/plans/2026-10-11-kmo-operator.md` (spec steps 5 to 11), is
complete, all eleven tasks. The operator deploys, the guarded Rollout watch is proven on the cluster, the three custom
resource definitions are installed, and a reconcile reads the source files of each ConfigSync, from every store it
lists, writes one ConfigMap and one Secret for each, and stamps the config hash on the targets, so they roll when their
values change. It reports the result on the ConfigSync, as status with four conditions and as Events. A timer and
changes to outputs, workloads and stores ask for a sync, a failed sync is tried again once a minute, and `suspend` makes
the operator leave a ConfigSync alone. Admission refuses a ConfigSync that shares a target or an output name with
another. Each store reports a `Ready` condition from a check of its bucket, and the local environment has two tenants. A
store can name a ServiceAccount in place of a credentials Secret; the operator exchanges its token for short-lived AWS
keys. That path is proven from the local cluster against a real AWS account, and not yet inside EKS. AWS refuses a
ServiceAccount that the role does not trust, which is also proven. The AWS resources of that proof are removed. The next
plan, for the receiver and the finish (spec steps 12 and 13), is not written yet. The receiver does not exist, so a
changed file in the store is picked up only by the refresh interval or a request by hand.

The product is named **KMO**. The directory is still called `zeemo` and must not be renamed; never introduce "zeemo" in
code, manifests or docs. Kubernetes names use `kmo`: API group `kmo.isntall.net`, label
`app.kubernetes.io/managed-by: kmo`. The receiver and the credentials of cluster-wide stores live in the namespace
`kmo-system`; the operator runs in `pepr-system`, which Pepr does not let you change.

## What KMO is

A Kubernetes operator that keeps ConfigMaps and Secrets in step with dotenv files in an S3-compatible object store, and
rolls the workloads that use them when their effective values change. It is also a project for learning Kubernetes, so
idiomatic patterns are preferred and the reasons for them are documented.

This spec is the first of three. Helm and ArgoCD packaging, and the Terraform/Terragrunt AWS integration, are separate
later specs and out of scope here.

## Architecture

Two components, deliberately split:

- **Receiver.** A stateless HTTP service that turns a store change event (RustFS S3 notification or EventBridge) into a
  `kmo.isntall.net/sync-requested-at` annotation on each affected ConfigSync. It never reads the store and cannot read
  Secrets.
- **Operator.** A Pepr module (TypeScript) that reconciles each ConfigSync. It is the only component holding store
  credentials and the only writer of managed objects.

The split exists because Pepr cannot host a custom HTTP endpoint, and it gives webhooks, the refresh timer and manual
triggers one shared code path.

Custom resources, all `kmo.isntall.net/v1alpha1`:

- **ConfigSync** (namespaced, at most one per workload): names targets, an ordered list of sources and output names. A
  source is a reference to a store, with `common: false` to leave out that store's common files. Every spec field is
  optional and defaults from the resource's name and namespace. A ConfigSync never names a key.
- **ConfigStore** (namespaced) and **ClusterConfigStore** (cluster-wide, with an allowed-namespaces list): everything
  about the bucket is in the block `spec.s3`: the bucket and optional key prefix, the folders of the service files and
  the common files (`serviceFolder`, `commonFolder`, with the placeholders `{namespace}` and `{name}`), and the identity
  to reach it: a ServiceAccount whose token AWS exchanges for short-lived keys, or a credentials Secret for stores that
  cannot do that, such as the local RustFS.

Other kinds of store (Parameter Store, Secrets Manager) are planned and not built. Each will be a block next to `s3`
with its own identity, will yield the same four sets of values, and will announce changes through EventBridge. Do not
build a general store interface before the second kind exists.

A reconcile fetches four files from each source (workload and `_common`, config and secrets), merges every common file
and then every workload file in the order of the sources, the last one winning, writes one ConfigMap and one Secret,
then stamps a SHA-256 hash of their contents on each target's pod template as `kmo.isntall.net/config-hash`. The hash,
not a timestamp, is what makes reconciling repeatable and prevents restarts when nothing effective changed.

Invariants that span the design and are easy to break:

- The store is the source of truth; hand edits to managed objects are overwritten (unless the ConfigSync is suspended).
- Any failure (a store that is missing or unreachable, an unparsable file, an unlabelled object already holding the
  output name) stops the whole reconcile and leaves existing objects untouched. A partial merge is never written.
- Targets and outputs are always in the ConfigSync's own namespace.
- A ConfigSync on a cluster-wide store may read only its own namespace's folder and the common folder. This holds by
  construction: the keys come from the store's folders, and the definition refuses a ClusterConfigStore whose
  `serviceFolder` lacks `{namespace}`.
- Conflicting ConfigSyncs (shared target or output name) are rejected at admission; suspended resources keep their
  claims.
- Outputs carry `reloader.stakater.com/ignore: "true"` so Stakater Reloader does not roll workloads a second time.
- The receiver and operator must resolve stores and default keys with the same code, so they always agree.

## Layout

An npm workspace of source-only TypeScript packages: nothing is compiled, and consumers import the `.ts` sources.

`packages/core` exists and holds every decision that needs no cluster: env file parsing (`dotenv.ts`), merging
(`merge.ts`), hashing (`hash.ts`), turning the source files of every source into outputs (`render.ts`), ConfigSync
defaulting (`defaults.ts`, `duration.ts`), store lookup and the keys of a store's files (`store.ts`), the RustFS and
EventBridge event normalizers (`events.ts`) and event-to-ConfigSync matching (`matching.ts`), what a reconcile reads or
why it cannot start (`plan.ts`), the status and Events of an outcome (`status.ts`), whether a ConfigSync needs a
reconcile and when a trigger must ask for a sync (`trigger.ts`), conflicting ConfigSyncs (`claims.ts`), and which
identity a store uses (`identity.ts`). Shared types are in `types.ts`. The package is `@kmo/core` and everything is
exported through `src/index.ts`. It must not make Kubernetes or network calls. Parse errors carry a line number and a
reason, never a value, because values may be secrets.

`packages/operator` is the Pepr module, `@kmo/operator`: `pepr.ts` is the entry point, `src/capability.ts` holds every
binding, `src/kinds.ts` the client kinds and `src/guarded-kind.ts` the shim for watches on a kind that may be missing,
`src/cluster.ts` the small cluster reads (stores, stored keys), `src/credentials.ts` the choice between stored keys and
`src/web-identity.ts`, the exchange of a ServiceAccount's token for AWS keys, `src/s3.ts` the store reads,
`src/store-status.ts` the `Ready` condition of a store, `src/reconcile.ts` one reconcile from start to finish
`src/report.ts` the status and Events it leaves on the ConfigSync, and `src/triggers.ts` the handlers that ask for a
sync, with `src/generation-gate.ts` to tell a spec change from any other update. Its `package.json` holds the Pepr
settings and the hand-written RBAC rules. `test/e2e/` holds scripts that check the operator on the local cluster.

`crds/` holds the definitions of ConfigSync, ConfigStore and ClusterConfigStore. The `deploy` and `operator:deploy`
tasks apply them first, so the kinds exist before anything watches them. `dev/kmo/` holds the `kmo-system` namespace and
the local cluster-wide store `default`; `dev/workloads/configsyncs.yaml` holds one ConfigSync for each sample workload;
`dev/tenants/` holds the trusted tenant `payments`, with its own store, and the untrusted tenant `partners`, on a
cluster-wide store. `test/e2e/aws/` holds the scripts for the proof of stores without stored keys.

Still to come: `packages/receiver` (the HTTP service). The operator and receiver are to be thin shells around core.
`dev/` holds the local environment. The operator writes the `<name>-kmo` ConfigMaps and Secrets of the sample workloads,
so their pods start only after `mise run operator:deploy`.

One root `tsconfig.json` checks every package and emits nothing. Imports are extensionless, `verbatimModuleSyntax`
requires `import type` for types, and `noUncheckedIndexedAccess` is on.

## What the spike means for the operator

The spike findings in `docs/superpowers/spikes/` record what was verified about RustFS and Pepr; read them before
planning operator work. The consequences that are easiest to trip over:

- The root `overrides` are scoped to the package that brings each dependency. `@kubernetes/client-node` must keep
  `js-yaml` 4, or `pepr build` breaks. A changed override needs a regenerated lockfile.
- npm installs two copies of `kubernetes-fluent-client`, one for the operator and one inside Pepr, and each has its own
  list of registered kinds. Take `RegisterKind`, `kind` and `K8s` from `pepr`, or Pepr does not know the kind.
- A watch on a kind that is not installed crash-loops Pepr's watcher and takes the refresh timer with it. Hence the
  guarded Rollout watch (`KMO_GUARD_ROLLOUT_WATCH`, on by default), proven on the cluster by
  `mise run check:rollout-guard`. Another optional kind needs a `GuardedKind` value in `src/kinds.ts` and a call to
  `guardKind` after its watches are declared; never a plain watch.
- The shim behind that guard uses parts of Pepr that are not public. Treat every Pepr upgrade as a possible rewrite of
  the shim: Pepr stays pinned to an exact version, and `docs/upgrading-pepr.md` is the procedure to move the pin.
- Pepr creates the admission Deployment `pepr-kmo` only when the module has an admission binding. Until then only
  `pepr-kmo-watcher` runs.
- The operator's own status updates trigger a reconcile. `needsReconcile` returns early when neither
  `metadata.generation` nor the sync annotation differs from what the status records. Keep every new trigger on that
  path.
- `PatchStatus` sends a merge patch, which removes a field only when it is null. A status field that can go away must be
  written as null, as `statusPatch` does for the handled sync request, or the early return never holds.
- No trigger reconciles by itself. Each one sets the sync annotation with `requestSync`, as the receiver will, so there
  is one path into a reconcile. `requestSync` sends the uid, so the API server refuses it when the ConfigSync is gone.
- The watches see the operator's own writes before the reconcile has recorded them in the status. A handler that reads
  the status must use `putOff` while `needsReconcile` holds, or one change costs two reconciles. It must not wait in
  place: Pepr delivers the next event of a watch only when the callback has returned.
- Every watcher start asks for one sync of every ConfigSync, because every store is new to the generation gate.
- The module has an admission binding now, so the Deployment `pepr-kmo` runs next to the watcher, with failure policy
  `Fail`. While its pods are down, nothing can create or change a ConfigSync, the operator included. Hence `requestSync`
  sends a refused request again, and `operator:deploy` waits for both Deployments.
- A trigger check that was put off must read the workload again. The object the watch delivered is older than the
  reconcile it waited for.
- Use scoped RBAC with hand-written rules; Pepr's default grants cluster admin.

## Commands

Mise pins the tools and defines the tasks. Commands assume Mise is activated; otherwise prefix them with `mise x --`.

- `mise run setup` installs the npm dependencies and the Git hooks.
- `mise run lint` runs ESLint, the Prettier check, markdownlint and the TypeScript type check (`npm run typecheck`).
- `npm run format` rewrites files with Prettier (line length 120). Run it before committing; the pre-commit hook only
  checks. `packages/core/test/fixtures/` is excluded because the payloads are real captures, and
  `docs/superpowers/plans/` is excluded from both Prettier and markdownlint.
- `mise run test` runs the unit tests with Vitest. One file: `npx vitest run packages/core/test/dotenv.test.ts`. One
  test: add `-t "part of its name"`.
- `mise run operator:deploy` builds the operator and installs it into the cluster; `mise run operator:logs` shows the
  watcher log.
- `mise run test:e2e` runs the end-to-end smoke test, `test/e2e/smoke.sh`, in about three minutes. It needs Docker,
  creates the cluster and installs the local environment when they are missing, always installs the operator from the
  working tree, and uses its own namespace `kmo-smoke`. Run it at the end of every task that changes the operator, and
  add a check to it for each new behavior that can be seen on the cluster.
- `mise run aws:issuer`, `mise run aws:setup` and `mise run aws:teardown` run the proof of stores without stored keys
  against a real AWS account. They create and delete AWS resources, so they need a go-ahead in the session each time.
  `docs/aws-identity.md` describes them. With `KMO_OIDC_ISSUER` set, in `mise.local.toml`, `cluster:up` makes the API
  server sign its tokens under that address.
- `mise run check:rollout-guard` proves the guarded Rollout watch. It removes and reinstalls Argo Rollouts on the local
  cluster and takes about seven minutes.
- `mise run cluster:up` and `mise run cluster:down` create and delete the local k3d cluster. Its kubeconfig is
  `.kube/config` inside the repository.
- `mise run deploy` installs Argo Rollouts, RustFS, the seed Job and the sample workloads from `dev/`.
- `mise run store -- <aws args>` runs the AWS CLI against the local RustFS, for example `mise run store -- s3 ls`.

Pre-commit runs ESLint, the Prettier check, markdownlint, the TypeScript type check and gitleaks. Commit directly to
`main`; do not create branches. Leave finished work uncommitted for review: commit only when asked, never push, and do
not start the next step unasked. Use conventional commit messages with the types `feat`, `fix` and `chore`, for example
`feat: add the env file parser`.

The remaining planned task, `demo`, does not exist yet. The local environment is a k3d cluster named `kmo` with Argo
Rollouts installed, RustFS in the `kmo-dev` namespace holding the bucket `kmo-config`, and the sample workloads in
`shop`. `kubectl` reaches this cluster only when Mise is active, because Mise sets `KUBECONFIG`.

## How the build proceeds

The spec lists thirteen ordered steps. Steps 1 to 4 (tooling, the local cluster, the spike and the core logic) are done,
and so are the two operator tasks that come before step 5, step 5, the custom resources, step 6, syncing, step 7,
rolling updates, step 8, reporting, step 9, staying in step, step 10, guarding, and step 11, tenants. The next are step
12, the receiver, and step 13, the finish, which need a new plan first. Work one step at a time: explain beforehand what
is being built and which Kubernetes idea it introduces, finish with something observable, then pause for questions. Do
not batch several steps into one change. Implementation is test-first.

## Conventions

- **Comments.** Terse, and only where something is hard to understand. No reasons, no change history. Every exported
  function gets a terse JSDoc block covering what it does, its parameters and its return value. Every attribute of an
  exported interface gets a one-line JSDoc.
- **Unit tests.** Each test reads as a statement of behavior a person can follow. Full coverage is not a goal; leave out
  tests that assert nothing a reader would care about. Event normalizers are tested against real captured payloads.
- **Docs.** Written for people: high level, few code fences. `docs/index.md` is the entry point, and the default page in
  any `docs` sub-folder is named `index.md`.
- **`dev/README.md`.** One line for each entry in `dev/`, saying what it is for. Update it in the same change that adds,
  removes or repurposes an entry.
- **Root README.** A short introduction and file layout, a pointer to `docs/index.md`, and installation instructions for
  a cluster (in full or by link).
- **Nothing about one person's computer in committed files.** No absolute local paths (such as a home directory), user
  names, AWS account IDs, profiles or regions. Write paths relative to the repository root. A person's own settings
  belong in `CLAUDE.local.md`, which is not committed; read it for values such as the AWS region.
- **KISS.** Use ASD-STE100 Simplified Technical English to explain things.
