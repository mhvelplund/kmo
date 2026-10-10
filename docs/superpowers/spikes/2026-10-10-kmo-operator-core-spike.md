# KMO operator core: spike findings

Date: 2026-10-10. Spec: [KMO operator core design](../specs/2026-10-10-kmo-operator-core-design.md).

## Check 1: RustFS notifications and versioning on k3d

Verdict: PASS.

Tested with `rustfs/rustfs:1.0.1` on k3s v1.37.1, with a small echo server standing in for the receiver.

| Question                                               | Answer                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Webhook delivers on upload and on delete               | Yes. One request per event, within a second or two.                                                                                                                                                                      |
| Request method, path and `Authorization` value         | `POST /events/rustfs`, the path of the configured endpoint, with `Authorization: Bearer spike-token`.                                                                                                                    |
| Health-check requests seen                             | One `HEAD /` when RustFS starts, without an `Authorization` header. None after that in two minutes.                                                                                                                      |
| Body shape (`Records`, bucket name, object key)        | A JSON object with a `Records` list of one entry in the S3 format: `eventName`, `s3.bucket.name`, `s3.object.key`, `s3.object.versionId`. It also has two top-level fields that S3 does not send, `EventName` and `Key`. |
| How a key with a slash, a space and a plus is encoded  | Form-encoded in `Records[0].s3.object.key`: a slash is `%2F`, a space is `+` and a plus is `%2B`. `shop/orders-api/with space+plus.env` arrives as `shop%2Forders-api%2Fwith+space%2Bplus.env`.                          |
| Versioning: distinct version IDs, old version readable | Yes. Each upload gets its own UUID version ID, the newest is marked `IsLatest`, a delete adds a delete marker, and an older version is readable by its ID.                                                               |
| `get-object` returns a version ID                      | Yes, with and without `--version-id`.                                                                                                                                                                                    |
| RustFS starts with the target down                     | Yes. It becomes ready and the seed Job completes, both with the target scaled to zero and with a target whose Service does not exist.                                                                                    |
| Events queued while the target was down are delivered  | Yes. All twelve seed uploads arrived within a minute of the target coming back, none twice.                                                                                                                              |

Notes:

- The top-level `Key` is the bucket name and the unencoded object key joined by a slash, for example
  `kmo-config/shop/orders-api/config.env`. The normalizer reads `Records`, as it would for S3, and ignores it.
- On a versioned bucket a delete arrives as `s3:ObjectRemoved:DeleteMarkerCreated`, not `s3:ObjectRemoved:Delete`. The
  normalizer must match on the `s3:ObjectRemoved:` prefix.
- `awsRegion` is an empty string and `eventSource` is `rustfs:s3`.
- The event repeats the request headers of the upload under `requestParameters`. RustFS replaces the `authorization` and
  `x-amz-content-sha256` values with `***redacted***` itself.
- The health check carries no token, so the receiver must answer `HEAD /` without authentication.
- The local store keeps its data in an `emptyDir`, so restarting RustFS loses every version. The seed Job puts the files
  back, as new first versions.
- The captured upload and delete events are `packages/core/test/fixtures/rustfs-put.json` and `rustfs-delete.json`.
- The notification settings are left in place, pointing at the receiver's future address
  `http://kmo-receiver.kmo-system.svc:8080/events/rustfs` with the token `kmo-local-token`. Until the receiver exists
  the events queue inside RustFS and are lost when its pod restarts.

## Check 2: Pepr capabilities

Verdict: PASS, except that the module does not survive a watched kind whose definition is missing. That one answer
changed the design; see the first items under the consequences below.

Tested with Pepr 2.0.3 and a toy module that reconciles and validates a `Widget` resource, watches ConfigMaps,
Deployments, Argo Rollouts and a kind called `Missing` that was not installed, and runs a schedule.

| Question                                                 | Answer                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconcile runs on create and on spec change              | Yes. Create arrives with phase `ADDED`, a spec change with `MODIFIED`.                                                                                                                                                                                                                                            |
| Reconcile runs on an annotation-only change              | Yes, with phase `MODIFIED`.                                                                                                                                                                                                                                                                                       |
| Reconcile runs on a status-only change                   | Yes, with phase `MODIFIED`. A patch to the status subresource is not told apart from any other change.                                                                                                                                                                                                            |
| Validate can deny with a message                         | Yes. kubectl prints `admission webhook "pepr-kmo-spike.pepr.dev" denied the request: forbidden widgets are rejected`.                                                                                                                                                                                             |
| Validate can look up other resources before deciding     | Yes. A second widget with a claimed message is refused with `denied the request: message already claimed by widget one`.                                                                                                                                                                                          |
| Watches fire for ConfigMap, Deployment and Rollout       | Yes, all three.                                                                                                                                                                                                                                                                                                   |
| Module runs while a watched kind's definition is missing | No. The watcher starts and serves its other watches for about 35 seconds, then exits with `WatchEvent GiveUp Error: The watch has failed to start after several attempts` (`Retry limit (5) exceeded, giving up`). Kubernetes restarts it and it ends in `CrashLoopBackOff`. The admission pods are not affected. |
| A kind installed later is picked up                      | Only by a restart. Once the definition existed, the next crash-loop restart started cleanly and the watch delivered the waiting resource, about 90 seconds after it was created. A healthy watcher was not tested, since it cannot be healthy while the kind is missing.                                          |
| Schedule runs every minute                               | Yes, once the watcher stays up. Three ticks, 62 and 63 seconds apart.                                                                                                                                                                                                                                             |
| Corrections needed to the spike code for Pepr 2.0.3      | None. The capability compiled and ran as written.                                                                                                                                                                                                                                                                 |

