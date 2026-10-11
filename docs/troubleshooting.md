# Troubleshooting

Each entry says what you see, why, and what to do. Three commands answer most questions:

- `kubectl describe csync <name> -n <namespace>` shows the conditions and the Events of a ConfigSync;
- `mise run receiver:logs` shows what the receiver did with each event;
- `mise run operator:logs` shows what the operator did.

## A pod stays in `CreateContainerConfigError`

The pod refers to a ConfigMap or a Secret that does not exist yet. KMO writes them, so either the operator is not
installed, there is no ConfigSync for the workload, or the ConfigSync is not ready. Look at the ConfigSync. The pod
starts by itself when the objects exist.

## A changed file does nothing

Follow the path of the change.

1. The receiver's log. A line `KMO receiver handled an event` should name the file. When there is no line, the store did
   not send the event: check its notification settings and the token. When the line lists no ConfigSync under
   `requested`, no ConfigSync reads that file: compare the key with `status.sources` of the ConfigSync.
2. The ConfigSync. It may be suspended, and then the receiver skips it. It may be not ready, and then its message says
   why.
3. The operator's log, for the line `KMO reconciled` with the name of the ConfigSync.

## The ConfigMap changed and no pod restarted

- The effective values are the same. A changed comment, or a common value that the service sets itself, changes no
  value, so the hash is the same. This is intended.
- The workload does not use the object. The condition `TargetsWired` is false and its message names the object.
- The kind does not roll by itself. A StatefulSet or DaemonSet with the `OnDelete` strategy changes only as its pods are
  deleted. A CronJob uses the new values at its next run. A Rollout follows its own steps, and may pause.

## `Ready` is false

The reason and the message of the condition say why.

- `InvalidSpec`: the spec breaks a rule. The message names it, for example
  `store ClusterConfigStore/default is listed more than once`. Correct the spec.
- `StoreNotFound`: a store does not exist, or it does not allow the namespace. For example
  `ClusterConfigStore "partners" does not allow namespace "shop"`. Create the store, name another, or ask the
  administrator to add the namespace.
- `CredentialsMissing`: the identity of the store cannot be used. For example
  `Secret payments/store-keys was not found`, or a ServiceAccount that has no role annotation, or a role that AWS
  refused. Create or correct the Secret or the ServiceAccount.
- `StoreUnreachable`: the bucket did not answer, or it denied access. The message names the bucket and the error code.
  Check the bucket name, the endpoint, the addressing style and the permissions of the keys.
- `SourceUnparsable`: a file has a line that is not valid. The message names the file and the line, never the value.
  Correct the file; the sync follows by itself.
- `OutputTaken`: an object with the output name exists and KMO did not make it. KMO never takes it over. Delete or
  rename that object, or give the ConfigSync other output names.
- `OutputTooLarge`: a file is larger than 1 MiB, or the merged values of the ConfigMap or of the Secret are. Kubernetes
  stores no more than 1 MiB in one object, and KMO does not split the values over several. The message names the file or
  the object, and the size. Make the file smaller. A large blob, such as a data file, does not belong in an env file:
  mount it as a file in another way.
- `InternalError`: something that KMO did not expect. Read the operator's log.

While a ConfigSync is not ready, its two objects keep their last good values, and KMO tries again once a minute.

## `kubectl apply` of a ConfigSync is refused

- The message names another ConfigSync: the two share a target or an output name. Use one ConfigSync for the workload,
  or give them different targets and output names.
- The message says `unknown field`: the spec has a field that does not exist. A ConfigSync cannot name a key.
- The message is about a webhook that could not be called: the admission pods are down. See the next entry.

## Nothing can create or change a ConfigSync

The Deployment `pepr-kmo` in `pepr-system` is down. The API server asks it about every ConfigSync, and its failure
policy is `Fail`: no answer means no. Look at `kubectl get pods -n pepr-system`. While it is down, the operator and the
receiver cannot ask for a sync either. Nothing is lost: the requests are made again.

## The operator's watcher restarts in a loop

Pepr's watcher stops when it watches a kind that is not installed. The usual cause is that a definition from `crds/` is
missing: apply them. KMO guards its watch on Argo Rollouts against this, with the setting `KMO_GUARD_ROLLOUT_WATCH`,
which is on by default. When it is set to `false`, Argo Rollouts must be installed before the operator starts.
[Upgrading Pepr](upgrading-pepr.md) says more about the guard.

## The receiver answers 401, 503 or 500

- 401: the token of the sender is not the key `token` of the Secret `kmo-receiver-token`. After a change of the Secret,
  restart the receiver.
- 503: the receiver has just started. It lasts a moment. When it stays, the receiver cannot list ConfigSyncs or stores:
  check that the definitions are installed and that its ClusterRole is bound.
- 500: a request for a sync was refused. The usual cause is that the admission pods are down.

## A store is not ready

The message of the store's `Ready` condition says which part failed.

- The bucket: its name, the endpoint, the region or the addressing style is wrong, or the keys may not list it.
- The Secret: it does not exist, or it lacks the key `accessKeyId` or `secretAccessKey`.
- The ServiceAccount: it does not exist, it has no annotation `eks.amazonaws.com/role-arn`, or AWS refused the role
  because its trust policy does not name this ServiceAccount.

## Many workloads rolled at once

A common file changed. Every ConfigSync that reads it is synced, and every workload whose effective values changed is
rolled, all at the same time. KMO does not spread these restarts out. Change common files with care.

## Read next

- [ConfigSync](configsync.md) for the meaning of every condition.
- [Known limits](limits.md) for behavior that is known and accepted.
