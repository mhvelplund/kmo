# KMO Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ground the KMO operator stands on: the tooling, a local cluster with an object store and sample
workloads, a spike that confirms the risky assumptions, and the pure logic package with its unit tests.

**Architecture:** An npm workspace with one source-only TypeScript package, `@kmo/core`, that has no Kubernetes or
network calls. A k3d cluster runs RustFS and five sample workloads whose config is still written by hand. A throwaway
spike exercises RustFS notifications and Pepr before anything depends on them.

**Tech Stack:** Mise, Node 24, TypeScript 5.9, Vitest 5, ESLint 10, Prettier 3, pre-commit, k3d 5.9 (k3s 1.37), RustFS
1.0.1, Argo Rollouts 1.10, Pepr 2.0.3 (spike only).

**Spec:** `docs/superpowers/specs/2026-10-10-kmo-operator-core-design.md`

## Where this plan sits

The spec lists thirteen build steps. This plan covers steps 1 to 4: tooling, local cluster, spike, core logic. It stops
there on purpose. The spec says the design is revisited if the spike fails, so the operator steps cannot be planned
honestly until the spike has run. Two more plans follow:

- **Operator** (steps 5 to 11): the custom resources, syncing, rolling updates, reporting, staying in step, guarding,
  tenants. Written after this plan's spike findings are in.
- **Receiver and finish** (steps 12 and 13): the receiver, the end-to-end tests, the `demo` task and the full docs.

The Mise tasks `test:e2e` and `demo`, the tenant namespaces and the receiver's webhook target belong to those plans.

## Global Constraints

- The product is **KMO**; Kubernetes names use `kmo`. Never write "zeemo" in code, manifests or docs. The directory
  `/home/mhvelplund/projects/zeemo` keeps its name.
- API group `kmo.isntall.net`, version `v1alpha1`. Receiver namespace `kmo-system`. Local-only namespace `kmo-dev`.
- Commit directly to `main`. Do not create branches or worktrees.
- Pinned versions: Node `24.21.0`, kubectl `1.37.1`, k3d `5.9.0`, pre-commit `4.6.2`, aws-cli `2.37.12`, k3s image
  `rancher/k3s:v1.37.1-k3s1`, `rustfs/rustfs:1.0.1`, `amazon/aws-cli:2.37.12`, `busybox:1.37.0`, Argo Rollouts
  `v1.10.0`, TypeScript `5.9.3` (Pepr 2.0.3 requires `^5.8.3`; do not move to TypeScript 7), Pepr `2.0.3`.
- Prettier enforces a line length of 120 characters.
- Comments: terse, only where something is hard to follow, no reasons and no history. Every exported function, class and
  type gets a terse JSDoc block covering what it does, its parameters and its return value.
- Unit tests read as statements of behavior. No coverage chasing; leave out tests a reader would not care about.
- Docs are for people: high level, few code fences. `docs/index.md` is the entry point.
- `@kmo/core` makes no Kubernetes or network calls.
- Error messages produced while parsing env files never contain a value, only a line number and a reason. Values may be
  secrets, and these messages end up in Events and status.
- Learning pace. Every task opens with a **Before** note to explain to the user and closes with an **After** step that
  shows something observable, followed by a pause for questions. Do not start the next task until the user says so.
- Commands assume Mise is activated in the shell. If it is not, prefix them with `mise x --`.
- Run `npm run format` before each commit so the pre-commit hooks pass.

## Additions to the spec

Two small things the spec does not list, both needed to work with the local store from the host:

- `aws-cli` is added to the Mise tools, and a `store` task wraps it with the local endpoint and credentials.
- The local store's S3 port is published on the host as `localhost:9000`.

## Review Focus

- **Values containing `=` or `#`.** `DATABASE_URL=postgres://u:p@db/shop?sslmode=require`, `TOKEN=YWJj==`,
  `COLOR=#ff0000` and `PASSWORD=p#ss` keep their full value. A `#` starts a comment only after whitespace. (Task 6)
- **Files saved on Windows.** CRLF line endings and a leading byte-order mark parse exactly like a Unix file. (Task 6)
- **Secrets in error text.** A file that fails to parse reports its line number, never the offending value. (Task 6)
- **Namespaces that share a prefix.** On a cluster-wide store, namespace `shop` cannot read `shop-admin/…`; and key
  prefixes `prod` and `prod/` name the same location. (Task 9)
- **Awkward object keys in events.** Keys with spaces or encoded slashes decode correctly, and a broken escape is
  reported as a malformed event instead of crashing. (Task 10)

## File Structure

```text
mise.toml                      tools and tasks
package.json                   npm workspace root and scripts
tsconfig.json                  one type-check config for all packages
eslint.config.js
vitest.config.ts               (Task 6)
.prettierrc.json  .prettierignore  .markdownlint-cli2.jsonc  .gitleaks.toml  .pre-commit-config.yaml  .gitignore
README.md
docs/index.md                  docs entry point (Task 3)
docs/getting-started.md        local environment walkthrough (Task 3)
docs/superpowers/spikes/2026-10-10-kmo-operator-core-spike.md   spike findings (Tasks 4, 5)
dev/k3d.yaml                   cluster definition
dev/aws-config                 AWS CLI profile for the local store
dev/kustomization.yaml         store and sample workloads
dev/argo-rollouts/             Argo Rollouts install
dev/store/                     namespace, RustFS, seed Job
dev/store-files/               sample env files, laid out as in the bucket
dev/workloads/                 namespace and five sample workloads
packages/core/package.json
packages/core/src/types.ts     resource shapes shared by every module
packages/core/src/dotenv.ts    env file parser
packages/core/src/merge.ts     common + workload merge
packages/core/src/hash.ts      content hash
packages/core/src/render.ts    four file texts -> ConfigMap data, Secret data, hash
packages/core/src/duration.ts  refresh interval parsing
packages/core/src/defaults.ts  ConfigSync defaulting
packages/core/src/store.ts     store lookup, key building, access rules
packages/core/src/events.ts    RustFS and EventBridge normalizers
packages/core/src/matching.ts  which ConfigSyncs an event affects
packages/core/src/index.ts     public exports
packages/core/test/*.test.ts   one test file per module
packages/core/test/fixtures/   event payloads
```



### Task 1: Tooling

**Before (explain to the user):** Mise pins every command-line tool per repository, so a fresh clone gets the same
versions. An npm workspace lets several packages share one install and one lockfile. Pre-commit runs the checks before
each commit so mistakes are caught locally. No Kubernetes yet.

**Files:**

- Create: `mise.toml`, `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
  `.markdownlint-cli2.jsonc`, `.gitleaks.toml`, `.pre-commit-config.yaml`, `.gitignore`, `README.md`
- Modify: `docs/superpowers/specs/2026-10-10-kmo-operator-core-design.md` (lint fixes only), `CLAUDE.md`

**Interfaces:**

- Produces: Mise tasks `setup` and `lint`; npm scripts `lint`, `format`, `format:check`, `typecheck`, `lint:md`.

- [x] **Step 1: Write `mise.toml`**

```toml
[tools]
node = "24.21.0"
kubectl = "1.37.1"
k3d = "5.9.0"
pre-commit = "4.6.2"
aws-cli = "2.37.12"

[env]
KUBECONFIG = "{{config_root}}/.kube/config"

[tasks.setup]
description = "Install dependencies and Git hooks"
run = ["npm install", "pre-commit install"]

[tasks.lint]
description = "Run every static check"
run = ["npm run lint", "npm run format:check", "npm run lint:md"]
```

`KUBECONFIG` points inside the repository so the local cluster never touches `~/.kube/config`.

- [x] **Step 2: Install the tools**

Run: `mise trust && mise install && node --version && k3d version` Expected: `v24.21.0` and `k3d version v5.9.0`.

- [x] **Step 3: Write `.gitignore`**

```gitignore
node_modules/
dist/
.kube/
*.log
```

- [x] **Step 4: Write `package.json`**

```json
{
  "name": "kmo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "lint": "eslint . --no-error-on-unmatched-pattern",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc",
    "lint:md": "markdownlint-cli2 \"**/*.md\""
  }
}
```

- [x] **Step 5: Install the development dependencies**

Run:

```bash
npm install --save-dev --save-exact typescript@5.9.3 eslint@10.12.0 @eslint/js@10.0.1 typescript-eslint@8.71.1 \
  eslint-config-prettier@10.1.8 prettier@3.9.10 markdownlint-cli2@0.23.3 @types/node@24
```

Expected: `package-lock.json` and `node_modules/` appear, with no peer dependency errors.

- [x] **Step 6: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["packages/*/src", "packages/*/test"]
}
```

Packages are source-only: nothing is compiled to `dist`. Vitest and, later, Pepr's bundler read the TypeScript directly.
There is no TypeScript yet, so `npm run typecheck` reports `TS18003: No inputs were found` until Task 6. That is
expected, and it is why `typecheck` joins the `lint` task only then.

- [x] **Step 7: Write `eslint.config.js`**

```js
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/node_modules/", "**/dist/", "packages/kmo-spike/", "packages/spike-lib/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
);
```

- [x] **Step 8: Write the Prettier, markdownlint and gitleaks configs**

`.prettierrc.json`:

```json
{
  "printWidth": 120,
  "proseWrap": "always"
}
```

`.prettierignore` (plans are working documents full of embedded files; reformatting them mid-run is noise):

```text
docs/superpowers/plans/
packages/kmo-spike/
packages/spike-lib/
packages/core/test/fixtures/
```

`.markdownlint-cli2.jsonc`:

```jsonc
{
  "config": {
    "MD013": { "line_length": 120, "code_blocks": false, "tables": false },
  },
  "ignores": ["**/node_modules/**", "docs/superpowers/plans/**", "packages/kmo-spike/**"],
}
```

`.gitleaks.toml` (the local environment and the tests use obvious sample values):

```toml
[extend]
useDefault = true

[allowlist]
description = "Sample values for the local environment and the tests"
paths = ['''^dev/''', '''^packages/core/test/''', '''^docs/superpowers/plans/''']
regexes = ['''kmo-local-secret''']
```

- [x] **Step 9: Write `.pre-commit-config.yaml`**

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v6.0.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
        args: [--allow-multiple-documents]
      - id: check-added-large-files
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.30.1
    hooks:
      - id: gitleaks
  - repo: local
    hooks:
      - id: eslint
        name: eslint
        entry: npx eslint --no-error-on-unmatched-pattern
        language: system
        types_or: [ts, javascript]
      - id: prettier
        name: prettier
        entry: npx prettier --check --ignore-unknown
        language: system
        types: [text]
      - id: typecheck
        name: typescript type check
        entry: npm run typecheck
        language: system
        types: [ts]
        pass_filenames: false
      - id: markdownlint
        name: markdownlint
        entry: npx markdownlint-cli2
        language: system
        types: [markdown]
        exclude: ^docs/superpowers/plans/
```

The ESLint, Prettier and type-check hooks are `local` so they use the versions in `package.json`.

- [x] **Step 10: Write `README.md`**

````markdown
# KMO

KMO keeps the configuration of Kubernetes workloads in step with env files held in an object store. When a file
changes, the matching ConfigMap or Secret is updated within seconds and the workloads that use it pick up the new
values through a rolling update.

The project is under construction. See the [documentation](docs/index.md) for what exists today.

## Layout

- `packages/` holds the TypeScript packages. `core` is the shared logic.
- `dev/` holds the manifests for the local environment.
- `docs/` holds the documentation, starting at [docs/index.md](docs/index.md).
- `mise.toml` pins the tools and defines the tasks.

## Installing

KMO cannot be installed into a real cluster yet. To try what exists on a local cluster, follow
[Getting started](docs/getting-started.md).
````

- [x] **Step 11: Format and fix the existing Markdown**

Run: `npm run format && npm run lint:md` Expected: Prettier may rewrap `CLAUDE.md`. markdownlint reports `MD040` (fenced
code block without a language) for the "Repository layout" block in the spec. Fix it by changing that block's opening
fence from three backticks to three backticks followed by `text`. Re-run until `npm run lint:md` prints
`Summary: 0 error(s)`.

- [x] **Step 12: Replace the "Planned tooling" section of `CLAUDE.md`**

Replace the whole `## Planned tooling` section with:

```markdown
## Commands

Mise pins the tools and defines the tasks. Commands assume Mise is activated; otherwise prefix them with `mise x --`.

- `mise run setup` installs the npm dependencies and the Git hooks.
- `mise run lint` runs ESLint, the Prettier check and markdownlint.
- `npm run format` rewrites files with Prettier (line length 120). Run it before committing.

Pre-commit also runs gitleaks and a TypeScript type check. Commit directly to `main`; do not create branches.
```

Also change the first paragraph under `## State of the repository` to say the tooling exists and the plan in
`docs/superpowers/plans/2026-10-10-kmo-foundations.md` is being executed.

- [x] **Step 13: Run the checks**

Run: `mise run setup && npm run format && mise run lint && pre-commit run --all-files` Expected: every hook prints
`Passed` or `Skipped`. The first run builds gitleaks and takes a minute or two. If a whitespace hook rewrites a file it
reports `Failed` once; run the command again.

- [x] **Step 14: Commit**

```bash
git add -A
git commit -m "Add tooling: Mise, npm workspace, linters and pre-commit hooks"
```

- [x] **After (show, then pause):** Add a line with trailing spaces to `README.md`, run `git commit -am test`, and show
  the hook refusing it. Undo with `git checkout README.md`. Ask for questions before Task 2.



### Task 2: Local cluster and object store

