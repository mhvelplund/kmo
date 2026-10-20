## v0.3.1 (2026-10-20)

### Fix

- bump infra provider, module and chart pins

## v0.3.0 (2026-10-17)

### Feat

- check the demo on AWS end to end with mise run test:aws
- carry the events of the bucket to the receiver through API Gateway
- run KMO in EKS with a store that has no stored key
- install ArgoCD, the load balancer controller and External Secrets on the demo cluster
- make the network and the EKS cluster of the demo with Terragrunt

### Fix

- let ArgoCD read an SSH clone, let aws:down finish after a failed aws:up, and keep the NLB's idle timeout above the receiver's
- keep idle connections to the receiver open longer than the load balancers in front of it
- spread the receiver's NLB across zones, so a replaced pod in the other zone gets events at once
- make the checks of test:aws prove what happened in this run
- let a root sync that waits on old values time out and retry
- install the root Application after ArgoCD, and limit the controller to the demo's target groups
- name the target groups the load balancer controller may change

## v0.2.0 (2026-10-12)

### Feat

- make versions with Commitizen and publish the images and the chart
- prove the chart through the life of a release and under ArgoCD
- add the Helm chart and install the local environment with it
- add the program that makes and renews the webhook key
- mirror the docs to the wiki of the repository

## v0.1.0 (2026-10-11)

### Feat

- add the receiver, the end-to-end suites and the documentation
- report, stay in step, guard ConfigSyncs and serve tenants
- add the operator that syncs and rolls ConfigSync targets
- add core package with parsing, rendering, stores and events

### Fix

- replace markdownlint-cli2 and pin patched packages to clear npm audit
