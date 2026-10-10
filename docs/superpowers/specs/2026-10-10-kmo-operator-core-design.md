# KMO operator core: design

Date: 2026-10-10 Status: awaiting review

## Purpose

KMO keeps the configuration of Kubernetes workloads in step with env files held in an object store. When a file changes,
the matching ConfigMap or Secret is updated within seconds and the workloads that use it pick up the new values through
a rolling update.

It replaces a setup where values live in AWS SSM Parameter Store and are synced on a timer. That setup has two problems
this project fixes:

- **Staleness.** A changed value takes until the next sync to arrive.
- **No automatic restarts.** Pods keep old values until someone redeploys them.

A third problem, awkward editing, is addressed later by a separate UI project that edits the files directly. Versioning
stays enabled on the bucket so that project has a history to work with.

The project is also a way to learn Kubernetes, so the design favours idiomatic patterns and the documentation explains
why each was chosen.

## Scope

This is the first of three specs.

1. **Operator core (this spec).** Tooling, the local environment, the custom resources, the receiver and the operator,
   running end to end on a local cluster.
2. **Packaging.** A Helm chart and ArgoCD application for installing into a real EKS cluster.
3. **AWS integration.** Terraform modules composed with Terragrunt for S3 and EventBridge, plus proper authentication of
   the receiver.

Out of scope for this spec:

- Helm, ArgoCD, Terraform and Terragrunt.
- TLS, ingress and authentication beyond a shared bearer token.
- Automatic injection of references into workloads.
- Workload kinds other than Deployment, StatefulSet and CronJob.
- Staggering restarts after a common-file change.
- The config-editing UI.
- The tool for synchronizing local developer dotenv environments with the S3 values.
- Running several copies of the operator in one cluster. Tenants are separated by stores instead, as described below.
- Stores whose credentials are an IAM role to assume instead of stored keys. This belongs to the AWS integration spec.

## Success criteria

- Editing a file in the local object store updates the matching object and rolls the affected workloads, with no manual
  step.
- A change that leaves a workload's effective values unchanged causes no restart.
- An unreachable store or an unparsable file never empties or alters existing objects.
- A single field on a ConfigSync pauses all syncing and restarts for its workloads, and clearing it resumes them.
- Each warning described below is visible on the resource and as an Event.
- Workloads in different namespaces can be served from different buckets with different credentials, and a namespace
  cannot read another namespace's files.
- A newcomer can go from a fresh clone to a working demo using only Mise tasks and the docs.

## Decisions and their reasons

| Decision                                                | Reason                                                                                                                                                                                                                           |
|---------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| TypeScript with Pepr                                    | Matches the developer's preferences; Pepr was the recommended framework.                                                                                                                                                         |
| A separate receiver that annotates resources            | Pepr has no supported way to host a custom HTTP endpoint. The split also keeps the exposed component free of store credentials, and gives webhooks, timers and manual triggers one shared code path. Flux uses the same pattern. |
| The operator merges common and workload files           | Each workload depends on exactly two objects, which is clear to a human and simple to track. Workloads whose effective values did not change are not restarted.                                                                  |
| Content hash on the pod template                        | Makes reconciling safe to repeat. A timestamp would restart pods on every run.                                                                                                                                                   |
| The store is the source of truth                        | Hand edits to managed objects are overwritten, so the cluster and the files never silently disagree.                                                                                                                             |
| Defaults derived from the resource's name and namespace | Something must exist in the cluster to opt a workload in, and that object already carries both values.                                                                                                                           |
| Workloads reference the objects explicitly              | Keeps manifests honest about what a pod receives and avoids confusing ArgoCD's diffing.                                                                                                                                          |
| A suspend switch on each resource                       | One field covers both reasons to pause: protecting a workload from restarts during sensitive work, and preserving a hand-edited object. CronJobs and Flux use the same field name.                                               |
| Conflicting resources rejected at admission             | The mistake is reported to the person making it, at the moment they make it, instead of surfacing later as unexplained restarts.                                                                                                 |
| Stores as custom resources, one operator for all        | Each tenant namespace gets its own bucket and credentials without running a second operator, which Pepr does not readily support. External Secrets Operator and cert-manager separate tenants the same way.                      |
| RustFS as the local store                               | RustFS is Apache-2.0, needs no registration and uses the standard S3 notification API.                                                                                                                                           |
| k3d for the local cluster                               | It is k3s in Docker: disposable, rootless, version-pinned by Mise and equipped with an image registry.                                                                                                                           |

## Architecture