**Before (explain to the user):** k3d runs k3s, a small Kubernetes, inside Docker containers, so the whole cluster can
be thrown away and recreated. This task introduces Namespaces, a Deployment (keeps a pod running), a Service (a stable
address for it), a Secret, a Job (runs to completion once) and Kustomize (builds manifests from a folder). RustFS plays
the part of S3.

**Files:**

- Create: `dev/k3d.yaml`, `dev/aws-config`, `dev/kustomization.yaml`, `dev/store/namespace.yaml`,
  `dev/store/rustfs.yaml`, `dev/store/seed-job.yaml`, `dev/store-files/**`
- Modify: `mise.toml`

**Interfaces:**

- Produces: cluster `kmo`; registry `kmo-registry.localhost:5111`; RustFS at `http://rustfs.kmo-dev.svc:9000` in the
  cluster and `http://localhost:9000` on the host; root credentials `kmoadmin` / `kmo-local-secret` in Secret
  `kmo-dev/rustfs-root` (keys `accessKey`, `secretKey`); region `us-east-1`; buckets `kmo-config` and `kmo-tenant`, both
  versioned; Mise tasks `cluster:up`, `cluster:down`, `deploy`, `store`.

- [ ] **Step 1: Write `dev/k3d.yaml`**

```yaml
apiVersion: k3d.io/v1alpha5
kind: Simple
metadata:
  name: kmo
servers: 1
agents: 1
image: rancher/k3s:v1.37.1-k3s1
registries:
  create:
    name: kmo-registry.localhost
    host: 0.0.0.0
    hostPort: "5111"
ports:
  - port: 9000:30900
    nodeFilters:
      - server:0
```

One server and one agent give two nodes, which makes the DaemonSet in Task 3 worth looking at.

- [ ] **Step 2: Write the sample env files**

Run:

```bash
mkdir -p dev/store-files/_common
printf 'LOG_LEVEL=info\nREGION=eu-west-1\n' > dev/store-files/_common/config.env
printf 'SHARED_API_TOKEN=common-token\n' > dev/store-files/_common/secrets.env
for w in orders-api inventory node-agent nightly-report checkout; do
  mkdir -p "dev/store-files/shop/$w"
  printf 'GREETING=hello from %s\n' "$w" > "dev/store-files/shop/$w/config.env"
  printf 'DB_PASSWORD=%s-password\n' "$w" > "dev/store-files/shop/$w/secrets.env"
done
printf 'LOG_LEVEL=debug\n' >> dev/store-files/shop/orders-api/config.env
```

The folder mirrors the bucket: `<namespace>/<name>/config.env` and `_common/config.env`. `orders-api` overrides the
common `LOG_LEVEL`.

- [ ] **Step 3: Write `dev/store/namespace.yaml`**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: kmo-dev
```

- [ ] **Step 4: Write `dev/store/rustfs.yaml`**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: rustfs-root
  namespace: kmo-dev
stringData:
  accessKey: kmoadmin
  secretKey: kmo-local-secret
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rustfs
  namespace: kmo-dev
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: rustfs
  template:
    metadata:
      labels:
        app: rustfs
    spec:
      containers:
        - name: rustfs
          image: rustfs/rustfs:1.0.1
          env:
            - name: RUSTFS_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: rustfs-root
                  key: accessKey
            - name: RUSTFS_SECRET_KEY
              valueFrom:
                secretKeyRef:
                  name: rustfs-root
                  key: secretKey
          ports:
            - name: s3
              containerPort: 9000
          readinessProbe:
            tcpSocket:
              port: s3
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: rustfs
  namespace: kmo-dev
spec:
  type: NodePort
  selector:
    app: rustfs
  ports:
    - name: s3
      port: 9000
      targetPort: s3
      nodePort: 30900
```

The data lives in an `emptyDir`, so it is lost when the pod restarts. The seed Job puts it back.

- [ ] **Step 5: Write `dev/store/seed-job.yaml`**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: store-seed
  namespace: kmo-dev
spec:
  backoffLimit: 3
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: seed
          image: amazon/aws-cli:2.37.12
          command: ["/bin/sh", "-c"]
          args:
            - |
              set -eu
              aws configure set default.s3.addressing_style path
              until aws s3api list-buckets >/dev/null 2>&1; do echo "waiting for the store"; sleep 2; done
              for bucket in kmo-config kmo-tenant; do
                aws s3api head-bucket --bucket "$bucket" 2>/dev/null || aws s3api create-bucket --bucket "$bucket"
                aws s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled
              done
              for file in /seed/*; do
                key=$(basename "$file" | sed 's|__|/|g')
                aws s3 cp "$file" "s3://kmo-config/$key"
              done
          env:
            - name: AWS_ENDPOINT_URL
              value: http://rustfs.kmo-dev.svc:9000
            - name: AWS_DEFAULT_REGION
              value: us-east-1
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: rustfs-root
                  key: accessKey
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: rustfs-root
                  key: secretKey
          volumeMounts:
            - name: seed
              mountPath: /seed
      volumes:
        - name: seed
          configMap:
            name: store-seed-files
```

ConfigMap keys cannot contain a slash, so each file is stored with `__` in its name and the script turns that back into
`/`.

- [ ] **Step 6: Write `dev/kustomization.yaml`**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - store/namespace.yaml
  - store/rustfs.yaml
  - store/seed-job.yaml
generatorOptions:
  disableNameSuffixHash: true
configMapGenerator:
  - name: store-seed-files
    namespace: kmo-dev
    files:
      - _common__config.env=store-files/_common/config.env
      - _common__secrets.env=store-files/_common/secrets.env
      - shop__orders-api__config.env=store-files/shop/orders-api/config.env
      - shop__orders-api__secrets.env=store-files/shop/orders-api/secrets.env
      - shop__inventory__config.env=store-files/shop/inventory/config.env
      - shop__inventory__secrets.env=store-files/shop/inventory/secrets.env
      - shop__node-agent__config.env=store-files/shop/node-agent/config.env
      - shop__node-agent__secrets.env=store-files/shop/node-agent/secrets.env
      - shop__nightly-report__config.env=store-files/shop/nightly-report/config.env
      - shop__nightly-report__secrets.env=store-files/shop/nightly-report/secrets.env
      - shop__checkout__config.env=store-files/shop/checkout/config.env
      - shop__checkout__secrets.env=store-files/shop/checkout/secrets.env
```

- [ ] **Step 7: Write `dev/aws-config`**

```ini
[default]
region = us-east-1
endpoint_url = http://localhost:9000
s3 =
    addressing_style = path
```

- [ ] **Step 8: Add the cluster tasks to `mise.toml`**

Append:

```toml
[tasks."cluster:up"]
description = "Create the local k3d cluster and its image registry"
run = ["mkdir -p .kube", "k3d cluster create --config dev/k3d.yaml --wait"]

[tasks."cluster:down"]
description = "Delete the local k3d cluster and its image registry"
run = "k3d cluster delete --config dev/k3d.yaml"

[tasks.deploy]
description = "Install the local environment into the cluster"
run = [
  "kubectl delete job store-seed -n kmo-dev --ignore-not-found",
  "kubectl apply -k dev",
  "kubectl rollout status deployment/rustfs -n kmo-dev --timeout=180s",
  "kubectl wait --for=condition=Complete job/store-seed -n kmo-dev --timeout=180s",
]

[tasks.store]
description = "Run an AWS CLI command against the local object store, e.g. mise run store -- s3 ls"
run = "aws"

[tasks.store.env]
AWS_CONFIG_FILE = "{{config_root}}/dev/aws-config"
AWS_PROFILE = "default"
AWS_ACCESS_KEY_ID = "kmoadmin"
AWS_SECRET_ACCESS_KEY = "kmo-local-secret"
```

A finished Job cannot be changed, so `deploy` deletes the old one before applying.

- [ ] **Step 9: Create the cluster**

Run: `mise run cluster:up && kubectl get nodes && curl -s http://localhost:5111/v2/_catalog` Expected: two nodes,
`k3d-kmo-server-0` and `k3d-kmo-agent-0`, both `Ready`; then `{"repositories":[]}`.

If port 9000 or 5111 is already taken on the host, k3d says so. Change the host side of the port in `dev/k3d.yaml` (and
`endpoint_url` in `dev/aws-config` for 9000) and tell the user.

- [ ] **Step 10: Deploy and verify**

Run: `mise run deploy && mise run store -- s3 ls s3://kmo-config --recursive` Expected:
`job.batch/store-seed condition met`, then twelve keys, among them `_common/config.env` and
`shop/orders-api/config.env`.

Run: `mise run store -- s3api get-bucket-versioning --bucket kmo-config` Expected: `"Status": "Enabled"`.

If `put-bucket-versioning` fails inside the Job (`kubectl logs job/store-seed -n kmo-dev`), that is an early answer to
the first spike check. Stop and tell the user; the spec's fallback is another store.

- [ ] **Step 11: Commit**

```bash
npm run format
git add -A
git commit -m "Add local cluster with RustFS and seeded sample files"
```

- [ ] **After (show, then pause):** Show `kubectl get all -n kmo-dev`, the Job's log, and
  `mise run store -- s3 cp s3://kmo-config/shop/orders-api/config.env -`. Ask for questions before Task 3.



### Task 3: Sample workloads with hand-written config

**Before (explain to the user):** The five workload kinds KMO will serve: a Deployment (interchangeable pods), a
StatefulSet (pods with stable identity), a DaemonSet (one pod per node), a CronJob (pods on a timer) and an Argo Rollout
(a Deployment with staged rollouts, added by a custom resource definition). Each reads a ConfigMap and a Secret through
`envFrom`. For now those two objects are generated by hand from the workload's own sample file, without the common
values. This task ends by showing the problem KMO exists to solve.

**Files:**

- Create: `dev/argo-rollouts/kustomization.yaml`, `dev/argo-rollouts/namespace.yaml`, `dev/workloads/namespace.yaml`,
  `dev/workloads/orders-api.yaml`, `dev/workloads/inventory.yaml`, `dev/workloads/node-agent.yaml`,
  `dev/workloads/nightly-report.yaml`, `dev/workloads/checkout.yaml`, `docs/index.md`, `docs/getting-started.md`
- Modify: `dev/kustomization.yaml`, `mise.toml`, `CLAUDE.md`

**Interfaces:**

- Consumes: `dev/store-files/shop/<name>/{config,secrets}.env` from Task 2.
- Produces: namespace `shop` with Deployment `orders-api`, StatefulSet `inventory`, DaemonSet `node-agent`, CronJob
  `nightly-report` and Rollout `checkout`. Each references ConfigMap and Secret `<name>-kmo`, the names KMO will later
  write by default. Every pod has the label `app: <name>`.

- [ ] **Step 1: Write the Argo Rollouts install**

`dev/argo-rollouts/namespace.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: argo-rollouts
```

`dev/argo-rollouts/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: argo-rollouts
resources:
  - namespace.yaml
  - https://github.com/argoproj/argo-rollouts/releases/download/v1.10.0/install.yaml
```

- [ ] **Step 2: Write `dev/workloads/namespace.yaml`**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: shop
```

- [ ] **Step 3: Write `dev/workloads/orders-api.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: shop
spec:
  replicas: 2
  selector:
    matchLabels:
      app: orders-api
  template:
    metadata:
      labels:
        app: orders-api
    spec:
      terminationGracePeriodSeconds: 2
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c"]
          args:
            - |
              env | grep -E '^(GREETING|LOG_LEVEL|REGION|DB_PASSWORD|SHARED_API_TOKEN)=' | sort
              while true; do sleep 3600; done
          envFrom:
            - configMapRef:
                name: orders-api-kmo
            - secretRef:
                name: orders-api-kmo
```

The container prints the values it received and then idles. Printing a secret is acceptable only because these are
sample values.

- [ ] **Step 4: Write `dev/workloads/inventory.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: inventory
  namespace: shop
spec:
  clusterIP: None
  selector:
    app: inventory
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: inventory
  namespace: shop
spec:
  serviceName: inventory
  replicas: 2
  selector:
    matchLabels:
      app: inventory
  template:
    metadata:
      labels:
        app: inventory
    spec:
      terminationGracePeriodSeconds: 2
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c"]
          args:
            - |
              env | grep -E '^(GREETING|LOG_LEVEL|REGION|DB_PASSWORD|SHARED_API_TOKEN)=' | sort
              while true; do sleep 3600; done
          envFrom:
            - configMapRef:
                name: inventory-kmo
            - secretRef:
                name: inventory-kmo
```

- [ ] **Step 5: Write `dev/workloads/node-agent.yaml`**

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-agent
  namespace: shop
spec:
  selector:
    matchLabels:
      app: node-agent
  template:
    metadata:
      labels:
        app: node-agent
    spec:
      terminationGracePeriodSeconds: 2
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c"]
          args:
            - |
              env | grep -E '^(GREETING|LOG_LEVEL|REGION|DB_PASSWORD|SHARED_API_TOKEN)=' | sort
              while true; do sleep 3600; done
          envFrom:
            - configMapRef:
                name: node-agent-kmo
            - secretRef:
                name: node-agent-kmo
```

- [ ] **Step 6: Write `dev/workloads/nightly-report.yaml`**

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-report
  namespace: shop
spec:
  schedule: "*/2 * * * *"
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        metadata:
          labels:
            app: nightly-report
        spec:
          restartPolicy: Never
          containers:
            - name: app
              image: busybox:1.37.0
              command: ["sh", "-c"]
              args:
                - env | grep -E '^(GREETING|LOG_LEVEL|REGION|DB_PASSWORD|SHARED_API_TOKEN)=' | sort
              envFrom:
                - configMapRef:
                    name: nightly-report-kmo
                - secretRef:
                    name: nightly-report-kmo
