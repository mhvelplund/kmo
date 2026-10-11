# Design

This page says why KMO is built the way it is: what it is for, what it covers, the decisions behind it and the reason
for each. The rules of each resource are in the reference pages, [ConfigSync](configsync.md), [Stores](stores.md) and
[The receiver](receiver.md), and are not repeated here.

## Purpose

KMO keeps the configuration of Kubernetes workloads in step with env files held in an object store. When a file changes,
the matching ConfigMap or Secret is updated within seconds and the workloads that use it pick up the new values through
a rolling update.

It replaces a setup where values live in AWS Systems Manager Parameter Store and are synced on a timer. That setup has
two problems that KMO fixes:

- **Staleness.** A changed value takes until the next sync to arrive.
- **No automatic restarts.** Pods keep old values until someone redeploys them.

A third problem, awkward editing, belongs to a separate project: a UI that edits the files directly. Versioning stays
enabled on the bucket, so that project has a history to work with.

KMO is also a way to learn Kubernetes. The design prefers idiomatic patterns, and the documentation explains why each
was chosen. [Concepts](concepts.md) explains each Kubernetes idea that KMO uses.

## Scope

KMO is the operator, the receiver, the three custom resources, the tooling and a local environment, and it runs end to
end on a local cluster.

It does not have:

- a Helm chart, an ArgoCD application, or Terraform and Terragrunt modules;
- TLS, ingress, or authentication of the receiver beyond a shared bearer token;
- automatic injection of references into workloads;
- workload kinds other than Deployment, StatefulSet, DaemonSet, CronJob and Argo Rollout;
- staggered restarts after a change to a common file;
- the UI that edits the files;
- a tool that brings a developer's local dotenv files in step with the store;
- several copies of the operator in one cluster. Tenants are kept apart by stores;
- the AWS side of a store without stored keys: the registration of a cluster's signing keys, and the IAM roles.

Two pieces of work are planned to close most of these: packaging for a real EKS cluster, and the AWS integration for S3
and EventBridge. [Known limits and open points](limits.md) lists what they must settle.

## What KMO guarantees

- A changed file in the store updates the matching object and rolls the affected workloads, with no step by hand.
- A change that leaves the effective values of a workload as they were causes no restart.
- A store that cannot be reached, or a file that cannot be parsed, never empties or changes the existing objects.
- One field on a ConfigSync pauses all syncing and all restarts for its workloads, and clearing it resumes them.
- Each failure and each warning is visible on the resource and as an Event.
- Workloads in different namespaces can be served from different buckets with different credentials, and a namespace
  cannot read the files of another.
- A store in AWS can be reached with no stored key: the store names a ServiceAccount, and AWS gives short-lived keys in
  exchange for that ServiceAccount's token. This is proven from a cluster outside EKS, and not yet inside EKS.
- A newcomer can go from a fresh clone to a working demo with only the Mise tasks and these pages.

The end-to-end suites in `test/e2e/` check these on the local cluster.

## Decisions and their reasons

