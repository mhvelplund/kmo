# Installing

KMO is installed with one Helm chart, named `kmo`. The chart brings the three definitions, the operator and the
receiver. Helm and ArgoCD can both install it.

A release publishes the chart and two images to the registry of the repository on GitHub. [Releases](releases.md) says
how a version is made. In the addresses on this page, `OWNER` is the owner of that repository.

To try KMO on a local cluster, follow [Getting started](getting-started.md) in place of this page.

## Before you install

- **The namespace is fixed.** The chart must be installed into the namespace `pepr-system`, because Pepr puts the
  operator there and has no setting for it. The chart refuses another namespace. The receiver goes into `kmo-system`,
  which the chart creates.
- **The packages are private** while the repository is. Then the cluster needs a pull Secret in two namespaces:
  - in `pepr-system`, named in the value `certgen.imagePullSecrets`. It must exist before the installation, because a
    Job of the chart runs first. So create the namespace and the Secret by hand.
  - in `kmo-system`, named in the value `receiver.imagePullSecrets`. Create it after the installation, because the chart
    creates that namespace.
- **The chart holds no token.** After the installation, create a Secret named `kmo-receiver-token` in `kmo-system`, with
  your own token under the key `token`. The receiver's pod waits until the Secret is there. [The receiver](receiver.md)
  says what the token is for.

## With Helm

```sh
helm install kmo oci://ghcr.io/OWNER/charts/kmo --version <version> --namespace pepr-system --create-namespace
```

Then create the Secret with the token. The installation is complete when the Deployments `pepr-kmo` and
`pepr-kmo-watcher` in `pepr-system` and `kmo-receiver` in `kmo-system` are ready.

## With ArgoCD

Start from the file `charts/argocd-application.yaml` in the repository. Replace `OWNER`, and set the version that you
want. The file has four settings that the chart needs:

- **`CreateNamespace`** makes `pepr-system` before anything else, because a Job of the chart runs before its other
  objects exist.
- **`ServerSideApply`** is needed for the Secret that holds the operator's code. It is too large for the way ArgoCD
  applies an object by default. The chart also marks that Secret itself, so a sync that a person starts by hand works
  too.
- **`RespectIgnoreDifferences`** and the list under **`ignoreDifferences`** tell ArgoCD to leave two fields of the
  webhook configuration alone. A Job of the chart fills them in, and ArgoCD would otherwise empty them.

ArgoCD shows the application as synced and healthy a short time before the installation is complete. Its last phase then
fills in the webhook configuration. Wait until the sync operation has succeeded.

## What the chart does at an installation

The admission webhook needs a certificate with a private key, and a secret part of its address.
[Security](security.md#the-key-of-the-webhook) says why the chart cannot bring them.

- A Job that runs before the installation makes both, as the Secrets `pepr-kmo-tls` and `pepr-kmo-api-path`. It leaves
  them as they are when they exist.
- A Job that runs after the installation writes the certificate authority and the address into the webhook
  configuration.
- Both Jobs, and their rights, are deleted when they are done.
- A CronJob, `kmo-certgen-renew`, looks at the certificate each day and renews it before it ends.

## Values

The values that a person is most likely to set:

| Value                       | Default              | What it is                                                                   |
| --------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `crds.install`              | `true`               | Install the three definitions. Set to `false` when you manage them yourself. |
| `receiver.image.digest`     | empty                | Name the receiver's image by this digest, and not by the tag.                |
| `receiver.imagePullSecrets` | none                 | Names of pull Secrets in `kmo-system`.                                       |
| `receiver.tokenSecret.name` | `kmo-receiver-token` | The Secret in `kmo-system` that holds the token.                             |
| `receiver.resources`        | 64Mi, limit 128Mi    | Size the limit for your cluster: see [The receiver](receiver.md#memory).     |
| `certgen.image.digest`      | empty                | Name the image of the Jobs by this digest.                                   |
| `certgen.imagePullSecrets`  | none                 | Names of pull Secrets in `pepr-system`.                                      |
| `certgen.certificateDays`   | `90`                 | The number of days that a certificate of the webhook is valid.               |
| `certgen.renewBeforeDays`   | `30`                 | The certificate is renewed when it has this number of days left.             |
| `certgen.schedule`          | `17 3 * * *`         | When the CronJob looks at the certificate.                                   |

The other values belong to the operator and come from Pepr: the resources, the environment and the scheduling of the
Deployments `pepr-kmo` (under `admission`) and `pepr-kmo-watcher` (under `watcher`). The setting
`KMO_GUARD_ROLLOUT_WATCH` is in the `env` list of both. Do not change the value `hash`: it must match the operator's
code.

## Upgrading

Install the new version: `helm upgrade` with the same namespace, or a new `targetRevision` in the application. The key
of the webhook stays. The pods of the operator restart at each upgrade, also when its code is the same.

## Uninstalling

`helm uninstall kmo --namespace pepr-system` removes the operator and the receiver. It keeps these, because a loss of
them cannot be undone:

- the three definitions, and so every ConfigSync and every store. To remove them, delete the definitions. A deleted
  definition deletes every resource of its kind, in every namespace.
- the namespace `kmo-system`, with the token and the credentials of the cluster-wide stores. To remove it, delete the
  namespace.
- the Secrets `pepr-kmo-tls` and `pepr-kmo-api-path`. To remove them, delete the namespace `pepr-system`. A later
  installation then makes a new key.

The ConfigMaps and Secrets that KMO wrote stay as they are, and the workloads keep the values they have.

## After the installation

- **A store.** Create a ConfigStore or a ClusterConfigStore for your bucket, with its identity. See [Stores](stores.md),
  and [Stores in AWS without stored keys](aws-identity.md) for a bucket in AWS.
- **Notifications.** Make the store send its change events to the receiver, with the token. See
  [The receiver](receiver.md). Without this, a changed file is picked up by the refresh interval only.
- **Who may change KMO.** Limit the rights in `pepr-system` and `kmo-system` to one group: see [Security](security.md).

Argo Rollouts is optional. Without it, a Rollout target is reported as a workload that does not exist.

## What is not there yet

- The receiver speaks plain HTTP and knows one shared token. Do not put it on a public address.
- The path from S3 through EventBridge to the receiver is not set up by KMO.
- Stores without stored keys are proven from a cluster outside EKS, and not yet inside EKS.

[Known limits](limits.md) has the full list, and [Planned work](planned.md) says what will change.

## Read next

- [Security](security.md) for the key of the webhook and the rights that give control of KMO.
- [Troubleshooting](troubleshooting.md) for an installation that does not work.
