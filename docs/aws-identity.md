# Stores in AWS without stored keys

A store must prove to the bucket who is asking. The simple way is an access key and a secret key in a Secret. Those are
a user name and a password: they do not expire, and anyone who can read the Secret has them. For a bucket in AWS there
is a better way, and KMO supports it.

**Status.** The path is proven from a cluster outside EKS: the local cluster read env files from a private S3 bucket
with a role and no stored key. It is not proven inside EKS yet. The operator's code is the same there.

## How it works

A ServiceAccount is an identity in the cluster. The API server can sign a short-lived token for one: a small document
that says "this is ServiceAccount X in namespace Y", valid for some minutes and for one named audience. The cluster
publishes the public half of its signing key, so AWS can check such a token. An IAM role says which tokens it trusts,
and AWS exchanges a trusted token for keys that last an hour. In EKS this is called IRSA.

A store names a ServiceAccount with `serviceAccountRef` in place of `credentialsSecretRef`. The operator does not use
its own identity. It asks Kubernetes for a token of the store's ServiceAccount, exchanges it, and keeps the keys in
memory until shortly before they expire. No key is stored in the cluster.

## What to set up

- **The ServiceAccount.** For a ConfigStore it is always in the store's own namespace. A ClusterConfigStore must name
  the namespace, and an administrator chooses it.
- **The role.** The annotation `eks.amazonaws.com/role-arn` on the ServiceAccount names the IAM role. This is the same
  annotation that IRSA uses.
- **The trust policy of the role.** It must trust the cluster's identity provider, and only for the subject
  `system:serviceaccount:<namespace>:<name>` and the audience `sts.amazonaws.com`. This is what keeps tenants apart: a
  ServiceAccount in another namespace can name the same role, and AWS refuses its token.
- **The permissions of the role.** It needs `s3:GetObject` and `s3:GetObjectVersion` on the files, and `s3:ListBucket`
  on the bucket. Without `s3:ListBucket`, S3 answers "access denied" for a file that is only missing, and KMO cannot
  tell a missing file from a forbidden one.
- **The cluster's signing keys.** EKS registers them in IAM by itself. For any other cluster they are published at a
  public address and registered once as an OIDC identity provider. The scripts in `test/e2e/aws/` are a worked example
  for the local cluster.

## What to know

- The operator may create a token for every ServiceAccount in the cluster. That is a strong permission, of the same
  weight as reading every Secret, which the operator already has. It is needed because a store can name a ServiceAccount
  in any namespace.
- Stored keys stay supported. They are for stores that cannot do this exchange, such as the local RustFS.
- When the exchange fails, the store's `Ready` condition says why. It names the ServiceAccount and the role, and never
  the token.

## The proof on the local cluster

Three Mise tasks run the proof against a real AWS account. They create two S3 buckets, an identity provider and a role,
so run them only when you mean to. Each needs `AWS_REGION` set and uses your own AWS profile.

- `mise run aws:issuer` creates the bucket that will hold the cluster's public signing keys and prints the issuer
  address. Put that address in `mise.local.toml`, which is not committed, and create the cluster again: the API server
  must sign its tokens under that address.
- `mise run aws:setup` publishes the keys, registers the cluster in IAM, and creates a role, a private bucket with two
  env files, and the namespace `aws-demo` with a store, a ConfigSync and a workload.
- `mise run aws:teardown` removes all of it.
