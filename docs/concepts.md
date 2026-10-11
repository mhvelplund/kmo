# Concepts

KMO is also a way to learn Kubernetes. This page explains each Kubernetes idea that the project uses: what it is, where
KMO uses it, and which file to read.

## Custom resource definition and custom resource

Kubernetes knows kinds such as Deployment and Secret. A **custom resource definition** (CRD) adds a kind of your own,
with a schema that the API server checks. An object of that kind is a **custom resource**. From then on `kubectl` and
the API treat it like any other kind.

KMO adds three kinds: ConfigSync, ConfigStore and ClusterConfigStore. The definitions are in `crds/`. They also hold
rules, such as "a ClusterConfigStore's service folder must hold `{namespace}`", which the API server enforces by itself.

## Controller and reconcile

A **controller** is a program that looks at what a resource asks for, looks at what exists, and makes the second match
the first. One such pass is a **reconcile**. A good reconcile is **level-triggered**: it does not ask "what changed?"
but "what should be true now?", so it gives the same result whether it runs once or ten times.

KMO's reconcile reads the files, writes the two objects and stamps the workloads, whatever started it. The hash makes
the repeat harmless. Read `packages/operator/src/reconcile.ts`.

## Operator

An **operator** is a controller together with the custom resources that it acts on. It puts the knowledge of a person
who operates something into a program. KMO's operator is a [Pepr](https://pepr.dev) module, which is a framework for
writing controllers and admission checks in TypeScript. Read `packages/operator/src/capability.ts`.

## Watch and informer

A **watch** is an open connection on which the API server sends every change to a kind, so a program need not ask again
and again. An **informer** lists a kind once, then watches, and keeps the result as a list in memory.

The operator watches ConfigSyncs, the two objects, the workloads and the stores. The receiver keeps three informers, so
it answers an event without a read from the API server. Read `packages/receiver/src/cluster.ts`.

A watch on a kind that is not installed fails. That is why the watch on Argo Rollouts is guarded: read
`packages/operator/src/guarded-kind.ts`.

## Status, conditions and Events

The **spec** of a resource is what a person asks for. The **status** is what the controller reports back. A
**condition** is one line of the status that says whether something is true now, with a reason for machines, a message
for people, and the time it last changed. An **Event** is a separate small object that records that something happened.
Conditions show the state; Events show the history, and Kubernetes deletes them after about an hour.

KMO reports four conditions on a ConfigSync and one on a store, and records an Event when a condition changes. Read
`packages/core/src/status.ts`.

## `metadata.generation` and `observedGeneration`

The API server raises `metadata.generation` of a resource each time its spec changes, and not when its status or its
annotations change. A controller writes the generation that it acted on into the status as `observedGeneration`. When
the two are the same, the status is about the current spec.

KMO uses this to tell a real change from its own status update, which would otherwise start another reconcile. Read
`needsReconcile` in `packages/core/src/trigger.ts`.

## Owner reference and garbage collection

An **owner reference** on an object names another object as its owner. When the owner is deleted, Kubernetes deletes
what it owns. This is **garbage collection**.

The ConfigMap and the Secret that KMO writes are owned by their ConfigSync, so deleting a ConfigSync removes both
without any code in the operator.

## Labels and annotations

Both are small key-value pairs on an object. **Labels** are for selecting: "every object managed by KMO".
**Annotations** are for information that tools read.

KMO labels its two objects with `app.kubernetes.io/managed-by: kmo`, and will not touch an object of the same name that
lacks the label. It uses three annotations: `kmo.isntall.net/sync-requested-at` asks for a sync,
`kmo.isntall.net/config-hash` is the stamp on a pod template, and `reloader.stakater.com/ignore` tells Stakater Reloader
to leave the two objects alone.

## Pod template and rolling update

A workload such as a Deployment does not hold pods. It holds a **pod template** and makes pods from it. When the
template changes in any way, also in an annotation, the workload replaces its pods with new ones, a few at a time. That
is a **rolling update**: the service stays up while it happens.

KMO restarts nothing itself. It changes one annotation on the pod template, and Kubernetes does the rest.

## The workload kinds

