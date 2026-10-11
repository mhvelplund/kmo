# Upgrading Pepr

> [!CAUTION]  
> KMO watches Argo Rollouts through a small shim, so that the operator also runs on clusters without Argo Rollouts. The
> shim uses parts of Pepr that are not public.
>
> Pepr can change them in any release, so **an upgrade of Pepr might require the shim to be rewritten**. For that reason
> Pepr and its Kubernetes client are pinned to exact versions, and an upgrade is never a change of one number.

## Procedure

1. Change the versions of `pepr` and `kubernetes-fluent-client` in `packages/operator/package.json`. The client version
   must be the one that the new Pepr uses.
2. Run `mise run test`. The test "the versions the Rollout shim was verified against" fails. That is expected: it is the
   reminder to do the next steps.
3. Look at the other tests in `packages/operator/test/pepr-contract.test.ts`. Each states one thing the shim relies on.
   If one fails, the shim must be changed before you continue.
4. Run `mise run test:e2e -- rollout-guard`. The suite installs the operator, then removes and reinstalls Argo Rollouts
   on the local cluster, and takes about seven minutes. `mise run check:rollout-guard` is the same thing.
5. Only when the contract tests and all four cluster checks pass, change the versions in the `VERIFIED` constant of the
   contract test file.

## When a check fails

Set `KMO_GUARD_ROLLOUT_WATCH` to `false` to run without the shim. Argo Rollouts must then be installed before the
operator starts. Then read `packages/operator/src/guarded-kind.ts` next to the new Pepr source: the file names the Pepr
code it copies. Rewrite the shim, add a contract test for what it now relies on, and run the procedure again.