```

It runs every two minutes, despite the name, so there is something to watch.

- [ ] **Step 7: Write `dev/workloads/checkout.yaml`**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: checkout
  namespace: shop
spec:
  replicas: 2
  strategy:
    canary: {}
  selector:
    matchLabels:
      app: checkout
  template:
    metadata:
      labels:
        app: checkout
    spec:
      terminationGracePeriodSeconds: 2
      containers:
        - name: app
          image: busybox:1.37.0
          command: ["sh", "-c"]
          args:
            - |
              env | grep -E '^(GREETING|LOG_LEVEL|REGION|DB_PASSWORD|SHARED_API_TOKEN)=' | sort
              while true; do sleep 3600; done
          envFrom:
            - configMapRef:
                name: checkout-kmo
            - secretRef:
                name: checkout-kmo
```

- [ ] **Step 8: Add the workloads and their hand-written config to `dev/kustomization.yaml`**

Replace the `resources` list and add the generators, keeping `generatorOptions` and the existing `store-seed-files`
generator:

```yaml
resources:
  - store/namespace.yaml
  - store/rustfs.yaml
  - store/seed-job.yaml
  - workloads/namespace.yaml
  - workloads/orders-api.yaml
  - workloads/inventory.yaml
  - workloads/node-agent.yaml
  - workloads/nightly-report.yaml
  - workloads/checkout.yaml
```

Append these entries to `configMapGenerator`:

```yaml
  - name: orders-api-kmo
    namespace: shop
    envs: [store-files/shop/orders-api/config.env]
  - name: inventory-kmo
    namespace: shop
    envs: [store-files/shop/inventory/config.env]
  - name: node-agent-kmo
    namespace: shop
    envs: [store-files/shop/node-agent/config.env]
  - name: nightly-report-kmo
    namespace: shop
    envs: [store-files/shop/nightly-report/config.env]
  - name: checkout-kmo
    namespace: shop
    envs: [store-files/shop/checkout/config.env]
```

Add a new top-level `secretGenerator`:

```yaml
secretGenerator:
  - name: orders-api-kmo
    namespace: shop
    envs: [store-files/shop/orders-api/secrets.env]
  - name: inventory-kmo
    namespace: shop
    envs: [store-files/shop/inventory/secrets.env]
  - name: node-agent-kmo
    namespace: shop
    envs: [store-files/shop/node-agent/secrets.env]
  - name: nightly-report-kmo
    namespace: shop
    envs: [store-files/shop/nightly-report/secrets.env]
  - name: checkout-kmo
    namespace: shop
    envs: [store-files/shop/checkout/secrets.env]
```

These ten generated objects are the hand-written stand-ins. The operator plan removes them when KMO takes over.

- [ ] **Step 9: Put Argo Rollouts in front of the `deploy` task**

In `mise.toml`, make the `deploy` task's `run` list start with:

```toml
  "kubectl apply -k dev/argo-rollouts",
  "kubectl wait --for=condition=Established crd/rollouts.argoproj.io --timeout=60s",
```

and end with:

```toml
  "kubectl rollout status deployment/orders-api -n shop --timeout=120s",
```

The Rollout kind must exist before a Rollout can be created, which is why the install is applied and waited for first.

- [ ] **Step 10: Deploy and verify**

Run: `mise run deploy && kubectl get deploy,statefulset,daemonset,cronjob,rollout,pods -n shop` Expected: `orders-api`
2/2, `inventory` 2/2, `node-agent` 2 desired and 2 ready, `checkout` with 2 desired and 2 available, and the CronJob
listed.

Run: `kubectl logs -n shop deploy/orders-api` Expected:

```text
DB_PASSWORD=orders-api-password
GREETING=hello from orders-api
LOG_LEVEL=debug
```

`REGION` and `SHARED_API_TOKEN` are absent because nothing merges the common files yet.

- [ ] **Step 11: Write `docs/index.md`**

````markdown
# KMO documentation

KMO keeps the configuration of Kubernetes workloads in step with env files held in an object store. A change to a file
updates the matching ConfigMap or Secret and rolls the workloads that use it.

The project is being built in steps. Today it has a local environment and the shared logic; the operator and the
receiver are still to come.

## Pages

- [Getting started](getting-started.md) walks through the local environment.
- The [design](superpowers/specs/2026-10-10-kmo-operator-core-design.md) describes what is being built and why.
````

- [ ] **Step 12: Write `docs/getting-started.md`**

````markdown
# Getting started

