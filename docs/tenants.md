# Tenants

A tenant is a team that shares the cluster with others. This page says how to give each team its own files, and what
keeps one team out of the files of another. The local environment has one tenant of each kind to look at.

## A team that is trusted with credentials

Give the team a **ConfigStore** in its own namespace, next to the Secret or the ServiceAccount that reaches its bucket.
The team owns all of it.

`payments` is such a team in the local environment. Its store is named `default`, so its ConfigSync `ledger` uses it
without naming it: a store in the namespace wins over the cluster-wide store of the same name. The store reads the
team's own bucket, `kmo-tenant`.

## A team that must not see credentials

An administrator creates a **ClusterConfigStore** for the team:

- its `allowedNamespaces` lists the team's namespace and no other;
- its Secret or ServiceAccount is in `kmo-system`, where the team has no access;
- the team gets no permission to create stores of either kind.

`partners` is such a team. Its ConfigSync names the store `partners`, because a cluster-wide store that is not named
`default` must be named.

Kubernetes cannot hide a Secret or a ServiceAccount from people who can run pods in its namespace. That is why the
identity must be in another namespace, and why the separation is by namespace.

## Sharing a bucket

Several stores can read the same bucket, each under its own `keyPrefix`. The store `partners` reads the bucket
`kmo-config`, the same one as the store `default`, under the prefix `partners-store`. Each store has its own common
folder under its prefix, so the common values of one are not the common values of the other.

A prefix alone does not keep the store from reading the rest of the bucket: the credentials do. In the local environment
both tenants use the root keys of RustFS, because it gives out no keys that are limited to a prefix. So here KMO's rules
keep the tenants apart, and not the store. In AWS, give each store a role that may read only its own prefix. See
[Stores in AWS without stored keys](aws-identity.md).

## What a tenant can reach

- A ConfigSync names stores and never keys. Which files it reads follows from its own namespace and name, and from the
  folders of the store.
- On a cluster-wide store, a ConfigSync reads only the folder of its own namespace and the common folder. The API server
  refuses a ClusterConfigStore whose `serviceFolder` does not hold `{namespace}`.
- A ConfigSync named after a service of another namespace gets the common values and nothing of that service.
- A ConfigSync in a namespace that a store does not allow is not ready, and its message says so.
- A ConfigSync cannot name the ConfigStore of another namespace. It is told that the store was not found.
- With a ServiceAccount as the identity, AWS itself refuses a store that names the role of another tenant.

A tenant can always read the output Secret in its own namespace, because it holds the values of its own workload. What
is protected is direct access to the store: other locations, the history of a file, and writes.

`mise run test:e2e -- tenants` checks each of these rules on the local cluster.

## What KMO does not decide

Who may create a store, read a Secret or create a ConfigSync is not decided by KMO. The cluster's own access rules for
people decide that, and setting them up is the administrator's work.

## Read next

- [Stores](stores.md) for every field of a store.
- [Stores in AWS without stored keys](aws-identity.md) for a store that reaches a bucket as a ServiceAccount.
