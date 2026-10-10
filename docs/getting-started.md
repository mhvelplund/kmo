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

The `store` task runs the AWS command line against the local store. For example,
`mise run store -- s3 ls s3://kmo-config --recursive` lists every file.

## What does not work yet

The workloads' ConfigMaps and Secrets are written by hand from the sample files. Changing a file in the store changes
nothing in the cluster, and changing a ConfigMap does not restart the pods that use it. Closing that gap is what KMO is
for.

## Clean up

`mise run cluster:down` deletes the cluster and everything in it.
