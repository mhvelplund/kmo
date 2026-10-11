# Installing

KMO has no supported installation for a real cluster yet. [Planned work](planned.md#packaging) says what will bring one.
Until then, the local environment is the way to try KMO: follow [Getting started](getting-started.md).

This page says what a cluster needs today, for someone who wants to put the parts in place by hand and accepts that the
steps will change.

## What a cluster needs

**The three definitions.** Apply the files in `crds/`. They must exist before the operator starts, because the operator
watches these kinds.

**The operator.** Run `npx pepr build` in `packages/operator`. It writes the manifests of the module to the `dist`
folder there. Apply them. The operator always runs in the namespace `pepr-system`. Its permissions are the hand-written
rules in `packages/operator/package.json`; read [Known limits](limits.md) for what they allow. The output holds a
private key, so do not commit or publish it, and limit who may change the operator: see [Security](security.md).

**The receiver.** Build an image from `packages/receiver`: `npm run build --workspace @kmo/receiver` makes the bundle,
and the Dockerfile copies it into a Node image. Push it to a registry that the cluster can pull from. Then apply the
manifests in `dev/receiver/` with two changes: your own image name, and your own token in the Secret
`kmo-receiver-token`. The local token is public and must not be used. Set the memory limit for the size of your cluster:
see [The receiver](receiver.md#memory).

**A store.** Create a ConfigStore or a ClusterConfigStore for your bucket, with its identity. See [Stores](stores.md),
and [Stores in AWS without stored keys](aws-identity.md) for a bucket in AWS.

**Notifications.** Make the store send its change events to the receiver, with the token. See
[The receiver](receiver.md). Without this, a changed file is picked up by the refresh interval only.

Argo Rollouts is optional. Without it, a Rollout target is reported as a workload that does not exist.

## What is not there yet

- The receiver speaks plain HTTP and knows one shared token. Do not put it on a public address.
- The path from S3 through EventBridge to the receiver is not set up by KMO.
- Stores without stored keys are proven from a cluster outside EKS, and not yet inside EKS.

[Known limits](limits.md) has the full list, and [Planned work](planned.md) says what will change.

## Read next

- [Getting started](getting-started.md) for the local environment.
- [Architecture](architecture.md) for what the parts do.
