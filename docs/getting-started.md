# Getting started

This page takes a fresh clone to a running local environment. You need Docker and [Mise](https://mise.jdx.dev); Mise
installs everything else.

## Start the environment

Run these four tasks in order:

```bash
mise run setup
mise run cluster:up
mise run deploy
mise run operator:deploy
```

The first installs the tools and dependencies. The second creates a small Kubernetes cluster inside Docker. The third
installs the KMO resource kinds and an object store, fills the store with sample files and creates five sample
workloads. The fourth builds the operator and installs it. The pods of the workloads start only then, because they wait
for the ConfigMaps and Secrets that the operator writes.

## What you get

- A cluster named `kmo` with two nodes and an image registry.
- RustFS, an S3-compatible object store, in the `kmo-dev` namespace. It holds the bucket `kmo-config`, where each
  workload has a folder named after its namespace and name, next to a `_common` folder shared by all.
- Five workloads in the `shop` namespace, one of each kind KMO supports. Each prints the values it received when it
  starts, so its log shows its configuration.
- Three new kinds of resource: ConfigSync, ConfigStore and ClusterConfigStore. The cluster has one cluster-wide store
  named `default`, which points at the local object store, and one ConfigSync for each workload in `shop`. List them
  with `kubectl get clusterconfigstore` and `kubectl get configsync -n shop`.
- Two sample tenants, `payments` and `partners`, each with one workload. [Tenants](#tenants) explains them.

The `store` task runs the AWS command line against the local store. For example,
`mise run store -- s3 ls s3://kmo-config --recursive` lists every file.

## What the operator does

The operator reads each ConfigSync, fetches its files from the store, and writes one ConfigMap and one Secret named
`<name>-kmo`. These hold the service's own values merged with the common values. List them with
`kubectl get configmap,secret -n shop -l app.kubernetes.io/managed-by=kmo`.

The objects belong to their ConfigSync. A hand edit to one is undone at the next sync, and deleting a ConfigSync deletes
its two objects.

After it has written the two objects, the operator puts a hash of their values on the pod template of the workload, as
the annotation `kmo.isntall.net/config-hash`. When the values change, the hash changes and Kubernetes rolls the
workload. When the values are the same, nothing is restarted.

## Read the state of a ConfigSync

The operator reports on the ConfigSync itself. `kubectl get csync -n shop` shows for each one whether it is ready, the
stores it read and the time of its last sync. `kubectl describe csync orders-api -n shop` shows the rest:

- The status lists every file that was asked for, with its store, whether it exists, and the version that was read.
- Four conditions say what is true now. `Ready` is false when the last sync failed, and its reason and message say why.
  `SourcesFound` is false when every file is missing or empty. `TargetsWired` is false when a workload does not exist or
  does not use the two objects. `Suspended` says whether syncing is paused. The last three are warnings: the ConfigSync
  is still ready.
- Events record that something happened: a failure, a recovery, a new warning. A failure that repeats is recorded once.

A message never holds a value from a file. It names the store, the file and the line.

## When the operator syncs

The operator does not wait to be told about every change. It syncs a ConfigSync:

- when the ConfigSync is created or its spec changes;
- when one of its two objects is edited or deleted, so a hand edit is undone within seconds;
- when one of its workloads is created or its spec changes, so a workload that arrives late gets its hash;
- when a store it uses is created, changed or deleted;
- when its refresh interval has passed, 30 minutes unless `refreshInterval` says otherwise;
- once a minute while it is not ready, so a failure is tried again without help.

Every one of these sets the annotation `kmo.isntall.net/sync-requested-at` on the ConfigSync, and the operator syncs
when that annotation changes. You can set it too.

To make the operator leave a ConfigSync alone, set `suspend: true` in its spec. Nothing is read, written or restarted
until you set it back, and a hand edit stays. The `Suspended` column and condition show it.

## One ConfigSync for each workload

Two ConfigSyncs that claim the same workload, or write an object with the same name, would undo each other's work. The
API server asks the operator before it stores a ConfigSync, and the operator refuses one that shares a target or an
output name with another ConfigSync in the namespace. You see the refusal at once, in the output of `kubectl apply`. A
suspended ConfigSync keeps its claims.

This check runs in its own pods, `pepr-kmo` in `pepr-system`. While they are down, no ConfigSync can be created or
changed.

## Tenants

A tenant is a team that shares the cluster with others. KMO has two kinds of store for them.

- A team that is trusted with credentials has a **ConfigStore** in its own namespace, next to the Secret with its keys.
  `payments` is such a team. Its store is named `default`, so its ConfigSync `ledger` uses it without naming it: a store
  in the namespace wins over the cluster-wide store of the same name.
- For a team that must not see credentials, an administrator creates a **ClusterConfigStore**. Its keys stay in
  `kmo-system`, and it lists the namespaces that may use it. `partners` is such a team. Its store reads the same bucket
  as the store `default`, under the key prefix `partners-store`, and has its own common folder there.

A ConfigSync on a cluster-wide store reads only the folder of its own namespace and the common folder. It cannot name a
key, and the API server refuses a cluster-wide store whose service folder does not hold `{namespace}`. A ConfigSync in a
namespace that a store does not allow is not ready, and its message says so.

Each store has a `Ready` column: the operator checks once a minute, and when the store changes, that the bucket can be
reached with the store's credentials. See it with `kubectl get clusterconfigstore` and `kubectl get configstore -A`. The
log of each tenant's workload shows where its values came from: `kubectl logs -n payments deployment/ledger` and
`kubectl logs -n partners deployment/portal`.

Both tenants use the root keys of the local store, so the store itself does not keep them apart here; KMO's rules do. A
store in AWS can do without stored keys: see [Stores in AWS without stored keys](aws-identity.md).

Who may create a store or read a Secret is not decided by KMO. The cluster's own access rules for people decide that,
and an administrator sets them up.

## Try it

A changed file in the store is not noticed at once yet, so ask for a sync by hand after you change one. This is the
annotation that the receiver will set later:

```bash
kubectl annotate csync orders-api -n shop kmo.isntall.net/sync-requested-at="$(date -u +%FT%T.%3NZ)" --overwrite
```

Change `shop/orders-api/config.env` in the store with the `store` task, ask for a sync, and watch the pods of
`orders-api` be replaced with `kubectl rollout status deployment/orders-api -n shop`. To see a failure, put a line that
is not `KEY=value` in the file and ask for a sync: the ConfigSync is not ready, an Event says which line is wrong, and
the ConfigMap keeps its old values. `mise run deploy` puts the sample files back.

## What does not work yet

- Nothing tells the operator at once that a file in the store changed. The refresh interval picks the change up, or you
  ask for a sync as shown above. The receiver will close this gap.

## Check that it works

`mise run test:e2e` runs a smoke test of the whole path on the local cluster: files in the store, the two objects, the
hash, the rolling update, what the ConfigSync reports, what starts a sync, what is refused, and what happens on a
failure. It takes about three minutes and prints one line for each check. It creates the cluster first when there is
none, so it also works straight after `mise run setup`.

## Clean up

`mise run cluster:down` deletes the cluster and everything in it.
