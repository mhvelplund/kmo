# Commands

This page lists the tasks for people who work on KMO itself. Mise pins the tools and defines the tasks, in `mise.toml`.
Commands assume Mise is activated; otherwise prefix them with `mise x --`. `kubectl` reaches the local cluster only when
Mise is active, because Mise sets `KUBECONFIG`.

## Checks

- `mise run setup` installs the npm dependencies and the Git hooks.
- `mise run lint` runs ESLint, the Prettier check, markdownlint, the TypeScript type check (`npm run typecheck`),
  ShellCheck and the shfmt check.
- `mise run format` rewrites files with Prettier (line length 120) and the shell scripts with shfmt. Run it before
  committing; the pre-commit hooks only check. `packages/core/test/fixtures/` is excluded because the payloads are real
  captures.
- `mise run test` runs the unit tests with Vitest. One file: `npx vitest run packages/core/test/dotenv.test.ts`. One
  test: add `-t "part of its name"`.
- Pre-commit runs ESLint, the Prettier check, markdownlint, the TypeScript type check, ShellCheck, the shfmt check and
  gitleaks.

One root `tsconfig.json` checks every package and emits nothing. Imports are extensionless, `verbatimModuleSyntax`
requires `import type` for types, and `noUncheckedIndexedAccess` is on.

## The local cluster

- `mise run cluster:up` and `mise run cluster:down` create and delete the local k3d cluster, named `kmo`. Its kubeconfig
  is `.kube/config` inside the repository.
- `mise run deploy` installs Argo Rollouts, RustFS, the seed Job and the sample workloads from `dev/`.
- `mise run operator:deploy` builds the operator and installs it into the cluster; `mise run operator:logs` shows the
  watcher log.
- `mise run receiver:deploy` bundles the receiver, pushes its image to the cluster's registry and installs it;
  `mise run receiver:logs` shows its log.
- `mise run store -- <aws args>` runs the AWS CLI against the local RustFS, for example `mise run store -- s3 ls`.
- `mise run demo` changes one value in the local store and shows each step up to the new pods.

## End-to-end suites

- `mise run test:e2e` runs the six end-to-end suites through `test/e2e/run.sh`, in about twelve minutes. Name suites
  after `--` to run only those: `mise run test:e2e -- smoke` takes about two minutes.
- It needs Docker and `curl`, creates the cluster and installs the local environment when they are missing, and always
  installs the operator and the receiver from the working tree.
- Run the smoke suite at the end of every task that changes the operator or the receiver, and the full run before a
  commit.
- `mise run check:rollout-guard` is a shortcut for `mise run test:e2e -- rollout-guard`, which proves the guarded
  Rollout watch. It removes and reinstalls Argo Rollouts on the local cluster and takes about seven minutes.

## The proof on AWS

- `mise run aws:issuer`, `mise run aws:setup` and `mise run aws:teardown` run the proof of stores without stored keys
  against a real AWS account. They create and delete AWS resources, so run them only when you mean to.
  [Stores in AWS without stored keys](aws-identity.md) describes them.
- With `KMO_OIDC_ISSUER` set, in `mise.local.toml`, `cluster:up` makes the API server sign its tokens under that
  address.

## The wiki

- The workflow `.github/workflows/wiki.yml` copies the pages of `docs/` to the wiki of the repository on each push to
  `main` that changes them. The wiki is a copy: change a page in `docs/`, not in the wiki.
- `mise run docs:wiki -- <directory>` writes the same pages into a directory, to look at them before a push. It deletes
  each Markdown file already in that directory, and it stops when a link names a page that does not exist.