```text
  edit file
      │
      ▼
┌───────────┐  webhook   ┌───────────┐  annotate   ┌──────────────────┐
│  RustFS   │──────────► │ Receiver  │───────────► │   ConfigSync     │
│ (or S3 +  │            │ (HTTP)    │             │  (per workload)  │
│ EventBr.) │            └───────────┘             └────────┬─────────┘
└─────▲─────┘                                               │ change wakes
      │ read files                                          ▼
      │                                            ┌──────────────────┐
      └────────────────────────────────────────────│ Operator (Pepr)  │
                                                   └───┬──────────┬───┘
                                          write merged │          │ stamp config hash
                                                       ▼          ▼
                                             ConfigMap + Secret   workload ──► rolling update
```

- **Object store.** Holds the env files and announces changes.
- **Receiver.** Turns a change event into an annotation on each affected resource. It never reads the store and never
  touches Secrets.
- **ConfigStore.** A custom resource describing one location in a bucket and how to reach it. A namespace can have its
  own, and administrators can offer cluster-wide ones to chosen namespaces.
- **ConfigSync.** A namespaced custom resource, at most one per workload. It reads from a store.
- **Operator.** A Pepr module that reconciles each ConfigSync. It is the only component with store credentials and the
  only writer of managed objects.

## File layout in the store

- Workload files live at `<namespace>/<name>/config.env` and `<namespace>/<name>/secrets.env`.
- Common files live at `_common/config.env` and `_common/secrets.env`. Namespace names cannot contain an underscore, so
  this folder can never collide with one.
- Any of the four files may be absent.
- An optional key prefix, set on the store, goes in front of both locations. It defaults to nothing. With a prefix of
  `prod`, the files above live under `prod/<namespace>/<name>/` and `prod/_common/`. A trailing slash on the prefix is
  optional.
- The common folder belongs to the store. Two stores that share a bucket under different prefixes each have their own
  common files.

Files use the dotenv format: one `KEY=value` per line, `#` comments, blank lines and optional quotes. Variable expansion
is not supported. Keys must be valid environment variable names.

## The store resources

A store describes one location, a bucket and an optional key prefix, and how to reach it. Nothing outside that location
can be read through the store. There are two kinds, both in API group `kmo.isntall.net`, version `v1alpha1`:

- **ConfigStore** is namespaced and can only be used by ConfigSync resources in its own namespace. It suits a trusted
  team that brings its own bucket and credentials.
- **ClusterConfigStore** is cluster-wide and is created by administrators. It lists the namespaces allowed to use it,
  and its credentials are kept where those namespaces cannot reach them.

```yaml
apiVersion: kmo.isntall.net/v1alpha1
kind: ClusterConfigStore
metadata:
  name: shop
spec:
  bucket: company-config
  keyPrefix: shop                 # optional
  region: eu-west-1
  endpoint: ""                    # optional; empty for real S3
  addressingStyle: VirtualHosted  # optional; VirtualHosted | Path
  credentialsSecretRef:
    name: shop-store-credentials
    namespace: kmo-system         # ClusterConfigStore only
  allowedNamespaces:              # ClusterConfigStore only
    - shop
status:
  conditions:
    - type: Ready
```

Rules:

- The bucket, region and credentials are required on every store.
- The credentials Secret holds an access key ID and a secret access key. For a ConfigStore it lives in the store's own
  namespace. For a ClusterConfigStore the reference names the Secret's namespace.
- The operator never uses its own identity to read a store. A store without usable credentials is not ready.
- A ClusterConfigStore must list its allowed namespaces. The single entry `*` allows all of them. There is no default.
- Several stores may share a bucket, each with its own key prefix and its own credentials.
- The operator checks that it can reach the bucket and reports the result in the store's `Ready` condition.

**Addressing style.** S3 has two ways to put the bucket name in a request's address. `VirtualHosted`, the default, puts
it in the hostname, which is what AWS expects and requires DNS to resolve a separate name for every bucket. `Path` puts
it in the path after a single hostname. A self-hosted store such as RustFS has one hostname and no per-bucket DNS
records, so it needs `Path`.

**Which store a ConfigSync uses.** A ConfigSync may name a store. When it names none, it uses the ConfigStore called
`default` in its own namespace, and failing that the ClusterConfigStore called `default` if that store allows its
namespace. Default stores are a convenience and need not exist: without one, every ConfigSync must name its store.

**Keeping tenants apart.**