| Decision                                                                    | Reason                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript with Pepr                                                        | Matches the developer's preferences; Pepr was the recommended framework.                                                                                                                                                                   |
| A separate receiver that annotates resources                                | Pepr has no supported way to host a custom HTTP endpoint. The split also keeps the exposed component free of store credentials, and gives webhooks, timers and manual triggers one shared code path. Flux uses the same pattern.           |
| The operator merges common and workload files                               | Each workload depends on exactly two objects, which is clear to a human and simple to track. Workloads whose effective values did not change are not restarted.                                                                            |
| Content hash on the pod template                                            | Makes reconciling safe to repeat. A timestamp would restart pods on every run.                                                                                                                                                             |
| The store is the source of truth                                            | Hand edits to managed objects are overwritten, so the cluster and the files never silently disagree.                                                                                                                                       |
| Defaults derived from the resource's name and namespace                     | Something must exist in the cluster to opt a workload in, and that object already carries both values.                                                                                                                                     |
| Workloads reference the objects explicitly                                  | Keeps manifests honest about what a pod receives and avoids confusing ArgoCD's diffing.                                                                                                                                                    |
| A suspend switch on each resource                                           | One field covers both reasons to pause: protecting a workload from restarts during sensitive work, and preserving a hand-edited object. CronJobs and Flux use the same field name.                                                         |
| Conflicting resources rejected at admission                                 | The mistake is reported to the person making it, at the moment they make it, instead of surfacing later as unexplained restarts.                                                                                                           |
| Stores as custom resources, one operator for all                            | Each tenant namespace gets its own bucket and credentials without running a second operator, which Pepr does not readily support. External Secrets Operator and cert-manager separate tenants the same way.                                |
| A ConfigSync lists its stores in order                                      | One ConfigSync for each service stays the rule, but its values may come from several stores, such as a company store and a team store. Order decides who wins, which a person can read off the resource.                                   |
| The store owns the layout of its files                                      | The owner of a bucket knows where its files are. A ConfigSync cannot name a key, so a namespace can never ask for the files of another.                                                                                                    |
| The S3 fields of a store sit in their own block, with the identity          | Other kinds of store are planned. Each kind gets its own block with its own location and its own way to prove who is asking, so a new kind is an addition and not a change.                                                                |
| Outputs marked for Stakater Reloader to ignore                              | Clusters that already run Reloader would otherwise roll a workload a second time for the same change. The mark does nothing where Reloader is absent, so nothing has to be detected.                                                       |
| A store reaches AWS as a ServiceAccount, never with the operator's identity | No key is stored, and AWS itself refuses a store that names a role its namespace does not own. External Secrets Operator uses the same pattern. Stored keys stay as a second method for stores that cannot do this, such as the local one. |
| RustFS as the local store                                                   | RustFS is Apache-2.0, needs no registration and uses the standard S3 notification API.                                                                                                                                                     |
| A guarded Rollout watch, on by default, with a switch                       | Pepr crash-loops on a watch whose kind is missing, so the operator checks for Argo Rollouts before watching Rollouts. The check leans on Pepr internals, so a switch turns it off and falls back to the plain watch.                       |
| k3d for the local cluster                                                   | It is k3s in Docker: disposable, rootless, version-pinned by Mise and equipped with an image registry.                                                                                                                                     |

## How tenants stay apart

Three choices do the work, and none of them is a check that someone could forget.

- **A ConfigSync names stores, never keys.** The files it reads follow from its own namespace and name and from the
  folders of the store. So there is nothing it could write to ask for the files of another namespace.
- **The identity of a shared store is in another namespace.** Kubernetes cannot hide a Secret or a ServiceAccount from
  people who can run pods in its namespace, so the separation has to be by namespace.
- **The token belongs to the store's ServiceAccount, not to the operator.** A tenant that names the role of another
  tenant is refused by AWS itself.

A tenant can always read the output Secret in its own namespace, because it holds the values of its own workload. What
is protected is direct access to the store: other locations, the history of a file, and writes. [Tenants](tenants.md) is
the guide, with every rule.

## Other kinds of store

A store is a bucket today. Stores for AWS Systems Manager Parameter Store and AWS Secrets Manager are planned and not
built. Four rules are fixed, so that each new kind is an addition and not a change:

- Each kind of store is a block next to `s3`, with its own location, layout and identity. A store has exactly one block.
- Every kind yields the same four sets of values for a ConfigSync: common and service, config and secrets. Merging,
  hashing and everything after them do not know the kind.
- Every kind announces its changes through EventBridge. Each change ends as the sync annotation on the affected
  ConfigSyncs, as it does for a file.
- The receiver ignores an EventBridge event from a source that it does not know. It does not refuse it.

There is no general store interface in the code. It comes with the second kind, when there are two cases to shape it.

## The guarded Rollout watch

Pepr starts every watch that a module declares, and its watcher crash-loops when the kind behind one of them is not
installed. Left alone, a watch on Rollouts would break the operator on every cluster without Argo Rollouts.

