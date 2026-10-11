# KMO documentation

KMO keeps the configuration of Kubernetes workloads in step with env files held in an object store. A change to a file
updates the matching ConfigMap or Secret and rolls the workloads that use it.

The project is being built in steps. Today it has a local environment, the shared logic and an operator that syncs,
rolls the workloads, reports, and keeps tenants apart. The receiver is still to come, so a changed file is picked up by
the refresh interval and not at once.

## Pages

- [Getting started](getting-started.md) walks through the local environment.
- The [design](superpowers/specs/2026-10-10-kmo-operator-core-design.md) describes what is being built and why.
- [Stores in AWS without stored keys](aws-identity.md) explains how a store reaches a bucket as a ServiceAccount.
- [Upgrading Pepr](upgrading-pepr.md) is the procedure for a new Pepr version, and why it is not a one-line change.
- [Known advisories](advisories.md) lists the security advisories that cannot be cleared, and why.