- Every source key is relative to the store's key prefix, so a ConfigSync can never read outside its store's location.
- A cluster-wide store may be shared, so a ConfigSync using one may only read its own namespace's folder and the common
  folder, whatever keys its spec names. A ConfigSync using a store in its own namespace may read any key in that store's
  location.
- Tenants who should not see store credentials are served by a ClusterConfigStore whose Secret lives in a namespace they
  cannot access, and are given no permission to create stores. Kubernetes cannot hide a Secret from people who can run
  pods in its namespace, so the separation has to be by namespace.
- Tenants can always read the output Secret in their own namespace, since it holds their workload's values. What is
  protected is direct access to the store: other locations, file history and writes.

## The ConfigSync resource

API group `kmo.isntall.net`, version `v1alpha1`, kind `ConfigSync`, namespaced.

Every spec field is optional. The example shows the defaults for a resource named `orders-api` in namespace `shop`,
using a store with no key prefix.

```yaml
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata:
  name: orders-api
  namespace: shop
spec:
  suspend: false
  targets:
    - kind: Deployment            # Deployment | StatefulSet | CronJob
      name: orders-api
  storeRef:
    kind: ConfigStore             # ConfigStore | ClusterConfigStore
    name: default
  source:                         # keys are relative to the store's key prefix
    config: shop/orders-api/config.env
    secrets: shop/orders-api/secrets.env
    commonConfig: _common/config.env
    commonSecrets: _common/secrets.env
  output:
    configMapName: orders-api-kmo
    secretName: orders-api-kmo
  refreshInterval: 30m
status:
  observedGeneration: 3
  lastSyncTime: "2026-10-10T09:41:00Z"
  configHash: 9f2c…
  store: ConfigStore/default
  sources:
    - key: shop/orders-api/config.env
      found: true
      versionId: 3HL4kqtJlcpXroDTDmJ
  conditions:
    - type: Ready
    - type: SourcesFound
    - type: TargetsWired
    - type: Suspended
```

Rules:

- Targets and outputs are always in the resource's own namespace. Cross-namespace references are not possible.
- A target's kind defaults to Deployment. The targets list defaults to a single Deployment named after the resource.
- The refresh interval is a duration with a minimum of one minute.
- The bucket always comes from the store. A ConfigSync cannot name one.
- The status records which store was used and, for each source file, its full key in the bucket, whether it was found
  and which version was used.
- Source keys, whether defaulted or written explicitly, are relative to the store's key prefix.

### Suspending

Setting `suspend` to true pauses everything KMO does for that resource:

- No files are fetched, the two output objects are not written, and no workload is stamped or restarted.
- Store events and the refresh timer are ignored, including changes to common files.
- Hand edits to the output objects are left in place. KMO does not restart workloads for them, so a hand edit reaches
  the pods only when they are next restarted by other means.
- The status keeps its last values, the `Suspended` condition becomes true, and an Event records the change.

Setting it back to false reconciles immediately. The objects are rebuilt from the store, which discards any hand edits,
and the workloads roll if their effective values differ from what they last received.

### One resource per workload

A workload may be targeted by at most one ConfigSync, and an output object may belong to at most one. Two resources
sharing either would overwrite each other's work and restart the workload repeatedly.

The operator enforces this with an admission check. When a ConfigSync is created or changed, the request is rejected,
with a message naming the conflicting resource, if any of its resolved targets or output names is already claimed by
another ConfigSync in the same namespace.

- Suspended resources still hold their claims.
- A ConfigSync may list several targets, so one resource can still serve several workloads.
- Two conflicting resources created at the same instant can both pass the check. This is rare and is not guarded
  against.

## Reconciling

A reconcile is triggered when:

- the ConfigSync is created or its spec changes;
- the receiver sets the `kmo.isntall.net/sync-requested-at` annotation;
- one of its output objects changes;
- one of its target workloads changes;
- its refresh interval has elapsed, checked by a once-a-minute schedule;
- a store is created, changed or deleted, which reconciles every ConfigSync that uses it or would now resolve to it.

A suspended resource stops after recording that it is suspended. Otherwise each reconcile performs these steps:

1. Find the store, then resolve defaults for omitted fields.
2. Fetch the four files. A missing file is treated as empty.
3. Parse each file.
4. Merge common values with workload values, the workload winning. Config files produce the ConfigMap data and secret
   files the Secret data.
5. Write both objects, always, even when empty. They carry the label `app.kubernetes.io/managed-by: kmo` and an owner
   reference to the ConfigSync.
6. Compute a SHA-256 hash over the sorted contents of both objects and set it as the `kmo.isntall.net/config-hash`
   annotation on each target's pod template.
