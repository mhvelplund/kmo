# KMO

KMO keeps the configuration of Kubernetes workloads in step with env files held in an object store. When a file changes,
the matching ConfigMap or Secret is updated within seconds and the workloads that use it pick up the new values through
a rolling update.

KMO has two parts: an operator that syncs and rolls the workloads, and a receiver that notices a changed file at once.
Both run end to end on a local cluster and in EKS. See the [documentation](docs/index.md) for how it works.

## Layout

- `packages/` holds the TypeScript packages. `core` is the shared logic, `operator` is the Pepr module that runs in the
  cluster, `receiver` is the HTTP service that takes the change events of the store, and `certgen` makes and renews the
  key of the admission webhook.
- `crds/` holds the definitions of the three KMO resource kinds.
- `charts/` holds the Helm chart, the script that builds it, and an example ArgoCD application.
- `dev/` holds the manifests for the local environment, with two sample tenants, and the demo.
- `infra/` holds the Terraform and Terragrunt of the demo on AWS, and the charts that ArgoCD installs there.
- `test/e2e/` holds the suites that run against the local cluster, and the scripts for the proof on AWS.
- `docs/` holds the documentation, starting at [docs/index.md](docs/index.md).
- `mise.toml` pins the tools and defines the tasks.

## Installing

KMO is installed with one Helm chart, by Helm or by ArgoCD. [Installing](docs/installing.md) has the steps. The chart is
proven on a local cluster and in EKS: see [the demo on AWS](docs/aws-demo.md). To try KMO on a local cluster, follow
[Getting started](docs/getting-started.md).

## Quick start

These steps install the latest release into a cluster of your own. They need no file from this repository.
[Installing](docs/installing.md) has the full details.

The example uses these values. Replace them with your own.

- `<bucket>` and `<region>`: the S3 bucket that holds the env files, and its AWS region.
- `<key id>` and `<secret>`: an access key that can read the bucket.
- `<namespace>`: the namespace of the workload that gets its configuration from KMO.
- `<name>`: the name of the workload's Deployment.

> [!TIP]  
> To see the newest release, run `helm show chart oci://ghcr.io/mhvelplund/charts/kmo`

1. Install the chart. It must go into the namespace `pepr-system`. Add `--version <version>` to pin a release.

   ```bash
   helm install kmo oci://ghcr.io/mhvelplund/charts/kmo --namespace pepr-system --create-namespace
   ```

2. Create the token of the receiver. The chart holds no token, and the receiver waits until this Secret exists.

   ```bash
   kubectl create secret generic kmo-receiver-token -n kmo-system \
     --from-literal=token="$(openssl rand -hex 32)"
   ```

3. Wait until the operator and the receiver are ready.

   ```bash
   kubectl rollout status deployment/pepr-kmo -n pepr-system
   kubectl rollout status deployment/pepr-kmo-watcher -n pepr-system
   kubectl rollout status deployment/kmo-receiver -n kmo-system
   ```

4. Create a store for your bucket. A ClusterConfigStore named `default` is used by every ConfigSync that names no store.
   Put its credentials in a Secret in `kmo-system`. `allowedNamespaces` is required. It lists the namespaces whose
   ConfigSyncs may use the store. The single entry `*` allows all namespaces. For a bucket in AWS without stored keys,
   see [Stores in AWS without stored keys](docs/aws-identity.md).

   ```yaml
   apiVersion: v1
   kind: Secret
   metadata:
     name: kmo-config-credentials
     namespace: kmo-system
   stringData:
     accessKeyId: <key id>
     secretAccessKey: <secret>
   ---
   apiVersion: kmo.isntall.net/v1alpha1
   kind: ClusterConfigStore
   metadata:
     name: default
   spec:
     s3:
       bucket: <bucket>
       region: <region>
       credentialsSecretRef:
         name: kmo-config-credentials
         namespace: kmo-system
     allowedNamespaces: ["*"]
   ```

   [Stores](docs/stores.md) has every field, and the settings for a store that is not AWS S3.

5. Put the env files in the bucket: `_common/config.env` and `_common/secrets.env` for all workloads, and
   `<namespace>/<name>/config.env` and `<namespace>/<name>/secrets.env` for one workload.

6. Create a ConfigSync with the name of the Deployment, in its namespace. The shortest one has only a name and a
   namespace. KMO then reads the files of step 5 and stamps that Deployment.

   ```yaml
   apiVersion: kmo.isntall.net/v1alpha1
   kind: ConfigSync
   metadata:
     name: <name>
     namespace: <namespace>
   ```

   KMO writes a ConfigMap and a Secret named `<name>-kmo`. Let the Deployment read them with `envFrom`.
   [ConfigSync](docs/configsync.md) has the other fields.

7. Optional: make the store send its change events to the receiver, with the token. Without this, KMO finds a changed
   file at the refresh interval only, 30 minutes by default. See [The receiver](docs/receiver.md). The receiver speaks
   plain HTTP, so do not put it on a public address.