- A **Deployment** runs a number of pods that are all the same, and rolls them a few at a time.
- A **StatefulSet** runs pods with a fixed name and their own storage, and rolls them one by one, in order.
- A **DaemonSet** runs one pod on every node.
- A **CronJob** starts a Job on a schedule. Its template is used at the next run, so nothing rolls.
- A **Rollout** is the kind of Argo Rollouts. It replaces a Deployment and adds steps, such as a canary.

A StatefulSet and a DaemonSet can use the `OnDelete` strategy, which replaces a pod only when someone deletes it.

## ConfigMap, Secret and `envFrom`

A **ConfigMap** holds plain values and a **Secret** holds values that need care; Kubernetes can limit who reads a
Secret. A container takes all values of one as environment variables with `envFrom`, one value with `env`, or files with
a volume.

Environment variables are set when a container starts and never change after that. That is why a new value needs a new
pod, and why KMO exists.

## Admission webhook and failure policy

Before the API server stores an object, it can ask a program whether the object is allowed. That program is an
**admission webhook**. The **failure policy** says what happens when the program does not answer: `Ignore` lets the
object in, `Fail` refuses it.

KMO uses one to refuse a ConfigSync that conflicts with another, at the moment that someone applies it. Its policy is
`Fail`, so while its pods are down, no ConfigSync can be created or changed. Read `packages/core/src/claims.ts`.

## Server-side apply and field managers

With **server-side apply**, a program sends only the fields that it cares about, and the API server merges them into the
object. The API server records a **field manager** for each field: who set it last.

The operator and the receiver both ask for a sync this way. They send the name, the uid and the one annotation. The uid
makes the API server refuse the request when the ConfigSync was deleted in the meantime, so it is never created again.
`kubectl get csync <name> --show-managed-fields -o yaml` shows whether `kmo-receiver` or the operator asked last.

## ServiceAccount, Role and ClusterRole

A **ServiceAccount** is the identity of a program in the cluster. A **Role** lists what may be done in one namespace,
and a **ClusterRole** lists what may be done in all of them. A binding gives a role to an identity. **Least privilege**
means that a program gets only what it needs.

The receiver has three permissions, and none on Secrets. The operator's rules are written by hand, because Pepr's
default would make it a cluster administrator. Read `dev/receiver/receiver.yaml` and the `rbac` list in
`packages/operator/package.json`.

## ServiceAccount token and web identity

The API server can sign a short-lived **token** for a ServiceAccount: a small document that says who it is, for whom the
token is meant, and when it ends. Anyone with the cluster's public signing key can check it. **Web identity** is when
another system, such as AWS, accepts such a token and gives its own short-lived keys in exchange.

A store can reach a bucket this way, with no key stored in the cluster. Read
[Stores in AWS without stored keys](aws-identity.md) and `packages/operator/src/web-identity.ts`.

## Namespace as the boundary between tenants

A **namespace** is a named part of the cluster. Access rules, Secrets and ServiceAccounts all belong to one. Kubernetes
cannot hide a Secret from someone who can run pods in its namespace, so a namespace is the smallest unit that can keep
two teams apart.

KMO follows that. A ConfigSync reaches only its own namespace: its targets, its outputs and its folder in a shared
store. Read [Tenants](tenants.md).

## Deployment, Service and probes

A **Service** gives a set of pods one stable name and address. A **readiness probe** decides whether a pod gets requests
through the Service. A **liveness probe** decides whether a pod is restarted.

The receiver is a Deployment behind the Service `kmo-receiver.kmo-system.svc`. Its readiness probe asks `/readyz`, which
answers only when the receiver knows the cluster. Its liveness probe asks `/healthz`.

## At-least-once delivery

A sender that wants to be sure sends an event again until it gets an answer that says "done". So an event can arrive
twice, and the receiver must make that harmless. The status code is the whole contract: 200 means "forget it", and a 5xx
means "send it again".

For KMO a repeated event is harmless, because a request for a sync only says "look again", and a reconcile that finds
the same values changes nothing. Read `packages/receiver/src/handler.ts`.

## Read next

- [Architecture](architecture.md) shows how these ideas fit together in KMO.
- [Getting started](getting-started.md) lets you see them work.