7. Check each target's wiring, then update status, conditions and Events.

Consequences of this design:

- Deployments and StatefulSets roll when the hash changes. A StatefulSet using the `OnDelete` strategy is stamped but
  only changes as its pods are deleted.
- CronJobs are stamped so each run records the config it used. Running Jobs are never affected.
- A key present in both the ConfigMap and the Secret is resolved by the order of the workload's own references. KMO does
  not check for this.
- Deleting a ConfigSync deletes its two objects through the owner reference. Running pods are unaffected, but new pods
  fail to start until the references are removed or the resource is recreated.
- A change to a common file reconciles every resource that uses it, so many workloads may roll at once.

## Failures and warnings

**Failures** stop the reconcile, leave existing objects untouched, set `Ready` to false and are retried:

- No store can be found for the resource, or the store does not allow the resource's namespace.
- The store is unreachable, denies access, or its credentials Secret is missing.
- A source key falls outside the folders the resource is allowed to read from a cluster-wide store.
- A file cannot be parsed.
- An object with the output name already exists without KMO's label. KMO never adopts or overwrites it.

A failure on any one file stops the whole reconcile, so a partial merge is never written.

**Warnings** do not stop the reconcile:

| Situation                                                        | Condition               |
|------------------------------------------------------------------|-------------------------|
| All four files are missing or empty                              | `SourcesFound` is false |
| A target workload does not exist                                 | `TargetsWired` is false |
| An output object holds values but a target does not reference it | `TargetsWired` is false |

An empty output object that a target does not reference is not a warning. A target counts as referencing an object if
any of its containers uses it through `envFrom`, an individual `env` entry or a volume.

Every failure and warning is reported in two places: as a condition, which shows the current state and how long it has
held, and as a Warning Event on the ConfigSync.

## The receiver

A small stateless HTTP service.

- `POST /events/rustfs` accepts the S3 notification format, a `Records` list with URL-encoded keys.
- `POST /events/eventbridge` accepts the EventBridge format, with the bucket and key under `detail`.
- `GET /healthz` reports liveness.

For each event the receiver extracts the bucket and key, finds every ConfigSync whose resolved sources include that
file, and sets the sync-requested annotation on each. Creations and deletions are handled identically.

- It keeps a watched, in-memory list of ConfigSync resources and stores, and uses the same store lookup and defaulting
  code as the operator, so both agree on each resource's bucket and keys.
- It matches on bucket name and key only. Two stores that use the same bucket name at different endpoints may cause an
  unneeded sync, which is harmless.
- It requires a shared bearer token in the `Authorization` header. The token is held in a Secret. One token serves all
  tenants, since the most a caller can do with it is request a sync.
- It answers 200 once all annotations are written, including when nothing matched; 400 for a malformed body; 401 for a
  bad token; and 500 if an annotation could not be written, so the sender retries.
- Its only cluster permissions are to read and patch ConfigSync resources and to read stores. It cannot read Secrets, so
  it never sees store credentials.

## Configuration

All store-related configuration lives in the store resources described above. The operator and receiver watch them, so a
change takes effect without restarting either.

Secrets are kept out of the store resources:

- Store credentials are held in the Secret each store references. Those for cluster-wide stores are kept in `kmo-system`
  by convention.
- The receiver's bearer token is held in a Secret named `kmo-receiver-token` in the receiver's namespace.

The operator runs in the namespace Pepr installs into. The receiver runs in a namespace of its own, `kmo-system`.

## Repository layout

```
zeemo/
├── README.md
├── mise.toml
├── .pre-commit-config.yaml
├── packages/
│   ├── core/         shared logic with no Kubernetes or network calls
│   ├── operator/     the Pepr module
│   └── receiver/     the HTTP service and its Dockerfile
├── crds/             the ConfigSync and store definitions
├── dev/              local-only manifests
├── test/e2e/         end-to-end tests
└── docs/
```

The core package holds store lookup, defaulting, dotenv parsing, merging, hashing and the two event normalizers. The
operator and receiver are thin shells around it.

## Tooling

**Mise** pins the CLI tools and defines the task aliases.

- Tools: pre-commit, Node at the current LTS, kubectl and k3d.
- Tasks: `setup`, `cluster:up`, `cluster:down`, `deploy`, `test`, `test:e2e`, `lint` and `demo`.

**Pre-commit** runs:

- whitespace, end-of-file, YAML and large-file checks;
- ESLint;
- Prettier, enforcing a line length of 120 characters;
- a TypeScript type check;
- markdownlint;
- gitleaks.