This page takes a fresh clone to a running local environment. You need Docker and [Mise](https://mise.jdx.dev); Mise
installs everything else.

## Start the environment

Run these three tasks in order:

```bash
mise run setup
mise run cluster:up
mise run deploy
```

The first installs the tools and dependencies. The second creates a small Kubernetes cluster inside Docker. The third
installs an object store, fills it with sample files and starts five sample workloads.

## What you get

- A cluster named `kmo` with two nodes and an image registry.
- RustFS, an S3-compatible object store, in the `kmo-dev` namespace. It holds the bucket `kmo-config`, where each
  workload has a folder named after its namespace and name, next to a `_common` folder shared by all.
- Five workloads in the `shop` namespace, one of each kind KMO supports. Each prints the values it received when it
  starts, so its log shows its configuration.

The `store` task runs the AWS command line against the local store. For example, `mise run store -- s3 ls
s3://kmo-config --recursive` lists every file.

## What does not work yet

The workloads' ConfigMaps and Secrets are written by hand from the sample files. Changing a file in the store changes
nothing in the cluster, and changing a ConfigMap does not restart the pods that use it. Closing that gap is what KMO is
for.

## Clean up

`mise run cluster:down` deletes the cluster and everything in it.
````

- [ ] **Step 13: Extend the Commands section of `CLAUDE.md`**

Add to the list under `## Commands`:

```markdown
- `mise run cluster:up` and `mise run cluster:down` create and delete the local k3d cluster. Its kubeconfig is
  `.kube/config` inside the repository.
- `mise run deploy` installs Argo Rollouts, RustFS, the seed Job and the sample workloads from `dev/`.
- `mise run store -- <aws args>` runs the AWS CLI against the local RustFS, for example `mise run store -- s3 ls`.
```

- [ ] **Step 14: Commit**

```bash
npm run format && mise run lint
git add -A
git commit -m "Add sample workloads of each supported kind with hand-written config"
```

- [ ] **After (show, then pause):** Demonstrate the two problems from the spec's Purpose section.

  1. Staleness: `printf 'GREETING=changed in the store\n' > /tmp/config.env && mise run store -- s3 cp /tmp/config.env
     s3://kmo-config/shop/orders-api/config.env`, then show `kubectl get configmap orders-api-kmo -n shop -o yaml` is
     unchanged.
  2. No restarts: `kubectl patch configmap orders-api-kmo -n shop --type merge -p '{"data":{"GREETING":"edited by
     hand"}}'`, then show `kubectl get pods -n shop -l app=orders-api` has the same pods and
     `kubectl logs -n shop deploy/orders-api` still prints the old greeting.

  Restore with `mise run deploy`. Ask for questions before Task 4.



### Task 4: Spike, part one: RustFS notifications and versioning

**Before (explain to the user):** A spike is throwaway work that answers a question before the design depends on the
answer. This one checks that RustFS announces changes over a webhook in the S3 notification format and keeps file
versions. A tiny echo server stands in for the receiver and logs whatever RustFS sends.

**Files:**

- Create: `docs/superpowers/spikes/2026-10-10-kmo-operator-core-spike.md`,
  `packages/core/test/fixtures/rustfs-put.json`, `packages/core/test/fixtures/rustfs-delete.json`
- Modify: `dev/store/rustfs.yaml`, `dev/store/seed-job.yaml`
- Temporary, not committed: `/tmp/kmo-spike/echo.yaml`

**Interfaces:**

- Consumes: the cluster, the `store` task and bucket `kmo-config` from Task 2.
- Produces: two captured payloads for Task 10. Each is the body RustFS sent for one event on the key
  `shop/orders-api/config.env` in bucket `kmo-config`: `rustfs-put.json` for an upload, `rustfs-delete.json` for a
  delete. Also the findings document.

- [ ] **Step 1: Deploy the echo server**

Write `/tmp/kmo-spike/echo.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: echo
  namespace: kmo-dev
data:
  server.js: |
    require("http")
      .createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const { method, url } = req;
          console.log(JSON.stringify({ method, url, authorization: req.headers.authorization, body }));
          res.end("ok");
        });
      })
      .listen(8080);
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: echo
  namespace: kmo-dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: echo
  template:
    metadata:
      labels:
        app: echo
    spec:
      terminationGracePeriodSeconds: 1
      containers:
        - name: echo
          image: node:24-alpine
          command: ["node", "/app/server.js"]
          ports:
            - containerPort: 8080
          volumeMounts:
            - name: app
              mountPath: /app
      volumes:
        - name: app
          configMap:
            name: echo
---
apiVersion: v1
kind: Service
metadata:
  name: echo
  namespace: kmo-dev
spec:
  selector:
    app: echo
  ports:
    - port: 8080
```

Run: `kubectl apply -f /tmp/kmo-spike/echo.yaml && kubectl rollout status deploy/echo -n kmo-dev`

- [ ] **Step 2: Turn on notifications in `dev/store/rustfs.yaml`**

Add to the RustFS container's `env` list:

```yaml
            - name: RUSTFS_NOTIFY_ENABLE
              value: "true"
            - name: RUSTFS_NOTIFY_WEBHOOK_ENABLE_PRIMARY
              value: "on"
            - name: RUSTFS_NOTIFY_WEBHOOK_ENDPOINT_PRIMARY
              value: http://echo.kmo-dev.svc:8080/events/rustfs
            - name: RUSTFS_NOTIFY_WEBHOOK_AUTH_TOKEN_PRIMARY
              value: spike-token
            - name: RUSTFS_NOTIFY_WEBHOOK_QUEUE_DIR_PRIMARY
              value: /tmp/notify-primary
            - name: RUSTFS_OUTBOUND_ALLOW_ORIGINS
              value: http://echo.kmo-dev.svc:8080
```

The suffix `_PRIMARY` names the target `primary`, which gives it the address `arn:rustfs:sqs:us-east-1:primary:webhook`.

- [ ] **Step 3: Subscribe both buckets in `dev/store/seed-job.yaml`**

Inside the `for bucket` loop, after the `put-bucket-versioning` line, add:

```sh
                aws s3api put-bucket-notification-configuration --bucket "$bucket" --notification-configuration \
                  '{"QueueConfigurations":[{"Id":"kmo","QueueArn":"arn:rustfs:sqs:us-east-1:primary:webhook","Events":["s3:ObjectCreated:*","s3:ObjectRemoved:*"]}]}'
```

- [ ] **Step 4: Redeploy and watch the seed arrive as events**

Run: `mise run deploy && kubectl logs deploy/echo -n kmo-dev | head -20` Expected: one JSON line per request. Record in
the findings: whether `HEAD` health checks appear, the `POST` path, and the exact `authorization` value (the docs say
`Bearer spike-token`).

- [ ] **Step 5: Capture one upload and one delete**

Run:

```bash
kubectl rollout restart deploy/echo -n kmo-dev && kubectl rollout status deploy/echo -n kmo-dev
printf 'GREETING=hello from the spike\n' > /tmp/kmo-spike/config.env
mise run store -- s3 cp /tmp/kmo-spike/config.env s3://kmo-config/shop/orders-api/config.env
mise run store -- s3 rm s3://kmo-config/shop/orders-api/config.env
sleep 5
mkdir -p packages/core/test/fixtures
kubectl logs deploy/echo -n kmo-dev | jq -r 'select(.method == "POST") | .body' > /tmp/kmo-spike/bodies.jsonl
sed -n 1p /tmp/kmo-spike/bodies.jsonl | jq . > packages/core/test/fixtures/rustfs-put.json
sed -n 2p /tmp/kmo-spike/bodies.jsonl | jq . > packages/core/test/fixtures/rustfs-delete.json
```

Expected: both files are JSON objects with a `Records` list whose first entry has `s3.bucket.name` equal to `kmo-config`
and `s3.object.key` equal to `shop%2Forders-api%2Fconfig.env` (or the same key unencoded; record which). The first
file's `eventName` starts with `s3:ObjectCreated`, the second with `s3:ObjectRemoved`. If the events arrived in the
other order, swap the files.

- [ ] **Step 6: Check how awkward keys are encoded**

Run:

```bash
mise run store -- s3 cp /tmp/kmo-spike/config.env "s3://kmo-config/shop/orders-api/with space+plus.env"
sleep 3 && kubectl logs deploy/echo -n kmo-dev --tail=1 | jq -r .body | jq -r '.Records[0].s3.object.key'
mise run store -- s3 rm "s3://kmo-config/shop/orders-api/with space+plus.env"
```

Record the exact encoded key. Task 10 decodes `+` as a space and `%XX` as a byte; if RustFS encodes a space as `%20` and
leaves `+` literal, note it in the findings so Task 10's decoder can be adjusted.

- [ ] **Step 7: Check versioning**

Run:

```bash
mise run store -- s3 cp /tmp/kmo-spike/config.env s3://kmo-config/shop/orders-api/config.env
printf 'GREETING=second version\n' > /tmp/kmo-spike/config2.env
mise run store -- s3 cp /tmp/kmo-spike/config2.env s3://kmo-config/shop/orders-api/config.env
mise run store -- s3api list-object-versions --bucket kmo-config --prefix shop/orders-api/config.env
```

Expected: several entries under `Versions` with distinct `VersionId` values, the newest marked `IsLatest`, and a
`DeleteMarkers` entry from Step 5. Then fetch the older version by its ID and confirm it prints the first greeting:

```bash
mise run store -- s3api get-object --bucket kmo-config --key shop/orders-api/config.env \
  --version-id <older VersionId> /dev/stdout
```

Record whether `get-object` without a version ID returns a `VersionId` field; the operator reports that in status.

- [ ] **Step 8: Check what happens while the target is down**

The receiver will not exist until the last plan, so RustFS must cope with an absent target.

Run:

```bash
kubectl scale deploy/echo -n kmo-dev --replicas=0
kubectl rollout restart deploy/rustfs -n kmo-dev && kubectl rollout status deploy/rustfs -n kmo-dev --timeout=120s
kubectl delete job store-seed -n kmo-dev && kubectl apply -k dev
kubectl wait --for=condition=Complete job/store-seed -n kmo-dev --timeout=180s
kubectl scale deploy/echo -n kmo-dev --replicas=1 && kubectl rollout status deploy/echo -n kmo-dev
sleep 60 && kubectl logs deploy/echo -n kmo-dev | jq -r 'select(.method == "POST") | .url' | wc -l
```

Record three answers: does RustFS become ready with the target down, does the seed Job succeed, and are the queued
events delivered once the target is back (a count above zero).

- [ ] **Step 9: Write the findings so far**

Create `docs/superpowers/spikes/2026-10-10-kmo-operator-core-spike.md`:

````markdown
# KMO operator core: spike findings

Date: 2026-10-10. Spec: [KMO operator core design](../specs/2026-10-10-kmo-operator-core-design.md).

## Check 1: RustFS notifications and versioning on k3d

Verdict: PASS or FAIL.

| Question                                             | Answer |
|------------------------------------------------------|--------|
| Webhook delivers on upload and on delete             |        |
| Request method, path and `Authorization` value       |        |
| Health-check requests seen                           |        |
| Body shape (`Records`, bucket name, object key)      |        |
| How a key with a slash, a space and a plus is encoded |        |
| Versioning: distinct version IDs, old version readable |      |
| `get-object` returns a version ID                    |        |
| RustFS starts with the target down                   |        |
| Events queued while the target was down are delivered |       |

Notes:
````

Fill in every answer and the verdict from what was observed, quoting the relevant log line where it helps.

- [ ] **Step 10: Decide, restore and commit**

If the verdict is FAIL (no webhook delivery in the S3 format, or no usable versioning), stop and bring the findings to
the user. The spec's fallback is another store with a third normalizer.

Otherwise leave the manifests ready for the real receiver:

- In `dev/store/rustfs.yaml` set `RUSTFS_NOTIFY_WEBHOOK_ENDPOINT_PRIMARY` to
  `http://kmo-receiver.kmo-system.svc:8080/events/rustfs`, `RUSTFS_OUTBOUND_ALLOW_ORIGINS` to
  `http://kmo-receiver.kmo-system.svc:8080` and the token to `kmo-local-token`.
- If Step 8 showed that RustFS does not start, or the seed Job fails, with the target down: instead remove the six
  notification variables and the `put-bucket-notification-configuration` line again, and say so in the findings. The
  receiver plan will put them back.

Run:

```bash
kubectl delete -f /tmp/kmo-spike/echo.yaml
mise run deploy
npm run format && mise run lint
git add -A
git commit -m "Spike: confirm RustFS notifications and versioning, capture event payloads"
```

- [ ] **After (show, then pause):** Walk the user through the findings table and one captured payload. Ask for questions
  before Task 5.



### Task 5: Spike, part two: Pepr

**Before (explain to the user):** Pepr is the framework the operator will be written in. An operator is a program that
watches resources and acts until the cluster matches what they ask for; "reconcile" is one such pass. Admission is the
moment the API server asks a webhook whether to accept a change. This spike builds a toy module to confirm Pepr can do
each thing the design needs, and that it works inside the npm workspace. None of this code is kept.

**Files:**

- Temporary, not committed: `packages/kmo-spike/**`, `packages/spike-lib/**`
- Modify: `docs/superpowers/spikes/2026-10-10-kmo-operator-core-spike.md`

**Interfaces:**

- Consumes: the cluster with Argo Rollouts and the `shop` workloads from Task 3.
- Produces: the completed findings document, which the operator plan is written from.

- [ ] **Step 1: Create a workspace library for the module to import**

`packages/spike-lib/package.json`:

```json
{
  "name": "@kmo/spike-lib",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts"
}
```

`packages/spike-lib/src/index.ts`:

```ts
export function shout(text: string): string {
  return text.toUpperCase();
}
```

This is source-only TypeScript, exactly how `@kmo/core` will be published to the operator.

- [ ] **Step 2: Scaffold the Pepr module inside the workspace**

Run:

```bash
cd packages
npx --yes pepr@2.0.3 init --name kmo-spike --description "Throwaway checks for the KMO design" \
  --error-behavior reject --uuid kmo-spike --skip-post-init --yes
cd ..
npm pkg set 'dependencies.@kmo/spike-lib=*' --workspace packages/kmo-spike
npm install
```

Expected: `packages/kmo-spike/` with `pepr.ts`, `package.json` and `capabilities/`. `--skip-post-init` matters: without
it Pepr runs `git init` inside the repository. Record in the findings whether `npm install` at the root succeeds and
where `pepr` lands (`node_modules/pepr` at the root or under the package).

- [ ] **Step 3: Write the spike capability**

`packages/kmo-spike/capabilities/spike.ts`:

```ts
import { shout } from "@kmo/spike-lib";
import { GenericKind, RegisterKind } from "kubernetes-fluent-client";
import { Capability, K8s, Log, a } from "pepr";

class Widget extends GenericKind {
  spec?: { message?: string; forbidden?: boolean };
}
RegisterKind(Widget, { group: "spike.kmo.isntall.net", version: "v1alpha1", kind: "Widget", plural: "widgets" });

class Rollout extends GenericKind {}
RegisterKind(Rollout, { group: "argoproj.io", version: "v1alpha1", kind: "Rollout", plural: "rollouts" });

class Missing extends GenericKind {}
RegisterKind(Missing, { group: "spike.kmo.isntall.net", version: "v1alpha1", kind: "Missing", plural: "missings" });

export const Spike = new Capability({
  name: "spike",
  description: "Throwaway checks for the KMO design",
  namespaces: [],
});

const { When, OnSchedule } = Spike;

When(Widget)
  .IsCreatedOrUpdated()
  .InNamespace("spike")
  .Validate(async (request) => {
    if (request.Raw.spec?.forbidden) return request.Deny("forbidden widgets are rejected");
    const others = await K8s(Widget).InNamespace("spike").Get();
    const clash = others.items.find(
      (other) => other.metadata?.name !== request.Raw.metadata?.name && other.spec?.message === request.Raw.spec?.message,
    );
    return clash ? request.Deny(`message already claimed by widget ${clash.metadata?.name}`) : request.Approve();
  })
  .Reconcile(async (widget, phase) => {
    Log.info({ name: widget.metadata?.name, phase, said: shout(widget.spec?.message ?? "") }, "SPIKE reconcile widget");
  });

When(a.ConfigMap)
  .IsCreatedOrUpdated()
  .InNamespace("spike")
  .Watch((configMap) => Log.info({ name: configMap.metadata?.name }, "SPIKE watch configmap"));

When(a.Deployment)
  .IsCreatedOrUpdated()
  .InNamespace("shop")
  .Watch((deployment) => Log.info({ name: deployment.metadata?.name }, "SPIKE watch deployment"));

When(Rollout)
  .IsCreatedOrUpdated()
  .InNamespace("shop")
  .Watch((rollout) => Log.info({ name: rollout.metadata?.name }, "SPIKE watch rollout"));

When(Missing)
  .IsCreatedOrUpdated()
  .Watch((missing) => Log.info({ name: missing.metadata?.name }, "SPIKE watch missing kind"));

OnSchedule({
  name: "spike-tick",
  every: 1,
  unit: "minutes",
  run: async () => {
    Log.info("SPIKE schedule tick");
  },
});
```

Replace the body of `packages/kmo-spike/pepr.ts` so it loads this capability instead of the generated example:

```ts
import { PeprModule } from "pepr";
import cfg from "./package.json";
import { Spike } from "./capabilities/spike";

new PeprModule(cfg, [Spike]);
```

If an import or method name here does not match Pepr 2.0.3, correct it from the generated `capabilities/hello-pepr.ts`
and <https://docs.pepr.dev>, and record the correction in the findings. That is the spike doing its job.

- [ ] **Step 4: Install the Widget definition and a namespace**

Run:

```bash
kubectl create namespace spike
kubectl apply -f - <<'EOF'
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: widgets.spike.kmo.isntall.net
spec:
  group: spike.kmo.isntall.net
  scope: Namespaced
  names:
    kind: Widget
    plural: widgets
    singular: widget
  versions:
    - name: v1alpha1
      served: true
      storage: true
      subresources:
        status: {}
      schema:
        openAPIV3Schema:
          type: object
          x-kubernetes-preserve-unknown-fields: true
EOF
```

The `Missing` kind is deliberately not installed.

- [ ] **Step 5: Build and deploy the module**

Run:

```bash
cd packages/kmo-spike
npx pepr build
npx pepr deploy --yes
cd ../..
kubectl get deploy,pods -n pepr-system
```

Expected: two Deployments, an admission controller and a watcher, both ready. Record their names, the namespace, and
whether the build bundled `@kmo/spike-lib` without complaint (workspace check). Record whether the watcher stays up and
keeps logging even though the `Missing` kind does not exist; if it crash-loops, capture the error.

Set a shell variable for the watcher's log command, using the Deployment name just observed:

```bash
WATCHER="kubectl logs -n pepr-system deploy/pepr-kmo-spike-watcher --since=2m"
```

- [ ] **Step 6: Reconcile and its triggers**

Run each command, then `$WATCHER | grep SPIKE`, and record whether a `SPIKE reconcile widget` line appeared:

```bash
kubectl apply -f - <<'EOF'
apiVersion: spike.kmo.isntall.net/v1alpha1
kind: Widget
metadata: { name: one, namespace: spike }
spec: { message: hello }
EOF
kubectl patch widget one -n spike --type merge -p '{"spec":{"message":"changed"}}'
kubectl annotate widget one -n spike kmo.isntall.net/sync-requested-at="$(date -u +%FT%TZ)" --overwrite
kubectl patch widget one -n spike --subresource status --type merge -p '{"status":{"seen":true}}'
```

The four answers matter to the design:

- Create and spec change must trigger a reconcile. The first line should say `HELLO`, proving the workspace import.
- The annotation must trigger one: that is how the receiver asks for a sync.
- The status patch should ideally not trigger one. If it does, the operator needs a guard against reconciling in
  response to its own status updates. Record which.

- [ ] **Step 7: Admission, including a lookup of other resources**

Run:

```bash
kubectl apply -f - <<'EOF'
apiVersion: spike.kmo.isntall.net/v1alpha1
kind: Widget
metadata: { name: two, namespace: spike }
spec: { message: hi, forbidden: true }
EOF
kubectl apply -f - <<'EOF'
apiVersion: spike.kmo.isntall.net/v1alpha1
kind: Widget
metadata: { name: three, namespace: spike }
spec: { message: changed }
EOF
```

Expected: the first is refused with `forbidden widgets are rejected`. The second is refused with
`message already claimed by widget one`, which proves an admission check can look up other resources, as the
one-resource-per-workload rule requires. Record both messages as kubectl printed them.

- [ ] **Step 8: Watches on other kinds, and a kind that appears later**

Run:

```bash
kubectl create configmap probe -n spike --from-literal=a=1
kubectl annotate deployment orders-api -n shop spike=1 --overwrite
kubectl annotate rollout checkout -n shop spike=1 --overwrite
sleep 5 && $WATCHER | grep SPIKE
```

Expected: `SPIKE watch configmap`, `SPIKE watch deployment` and `SPIKE watch rollout` lines.

Then install the missing kind and create one, without restarting anything:

```bash
kubectl get crd widgets.spike.kmo.isntall.net -o json \
  | jq 'del(.metadata.resourceVersion, .metadata.uid, .metadata.creationTimestamp, .status)
        | .metadata.name = "missings.spike.kmo.isntall.net"
        | .spec.names = {kind: "Missing", plural: "missings", singular: "missing"}' \
  | kubectl apply -f -
kubectl apply -f - <<'EOF'
apiVersion: spike.kmo.isntall.net/v1alpha1
kind: Missing
metadata: { name: late, namespace: spike }
EOF
sleep 30 && $WATCHER | grep "missing kind"
```

Record whether the watch picks the kind up on its own, only after a watcher restart
(`kubectl rollout restart -n pepr-system deploy/pepr-kmo-spike-watcher`), or not at all. This decides how the operator
treats Rollout targets on clusters without Argo Rollouts.

- [ ] **Step 9: The schedule**

Run: `sleep 130 && kubectl logs -n pepr-system deploy/pepr-kmo-spike-watcher --since=3m | grep "schedule tick"`
Expected: at least two lines about a minute apart. Record the observed interval.

- [ ] **Step 10: Two things to record without depending on the answer**

- Namespace: look in `packages/kmo-spike/dist/` for the generated manifest and Helm chart, and at `npx pepr build
  --help`. Record whether the install namespace can be anything other than `pepr-system`.
- Several copies: from <https://docs.pepr.dev/user-guide/pepr-modules> and the resource names seen in Step 5 (they carry
  the module's UUID), record whether two modules, or two copies of one module with different UUIDs, can share a cluster.

- [ ] **Step 11: Complete the findings**

Append to `docs/superpowers/spikes/2026-10-10-kmo-operator-core-spike.md`:

````markdown
## Check 2: Pepr capabilities

Verdict: PASS or FAIL.

| Question                                                   | Answer |
|------------------------------------------------------------|--------|
| Reconcile runs on create and on spec change                |        |
| Reconcile runs on an annotation-only change                |        |
| Reconcile runs on a status-only change                     |        |
| Validate can deny with a message                           |        |
| Validate can look up other resources before deciding       |        |
| Watches fire for ConfigMap, Deployment and Rollout         |        |
| Module runs while a watched kind's definition is missing   |        |
| A kind installed later is picked up                        |        |
| Schedule runs every minute                                 |        |
| Corrections needed to the spike code for Pepr 2.0.3        |        |

## Check 3: Pepr inside the npm workspace

Verdict: PASS or FAIL.

| Question                                             | Answer |
|------------------------------------------------------|--------|
| Root `npm install` succeeds with the module present  |        |
| `pepr build` bundles a source-only workspace package |        |
| Deployed module runs the imported code               |        |

## Recorded for later

- Installing Pepr outside `pepr-system`:
- Several copies of a module in one cluster:

## Consequences for the operator plan
````

Fill in every answer and verdict, then list under "Consequences" anything the operator plan must account for, such as a
guard against status-triggered reconciles or a restart when a kind appears.

- [ ] **Step 12: Clean up**

Run:

```bash
kubectl delete -f packages/kmo-spike/dist/pepr-module-kmo-spike.yaml --ignore-not-found
kubectl delete namespace spike
kubectl delete crd widgets.spike.kmo.isntall.net missings.spike.kmo.isntall.net --ignore-not-found
kubectl annotate deployment orders-api -n shop spike-
kubectl annotate rollout checkout -n shop spike-
rm -rf packages/kmo-spike packages/spike-lib
git checkout package.json package-lock.json
npm install
git status --short
```

Expected: only the findings document is modified. If the manifest in `dist/` has a different file name, use the one that
is there.

- [ ] **Step 13: Decide and commit**

If check 2 or check 3 failed, stop: the spec says the affected part of the design is revisited with the user before the
build continues.

```bash
npm run format && mise run lint
git add -A
git commit -m "Spike: record Pepr findings"
```

- [ ] **After (show, then pause):** Walk the user through the findings and the consequences list. Ask for questions
  before Task 6. The remaining tasks do not depend on Pepr, so they can go ahead even while a Pepr finding is being
  discussed.



### Task 6: Core package and the env file parser

**Before (explain to the user):** No cluster in this task or the next four. `@kmo/core` is plain TypeScript holding
every decision KMO makes that does not need Kubernetes, which is what makes it easy to test. Work is test-first: write a
test that states a behavior, watch it fail, then write the code. The parser is our own because the common `dotenv`
library silently skips lines it cannot read, and the spec requires an unparsable file to stop the sync.

**Files:**

- Create: `vitest.config.ts`, `packages/core/package.json`, `packages/core/src/types.ts`, `packages/core/src/dotenv.ts`,
  `packages/core/src/index.ts`, `packages/core/test/dotenv.test.ts`
- Modify: `package.json`, `mise.toml`, `CLAUDE.md`

**Interfaces:**

- Produces:
  - `type EnvValues = Record<string, string>`
  - `parseDotenv(text: string): EnvValues`, throwing `DotenvParseError`
  - `class DotenvParseError extends Error` with `readonly line: number` and `readonly reason: string`
  - Mise task `test`; npm script `test`.

- [ ] **Step 1: Set up the package and the test runner**

Run: `npm install --save-dev --save-exact vitest@5.0.3`

`packages/core/package.json`:

```json
{
  "name": "@kmo/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts"
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
```

In the root `package.json` add the script `"test": "vitest run"`. In `mise.toml` add `"npm run typecheck"` to the `lint`
task's `run` list and append:

```toml
[tasks.test]
description = "Run the unit tests"
run = "npm test"
```

Run: `npm install`

- [ ] **Step 2: Write `packages/core/src/types.ts`**

```ts
/** Values read from one env file, or merged from several. */
export type EnvValues = Record<string, string>;

/** Workload kinds a ConfigSync can target. */
export type TargetKind = "Deployment" | "StatefulSet" | "DaemonSet" | "CronJob" | "Rollout";

/** The two kinds of store. */
export type StoreKind = "ConfigStore" | "ClusterConfigStore";

/** The four files a ConfigSync reads. */
export type SourceName = "config" | "secrets" | "commonConfig" | "commonSecrets";

/** The spec of a ConfigSync as written by a user; every field is optional. */
export interface ConfigSyncSpec {
  suspend?: boolean;
  targets?: { kind?: TargetKind; name: string }[];
  storeRef?: { kind?: StoreKind; name: string };
  source?: Partial<Record<SourceName, string>>;
  output?: { configMapName?: string; secretName?: string };
  refreshInterval?: string;
}

/** A ConfigSync resource, reduced to what the core logic reads. */
export interface ConfigSync {
  metadata: { name: string; namespace: string };
  spec?: ConfigSyncSpec;
}

/** The spec shared by ConfigStore and ClusterConfigStore. */
export interface StoreSpec {
  bucket: string;
  keyPrefix?: string;
  region: string;
  endpoint?: string;
  addressingStyle?: "VirtualHosted" | "Path";
  credentialsSecretRef: { name: string; namespace?: string };
  allowedNamespaces?: string[];
}

/** A ConfigStore or ClusterConfigStore; only a ConfigStore has a namespace. */
export interface Store {
  kind: StoreKind;
  metadata: { name: string; namespace?: string };
  spec: StoreSpec;
}
```

- [ ] **Step 3: Write the failing tests**

`packages/core/test/dotenv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DotenvParseError, parseDotenv } from "../src/dotenv";

/** Parses text that must be rejected and returns the error. */
function rejection(text: string): DotenvParseError {
  try {
    parseDotenv(text);
  } catch (error) {
    if (error instanceof DotenvParseError) return error;
    throw error;
  }
  throw new Error("expected the file to be rejected");
}

describe("an env file", () => {
  it("gives one value per KEY=value line", () => {
    expect(parseDotenv("GREETING=hello\nLOG_LEVEL=debug\n")).toEqual({ GREETING: "hello", LOG_LEVEL: "debug" });
  });

  it("may be empty", () => {
    expect(parseDotenv("")).toEqual({});
  });

  it("skips blank lines and comment lines", () => {
    expect(parseDotenv("# settings\n\nGREETING=hello\n   # indented comment\n")).toEqual({ GREETING: "hello" });
  });

  it("ignores spaces around the key and the value", () => {
    expect(parseDotenv("  NAME = orders  ")).toEqual({ NAME: "orders" });
  });

  it("allows an empty value", () => {
    expect(parseDotenv("EMPTY=\nALSO_EMPTY= # nothing here")).toEqual({ EMPTY: "", ALSO_EMPTY: "" });
  });

  it("keeps everything after the first equals sign", () => {
    expect(parseDotenv("DATABASE_URL=postgres://u:p@db/shop?sslmode=require\nTOKEN=YWJj==")).toEqual({
      DATABASE_URL: "postgres://u:p@db/shop?sslmode=require",
      TOKEN: "YWJj==",
    });
  });

  it("treats # as a comment only after whitespace", () => {
    expect(parseDotenv("PORT=8080 # http\nCOLOR=#ff0000\nPASSWORD=p#ss")).toEqual({
      PORT: "8080",
      COLOR: "#ff0000",
      PASSWORD: "p#ss",
    });
  });

  it("keeps spaces and # inside double quotes, and expands \\n and \\\"", () => {
    expect(parseDotenv('MOTTO=" keep # calm "\nLINES="one\\ntwo"\nQUOTE="she said \\"hi\\"" # note')).toEqual({
      MOTTO: " keep # calm ",
      LINES: "one\ntwo",
      QUOTE: 'she said "hi"',
    });
  });

  it("takes single-quoted values literally", () => {
    expect(parseDotenv("RAW='one\\ntwo # not a comment'")).toEqual({ RAW: "one\\ntwo # not a comment" });
  });

  it("does not expand variables", () => {
    expect(parseDotenv("URL=http://$HOST/${PATH}")).toEqual({ URL: "http://$HOST/${PATH}" });
  });

  it("lets the last of two identical keys win", () => {
    expect(parseDotenv("LEVEL=info\nLEVEL=debug")).toEqual({ LEVEL: "debug" });
  });

  it("reads a file saved on Windows the same way", () => {
    expect(parseDotenv("﻿GREETING=hello\r\nLOG_LEVEL=debug\r\n")).toEqual({ GREETING: "hello", LOG_LEVEL: "debug" });
  });
});

describe("an env file that cannot be parsed", () => {
  it("is rejected with the number of the offending line", () => {
    expect(rejection("GREETING=hello\nthis is not a setting").line).toBe(2);
  });

  it.each(["1ST=x", "MY-KEY=x", "=x", "export NAME=x"])("is rejected when a key is not a variable name: %s", (text) => {
    expect(rejection(text).reason).toBe("key is not a valid environment variable name");
  });

  it("is rejected when a quote is never closed", () => {
    expect(rejection('GREETING="hello').reason).toBe("quoted value is not closed");
  });

  it("is rejected when text follows a closing quote", () => {
    expect(rejection('GREETING="hello" there').reason).toBe("unexpected text after closing quote");
  });

  it("never repeats a value in its message, since values may be secrets", () => {
    expect(rejection('USER=admin\nPASSWORD="hunter2').message).toBe("line 2: quoted value is not closed");
  });
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `npm test` Expected: FAIL, because `../src/dotenv` does not exist.

- [ ] **Step 5: Write `packages/core/src/dotenv.ts`**

```ts
import type { EnvValues } from "./types";

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t" };

/** Raised when an env file cannot be parsed. Carries the line number and a reason, never a value. */
export class DotenvParseError extends Error {
  /**
   * @param line One-based number of the offending line.
   * @param reason What is wrong with it.
   */
  constructor(
    readonly line: number,
    readonly reason: string,
  ) {
    super(`line ${line}: ${reason}`);
    this.name = "DotenvParseError";
  }
}

/**
 * Parses the text of an env file.
 * @param text File contents.
 * @returns The key-value pairs, the last occurrence of a key winning.
 * @throws DotenvParseError on the first line that is not blank, a comment or a valid assignment.
 */
export function parseDotenv(text: string): EnvValues {
  const values: EnvValues = {};
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const equals = line.indexOf("=");
    if (equals === -1) throw new DotenvParseError(index + 1, "expected KEY=value");
    const key = line.slice(0, equals).trimEnd();
    if (!KEY.test(key)) throw new DotenvParseError(index + 1, "key is not a valid environment variable name");
    values[key] = parseValue(line.slice(equals + 1), index + 1);
  });
  return values;
}

