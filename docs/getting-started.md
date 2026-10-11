# Getting started

This page takes a fresh clone to a running local environment. You need Docker and [Mise](https://mise.jdx.dev); Mise
installs everything else.

## Start the environment

Run these five tasks in order:

```bash
mise run setup
mise run cluster:up
mise run deploy
mise run operator:deploy
mise run receiver:deploy
```

The first installs the tools and dependencies. The second creates a small Kubernetes cluster inside Docker. The third
installs the KMO resource kinds and an object store, fills the store with sample files and creates five sample
workloads. The fourth builds the operator and installs it. The pods of the workloads start only then, because they wait
for the ConfigMaps and Secrets that the operator writes. The fifth builds the receiver, pushes its image to the
cluster's registry and installs it.

## What you get

- A cluster named `kmo` with two nodes and an image registry.
- RustFS, an S3-compatible object store, in the `kmo-dev` namespace. It holds the bucket `kmo-config`, where each
  workload has a folder named after its namespace and name, next to a `_common` folder shared by all.
- Five workloads in the `shop` namespace, one of each kind KMO supports. Each prints the values it received when it
  starts, so its log shows its configuration.
- Three new kinds of resource: ConfigSync, ConfigStore and ClusterConfigStore. The cluster has one cluster-wide store
  named `default`, which points at the local object store, and one ConfigSync for each workload in `shop`. List them
  with `kubectl get clusterconfigstore` and `kubectl get configsync -n shop`.
- The receiver in the `kmo-system` namespace. The object store sends it an event for each changed file.
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

## What starts a sync

The object store tells the receiver about each changed file, and the receiver asks for a sync of every ConfigSync that
reads the file. So a change arrives in seconds. The operator also syncs when a ConfigSync, one of its two objects, one
of its workloads or one of its stores changes, and when the refresh interval has passed. A ConfigSync that failed is
tried again once a minute.

`kubectl get csync -n shop` shows for each ConfigSync whether it is ready, the stores it read and the time of its last
sync. `kubectl describe csync orders-api -n shop` shows the files that were read, four conditions and the Events. To
make KMO leave a ConfigSync alone, set `suspend: true` in its spec.

[ConfigSync](configsync.md) is the reference for all of this: every field, the status, the failures and the warnings.

## Tenants

A tenant is a team that shares the cluster with others. The local environment has two. `payments` is trusted with
credentials and has its own store in its own namespace. `partners` is not, and uses a cluster-wide store whose
credentials it cannot reach. [Tenants](tenants.md) explains both, and what keeps one team out of the files of another.

## Try it

`mise run demo` changes one value of the sample service `orders-api` in the store, and shows each step that follows: the
receiver's log line, the new ConfigMap, the new hash, the rolling update and the value in a new pod. Nothing in it is
done by hand after the file is changed.

To change a file yourself, use the `store` task. This puts a new greeting in the file of `orders-api`:

```bash
printf 'GREETING=hello again\nLOG_LEVEL=debug\n' | mise run store -- s3 cp - s3://kmo-config/shop/orders-api/config.env
```

Watch the pods be replaced with `kubectl rollout status deployment/orders-api -n shop`, and read what the receiver did
with `mise run receiver:logs`. To see a failure, put a line that is not `KEY=value` in the file: the ConfigSync is not
ready, an Event says which line is wrong, and the ConfigMap keeps its old values. `mise run deploy` puts the sample
files back.

When something does not do what you expect, read [Troubleshooting](troubleshooting.md).

## Check that it works

`mise run test:e2e` runs six suites of checks on the local cluster, one after the other, and prints one line for each
check and a summary at the end. It takes about twelve minutes. It creates the cluster first when there is none, so it
also works straight after `mise run setup`.

- `smoke` is the whole path for one service: the two objects, the hash, the rolling update, what the ConfigSync reports,
  what starts a sync, what is refused, and what happens on a failure. It takes about two minutes.
- `events` is the receiver: its answers, and changed files that reach the pods with no request by hand.
- `kinds` is a rolling update of each of the five kinds of workload.
- `failures` is the failures that the smoke suite does not cover, and the timer that tries again.
- `tenants` is the rules that keep tenants apart.
- `rollout-guard` proves that the operator runs with and without Argo Rollouts. It removes and reinstalls Argo Rollouts
  and takes about seven minutes.

Name suites after `--` to run only those: `mise run test:e2e -- smoke` is the quick check after a change.

## Clean up

`mise run cluster:down` deletes the cluster and everything in it.

## Read next

- [Architecture](architecture.md) for how the parts fit together.
- [Concepts](concepts.md) for the Kubernetes ideas behind them.
