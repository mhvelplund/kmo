# @kmo/certgen

**Certgen** creates and renews the TLS key of the operator's admission webhook. It also creates the webhook address: the
URL path where the API server calls the webhook, which contains a random part.

The [KMO Helm chart](../../charts/kmo) runs **certgen** in two Jobs and a CronJob inside the cluster, which are defined
in [`templates/certgen.yaml`](../../charts/kmo/templates/certgen.yaml). Because of this, the published chart contains no
private key and no address, and each installation gets its own.

**Certgen** has three commands:

- `create` creates the Secret with the key and the Secret with the webhook address, if they do not exist. A Job runs it
  before each install and upgrade.
- `patch` writes the certificate authority and the address into the webhook configuration. A Job runs it after each
  install and upgrade.
- `renew` checks how long the certificate is still valid. If it expires within `KMO_RENEW_BEFORE_DAYS`, it creates a new
  key and restarts the webhook pods one at a time. A CronJob runs it on a schedule.

You can run each command again safely: if there is nothing to do, it changes nothing. The log never contains the key or
the address.

- Source: `src/keys.ts` creates keys without calling the cluster, `src/commands.ts` contains `create` and `patch`,
  `src/renew.ts` contains `renew`, and `src/api.ts` calls the Kubernetes API server.
- Settings: `KMO_CERTIFICATE_DAYS` (default 90) and `KMO_RENEW_BEFORE_DAYS` (default 30). The chart sets them from the
  values `certgen.certificateDays` and `certgen.renewBeforeDays`.
- Build: `npm run build --workspace @kmo/certgen` bundles the code into `dist/certgen.cjs`, and the `Dockerfile` puts
  that file into an image. `mise run kmo:deploy` does both for the local cluster.

[Security](../../docs/security.md) explains how the key is created and renewed.  
[Installing](../../docs/installing.md) explains how to install the KMO chart and lists its `certgen.*` values.