function parseValue(afterEquals: string, line: number): string {
  const rest = afterEquals.trimStart();
  const quote = rest[0];
  if (quote !== '"' && quote !== "'") return afterEquals.replace(/\s#.*$/, "").trim();

  const close = closingQuote(rest, quote);
  if (close === -1) throw new DotenvParseError(line, "quoted value is not closed");
  const trailing = rest.slice(close + 1).trim();
  if (trailing !== "" && !trailing.startsWith("#")) {
    throw new DotenvParseError(line, "unexpected text after closing quote");
  }
  const body = rest.slice(1, close);
  return quote === "'" ? body : body.replace(/\\(.)/g, (_, char: string) => ESCAPES[char] ?? char);
}

function closingQuote(text: string, quote: string): number {
  for (let i = 1; i < text.length; i++) {
    if (quote === '"' && text[i] === "\\") i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}
```

`packages/core/src/index.ts`:

```ts
export * from "./types";
export * from "./dotenv";
```

- [ ] **Step 6: Run the tests and the checks**

Run: `npm test && mise run lint` Expected: all tests pass; lint, format and type check are clean. Run `npm run format`
first if Prettier complains.

- [ ] **Step 7: Update `CLAUDE.md` and commit**

Add to the list under `## Commands`:

```markdown
- `mise run test` runs the unit tests with Vitest. One file: `npx vitest run packages/core/test/dotenv.test.ts`. One
  test: add `-t "part of its name"`.
- `mise run lint` also runs the TypeScript type check (`npm run typecheck`).
```

```bash
git add -A
git commit -m "Add core package with the env file parser"
```

- [ ] **After (show, then pause):** Show the test output as a readable list with `npx vitest run --reporter=verbose`.
  Invite the user to add a line to a test and see it fail. Ask for questions before Task 7.



### Task 7: Merging, hashing and building the outputs

**Before (explain to the user):** This is the heart of the "no needless restarts" promise. Common values and workload
values are merged, the workload winning. A hash of the result is stamped on the pod template later; Kubernetes rolls a
workload only when its pod template changes, so an unchanged hash means no restart. A hash is used instead of a
timestamp so that running the sync twice changes nothing.

**Files:**

- Create: `packages/core/src/merge.ts`, `packages/core/src/hash.ts`, `packages/core/src/render.ts`,
  `packages/core/test/render.test.ts`, `packages/core/test/hash.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `EnvValues`, `SourceName` from `types.ts`; `parseDotenv`, `DotenvParseError` from `dotenv.ts`.
- Produces:
  - `mergeValues(common: EnvValues, workload: EnvValues): EnvValues`
  - `configHash(configMapData: EnvValues, secretData: EnvValues): string` (64 lowercase hex characters)
  - `type SourceTexts = Partial<Record<SourceName, string>>`
  - `interface Outputs { configMapData: EnvValues; secretData: EnvValues; configHash: string }`
  - `buildOutputs(texts: SourceTexts): Outputs`, throwing `SourceParseError`
  - `class SourceParseError extends Error` with `readonly source: SourceName`, `readonly line: number`,
    `readonly reason: string`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { configHash } from "../src/hash";

describe("the config hash", () => {
  it("is the same whatever order the keys are in", () => {
    expect(configHash({ A: "1", B: "2" }, { X: "9" })).toBe(configHash({ B: "2", A: "1" }, { X: "9" }));
  });

  it("changes when a value changes", () => {
    expect(configHash({ A: "1" }, {})).not.toBe(configHash({ A: "2" }, {}));
  });

  it("changes when a key moves between the ConfigMap and the Secret", () => {
    expect(configHash({ A: "1" }, {})).not.toBe(configHash({}, { A: "1" }));
  });

  it("tells one value containing a line break from two separate keys", () => {
    expect(configHash({ A: "1\nB=2" }, {})).not.toBe(configHash({ A: "1", B: "2" }, {}));
  });

  it("is a SHA-256 digest in hex", () => {
    expect(configHash({}, {})).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

`packages/core/test/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SourceParseError, buildOutputs } from "../src/render";

describe("building a workload's ConfigMap and Secret", () => {
  it("puts config files in the ConfigMap and secret files in the Secret", () => {
    const outputs = buildOutputs({ config: "GREETING=hello", secrets: "DB_PASSWORD=s3cret" });
    expect(outputs.configMapData).toEqual({ GREETING: "hello" });
    expect(outputs.secretData).toEqual({ DB_PASSWORD: "s3cret" });
  });

  it("adds the common values, the workload's own value winning", () => {
    const outputs = buildOutputs({
      commonConfig: "LOG_LEVEL=info\nREGION=eu-west-1",
      config: "LOG_LEVEL=debug",
      commonSecrets: "SHARED_API_TOKEN=common",
      secrets: "DB_PASSWORD=s3cret",
    });
    expect(outputs.configMapData).toEqual({ LOG_LEVEL: "debug", REGION: "eu-west-1" });
    expect(outputs.secretData).toEqual({ SHARED_API_TOKEN: "common", DB_PASSWORD: "s3cret" });
  });

  it("treats a missing file as empty", () => {
    expect(buildOutputs({})).toMatchObject({ configMapData: {}, secretData: {} });
  });

  it("keeps the same hash when a common value changes that the workload overrides", () => {
    const before = buildOutputs({ commonConfig: "LOG_LEVEL=info", config: "LOG_LEVEL=debug" });
    const after = buildOutputs({ commonConfig: "LOG_LEVEL=warn", config: "LOG_LEVEL=debug" });
    expect(after.configHash).toBe(before.configHash);
  });

  it("changes the hash when a common value changes that the workload does not override", () => {
    const before = buildOutputs({ commonConfig: "REGION=eu-west-1", config: "LOG_LEVEL=debug" });
    const after = buildOutputs({ commonConfig: "REGION=us-east-1", config: "LOG_LEVEL=debug" });
    expect(after.configHash).not.toBe(before.configHash);
  });

  it("produces nothing at all when any one file cannot be parsed, and says which file and line", () => {
    const build = () => buildOutputs({ config: "GREETING=hello", secrets: "DB_PASSWORD=s3cret\nnot a setting" });
    expect(build).toThrow(SourceParseError);
    expect(build).toThrow("secrets, line 2: expected KEY=value");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test` Expected: FAIL, because `../src/hash` and `../src/render` do not exist.

- [ ] **Step 3: Write `packages/core/src/merge.ts`**

```ts
import type { EnvValues } from "./types";

/**
 * Merges common values with a workload's own values.
 * @param common Values shared by every workload of the store.
 * @param workload Values of one workload; these win.
 * @returns The effective values.
 */
export function mergeValues(common: EnvValues, workload: EnvValues): EnvValues {
  return { ...common, ...workload };
}
```

- [ ] **Step 4: Write `packages/core/src/hash.ts`**

```ts
import { createHash } from "node:crypto";
import type { EnvValues } from "./types";

/**
 * Hashes the contents of a workload's two output objects.
 * @param configMapData Data of the ConfigMap.
 * @param secretData Data of the Secret.
 * @returns A SHA-256 digest in lowercase hex, independent of key order.
 */
export function configHash(configMapData: EnvValues, secretData: EnvValues): string {
  const canonical = JSON.stringify([sortedEntries(configMapData), sortedEntries(secretData)]);
  return createHash("sha256").update(canonical).digest("hex");
}

function sortedEntries(values: EnvValues): [string, string][] {
  return Object.entries(values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
```

- [ ] **Step 5: Write `packages/core/src/render.ts`**

```ts
import { DotenvParseError, parseDotenv } from "./dotenv";
import { configHash } from "./hash";
import { mergeValues } from "./merge";
import type { EnvValues, SourceName } from "./types";

/** The text of each source file that was found; a missing file is left out. */
export type SourceTexts = Partial<Record<SourceName, string>>;

/** What a reconcile writes for one workload. */
export interface Outputs {
  configMapData: EnvValues;
  secretData: EnvValues;
  configHash: string;
}

/** Raised when one of the source files cannot be parsed. Never carries a value. */
export class SourceParseError extends Error {
  /**
   * @param source Which of the four files failed.
   * @param line One-based number of the offending line.
   * @param reason What is wrong with it.
   */
  constructor(
    readonly source: SourceName,
    readonly line: number,
    readonly reason: string,
  ) {
    super(`${source}, line ${line}: ${reason}`);
    this.name = "SourceParseError";
  }
}

/**
 * Builds a workload's ConfigMap data, Secret data and hash from its source files.
 * @param texts Contents of the files that exist.
 * @returns The merged outputs.
 * @throws SourceParseError if any file cannot be parsed; nothing is returned in that case.
 */
export function buildOutputs(texts: SourceTexts): Outputs {
  const configMapData = mergeValues(parse(texts, "commonConfig"), parse(texts, "config"));
  const secretData = mergeValues(parse(texts, "commonSecrets"), parse(texts, "secrets"));
  return { configMapData, secretData, configHash: configHash(configMapData, secretData) };
}

function parse(texts: SourceTexts, source: SourceName): EnvValues {
  try {
    return parseDotenv(texts[source] ?? "");
  } catch (error) {
    if (error instanceof DotenvParseError) throw new SourceParseError(source, error.line, error.reason);
    throw error;
  }
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./merge";
export * from "./hash";
export * from "./render";
```

- [ ] **Step 6: Run the tests and the checks, then commit**

Run: `npm run format && npm test && mise run lint` Expected: all pass.

```bash
git add -A
git commit -m "Add merging, hashing and output building to core"
```

- [ ] **After (show, then pause):** Run `npx vitest run --reporter=verbose packages/core/test/render.test.ts` and point
  at the two hash tests: they are the spec's "a change that leaves a workload's effective values unchanged causes no
  restart", stated as code. Ask for questions before Task 8.



### Task 8: ConfigSync defaults

**Before (explain to the user):** A ConfigSync with an empty spec must still mean something, so every omitted field is
derived from the resource's own name and namespace. Doing this in one function means the operator, the receiver and
later the admission check all read a resource the same way.

**Files:**

- Create: `packages/core/src/duration.ts`, `packages/core/src/defaults.ts`, `packages/core/test/defaults.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `ConfigSync`, `TargetKind`, `StoreKind`, `SourceName` from `types.ts`.
- Produces:
  - `parseDuration(text: string): number` (milliseconds), throwing `ConfigSyncSpecError`
  - `class ConfigSyncSpecError extends Error`
  - `const COMMON_FOLDER = "_common"`
  - `interface ResolvedConfigSync { name: string; namespace: string; suspend: boolean; targets: { kind: TargetKind;
    name: string }[]; storeRef?: { kind: StoreKind; name: string }; source: Record<SourceName, string>; output: {
    configMapName: string; secretName: string }; refreshIntervalMs: number }`. `storeRef` is absent when the spec
    names no store, meaning "use the default lookup".
  - `resolveConfigSync(sync: ConfigSync): ResolvedConfigSync`, throwing `ConfigSyncSpecError`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/defaults.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConfigSyncSpecError, resolveConfigSync } from "../src/defaults";
import type { ConfigSyncSpec } from "../src/types";

/** A ConfigSync named orders-api in namespace shop with the given spec. */
function ordersApi(spec?: ConfigSyncSpec) {
  return { metadata: { name: "orders-api", namespace: "shop" }, spec };
}

describe("a ConfigSync with an empty spec", () => {
  const resolved = resolveConfigSync(ordersApi());

  it("targets the Deployment that shares its name", () => {
    expect(resolved.targets).toEqual([{ kind: "Deployment", name: "orders-api" }]);
  });

  it("reads its namespace and name folder, and the common folder", () => {
    expect(resolved.source).toEqual({
      config: "shop/orders-api/config.env",
      secrets: "shop/orders-api/secrets.env",
      commonConfig: "_common/config.env",
      commonSecrets: "_common/secrets.env",
    });
  });

  it("writes a ConfigMap and a Secret named after itself with a -kmo suffix", () => {
    expect(resolved.output).toEqual({ configMapName: "orders-api-kmo", secretName: "orders-api-kmo" });
  });

  it("refreshes every thirty minutes and is not suspended", () => {
    expect(resolved.refreshIntervalMs).toBe(30 * 60 * 1000);
    expect(resolved.suspend).toBe(false);
  });

  it("names no store, leaving the choice to the default lookup", () => {
    expect(resolved.storeRef).toBeUndefined();
  });
});

describe("a ConfigSync that sets fields", () => {
  it("keeps what it sets and defaults the rest", () => {
    const resolved = resolveConfigSync(
      ordersApi({
        suspend: true,
        source: { config: "shared/app.env" },
        output: { secretName: "orders-secrets" },
        refreshInterval: "1h30m",
      }),
    );
    expect(resolved.suspend).toBe(true);
    expect(resolved.source.config).toBe("shared/app.env");
    expect(resolved.source.secrets).toBe("shop/orders-api/secrets.env");
    expect(resolved.output).toEqual({ configMapName: "orders-api-kmo", secretName: "orders-secrets" });
    expect(resolved.refreshIntervalMs).toBe(90 * 60 * 1000);
  });

  it("can list several targets, each a Deployment unless it says otherwise", () => {
    const resolved = resolveConfigSync(ordersApi({ targets: [{ name: "api" }, { kind: "CronJob", name: "cleanup" }] }));
    expect(resolved.targets).toEqual([
      { kind: "Deployment", name: "api" },
      { kind: "CronJob", name: "cleanup" },
    ]);
  });

  it("falls back to the default target when its target list is empty", () => {
    expect(resolveConfigSync(ordersApi({ targets: [] })).targets).toEqual([{ kind: "Deployment", name: "orders-api" }]);
  });

  it("means a ConfigStore when it names a store without a kind", () => {
    expect(resolveConfigSync(ordersApi({ storeRef: { name: "team" } })).storeRef).toEqual({
      kind: "ConfigStore",
      name: "team",
    });
  });
});

describe("a refresh interval", () => {
  it.each(["30s", "0m", "soon", "", "5 minutes", "1.5h"])("is rejected when shorter than a minute or unreadable: %j", (text) => {
    expect(() => resolveConfigSync(ordersApi({ refreshInterval: text }))).toThrow(ConfigSyncSpecError);
  });

  it("may be exactly one minute", () => {
    expect(resolveConfigSync(ordersApi({ refreshInterval: "60s" })).refreshIntervalMs).toBe(60_000);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test` Expected: FAIL, because `../src/defaults` does not exist.

- [ ] **Step 3: Write `packages/core/src/duration.ts`**

```ts
const DURATION = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

/** Raised when a ConfigSync spec holds a value that cannot be used. */
export class ConfigSyncSpecError extends Error {
  /** @param message What is wrong with the spec. */
  constructor(message: string) {
    super(message);
    this.name = "ConfigSyncSpecError";
  }
}

/**
 * Parses a duration made of hours, minutes and seconds, such as 30m or 1h30m.
 * @param text The duration as written in a spec.
 * @returns The duration in milliseconds.
 * @throws ConfigSyncSpecError if the text is not a duration.
 */
export function parseDuration(text: string): number {
  const match = DURATION.exec(text);
  if (!match || text === "") throw new ConfigSyncSpecError(`"${text}" is not a duration such as 30m or 1h30m`);
  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
}
```

- [ ] **Step 4: Write `packages/core/src/defaults.ts`**

```ts
import { ConfigSyncSpecError, parseDuration } from "./duration";
import type { ConfigSync, SourceName, StoreKind, TargetKind } from "./types";

export { ConfigSyncSpecError } from "./duration";

/** Folder holding the files shared by every workload of a store. */
export const COMMON_FOLDER = "_common";

const DEFAULT_REFRESH_INTERVAL = "30m";
const MINIMUM_REFRESH_INTERVAL_MS = 60_000;

/** A ConfigSync with every default filled in. */
export interface ResolvedConfigSync {
  name: string;
  namespace: string;
  suspend: boolean;
  targets: { kind: TargetKind; name: string }[];
  /** Absent when the spec names no store. */
  storeRef?: { kind: StoreKind; name: string };
  /** Keys relative to the store's key prefix. */
  source: Record<SourceName, string>;
  output: { configMapName: string; secretName: string };
  refreshIntervalMs: number;
}

/**
 * Fills in the defaults of a ConfigSync from its name and namespace.
 * @param sync The resource as stored in the cluster.
 * @returns The resource with no optional field left open, except the store reference.
 * @throws ConfigSyncSpecError if the refresh interval is unreadable or under one minute.
 */
export function resolveConfigSync(sync: ConfigSync): ResolvedConfigSync {
  const { name, namespace } = sync.metadata;
  const spec = sync.spec ?? {};
  const targets = spec.targets?.length ? spec.targets : [{ name }];
  const refreshIntervalMs = parseDuration(spec.refreshInterval ?? DEFAULT_REFRESH_INTERVAL);
  if (refreshIntervalMs < MINIMUM_REFRESH_INTERVAL_MS) {
    throw new ConfigSyncSpecError("the refresh interval must be at least one minute");
  }

  return {
    name,
    namespace,
    suspend: spec.suspend ?? false,
    targets: targets.map((target) => ({ kind: target.kind ?? "Deployment", name: target.name })),
    storeRef: spec.storeRef && { kind: spec.storeRef.kind ?? "ConfigStore", name: spec.storeRef.name },
    source: {
      config: spec.source?.config ?? `${namespace}/${name}/config.env`,
      secrets: spec.source?.secrets ?? `${namespace}/${name}/secrets.env`,
      commonConfig: spec.source?.commonConfig ?? `${COMMON_FOLDER}/config.env`,
      commonSecrets: spec.source?.commonSecrets ?? `${COMMON_FOLDER}/secrets.env`,
    },
    output: {
      configMapName: spec.output?.configMapName ?? `${name}-kmo`,
      secretName: spec.output?.secretName ?? `${name}-kmo`,
    },
    refreshIntervalMs,
  };
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./duration";
export { COMMON_FOLDER, resolveConfigSync, type ResolvedConfigSync } from "./defaults";
```

- [ ] **Step 5: Run the tests and the checks, then commit**

Run: `npm run format && npm test && mise run lint` Expected: all pass.

```bash
git add -A
git commit -m "Add ConfigSync defaulting to core"
```

- [ ] **After (show, then pause):** Put the spec's example ConfigSync next to the first `describe` block and show they
  say the same thing. Ask for questions before Task 9.



### Task 9: Store lookup and tenant rules

**Before (explain to the user):** A store says where files live and who may use them. This task encodes three rules from
the spec as pure functions: which store a ConfigSync ends up with, how a relative key becomes a full key in the bucket,
and what a ConfigSync on a shared, cluster-wide store is allowed to read. The last one is what keeps tenants apart.

**Files:**

- Create: `packages/core/src/store.ts`, `packages/core/test/store.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `Store`, `SourceName` from `types.ts`; `ResolvedConfigSync`, `COMMON_FOLDER`, `resolveConfigSync` from
  `defaults.ts`.
- Produces:
  - `storeLabel(store: Store): string`, for example `ConfigStore/default`; this is the status `store` field
  - `allowsNamespace(store: Store, namespace: string): boolean`
  - `type StoreLookup = { ok: true; store: Store } | { ok: false; reason: string }`
  - `findStore(sync: ResolvedConfigSync, stores: Store[]): StoreLookup`
  - `fullKey(store: Store, key: string): string`
  - `sourceAccessProblem(sync: ResolvedConfigSync, store: Store): string | undefined`, a reason when a source key may
    not be read, otherwise `undefined`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveConfigSync } from "../src/defaults";
import { findStore, fullKey, sourceAccessProblem, storeLabel } from "../src/store";
import type { ConfigSyncSpec, Store } from "../src/types";

const credentials = { name: "store-credentials" };

/** A ConfigStore in a namespace. */
function namespaceStore(name: string, namespace: string, keyPrefix?: string): Store {
  return {
    kind: "ConfigStore",
    metadata: { name, namespace },
    spec: { bucket: `${namespace}-bucket`, region: "eu-west-1", keyPrefix, credentialsSecretRef: credentials },
  };
}

/** A ClusterConfigStore open to the given namespaces. */
function clusterStore(name: string, allowedNamespaces: string[] | undefined, keyPrefix?: string): Store {
  return {
    kind: "ClusterConfigStore",
    metadata: { name },
    spec: { bucket: "company-config", region: "eu-west-1", keyPrefix, allowedNamespaces, credentialsSecretRef: credentials },
  };
}

/** The resolved ConfigSync orders-api in namespace shop. */
function ordersApi(spec?: ConfigSyncSpec) {
  return resolveConfigSync({ metadata: { name: "orders-api", namespace: "shop" }, spec });
}

describe("a ConfigSync that names no store", () => {
  it("uses the ConfigStore called default in its own namespace", () => {
    const own = namespaceStore("default", "shop");
    expect(findStore(ordersApi(), [clusterStore("default", ["*"]), own])).toEqual({ ok: true, store: own });
  });

  it("otherwise uses the ClusterConfigStore called default, if that allows its namespace", () => {
    const shared = clusterStore("default", ["shop"]);
    expect(findStore(ordersApi(), [namespaceStore("default", "billing"), shared])).toEqual({ ok: true, store: shared });
  });

  it("finds no store when the cluster-wide default does not allow its namespace", () => {
    expect(findStore(ordersApi(), [clusterStore("default", ["billing"])])).toEqual({
      ok: false,
      reason: 'no store is named and no default store is available to namespace "shop"',
    });
  });

  it("finds no store when there are no default stores at all", () => {
    expect(findStore(ordersApi(), [namespaceStore("team", "shop")]).ok).toBe(false);
  });
});

describe("a ConfigSync that names a store", () => {
  it("uses the ConfigStore of that name in its own namespace", () => {
    const team = namespaceStore("team", "shop");
    expect(findStore(ordersApi({ storeRef: { name: "team" } }), [namespaceStore("team", "billing"), team])).toEqual({
      ok: true,
      store: team,
    });
  });

  it("cannot use a ConfigStore from another namespace", () => {
    expect(findStore(ordersApi({ storeRef: { name: "team" } }), [namespaceStore("team", "billing")])).toEqual({
      ok: false,
      reason: 'ConfigStore "team" was not found in namespace "shop"',
    });
  });

  it("can use a ClusterConfigStore that lists its namespace or allows all with *", () => {
    const storeRef = { kind: "ClusterConfigStore", name: "shared" } as const;
    expect(findStore(ordersApi({ storeRef }), [clusterStore("shared", ["billing", "shop"])]).ok).toBe(true);
    expect(findStore(ordersApi({ storeRef }), [clusterStore("shared", ["*"])]).ok).toBe(true);
  });

  it("is refused by a ClusterConfigStore that does not list its namespace", () => {
    const storeRef = { kind: "ClusterConfigStore", name: "shared" } as const;
    expect(findStore(ordersApi({ storeRef }), [clusterStore("shared", ["billing"])])).toEqual({
      ok: false,
      reason: 'ClusterConfigStore "shared" does not allow namespace "shop"',
    });
  });

  it("is refused by a ClusterConfigStore that lists no namespaces, since there is no default", () => {
    const storeRef = { kind: "ClusterConfigStore", name: "shared" } as const;
    expect(findStore(ordersApi({ storeRef }), [clusterStore("shared", undefined)]).ok).toBe(false);
  });
});

describe("a store's label", () => {
  it("is its kind and name", () => {
    expect(storeLabel(namespaceStore("default", "shop"))).toBe("ConfigStore/default");
  });
});

describe("the full key of a file", () => {
  it("is the source key itself when the store has no prefix", () => {
    expect(fullKey(clusterStore("shared", ["*"]), "shop/orders-api/config.env")).toBe("shop/orders-api/config.env");
  });

  it("puts the store's prefix in front, with or without a trailing slash on the prefix", () => {
    expect(fullKey(clusterStore("shared", ["*"], "prod"), "_common/config.env")).toBe("prod/_common/config.env");
    expect(fullKey(clusterStore("shared", ["*"], "prod/"), "_common/config.env")).toBe("prod/_common/config.env");
  });
});

describe("what a ConfigSync may read", () => {
  const shared = clusterStore("shared", ["*"]);

  it("is its own namespace folder and the common folder, on a cluster-wide store", () => {
    expect(sourceAccessProblem(ordersApi(), shared)).toBeUndefined();
    expect(sourceAccessProblem(ordersApi({ source: { config: "shop/other-app/config.env" } }), shared)).toBeUndefined();
  });

  it("is never another namespace's folder, on a cluster-wide store", () => {
    expect(sourceAccessProblem(ordersApi({ source: { secrets: "billing/ledger/secrets.env" } }), shared)).toBe(
      'source "secrets" is outside the folders namespace "shop" may read from a cluster-wide store',
    );
  });

  it("is not a folder whose name merely starts with its namespace", () => {
    expect(sourceAccessProblem(ordersApi({ source: { config: "shop-admin/app/config.env" } }), shared)).toBeDefined();
  });

  it("is any key at all in a store of its own namespace", () => {
    const own = namespaceStore("default", "shop");
    expect(sourceAccessProblem(ordersApi({ source: { config: "anything/app.env" } }), own)).toBeUndefined();
  });

  it.each(["/shop/orders-api/config.env", "shop/../billing/config.env", ""])("never includes the key %j", (key) => {
    expect(sourceAccessProblem(ordersApi({ source: { config: key } }), namespaceStore("default", "shop"))).toBe(
      'source "config" is not a usable key',
    );
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test` Expected: FAIL, because `../src/store` does not exist.

- [ ] **Step 3: Write `packages/core/src/store.ts`**

```ts
import { COMMON_FOLDER, type ResolvedConfigSync } from "./defaults";
import type { SourceName, Store } from "./types";

const DEFAULT_STORE = "default";

/** The outcome of looking for a ConfigSync's store. */
export type StoreLookup = { ok: true; store: Store } | { ok: false; reason: string };

/**
 * Names a store the way it is shown in a ConfigSync's status.
 * @param store The store.
 * @returns Its kind and name, such as ConfigStore/default.
 */
export function storeLabel(store: Store): string {
  return `${store.kind}/${store.metadata.name}`;
}

/**
 * Tells whether a namespace may use a store.
 * @param store The store.
 * @param namespace The namespace asking.
 * @returns True for a ConfigStore in that namespace, or a ClusterConfigStore that lists it or lists `*`.
 */
export function allowsNamespace(store: Store, namespace: string): boolean {
  if (store.kind === "ConfigStore") return store.metadata.namespace === namespace;
  const allowed = store.spec.allowedNamespaces ?? [];
  return allowed.includes("*") || allowed.includes(namespace);
}

/**
 * Finds the store a ConfigSync reads from.
 * @param sync The resolved ConfigSync.
 * @param stores Every ConfigStore and ClusterConfigStore in the cluster.
 * @returns The store, or the reason none can be used.
 */
export function findStore(sync: ResolvedConfigSync, stores: Store[]): StoreLookup {
  const { namespace, storeRef } = sync;
  const own = (name: string) =>
    stores.find((s) => s.kind === "ConfigStore" && s.metadata.name === name && s.metadata.namespace === namespace);
  const clusterWide = (name: string) => stores.find((s) => s.kind === "ClusterConfigStore" && s.metadata.name === name);

  if (!storeRef) {
    const store = own(DEFAULT_STORE) ?? clusterWide(DEFAULT_STORE);
    if (store && allowsNamespace(store, namespace)) return { ok: true, store };
    return { ok: false, reason: `no store is named and no default store is available to namespace "${namespace}"` };
  }

  if (storeRef.kind === "ConfigStore") {
    const store = own(storeRef.name);
    if (store) return { ok: true, store };
    return { ok: false, reason: `ConfigStore "${storeRef.name}" was not found in namespace "${namespace}"` };
  }

  const store = clusterWide(storeRef.name);
  if (!store) return { ok: false, reason: `ClusterConfigStore "${storeRef.name}" was not found` };
  if (!allowsNamespace(store, namespace)) {
    return { ok: false, reason: `ClusterConfigStore "${storeRef.name}" does not allow namespace "${namespace}"` };
  }
  return { ok: true, store };
}

/**
 * Builds the key of a file in the store's bucket.
 * @param store The store, whose key prefix goes in front.
 * @param key A source key relative to that prefix.
 * @returns The full key in the bucket.
 */
export function fullKey(store: Store, key: string): string {
  const prefix = (store.spec.keyPrefix ?? "").replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${key}` : key;
}

/**
 * Checks that a ConfigSync may read each of its source keys from a store.
 * @param sync The resolved ConfigSync.
 * @param store The store it reads from.
 * @returns A reason naming the first source that may not be read, or undefined when all may.
 */
export function sourceAccessProblem(sync: ResolvedConfigSync, store: Store): string | undefined {
  const allowedFolders = [`${sync.namespace}/`, `${COMMON_FOLDER}/`];
  for (const [source, key] of Object.entries(sync.source) as [SourceName, string][]) {
    if (key === "" || key.startsWith("/") || key.split("/").includes("..")) {
      return `source "${source}" is not a usable key`;
    }
    if (store.kind === "ClusterConfigStore" && !allowedFolders.some((folder) => key.startsWith(folder))) {
      return `source "${source}" is outside the folders namespace "${sync.namespace}" may read from a cluster-wide store`;
    }
  }
  return undefined;
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./store";
```

- [ ] **Step 4: Run the tests and the checks, then commit**

Run: `npm run format && npm test && mise run lint` Expected: all pass.

```bash
git add -A
git commit -m "Add store lookup, key building and tenant access rules to core"
```

- [ ] **After (show, then pause):** Read the "what a ConfigSync may read" tests aloud against the spec's "Keeping
  tenants apart" section. Ask for questions before Task 10.



### Task 10: Event normalizers and matching

**Before (explain to the user):** The receiver will hear about changes from two sources that describe the same thing in
different shapes: RustFS locally and EventBridge on AWS. A normalizer turns each into one plain shape, a bucket and a
key. Matching then answers "which ConfigSyncs read this file?" using the same defaulting and store lookup as the
operator, so the two can never disagree. The RustFS tests use the payloads captured in Task 4.

**Files:**

- Create: `packages/core/src/events.ts`, `packages/core/src/matching.ts`, `packages/core/test/events.test.ts`,
  `packages/core/test/matching.test.ts`, `packages/core/test/fixtures/eventbridge-object-created.json`
- Modify: `packages/core/src/index.ts`, `CLAUDE.md`

**Interfaces:**

- Consumes: `rustfs-put.json` and `rustfs-delete.json` from Task 4; `resolveConfigSync`, `ConfigSyncSpecError`;
  `findStore`, `fullKey`; `ConfigSync`, `Store`.
- Produces:
  - `interface StoreEvent { bucket: string; key: string }`
  - `class MalformedEventError extends Error`
  - `normalizeRustfsEvent(body: unknown): StoreEvent[]`, throwing `MalformedEventError`
  - `normalizeEventBridgeEvent(body: unknown): StoreEvent[]`, throwing `MalformedEventError`
  - `findAffectedSyncs(event: StoreEvent, syncs: ConfigSync[], stores: Store[]): ConfigSync[]`

- [ ] **Step 1: Save the EventBridge sample**

`packages/core/test/fixtures/eventbridge-object-created.json` is the "Object Created" example from the Amazon S3 user
guide:

```json
{
  "version": "0",
  "id": "17793124-05d4-b198-2fde-7ededc63b103",
  "detail-type": "Object Created",
  "source": "aws.s3",
  "account": "111122223333",
  "time": "2021-11-12T00:00:00Z",
  "region": "ca-central-1",
  "resources": ["arn:aws:s3:::amzn-s3-demo-bucket1"],
  "detail": {
    "version": "0",
    "bucket": {
      "name": "amzn-s3-demo-bucket1"
    },
    "object": {
      "key": "example-key",
      "size": 5,
      "etag": "b1946ac92492d2347c6235b4d2611184",
      "version-id": "IYV3p45BT0ac8hjHg1houSdS1a.Mro8e",
      "sequencer": "617f08299329d189"
    },
    "request-id": "N4N7GDK58NMKJ12R",
    "requester": "123456789012",
    "source-ip-address": "1.2.3.4",
    "reason": "PutObject"
  }
}
```

EventBridge keys are taken as they are, without URL decoding, unlike S3 notifications. That is an assumption from the
AWS documentation; the AWS integration spec should confirm it against a live event.

- [ ] **Step 2: Write the failing tests**

`packages/core/test/events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MalformedEventError, normalizeEventBridgeEvent, normalizeRustfsEvent } from "../src/events";
import eventBridgeCreated from "./fixtures/eventbridge-object-created.json";
import rustfsDelete from "./fixtures/rustfs-delete.json";
import rustfsPut from "./fixtures/rustfs-put.json";

/** An S3 notification body with one record. */
function notification(bucket: unknown, key: unknown) {
  return { Records: [{ s3: { bucket: { name: bucket }, object: { key } } }] };
}

describe("a RustFS notification", () => {
  it("names the bucket and the decoded key of an uploaded file", () => {
    expect(normalizeRustfsEvent(rustfsPut)).toEqual([{ bucket: "kmo-config", key: "shop/orders-api/config.env" }]);
  });

  it("reads a deletion the same way as an upload", () => {
    expect(normalizeRustfsEvent(rustfsDelete)).toEqual([{ bucket: "kmo-config", key: "shop/orders-api/config.env" }]);
  });

  it("decodes encoded slashes, spaces written as + and other escapes in a key", () => {
    expect(normalizeRustfsEvent(notification("b", "shop%2Fmy+app%2Fconfig%20v2.env"))).toEqual([
      { bucket: "b", key: "shop/my app/config v2.env" },
    ]);
  });

  it("gives one event per record", () => {
    const body = { Records: [...notification("b", "one").Records, ...notification("b", "two").Records] };
    expect(normalizeRustfsEvent(body).map((event) => event.key)).toEqual(["one", "two"]);
  });

  it("may carry no records", () => {
    expect(normalizeRustfsEvent({ Records: [] })).toEqual([]);
  });

  it.each([
    ["has no Records list", { EventName: "s3:ObjectCreated:Put" }],
    ["is not an object", "hello"],
    ["is empty", null],
    ["has a record without a key", notification("b", undefined)],
    ["has a record without a bucket", notification(undefined, "k")],
    ["has a key with a broken escape", notification("b", "shop%2")],
  ])("is malformed when it %s", (_, body) => {
    expect(() => normalizeRustfsEvent(body)).toThrow(MalformedEventError);
  });
});

describe("an EventBridge event", () => {
  it("names the bucket and key found under detail", () => {
    expect(normalizeEventBridgeEvent(eventBridgeCreated)).toEqual([{ bucket: "amzn-s3-demo-bucket1", key: "example-key" }]);
  });

  it("takes the key as it is, without decoding", () => {
    const body = { detail: { bucket: { name: "b" }, object: { key: "shop/my+app/100%.env" } } };
    expect(normalizeEventBridgeEvent(body)).toEqual([{ bucket: "b", key: "shop/my+app/100%.env" }]);
  });

  it.each([
    ["has no detail", { source: "aws.s3" }],
    ["has no object key", { detail: { bucket: { name: "b" }, object: {} } }],
    ["is not an object", 42],
  ])("is malformed when it %s", (_, body) => {
    expect(() => normalizeEventBridgeEvent(body)).toThrow(MalformedEventError);
  });
});
```

`packages/core/test/matching.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findAffectedSyncs } from "../src/matching";
import type { ConfigSync, ConfigSyncSpec, Store } from "../src/types";

const credentials = { name: "store-credentials" };

/** A cluster-wide default store open to every namespace. */
function defaultStore(bucket: string, keyPrefix?: string): Store {
  return {
    kind: "ClusterConfigStore",
    metadata: { name: "default" },
    spec: { bucket, region: "eu-west-1", keyPrefix, allowedNamespaces: ["*"], credentialsSecretRef: credentials },
  };
}

/** A ConfigSync in namespace shop. */
function sync(name: string, spec?: ConfigSyncSpec): ConfigSync {
  return { metadata: { name, namespace: "shop" }, spec };
}

/** The names of the ConfigSyncs affected by a change to a key. */
function affected(key: string, syncs: ConfigSync[], stores: Store[], bucket = "company-config"): string[] {
  return findAffectedSyncs({ bucket, key }, syncs, stores).map((s) => s.metadata.name);
}

describe("a changed file", () => {
  const syncs = [sync("orders-api"), sync("checkout")];
  const stores = [defaultStore("company-config")];

  it("affects the one ConfigSync whose folder it is in", () => {
    expect(affected("shop/orders-api/secrets.env", syncs, stores)).toEqual(["orders-api"]);
  });

  it("affects every ConfigSync of the store when it is a common file", () => {
    expect(affected("_common/config.env", syncs, stores)).toEqual(["orders-api", "checkout"]);
  });

  it("affects nothing when no ConfigSync reads it", () => {
    expect(affected("shop/orders-api/notes.txt", syncs, stores)).toEqual([]);
  });

  it("affects nothing when it is in a different bucket", () => {
    expect(affected("shop/orders-api/config.env", syncs, stores, "another-bucket")).toEqual([]);
  });

  it("is matched under the store's key prefix", () => {
    const prefixed = [defaultStore("company-config", "prod")];
    expect(affected("prod/shop/orders-api/config.env", syncs, prefixed)).toEqual(["orders-api"]);
    expect(affected("shop/orders-api/config.env", syncs, prefixed)).toEqual([]);
  });

  it("is matched against a source key written out in the spec", () => {
    const custom = [sync("orders-api", { source: { config: "shop/shared/app.env" } })];
    expect(affected("shop/shared/app.env", custom, stores)).toEqual(["orders-api"]);
  });

  it("still affects a suspended ConfigSync; the operator decides to ignore the request", () => {
    expect(affected("shop/orders-api/config.env", [sync("orders-api", { suspend: true })], stores)).toEqual(["orders-api"]);
  });

  it("passes over a ConfigSync that has no usable store or an unusable spec", () => {
    const broken = [sync("orders-api", { storeRef: { name: "gone" } }), sync("checkout", { refreshInterval: "soon" })];
    expect(affected("_common/config.env", broken, stores)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm test` Expected: FAIL, because `../src/events` and `../src/matching` do not exist.

- [ ] **Step 4: Write `packages/core/src/events.ts`**

```ts
/** A change to one file in a bucket, whatever announced it. */
export interface StoreEvent {
  bucket: string;
  key: string;
}

/** Raised when an event body does not have the expected shape. */
export class MalformedEventError extends Error {
  /** @param message What is wrong with the body. */
  constructor(message: string) {
    super(message);
    this.name = "MalformedEventError";
  }
}

/**
 * Reads an S3 notification as sent by RustFS.
 * @param body The parsed JSON body.
 * @returns One event per record, with URL-decoded keys.
 * @throws MalformedEventError if the body is not a notification.
 */
export function normalizeRustfsEvent(body: unknown): StoreEvent[] {
  const records = dig(body, "Records");
  if (!Array.isArray(records)) throw new MalformedEventError("expected a Records list");
  return records.map((record: unknown, index) => {
    const bucket = dig(record, "s3", "bucket", "name");
    const key = dig(record, "s3", "object", "key");
    if (typeof bucket !== "string" || typeof key !== "string") {
      throw new MalformedEventError(`record ${index} has no bucket name or object key`);
    }
    return { bucket, key: decodeKey(key, index) };
  });
}

/**
 * Reads an Amazon S3 event delivered through EventBridge.
 * @param body The parsed JSON body.
 * @returns A single event, with the key exactly as sent.
 * @throws MalformedEventError if the body is not an S3 EventBridge event.
 */
export function normalizeEventBridgeEvent(body: unknown): StoreEvent[] {
  const bucket = dig(body, "detail", "bucket", "name");
  const key = dig(body, "detail", "object", "key");
  if (typeof bucket !== "string" || typeof key !== "string") {
    throw new MalformedEventError("expected detail.bucket.name and detail.object.key");
  }
  return [{ bucket, key }];
}

function dig(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>(
    (current, part) =>
      typeof current === "object" && current !== null ? (current as Record<string, unknown>)[part] : undefined,
    value,
  );
}

function decodeKey(key: string, index: number): string {
  try {
    return decodeURIComponent(key.replace(/\+/g, " "));
  } catch {
    throw new MalformedEventError(`record ${index} has a key that cannot be decoded`);
  }
}
```

If Task 4's findings say RustFS leaves `+` literal and writes a space as `%20`, remove the `.replace(/\+/g, " ")` and
change the decoding test's expected key to match what was recorded.

- [ ] **Step 5: Write `packages/core/src/matching.ts`**

```ts
import { resolveConfigSync } from "./defaults";
import { ConfigSyncSpecError } from "./duration";
import type { StoreEvent } from "./events";
import { findStore, fullKey } from "./store";
import type { ConfigSync, Store } from "./types";

/**
 * Finds the ConfigSyncs that read a changed file.
 * @param event The bucket and key that changed.
 * @param syncs Every ConfigSync in the cluster.
 * @param stores Every ConfigStore and ClusterConfigStore in the cluster.
 * @returns The ConfigSyncs with a source at that key in that bucket, suspended ones included.
 */
export function findAffectedSyncs(event: StoreEvent, syncs: ConfigSync[], stores: Store[]): ConfigSync[] {
  return syncs.filter((sync) => {
    const resolved = resolveOrSkip(sync);
    if (!resolved) return false;
    const lookup = findStore(resolved, stores);
    if (!lookup.ok || lookup.store.spec.bucket !== event.bucket) return false;
    return Object.values(resolved.source).some((key) => fullKey(lookup.store, key) === event.key);
  });
}

function resolveOrSkip(sync: ConfigSync) {
  try {
    return resolveConfigSync(sync);
  } catch (error) {
    if (error instanceof ConfigSyncSpecError) return undefined;
    throw error;
  }
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./events";
export * from "./matching";
```

- [ ] **Step 6: Run the tests and the checks**

Run: `npm run format && npm test && mise run lint` Expected: all pass. If a captured-payload test fails, compare the
fixture with the findings from Task 4 before touching the code; the capture is the truth about what RustFS sends.

- [ ] **Step 7: Bring `CLAUDE.md` up to date and commit**

Replace the `## Planned layout` section of `CLAUDE.md` with:

```markdown
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
```

Update the paragraph under `## State of the repository` to say that the foundations plan is complete and the operator
plan is next.

```bash
npm run format && mise run lint
git add -A
git commit -m "Add event normalizers and event matching to core"
```

- [ ] **After (show, then pause):** Run `npx vitest run --reporter=verbose` and show the whole core package reading as a
  description of KMO's rules. Summarize what exists, and say that the next plan, the operator, is written from the spike
  findings.



## What comes next

When this plan is done, write the operator plan (spec steps 5 to 11) from the spec and the spike findings. Bring to it
any consequence the spike recorded, for example a guard against status-triggered reconciles.