Notes:

- Pepr deploys two Deployments into `pepr-system`: `pepr-kmo-spike` (admission, two replicas) and
  `pepr-kmo-spike-watcher` (watches, reconciles and schedules, one replica).
- When the watcher starts, every watch delivers the resources that already exist. Each restart therefore reconciles
  every resource once.
- The schedule runs in the watcher, so it did not tick at all while the watcher was crash-looping.
- The generated module asks for admin RBAC and Pepr warns that this is for demos only. A scoped mode exists
  (`pepr build --rbac-mode scoped`) and was not tried.
- The controller image runs Node 26.9.0, whatever Node the repository pins.

## Check 3: Pepr inside the npm workspace

Verdict: PASS, after one correction to the root `package.json`.

| Question                                             | Answer                                                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Root `npm install` succeeds with the module present  | Yes. `pepr` is hoisted to `node_modules/pepr` at the root; the module's own `node_modules` holds only a few type and lint packages. |
| `pepr build` bundles a source-only workspace package | Yes, once the correction below is made. The build output lists `../spike-lib/src/index.ts` among the bundled files.                 |
| Deployed module runs the imported code               | Yes. The first reconcile logged `HELLO`, the widget's message passed through the library's function.                                |

Notes:

- The correction: the root `overrides` pins `js-yaml` to 5.4.3 for every package. `pepr build` then fails at once with
  `The requested module 'js-yaml' does not provide an export named 'default'`, because `@kubernetes/client-node` needs
  version 4. Scoping the override to `markdownlint-cli` fixed it, but only after the lockfile was regenerated; a plain
  `npm install` kept the old resolution.
- With Pepr installed, `npm audit` reports five advisories (three high, in `node-forge` and in the `undici` that
  `kubernetes-fluent-client` brings). The repository currently reports none.
- `pepr init` writes an `overrides` block into the module's own `package.json`. npm ignores overrides outside the
  workspace root, so any that matter have to move there.
- The generated module has its own `tsconfig.json` with `strict` off, its own ESLint and Prettier configs and
  `@types/node` 26. They will need reconciling with the root configs.
- Pepr warns that the module's `package.json` has no `type` field and builds it as CommonJS. The build still bundled the
  workspace library, which is an ES module.
- `--skip-post-init` worked: no nested Git repository was created.

## Recorded for later

- Installing Pepr outside `pepr-system`: not possible with what Pepr generates. The namespace is written literally into
  the manifest and into every Helm chart template, the chart's values have no setting for it, and `pepr build` has no
  option for it.
- Several copies of a module in one cluster: every generated resource is named after the module's UUID
  (`pepr-kmo-spike`, `pepr-kmo-spike-watcher`, the webhook `pepr-kmo-spike.pepr.dev`), so modules with different UUIDs
  can share a cluster and all live in `pepr-system`. Two copies with the same UUID would collide. This is read from the
  generated names; the Pepr documentation was not consulted.

## Consequences for the operator plan

- **Rollout targets: decided, not yet tested.** A static watch on Argo Rollouts crash-loops the operator on any cluster
  without Argo Rollouts, and takes the refresh timer down with it. The decision, now in the spec under Configuration, is
  a shim that declares the Rollout watch as usual, removes it from Pepr's list when the operator runs, and starts it by
  hand only when the kind is installed. The setting `KMO_GUARD_ROLLOUT_WATCH` turns the shim off and defaults to on.
- **Why the shim is possible.** Read from the Pepr 2.0.3 source: a declared watch is only a plain object on the
  capability's list of bindings, and nothing starts until the watcher is ready. The crash comes from Pepr's handler for
  the client's give-up event, which throws; the client itself only reports the event.
- **What the operator plan must prove first.** None of this was run. Before anything depends on it, show on the cluster
  that the watcher stays up and the schedule ticks without the kind, that the watch starts when the kind is installed
  and stops when it is removed, and that turning the setting off gives the plain behavior.
- **What the shim costs.** It copies the few lines Pepr uses to start a watch, because that function is not exported,
  and it depends on the shape of Pepr's bindings. It needs a test that fails loudly when a Pepr upgrade changes either,
  and that watch reports no Pepr metrics.
- **Guard against status-triggered reconciles.** The operator's own status updates will trigger a reconcile. The content
  hash already makes a repeat reconcile harmless, but it still costs four fetches from the store, so the reconcile
  should return early when neither the spec nor the sync annotation has changed, for example by comparing
  `metadata.generation` with an observed generation in status.
- **Expect a reconcile of everything on each start.** That gives a free catch-up after downtime and must be safe at the
  size of a real cluster.
- **Scope the `js-yaml` override** to `markdownlint-cli` and regenerate the lockfile when the operator package is added,
  and decide what to do about the advisories Pepr brings.
- **The operator runs in `pepr-system`**, not a namespace of our choosing. The receiver can still live in `kmo-system`.
- **Use scoped RBAC** and write the rules by hand; the default grants cluster-wide admin.
