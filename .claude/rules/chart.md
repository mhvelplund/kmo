---
paths:
  - "charts/**"
  - "packages/certgen/**"
---

# Work on the chart and on `packages/certgen`

The chart `kmo` installs the operator, the receiver and the three definitions. `docs/installing.md` is what a person
reads, and `docs/security.md` says how the key of the webhook is made and renewed.

## The two halves of the chart

- `charts/kmo/` holds the parts that are written by hand: `Chart.yaml`, `values.yaml` and the templates of the receiver,
  the Jobs, the guard and the namespace `kmo-system`.
- `charts/build.sh` makes the full chart in `dist/chart/kmo`. It runs `pepr build`, copies the chart that Pepr
  generates, removes what is tied to one build, wraps each file of `crds/` in a template, and adds the parts of
  `charts/kmo/`. Never edit `dist/chart`.
- The build stops when a template of Pepr that it changes is missing or has another form, and when the result holds a
  private key or the address. Keep these checks: they are the guard for a Pepr upgrade.
- The files in `charts/kmo/templates/` are not YAML before Helm renders them. Prettier and the YAML hook leave them
  alone. `helm lint` in the build checks them.
- Only Commitizen changes the version in `Chart.yaml` and in `charts/argocd-application.yaml`.

## Rules

- The built chart holds no private key, no address and no token.
- The chart is installed into `pepr-system`, and `guard.yaml` refuses another namespace.
- The definitions and the namespace `kmo-system` carry the keep annotation. An uninstall must not delete a ConfigSync, a
  store or a credential.
- The two Jobs of an installation are hooks, with their rights, so nothing of them stays. The CronJob's rights stay:
  keep them to the one Secret, the one webhook configuration, and list and delete on pods. Never give it a right on a
  Deployment.
- A release holds about 1 MB, and the operator's code takes most of it. Do not put a large file in a ConfigMap of the
  chart.

## `packages/certgen`

- `src/keys.ts` makes a key and an address, with no cluster call. `src/commands.ts` holds `create` and `patch`,
  `src/renew.ts` holds `renew`, and `src/api.ts` is the real calls to the API server.
- Each command changes nothing when it runs again.
- A renewal writes the old and the new authority into the webhook configuration before it replaces the Secret, and
  restarts the pods one at a time.
- No log line holds the key or the address. A test checks this.

## When the work is done

Run `mise run test:e2e -- chart argocd`, and the smoke suite. `docs/commands.md` has the other tasks.