So the operator declares its Rollout watch through a small shim. The shim keeps the declaration in place while the
module is built, so the permissions for Rollouts are still generated. When the operator runs, the shim takes the watch
out of Pepr's hands, checks whether the Rollout kind is installed, and starts the watch itself only if it is. It checks
again whenever a custom resource definition is added or removed, so Argo Rollouts can be installed or removed with no
restart of the operator.

One setting of the operator controls the shim, the environment variable `KMO_GUARD_ROLLOUT_WATCH`:

- `true`, the default: the shim is used.
- `false`: the Rollout watch is declared the plain Pepr way, and Argo Rollouts must be installed before the operator
  starts. This is the way out when a Pepr upgrade breaks the shim.

The setting is read once, when the operator starts.

The shim relies on parts of Pepr that are not public: it copies the few lines that Pepr uses to start a watch, and it
depends on the shape of Pepr's list of bindings. Pepr can change these without notice. Three things keep that from going
unseen:

- Pepr is pinned to an exact version, and a test fails when the installed version is not the one that the shim was
  verified against.
- Tests state what the shim relies on in Pepr, and fail when an upgrade changes it.
- The end-to-end suite `rollout-guard` checks the behavior on a cluster, with and without Argo Rollouts, and can be run
  again after every upgrade.

A watch that the shim starts reports no Pepr metrics. [Upgrading Pepr](upgrading-pepr.md) is the procedure.

## What was verified about RustFS and Pepr

Parts of the design rest on how RustFS and Pepr behave, and not all of it is in their documentation. These facts were
checked on the local cluster, with RustFS 1.0.1 and Pepr 2.0.3.

RustFS:

- A notification is one `POST` for each event, with a `Records` list of one entry in the S3 format. It also has two
  top-level fields that S3 does not send, `EventName` and `Key`. KMO reads `Records` only.
- The key in `Records` is form-encoded: a slash is `%2F`, a space is `+` and a plus is `%2B`.
- On a bucket with versioning, a delete arrives as `s3:ObjectRemoved:DeleteMarkerCreated`. KMO treats every event the
  same way, so the name does not matter to it.
- `awsRegion` is an empty string and `eventSource` is `rustfs:s3`.
- The event repeats the request headers of the upload. RustFS itself replaces the value of `authorization` with
  `***redacted***`.
- Each upload gets its own version, and an older version can be read by its identifier.
- RustFS starts when its webhook target is down, and keeps the events in a queue until the target is back.
- The local store keeps its data in an `emptyDir` volume. A restart of RustFS loses every file and every version, and
  the seed Job puts the files back.

Pepr:

- A reconcile runs for every change of a resource, also for a change of the status only. A status update is not told
  apart from another update. This is why a reconcile first asks whether anything it acts on has changed.
- When the kind of a watch is not installed, the watcher serves its other watches for about 35 seconds and then exits.
  Kubernetes restarts it, and it ends in `CrashLoopBackOff`. The schedule runs in the watcher, so the refresh timer
  stops too. The admission pods are not affected.
- When the watcher starts, each watch delivers every resource that exists. So every start reconciles everything once.
- Pepr writes the namespace `pepr-system` into the manifest and into every template of its chart. There is no setting
  for it.
- Every resource that Pepr generates is named after the identifier of the module. This suggests that modules with
  different identifiers can share a cluster. It was read from the names, and not confirmed in the Pepr documentation.
- The module's default permissions are those of a cluster administrator. KMO builds with scoped permissions and rules
  that are written by hand.
- `pepr build` bundles a workspace package that is only TypeScript source, so the operator can import `@kmo/core` with
  no build step between them.
- The controller image brings its own Node, whatever version the repository pins.

## Read next

- [Architecture](architecture.md) for the parts and the path of one changed file.
- [ConfigSync](configsync.md), [Stores](stores.md) and [The receiver](receiver.md) for the rules.
- [Known limits and open points](limits.md) for what is not built and what is still to prove.
