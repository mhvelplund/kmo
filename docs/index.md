# KMO documentation

KMO keeps the configuration of Kubernetes workloads in step with env files held in an object store. A change to a file
updates the matching ConfigMap or Secret within seconds and rolls the workloads that use it.

It has two programs. The receiver takes the change events of the store and asks for a sync. The operator reads the
files, writes one ConfigMap and one Secret for each service, and puts a hash of their values on the workload, so that
Kubernetes replaces the pods when a value changed and leaves them alone when none did.

KMO runs end to end on a local cluster today. It has a Helm chart, which is not yet proven in a real cluster.

## Pages

In reading order:

- [Getting started](getting-started.md) takes a fresh clone to a running local environment and a demo.
- [Architecture](architecture.md) says what each part does and why the parts are split as they are.
- [Concepts](concepts.md) explains each Kubernetes idea that KMO uses.
- [ConfigSync](configsync.md) is the reference of the resource that opts a workload in.
- [Stores](stores.md) is the reference of the two kinds of store.
- [The receiver](receiver.md) describes the HTTP service, its answers and its token.
- [Tenants](tenants.md) is the guide to giving each team its own files.
- [Stores in AWS without stored keys](aws-identity.md) explains how a store reaches a bucket as a ServiceAccount.
- [Security](security.md) says who can change the code that KMO runs, and how to limit that to one group.
- [Troubleshooting](troubleshooting.md) says what to do when something does not work.
- [Known limits](limits.md) says what KMO does not do.
- [Planned work](planned.md) says what is planned and not built, and what is still to prove.
- [Installing](installing.md) says how to install KMO with Helm or ArgoCD.

For people who work on KMO itself:

- The [design](design.md) gives the purpose, the scope and every decision with its reason.
- [Commands](commands.md) lists the Mise tasks: the checks, the local cluster and the end-to-end suites.
- [Releases](releases.md) says how a version is made and published.
- [Upgrading Pepr](upgrading-pepr.md) is the procedure for a new Pepr version, and why it is not a one-line change.
- [Known advisories](advisories.md) lists the security advisories that cannot be cleared, and why.
