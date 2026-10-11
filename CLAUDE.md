# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is short on
purpose: the details are in the files listed under [Read when needed](#read-when-needed).

## What KMO is

A Kubernetes operator that keeps ConfigMaps and Secrets in step with dotenv files in an S3-compatible object store, and
rolls the workloads that use them when their effective values change. It is also a project for learning Kubernetes, so
idiomatic patterns are preferred and the reasons for them are documented.

The operator core is finished: the operator, the receiver and the three custom resources run end to end on a local
cluster. Stores without stored keys are proven from the local cluster against a real AWS account, and not yet inside
EKS. Two more pieces of work are planned, packaging (Helm, ArgoCD) and AWS integration (Terraform/Terragrunt). Neither
is designed, and each needs a spec before a plan.

The product is named **KMO**. The directory is still called `zeemo` and must not be renamed; never introduce "zeemo" in
code, manifests or docs. Kubernetes names use `kmo`: API group `kmo.isntall.net`, label
`app.kubernetes.io/managed-by: kmo`. The receiver and the credentials of cluster-wide stores live in the namespace
`kmo-system`; the operator runs in `pepr-system`, which Pepr does not let you change.

## Architecture

Two components, split because Pepr cannot host a custom HTTP endpoint:

- **Receiver.** A stateless HTTP service that turns a store change event into a `kmo.isntall.net/sync-requested-at`
  annotation on each affected ConfigSync. It never reads the store and cannot read Secrets.
- **Operator.** A Pepr module (TypeScript) that reconciles each ConfigSync. It is the only component holding store
  credentials and the only writer of managed objects.

Three custom resources, all `kmo.isntall.net/v1alpha1`: **ConfigSync** (namespaced, at most one per workload, names
stores and never keys), **ConfigStore** (namespaced) and **ClusterConfigStore** (cluster-wide, with a list of allowed
namespaces). Everything about a bucket, its identity included, is in the store's block `spec.s3`.

A reconcile fetches four files from each source (workload and `_common`, config and secrets), merges every common file
and then every workload file in the order of the sources, the last one winning, writes one ConfigMap and one Secret,
then stamps a SHA-256 hash of their contents on each target's pod template as `kmo.isntall.net/config-hash`. Every
trigger sets the sync annotation, so there is one path into a reconcile.

Invariants that span the design and are easy to break:

- The store is the source of truth; hand edits to managed objects are overwritten (unless the ConfigSync is suspended).
- Any failure stops the whole reconcile and leaves existing objects untouched. A partial merge is never written.
- The hash, not a timestamp, is the stamp. A reconcile that finds the same values restarts nothing.
- Targets and outputs are always in the ConfigSync's own namespace.
- A ConfigSync on a cluster-wide store may read only its own namespace's folder and the common folder. This holds by
  construction: the keys come from the store's folders, and the definition refuses a ClusterConfigStore whose
  `serviceFolder` lacks `{namespace}`.
- Conflicting ConfigSyncs (shared target or output name) are rejected at admission; suspended resources keep their
  claims.
- Values are never split over several objects. More than 1 MiB is the failure `OutputTooLarge`.
- The receiver and operator resolve stores and keys with the same code from core, so they always agree.
- The receiver has no permission on Secrets and no code that reads the store.
- A message in a log, a status, an Event or an HTTP answer never holds a token or a value from a file.
- Do not build a general store interface before a second kind of store exists.

## Layout

An npm workspace of source-only TypeScript packages: nothing is compiled, and consumers import the `.ts` sources.

- `packages/core` (`@kmo/core`) holds every decision that needs no cluster. It makes no Kubernetes or network call.
- `packages/operator` (`@kmo/operator`) is the Pepr module, a thin shell around core.
- `packages/receiver` (`@kmo/receiver`) is the HTTP service, also a thin shell around core.
- `crds/` holds the definitions of the three custom resources.
- `dev/` holds the manifests of the local environment and the demo.
- `test/e2e/` holds the end-to-end suites, in Bash, and the scripts for the proof on AWS.
- `docs/` holds the documentation for people, starting at `docs/index.md`.
- `.claude/rules/` holds the detailed guidance for work on each part of this repository.

## Read when needed

Read the file that fits before you plan or change that part. Do not read them all at the start.

| When                                             | Read                                                         |
| ------------------------------------------------ | ------------------------------------------------------------ |
| A design question, or a new piece of work        | `docs/design.md`, then `docs/planned.md` for the open points |
| The rules of a resource or of the receiver       | `docs/configsync.md`, `docs/stores.md`, `docs/receiver.md`   |
| Running a task, the cluster or the proof on AWS  | `docs/commands.md`                                           |
| Work on `packages/core`                          | `.claude/rules/core.md`                                      |
| Work on `packages/operator`, or anything on Pepr | `.claude/rules/operator.md`, and `docs/upgrading-pepr.md`    |
| Work on `packages/receiver`                      | `.claude/rules/receiver.md`                                  |
| Work on `test/e2e/`                              | `.claude/rules/e2e.md`                                       |
| Work on `dev/` or `crds/`                        | `.claude/rules/dev.md`                                       |
| Writing a shell script                           | `.claude/rules/shell.md`                                     |
| Writing documentation                            | `.claude/rules/docs.md`                                      |
| A person's own settings, such as the AWS region  | `CLAUDE.local.md`, which is not committed                    |

Each file in `.claude/rules/` names the paths it is for, so it is also loaded when a file under those paths is read.

## Commands

Mise pins the tools and defines the tasks. Commands assume Mise is activated; otherwise prefix them with `mise x --`.

- `mise run format` rewrites files with Prettier and shfmt. Run it before committing; the hooks only check.
- `mise run lint` runs every static check.
- `mise run test` runs the unit tests. One file: `npx vitest run packages/core/test/dotenv.test.ts`.
- `mise run test:e2e -- smoke` runs the smoke suite on the local cluster, in about two minutes. Run it at the end of
  every task that changes the operator or the receiver. Run all suites, `mise run test:e2e`, before a commit of such a
  change.
- The `aws:*` tasks create and delete AWS resources, so they need a go-ahead in the session each time.

## How to work

- New work starts with a spec, then a plan. Implementation is test-first.
- Work one step at a time: explain beforehand what is being built and which Kubernetes idea it introduces, finish with
  something observable, then pause for questions. Do not batch several steps into one change.
- Commit directly to `main`; do not create branches. Leave finished work uncommitted for review: commit only when asked,
  never push, and do not start the next step unasked.
- Use conventional commit messages with the types `feat`, `fix` and `chore`, for example
  `feat: add the env file parser`.

## Conventions

- **Comments.** Terse, and only where something is hard to understand. No reasons, no change history. Every exported
  function gets a terse JSDoc block covering what it does, its parameters and its return value. Every attribute of an
  exported interface gets a one-line JSDoc.
- **TypeScript.** Imports are extensionless, types need `import type`, and `noUncheckedIndexedAccess` is on.
- **Unit tests.** Each test reads as a statement of behavior a person can follow. Full coverage is not a goal; leave out
  tests that assert nothing a reader would care about.
- **Nothing about one person's computer in committed files.** No absolute local paths (such as a home directory), user
  names, AWS account IDs, profiles or regions. Write paths relative to the repository root.
- **KISS.** Use ASD-STE100 Simplified Technical English to explain things.
