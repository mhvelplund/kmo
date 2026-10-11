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

## Try it

Nothing asks for a sync by itself yet, so ask for one by hand after you change a file. This is the annotation that the
receiver will set later:

```bash
kubectl annotate csync orders-api -n shop kmo.isntall.net/sync-requested-at="$(date -u +%FT%T.%3NZ)" --overwrite
```

Change `shop/orders-api/config.env` in the store with the `store` task, ask for a sync, and watch the pods of
`orders-api` be replaced with `kubectl rollout status deployment/orders-api -n shop`. `mise run deploy` puts the sample
files back.

## What does not work yet

- Nothing asks for a sync when a file in the store changes. A sync runs when the operator starts, when a ConfigSync is
  created or changed, and when you ask for one as shown above.
- A ConfigSync does not report what happened: its `Ready`, `Stores` and `Last sync` columns stay empty. The operator's
  log is the place to look, with `mise run operator:logs`.

## Check that it works

`mise run test:e2e` runs a smoke test of the whole path on the local cluster: files in the store, the two objects, the
hash, the rolling update, and what happens on a failure. It takes about two minutes and prints one line for each check.
It creates the cluster first when there is none, so it also works straight after `mise run setup`.

## Clean up

`mise run cluster:down` deletes the cluster and everything in it.
