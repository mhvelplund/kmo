# Architecture

KMO has two programs and three kinds of resource. This page says what each part does, how one changed file travels
through them, and why the parts are split the way they are.

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

## The parts

**The object store** holds the env files and announces each change. Locally it is RustFS. In AWS it is S3, which
announces changes through EventBridge.

**The receiver** is a small HTTP service. It turns a change event into an annotation on each ConfigSync that reads the
changed file. It never reads the store and cannot read a Secret. [The receiver](receiver.md) has the details.

**A store resource** describes one location in a bucket and how to reach it. A ConfigStore belongs to one namespace. A
ClusterConfigStore is cluster-wide and lists the namespaces that may use it. [Stores](stores.md) is the reference.

**A ConfigSync** opts one workload in. It names the workload, the stores to read and the two objects to write, and every
one of those has a default. [ConfigSync](configsync.md) is the reference.

**The operator** is a [Pepr](https://pepr.dev) module. It reconciles each ConfigSync: it reads the files, writes one
ConfigMap and one Secret, and stamps the workload. It is the only part that holds store credentials and the only writer
of the two objects.

## The path of one changed file

1. Someone changes a file in the store, for example `shop/orders-api/config.env`.
2. The store sends an event to the receiver. The event names the bucket and the key, and nothing else that matters.
3. The receiver looks in its in-memory lists for every ConfigSync that reads that file. A common file can match many.
4. The receiver sets the annotation `kmo.isntall.net/sync-requested-at` on each of them, to the current time.
5. The operator sees the changed annotation and reconciles the ConfigSync. It fetches the files of every source, parses
   them and merges them.
6. The operator writes the ConfigMap and the Secret.
7. The operator computes a hash of the values of both objects and puts it on the pod template of each target, as the
   annotation `kmo.isntall.net/config-hash`.
8. When the hash is new, Kubernetes sees a changed pod template and replaces the pods. When it is the same, nothing
   happens.

## Why two programs

- Pepr has no supported way to serve an HTTP endpoint of your own, so something else must take the webhooks.
- The receiver is the part with an open port. It holds no store credentials and has no permission on Secrets, so a
  break-in there finds nothing of value. The most it can do is ask for a sync.
- Webhooks, the refresh timer, the operator's own triggers and a request by hand all do the same thing: they set the one
  annotation. So there is one way into a reconcile, and one path to test.

## Three design choices

**A hash, not a timestamp.** The stamp on the pod template is a SHA-256 hash of the values. A reconcile that finds the
same values writes the same hash, and Kubernetes restarts nothing. So a reconcile is safe to repeat, and an event that
arrives twice is harmless. A timestamp would restart the pods on every run.

**The store is the source of truth.** A hand edit to one of the two objects is undone at the next sync. The cluster and
the files never disagree silently. To keep a hand edit for a while, suspend the ConfigSync.

**The operator merges.** Each workload depends on exactly two objects, which already hold the common values and the
workload's own values. A person can read what a pod receives from two objects, and a workload whose effective values did
not change is not restarted when a common file changes.

The design document lists every decision with its reason:
[Decisions and their reasons](design.md#decisions-and-their-reasons).

## Where each part runs

- The operator runs in the namespace `pepr-system`. Pepr decides that, and it cannot be changed. It runs as two
  Deployments: `pepr-kmo-watcher` reconciles, and `pepr-kmo` answers the API server's admission requests.
- The receiver runs in `kmo-system`, as the Deployment `kmo-receiver` behind a Service of the same name.
- The credentials of cluster-wide stores are kept in `kmo-system` by convention.

## The packages

The code is an npm workspace of three TypeScript packages.

- `packages/core` holds every decision that needs no cluster: parsing, merging, hashing, defaults, which store a
  ConfigSync uses, the keys of its files, reading events, matching an event to ConfigSyncs, and what a status says. It
  makes no Kubernetes call and no network call, so all of it has unit tests.
- `packages/operator` is the Pepr module, a thin shell around core.
- `packages/receiver` is the HTTP service, also a thin shell around core.

The operator and the receiver must always agree on which files a ConfigSync reads. They do, because both take the answer
from the same functions in core.

## Read next

- [Concepts](concepts.md) explains each Kubernetes idea that KMO uses.
- [ConfigSync](configsync.md) and [Stores](stores.md) are the references of the resources.
- [Known limits](limits.md) says what KMO does not do.
