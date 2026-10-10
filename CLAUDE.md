# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## State of the repository

The design spec, `docs/superpowers/specs/2026-10-10-kmo-operator-core-design.md`, is the source of truth for every
design question; read it before proposing or building anything. The foundations plan,
`docs/superpowers/plans/2026-10-10-kmo-foundations.md`, is complete: the tooling, the local environment, the spike and
the core logic exist. The operator and the receiver do not. The operator plan (spec steps 5 to 11) is next and has not
been written yet.

The product is named **KMO**. The directory is still called `zeemo` and must not be renamed; never introduce "zeemo" in
code, manifests or docs. Kubernetes names use `kmo`: API group `kmo.isntall.net`, namespace `kmo-system`, label
`app.kubernetes.io/managed-by: kmo`.

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

- **ConfigSync** (namespaced, at most one per workload): names targets, a store, source keys and output names. Every
  spec field is optional and defaults from the resource's name and namespace.
- **ConfigStore** (namespaced) and **ClusterConfigStore** (cluster-wide, with an allowed-namespaces list): one bucket
  plus optional key prefix, and the credentials Secret to reach it.

A reconcile fetches four files (workload and `_common`, config and secrets), merges them with the workload winning,
writes one ConfigMap and one Secret, then stamps a SHA-256 hash of their contents on each target's pod template as
`kmo.isntall.net/config-hash`. The hash, not a timestamp, is what makes reconciling repeatable and prevents restarts
when nothing effective changed.

Invariants that span the design and are easy to break:

- The store is the source of truth; hand edits to managed objects are overwritten (unless the ConfigSync is suspended).
- Any failure (unreachable store, unparsable file, disallowed key, unlabelled object already holding the output name)
  stops the whole reconcile and leaves existing objects untouched. A partial merge is never written.
- Targets and outputs are always in the ConfigSync's own namespace.
- A ConfigSync on a cluster-wide store may read only its own namespace's folder and the common folder, whatever its spec
  says.
- Conflicting ConfigSyncs (shared target or output name) are rejected at admission; suspended resources keep their
  claims.
- Outputs carry `reloader.stakater.com/ignore: "true"` so Stakater Reloader does not roll workloads a second time.
- The receiver and operator must resolve stores and default keys with the same code, so they always agree.

## Layout

An npm workspace of source-only TypeScript packages: nothing is compiled, and consumers import the `.ts` sources.

`packages/core` exists and holds every decision that needs no cluster: env file parsing (`dotenv.ts`), merging and
hashing (`render.ts`), ConfigSync defaulting (`defaults.ts`), store lookup and tenant access rules (`store.ts`), the
RustFS and EventBridge event normalizers (`events.ts`) and event-to-ConfigSync matching (`matching.ts`). It must not
make Kubernetes or network calls. Parse errors carry a line number and a reason, never a value, because values may be
secrets.

Still to come: `packages/operator` (the Pepr module), `packages/receiver` (the HTTP service), `crds/` and `test/e2e/`.
The operator and receiver are to be thin shells around core. `dev/` holds the local environment; its hand-generated
`<name>-kmo` ConfigMaps and Secrets are stand-ins until the operator writes them.

The spike findings in `docs/superpowers/spikes/` record what was verified about RustFS and Pepr; read them before
planning operator work.

## Commands

Mise pins the tools and defines the tasks. Commands assume Mise is activated; otherwise prefix them with `mise x --`.

- `mise run setup` installs the npm dependencies and the Git hooks.
- `mise run lint` runs ESLint, the Prettier check, markdownlint and the TypeScript type check (`npm run typecheck`).
- `npm run format` rewrites files with Prettier (line length 120). Run it before committing.
- `mise run test` runs the unit tests with Vitest. One file: `npx vitest run packages/core/test/dotenv.test.ts`. One
  test: add `-t "part of its name"`.
- `mise run cluster:up` and `mise run cluster:down` create and delete the local k3d cluster. Its kubeconfig is
  `.kube/config` inside the repository.
- `mise run deploy` installs Argo Rollouts, RustFS, the seed Job and the sample workloads from `dev/`.
- `mise run store -- <aws args>` runs the AWS CLI against the local RustFS, for example `mise run store -- s3 ls`.

Pre-commit also runs gitleaks and a TypeScript type check. Commit directly to `main`; do not create branches. Use
conventional commit messages with the types `feat`, `fix` and `chore`, for example `feat: add the env file parser`.

The remaining planned tasks (`test:e2e`, `demo`) do not exist yet. The local environment is a k3d cluster with RustFS as
the object store and Argo Rollouts installed.

## How the build proceeds

The spec lists thirteen ordered steps, starting with tooling, the local cluster and a throwaway spike that checks three
risky assumptions about RustFS and Pepr. Work one step at a time: explain beforehand what is being built and which
Kubernetes idea it introduces, finish with something observable, then pause for questions. Do not batch several steps
into one change. Implementation is test-first.

## Conventions

- **Comments.** Terse, and only where something is hard to understand. No reasons, no change history. Every exported
  function gets a terse JSDoc block covering what it does, its parameters and its return value.
- **Unit tests.** Each test reads as a statement of behavior a person can follow. Full coverage is not a goal; leave out
  tests that assert nothing a reader would care about. Event normalizers are tested against real captured payloads.
- **Docs.** Written for people: high level, few code fences. `docs/index.md` is the entry point, and the default page in
  any `docs` sub-folder is named `index.md`.
- **Root README.** A short introduction and file layout, a pointer to `docs/index.md`, and installation instructions for
  a cluster (in full or by link).