## Local environment

- A k3d cluster with a local image registry.
- RustFS with versioning enabled and a webhook target pointing at the receiver.
- A setup Job that creates two buckets, configures notifications and uploads sample files.
- A ClusterConfigStore named `default` for the first bucket, open to all namespaces and using path addressing.
- Three sample workloads, one of each supported kind, that print their environment, with a ConfigSync for each.
- A second namespace acting as a trusted tenant, with its own ConfigStore for the second bucket, one sample workload and
  its ConfigSync.
- A third namespace acting as an untrusted tenant, served by a ClusterConfigStore that allows only that namespace and
  shares the first bucket under its own key prefix and credentials.

The `demo` task changes a file and shows the resulting rollout.

## Testing

- **Unit tests** cover the core package. The event normalizers are tested against real captured payloads.
- **End-to-end tests** run against the local cluster. They cover a workload-file change, a common-file change, an
  overridden common key causing no restart, each warning, each failure, a hand edit being reverted, suspending and
  resuming, a key prefix, two stores sharing a bucket, a namespace store taking precedence over the cluster-wide one, a
  resource being refused another namespace's files, a namespace being refused a store that does not allow it, rejection
  of a conflicting ConfigSync, and deletion of a ConfigSync.
- Implementation is test-first.

Unit tests double as documentation of what the system is expected to do:

- Each test reads as a statement of behavior that a person can follow without studying the implementation.
- Full code coverage is not a goal. Tests that assert nothing a reader would care about are left out as noise.

## Conventions

### Code comments

- Keep comments terse. Do not describe reasons or the history of a change.
- Comment only where something is hard to understand.
- Every exported function has a terse JSDoc block stating what it does, its parameters and its return value.

### Documentation

- The docs are written for people. Keep them high level where possible and use inline code fences sparingly.
- `docs/index.md` is the entry point: it gives the overview and links to the detailed pages.
- The default document in any sub-folder of `docs` is named `index.md`.
- Planned pages: architecture, local getting-started, the ConfigSync and store references, setting up tenants,
  troubleshooting, and a concepts page explaining each Kubernetes idea the project uses.

### Root README

- A short introduction to the repository and its file layout.
- A pointer to `docs/index.md` for details.
- Installation instructions for a Kubernetes cluster, either in full or by linking to the relevant docs page.

## How the build proceeds

Learning is the purpose, so the work is done in steps small enough to follow yet large enough to show something new
working. Each step follows the same rhythm:

- Before: a short explanation of what is about to be built and which Kubernetes idea it introduces.
- After: something observable in the cluster or the test output, and a pause for questions before the next step begins.

The steps, in order:

1. **Tooling.** The Git repository, Mise and the pre-commit hooks.
2. **Local cluster.** k3d, RustFS and the sample workloads, with their config written by hand for now.
3. **Spike.** The three checks described under risks below.
4. **Core logic.** Parsing, merging, hashing and defaulting, with unit tests and no cluster involved.
5. **The custom resources.** The ConfigSync and store definitions are installed and resources can be created, though
   nothing acts on them yet.
6. **Syncing.** The operator finds the store, reads the files, and writes the ConfigMap and Secret.
7. **Rollouts.** The operator stamps the hash and workloads roll when values change.
8. **Reporting.** Status, conditions, Events, and the failure and warning rules.
9. **Staying in step.** The refresh timer, reconciling when outputs, workloads or stores change, and the suspend switch.
10. **Guarding.** The admission check that rejects a conflicting ConfigSync.
11. **Tenants.** Namespace stores, allowed namespaces on cluster-wide stores, shared buckets, and the rules that keep
    tenants apart.
12. **The receiver.** Store events arrive and trigger a sync, completing the loop.
13. **End-to-end tests and documentation.**

## Risks, and the spike that addresses them

The build starts with a short throwaway spike that confirms three assumptions before anything depends on them:

1. RustFS delivers webhook notifications in the documented format and supports versioning, on k3d.
2. Pepr can reconcile a custom resource, validate it at admission, watch several other kinds and run a recurring
   schedule.
3. A Pepr module works inside a multi-package repository.

If the first fails, the fallback is another store with a third normalizer. If the second or third fails, the affected
part of the design is revisited with the user before the build continues.

The spike also records, without depending on the answer, whether Pepr can be installed outside its default namespace and
whether several copies of one module can share a cluster. That tells us how hard it would be to offer separate operator
instances later for tenants who need stronger isolation than stores provide.
