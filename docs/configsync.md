# ConfigSync

A ConfigSync tells KMO to keep one ConfigMap and one Secret in step with the env files of one service, and to roll the
workloads that use them. It is namespaced, and its short name is `csync`.

## The whole resource

Every field of the spec is optional. This example shows the defaults for a ConfigSync named `orders-api` in the
namespace `shop`.

```yaml
apiVersion: kmo.isntall.net/v1alpha1
kind: ConfigSync
metadata:
  name: orders-api
  namespace: shop
spec:
  suspend: false
  targets:
    - kind: Deployment # Deployment | StatefulSet | DaemonSet | CronJob | Rollout
      name: orders-api
  sources: # in order; a later one wins
    - storeRef:
        kind: ConfigStore # ConfigStore | ClusterConfigStore
        name: default
      common: true # false leaves out this store's common files
  output:
    configMapName: orders-api-kmo
    secretName: orders-api-kmo
  refreshInterval: 30m
```

So the shortest ConfigSync is a name and a namespace. It reads the store named `default`, writes two objects named
`orders-api-kmo`, and rolls the Deployment `orders-api`.

## The fields

**`suspend`.** When true, KMO does nothing for this ConfigSync: it reads no file, writes no object and restarts no
workload. Events from the store and the refresh timer are ignored, and a hand edit to an output object stays. Set it
back to false and KMO syncs at once, which discards hand edits.

**`targets`.** The workloads to stamp. Each has a `name` and a `kind`, which defaults to Deployment. The list defaults
to one Deployment named after the ConfigSync. A target is always in the ConfigSync's own namespace.

**`sources`.** The stores to read, in order. Each source has a `storeRef` with a `name` and a `kind`, which defaults to
ConfigStore. `common: false` leaves out that store's common files. There can be up to eight sources, and no store may be
listed twice. When the list is left out, KMO uses the ConfigStore named `default` in the namespace, and when there is
none, the ClusterConfigStore named `default`, if it allows the namespace.

**`output`.** The names of the ConfigMap and the Secret. Both default to the name of the ConfigSync followed by `-kmo`.
Both objects are always in the ConfigSync's own namespace.

**`refreshInterval`.** How often to sync when nothing asks for it, such as `30m` or `1h30m`. The default is 30 minutes
and the minimum is one minute.

A ConfigSync never names a bucket, a key or a folder. Those come from the store. The API server refuses a ConfigSync
with a field that the definition does not know.

## The merge order

Values are merged in this order, and the last one wins:

1. the common files of every source, in the order of the list;
2. the service files of every source, in the order of the list.

So a later source wins over an earlier one, and a service's own value always wins over a common value, whichever store
it is in. The files named `config.env` make the ConfigMap, and the files named `secrets.env` make the Secret.

An example with two sources, a company store and then a team store:

| File                          | Holds                           |
| ----------------------------- | ------------------------------- |
| company, common `config.env`  | `REGION=eu`, `LOG_LEVEL=info`   |
| team, common `config.env`     | `LOG_LEVEL=warn`, `TEAM=orders` |
| company, service `config.env` | `GREETING=hello`                |
| team, service `config.env`    | `GREETING=hi`, `REGION=north`   |

The ConfigMap holds `REGION=north`, `LOG_LEVEL=warn`, `TEAM=orders` and `GREETING=hi`.

A missing file is an empty file. A store that has no files for a service adds nothing.

## The two objects

KMO always writes the ConfigMap and the Secret, also when they are empty. Each carries:

- the label `app.kubernetes.io/managed-by: kmo`;
- the annotation `reloader.stakater.com/ignore: "true"`, so that Stakater Reloader, where it is installed, does not roll
  the workload a second time. Reloader still acts on the other ConfigMaps and Secrets of the workload;
- an owner reference to the ConfigSync.

The data of each object is replaced whole, so a key that someone added by hand is removed. Labels and annotations that
others added are kept.

## The status

`kubectl get csync -n shop` shows for each ConfigSync whether it is ready, whether it is suspended, the stores it read
and the time of its last sync. `kubectl describe csync orders-api -n shop` shows everything.

- `observedGeneration` is the version of the spec that the last reconcile acted on.
- `lastSyncTime` is the time of the last sync that worked.
- `configHash` is the hash that is on the workloads.
- `stores` lists the stores that were read, in order.
- `sources` lists every file that was asked for: its store, its full key, whether it exists, and the version that was
  read.
- `lastHandledSyncRequest` is the value of the sync annotation that the last reconcile handled.

Four conditions say what is true now.

