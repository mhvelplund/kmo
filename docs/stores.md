# Stores

A store describes one location, a bucket and an optional key prefix, and how to reach it. Nothing outside that location
can be read through the store. There are two kinds.

- A **ConfigStore** is namespaced. Only a ConfigSync in the same namespace can use it. It suits a team that brings its
  own bucket and credentials. Its short name is `cstore`.
- A **ClusterConfigStore** is cluster-wide, and an administrator creates it. It lists the namespaces that may use it,
  and its credentials are kept where those namespaces cannot reach them.

## The whole resource

```yaml
apiVersion: kmo.isntall.net/v1alpha1
kind: ClusterConfigStore
metadata:
  name: shop
spec:
  s3:
    bucket: company-config
    keyPrefix: shop # optional
    region: eu-west-1
    endpoint: "" # optional; empty for real S3
    addressingStyle: VirtualHosted # optional; VirtualHosted | Path
    serviceFolder: "{namespace}/{name}" # optional; this is the default
    commonFolder: _common # optional; this is the default
    serviceAccountRef: # exactly one of this and credentialsSecretRef
      name: shop-store
      namespace: kmo-system # ClusterConfigStore only
  allowedNamespaces: # ClusterConfigStore only
    - shop
```

## The fields of `spec.s3`

Everything about the bucket is in the block `s3`.

- `bucket` and `region` are required.
- `keyPrefix` goes in front of every key. It defaults to nothing, and a slash at its end is optional.
- `endpoint` is the address of an S3-compatible store that is not AWS. Leave it out for AWS.
- `addressingStyle` says where the bucket name goes in a request. See [Addressing style](#addressing-style).
- `serviceFolder` and `commonFolder` say where the files are. See [The layout](#the-layout).
- `serviceAccountRef` or `credentialsSecretRef` says how to prove who is asking. Exactly one of them is set.

## The two identities

**A ServiceAccount.** The store names a ServiceAccount that carries the annotation `eks.amazonaws.com/role-arn`. The
operator asks Kubernetes for a short-lived token of that ServiceAccount, and AWS exchanges the token for keys that last
about an hour. No key is stored in the cluster. Use this for AWS. [Stores in AWS without stored keys](aws-identity.md)
explains the setup.

**A credentials Secret.** The store names a Secret with the keys `accessKeyId` and `secretAccessKey`. This is for stores
that cannot exchange a token, such as the local RustFS. Do not use it for AWS.

For a ConfigStore, the ServiceAccount or the Secret is in the store's own namespace. A ClusterConfigStore names the
namespace, which is `kmo-system` by convention. The operator never uses its own identity to read a store.

## The layout

The store decides where its files are. By default:

- the files of a service are `<namespace>/<name>/config.env` and `<namespace>/<name>/secrets.env`, where the namespace
  and the name are those of the ConfigSync;
- the common files are `_common/config.env` and `_common/secrets.env`. A namespace name cannot hold an underscore, so
  this folder never collides with one.

Any of the four files may be absent. With a `keyPrefix` of `prod`, the files are under `prod/<namespace>/<name>/` and
`prod/_common/`.

`serviceFolder` and `commonFolder` name other folders. Both may hold the placeholders `{namespace}` and `{name}`, and
otherwise only letters, digits, `_`, `-` and `/`. The file names `config.env` and `secrets.env` are fixed.

The `serviceFolder` of a ClusterConfigStore must hold `{namespace}`. The API server refuses the store otherwise. This
rule is what keeps one namespace from reading the files of another on a shared store. The owner of a ConfigStore may lay
out its own bucket freely.

The common folder belongs to the store. Two stores that share a bucket under different key prefixes each have their own
common files.

## Who may use a store

A ClusterConfigStore must list its `allowedNamespaces`. The single entry `*` allows every namespace. There is no
default. A ConfigSync in a namespace that the store does not list is not ready, and its message says so.

A ConfigSync that lists no source uses a store named `default`: the ConfigStore of that name in its own namespace, and
when there is none, the ClusterConfigStore of that name, if it allows the namespace. So a store in the namespace wins
over the cluster-wide store of the same name. A default store need not exist. Without one, every ConfigSync must name
its stores.

## The `Ready` condition

The operator checks that it can reach the bucket with the store's identity, and reports the result as the condition
`Ready` on the store. It checks once a minute and when the store changes. `kubectl get clusterconfigstore` and
`kubectl get configstore -A` show it as a column. When the check fails, the message says why: the bucket, the Secret, or
the ServiceAccount and its role. It never holds a key or a token.

A store that is not ready does not stop a ConfigSync from trying. The ConfigSync reports its own failure.

## Addressing style

S3 has two ways to put the bucket name in the address of a request. `VirtualHosted`, the default, puts it in the host
name. AWS expects that, and it needs a DNS name for every bucket. `Path` puts it in the path, after one host name. A
store that you host yourself, such as RustFS, has one host name and no DNS record for each bucket, so it needs `Path`.

## Other kinds of store

A store is a bucket today. Stores for AWS Systems Manager Parameter Store and AWS Secrets Manager are planned and not
built. Each will be a block next to `s3`. The design document has the four rules that are fixed for them:
[The store resources](superpowers/specs/2026-10-10-kmo-operator-core-design.md#the-store-resources).

## Read next

- [Tenants](tenants.md) for how to give a team its own store.
- [The receiver](receiver.md) for how a store tells KMO about a change.
