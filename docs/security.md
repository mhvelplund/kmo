# Security

This page says who can change the code that KMO runs, what that gives them, and how to keep that right with one group of
people: the KMO administrators.

## Why the code matters

The operator may read every Secret in the cluster, and may create a token for every ServiceAccount. It needs these
rights because a store can keep its identity in any namespace. So a person who can change what the operator runs holds
the same rights. Treat a KMO administrator as a cluster administrator.

The receiver is a smaller risk. It may read ConfigSyncs and stores and ask for a sync. It cannot read a Secret.

## Where the code is

Pepr does not put the operator in an image of its own. The operator is three things in the namespace `pepr-system`:

- **The Secret `pepr-kmo-module`** holds the code, as one compressed file.
- **The Deployments `pepr-kmo` and `pepr-kmo-watcher`** run Pepr's controller image, mount that Secret, and pass the
  SHA-256 hash of the code as an argument. The controller refuses to start when the code does not match the hash.
- **The ServiceAccount `pepr-kmo`** carries the operator's rights, through the ClusterRole `pepr-kmo`.

The receiver's code is in its image, which the Deployment `kmo-receiver` in `kmo-system` runs.

## Rights that give control of the operator

Each of these rights, in `pepr-system`, is enough to run other code with the operator's rights, or to use those rights
directly:

- **Change a Deployment.** The image, the command, the hash and the environment are all there. This right alone is
  enough.
- **Create a pod, or anything that makes pods** (a Deployment, a Job, a CronJob and so on). The pod can name the
  ServiceAccount `pepr-kmo`.
- **Create a token for the ServiceAccount `pepr-kmo`**, which is the resource `serviceaccounts/token`.
- **Run a command in a pod**, which is the resources `pods/exec`, `pods/attach` and `pods/ephemeralcontainers`.

A person who can only write the Secret `pepr-kmo-module` cannot run other code, because of the hash. That person can
stop the operator: at its next start the code does not match, and the pods fail. While the admission pods are down,
nobody can create or change a ConfigSync.

These rights are outside the namespace, and they are as strong:

- **Change the ClusterRole `pepr-kmo` or its binding.** This changes what the operator may do.
- **Change or delete the ValidatingWebhookConfiguration `pepr-kmo`.** Without it, conflicting ConfigSyncs are no longer
  refused. With a changed address, another program answers in place of the operator.
- **Change the three definitions in `crds/`.** A deleted definition deletes every resource of its kind.
- **Push to the image registry, or change the build.** The image of Pepr's controller, the image of the receiver, the
  computer or pipeline that runs `pepr build`, and the Git repository that a tool such as ArgoCD installs from are all
  ways to the same code. Name images by digest where you can, and protect the branch that is installed.

## Rights that only read

Read access to the Secrets of two namespaces is also sensitive:

- In `pepr-system`, `pepr-kmo-tls` is the private key of the admission webhook, and `pepr-kmo-api-path` is the secret
  part of its address.
- In `kmo-system`, the credentials of the cluster-wide stores open the buckets, and `kmo-receiver-token` lets its holder
  ask for syncs.

## Give the right to one group

Kubernetes permissions only add. No rule takes a right away, so the method is to grant the rights above to one group and
to nobody else.

Choose a group name in your identity provider, for example `kmo-admins`. Bind the built-in ClusterRole `admin` to that
group with a RoleBinding in `pepr-system`, and with a second one in `kmo-system`. A RoleBinding that names a ClusterRole
grants its rules in the namespace of the binding only. This is the binding for `pepr-system`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: kmo-admins
  namespace: pepr-system
subjects:
  - kind: Group
    name: kmo-admins
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: admin
  apiGroup: rbac.authorization.k8s.io
```

With these two bindings a member of the group can change the Secret, the Deployments and the receiver. The member cannot
read the Secrets of another namespace directly, but can do so through the operator, as said above.

The parts outside the namespaces stay with the cluster administrators: the ClusterRole and its binding, the webhook
configuration and the definitions. Kubernetes lets a person create a ClusterRole only with rights that the person
already holds, so the first installation needs a cluster administrator or an installation pipeline with those rights.

## Keep everybody else out

- **Do not bind `cluster-admin`, `admin` or `edit` to people with a ClusterRoleBinding.** A ClusterRoleBinding counts in
  every namespace, `pepr-system` included. Give teams a RoleBinding in each of their own namespaces.
- **Do not grant rules with `*`** for resources or verbs across the cluster.
- **Look for rights on Secrets, workloads, pods and tokens** in every ClusterRole that is bound across the cluster,
  those of other operators and of pipelines included.
- **Give nobody but the group a RoleBinding** in `pepr-system` or `kmo-system`.

Check the result as each kind of user. This must answer `no` for a user who is not a KMO administrator, and `yes` for
one who is:

```sh
kubectl auth can-i patch deployment/pepr-kmo-watcher -n pepr-system --as=<user> --as-group=<group>
```

Repeat it for `update secret/pepr-kmo-module`, `create pods`, `create serviceaccounts/token` and `create pods/exec` in
`pepr-system`, and for `get secrets` in `kmo-system`.

A rule cannot refuse a person who holds a right through a ClusterRoleBinding. For that, the cluster needs an admission
policy for the two namespaces. KMO does not bring one.

## The key in the generated chart

`pepr build` writes a Helm chart and a manifest to `packages/operator/dist`. Both hold the Secret `pepr-kmo-tls` with
the private key of the admission webhook, and the Secret `pepr-kmo-api-path`. Pepr makes a new key in each build.

Today this is not a problem: the folder is not committed, each installation is its own build, and the key goes to that
cluster only. It becomes a problem when one build is given to many clusters or put in a Git repository. Then every
cluster has the same key, and every reader of the chart knows it. A person with the key, who can also take the traffic
that the API server sends to the webhook, can answer in place of the operator: allow ConfigSyncs that conflict, or
refuse them all. The requests hold ConfigSyncs only, and no value from a store.

So do not publish the output of one build, and do not commit it. Build for each cluster, or replace the two Secrets at
installation. The packaging work must settle this; see [Known limits](limits.md).

## Read next

- [Tenants](tenants.md) for what a team can reach through a store.
- [Known limits](limits.md) for what KMO does not do.