| Condition      | True means                                                 | Reason when false                  |
| -------------- | ---------------------------------------------------------- | ---------------------------------- |
| `Ready`        | The last sync worked and the outputs match the store.      | One of the failures below.         |
| `SourcesFound` | At least one source file holds values.                     | `NoSources`                        |
| `TargetsWired` | Every target exists and uses the outputs that hold values. | `NotWired`                         |
| `Suspended`    | Syncing is suspended.                                      | `Active` (this is the usual state) |

Events record that something changed: a failure, a recovery (`Synced`), a new warning, `Suspended` and `Resumed`. A
failure that repeats with the same message is recorded once. A message never holds a value from a file.

## Failures

A failure stops the whole reconcile. The two objects are left as they were, `Ready` becomes false, a Warning Event is
recorded, and KMO tries again once a minute. A partial merge is never written.

| What happened                                                                          | Reason               |
| -------------------------------------------------------------------------------------- | -------------------- |
| The spec breaks a rule: a store listed twice, a refresh interval under a minute        | `InvalidSpec`        |
| A store was not found, or it does not allow the namespace                              | `StoreNotFound`      |
| The store's Secret or ServiceAccount is missing or incomplete, or AWS refused the role | `CredentialsMissing` |
| The bucket could not be reached, or it denied access                                   | `StoreUnreachable`   |
| A file has a line that is not valid                                                    | `SourceUnparsable`   |
| An object with the output name exists and does not carry KMO's label                   | `OutputTaken`        |
| A file is over 1 MiB, or the merged values of one of the two objects are               | `OutputTooLarge`     |
| Something that KMO did not expect; the operator's log says more                        | `InternalError`      |

## Warnings

A warning does not stop the reconcile. The ConfigSync stays ready, a condition becomes false and a Warning Event is
recorded.

| What happened                                              | Condition      | What KMO does                         |
| ---------------------------------------------------------- | -------------- | ------------------------------------- |
| Every file of every source is missing or empty             | `SourcesFound` | Writes two empty objects.             |
| A target does not exist                                    | `TargetsWired` | Stamps it when it appears.            |
| A Rollout target takes its pod template from a Deployment  | `TargetsWired` | Nothing; name the Deployment instead. |
| An output object holds values and a target does not use it | `TargetsWired` | Stamps the target all the same.       |

A target uses an object when one of its containers refers to it through `envFrom`, a single `env` entry or a volume. An
empty object that a target does not use is not a warning.

## What starts a sync

- The ConfigSync is created, or its spec changes.
- The receiver reports a changed file that the ConfigSync reads.
- One of its two objects is edited or deleted.
- One of its workloads is created, or its spec changes.
- A store that it uses is created, changed or deleted.
- Its refresh interval has passed.

Also, a ConfigSync that is not ready is tried again once a minute.

Every one of these sets the annotation `kmo.isntall.net/sync-requested-at` on the ConfigSync. Only its change matters,
not its value. To ask for a sync by hand, set it yourself:

```bash
kubectl annotate csync orders-api -n shop kmo.isntall.net/sync-requested-at="$(date -u +%FT%T.%3NZ)" --overwrite
```

## One ConfigSync for each workload

Two ConfigSyncs that claim the same workload, or write an object of the same name, would undo each other's work. The API
server asks the operator before it stores a ConfigSync. The operator refuses one that shares a target or an output name
with another ConfigSync in the namespace, and `kubectl apply` shows a message such as
`Deployment "app" is already a target of ConfigSync "app"`.

- A suspended ConfigSync keeps its claims.
- One ConfigSync may list several targets, so it can still serve several workloads.

## Deleting a ConfigSync

The two objects belong to the ConfigSync, so Kubernetes deletes them with it. Running pods are not affected. New pods of
the workload cannot start until the workload stops referring to the objects, or the ConfigSync is created again.

## How each kind of workload rolls

- A Deployment, a StatefulSet and a DaemonSet replace their pods when the hash changes. One that uses the `OnDelete`
  strategy is stamped, and changes only as its pods are deleted.
- A Rollout starts a new rollout and follows its own canary or blue-green steps.
- A CronJob is stamped, so each run records the config that it used. A Job that is running is never touched.

## The file format

Files use the dotenv format.

- One `KEY=value` on each line. Blank lines and lines that start with `#` are ignored.
- A key is a valid name of an environment variable: letters, digits and `_`, not starting with a digit.
- A value may be in single or double quotes. Without quotes, a `#` after a space starts a comment.
- Nothing is expanded: `$OTHER` stays as it is written.
- A value cannot continue on the next line. Write a value with line breaks, such as a certificate, on one line in double
  quotes with `\n` for each break.
- When a key is in a file twice, the last one wins.

A line that breaks these rules makes the whole file unparsable, and the message names the file and the line.

## Read next

- [Stores](stores.md) for where the files are.
- [Troubleshooting](troubleshooting.md) for what to do when a ConfigSync is not ready.
