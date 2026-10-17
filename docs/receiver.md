# The receiver

The receiver is what makes a changed file arrive in seconds. It is a small HTTP service. A store sends it an event for
each changed file, and it asks for a sync of every ConfigSync that reads that file.

## What it does, and what it cannot do

For each event the receiver takes the bucket and the key, finds every ConfigSync with a source that reads that file, and
sets the annotation `kmo.isntall.net/sync-requested-at` on each. A created file and a deleted file are handled the same
way. The operator does the rest.

The receiver never reads the store. It has three permissions in the cluster and no more:

- read and patch ConfigSyncs;
- read ConfigStores;
- read ClusterConfigStores.

It cannot read a Secret, so it never sees the credentials of a store. The most that a caller can make it do is ask for a
sync, and a sync that finds the same values restarts nothing.

## Paths and answers

| Request                    | Token | What it is for                                                         |
| -------------------------- | ----- | ---------------------------------------------------------------------- |
| `POST /events/rustfs`      | yes   | An S3 notification: a `Records` list with URL-encoded keys.            |
| `POST /events/eventbridge` | yes   | An EventBridge event, with the bucket and the key under `detail`.      |
| `HEAD /`                   | no    | RustFS checks its target this way when it starts.                      |
| `GET /healthz`             | no    | Says that the process runs. The liveness probe uses it.                |
| `GET /readyz`              | no    | Says that the receiver knows the cluster. The readiness probe uses it. |

| Answer | Meaning                                                               | What the sender should do       |
| ------ | --------------------------------------------------------------------- | ------------------------------- |
| 200    | Every affected ConfigSync was asked to sync. Also when there is none. | Forget the event.               |
| 400    | The body is not JSON, or it is not an event.                          | Not send it again; it is wrong. |
| 401    | The token is missing or wrong.                                        | Correct the token.              |
| 404    | The path is not known.                                                | Correct the address.            |
| 405    | An event path was not called with `POST`.                             | Correct the method.             |
| 413    | The body is larger than 64 KiB.                                       | Not send it again.              |
| 500    | A request for a sync could not be written.                            | Send the event again.           |
| 503    | The receiver has just started and does not know the cluster yet.      | Send the event again.           |

The answer 503 exists so that no event is lost. For a moment after it starts, the receiver's lists are empty. An event
that arrived then would match nothing, and a 200 would tell the sender to forget it.

An event may arrive more than once. That is harmless, because a request for a sync only says "look again".

## The token

Events must carry the header `Authorization: Bearer <token>`. The token is the key `token` of the Secret
`kmo-receiver-token` in the receiver's namespace, and the receiver reads it when it starts. After you change the token,
restart the receiver.

One token serves all tenants. That is enough, because the only thing a caller can do with it is ask for a sync.

## How it matches an event

- The receiver keeps a watched list of every ConfigSync and every store in memory, so it answers an event without a read
  from the API server. A new ConfigSync or a changed store takes effect without a restart.
- It works out the files of each ConfigSync with the same code as the operator, so both always agree.
- It matches on the bucket name and the key only.
- It skips a suspended ConfigSync. A resume syncs at once, so nothing is missed.
- An EventBridge event from a source other than `aws.s3` is answered with 200 and ignored.
  [Planned work](planned.md#other-kinds-of-store) gives the reason.
- One event with several records for the same ConfigSync asks for one sync.

## Pointing a store at it

The local RustFS is the worked example. `dev/store/rustfs.yaml` turns on notifications with four settings: the webhook
is enabled, its endpoint is `http://kmo-receiver.kmo-system.svc:8080/events/rustfs`, its token is the receiver's token,
and the receiver's address is allowed as an outbound target. The seed Job then tells each bucket to send its
object-created and object-removed events to that webhook.

For S3 in AWS, the events come through EventBridge to `/events/eventbridge`. [The demo on AWS](aws-demo.md) makes the
rule, the connection (the token as `Authorization: Bearer`) and the API that carries them to the receiver.

## Running it

The receiver keeps no state of its own, so it can run as several pods. Its log is one line of JSON for each message.
`mise run receiver:logs` shows it. The lines to look for:

- `KMO receiver is ready` when it has started, with the number of ConfigSyncs and stores that it knows;
- `KMO receiver handled an event` for each event, with the files, the ConfigSyncs that were asked to sync, and how many
  requests failed;
- `KMO receiver lost a watch and starts it again` when the connection to the API server broke.

A log line never holds the token or a value from a file.

The receiver keeps an idle connection open for 400 s. This is longer than a client in front of it keeps one. So the
client never sends on a connection that the receiver has closed. A load balancer that passes TCP through must keep an
idle connection longer still. The NLB of the demo keeps it for 600 s.

## Memory

The receiver keeps every ConfigSync and every store of the cluster in memory. That is what lets it answer an event
without a read from the API server, and it means that its memory grows with the number of those resources.

- On the local cluster, with seven ConfigSyncs and three stores, a pod uses about 35Mi. The chart requests 64Mi and
  limits a pod to 128Mi by default; the value `receiver.resources` changes that.
- A ConfigSync takes a few KB in the list. A rough estimate for 5,000 of them is 50 to 100 MB on top of the base. This
  is an estimate and was not measured.
- A pod that passes its limit is killed and started again. While it starts, it answers 503, the store sends its events
  again, and nothing is lost. A limit that is too low for the cluster shows as a pod that restarts again and again with
  the reason `OOMKilled`, and changed files then arrive only by the refresh interval.
- So set the limit from what you see: read the use with `kubectl top pod -n kmo-system` and give it room to grow.
- More pods give more throughput and keep the receiver available when one pod stops. They do not lower the memory of
  each pod.

If the memory of one pod ever becomes a problem, the first step is to keep less of each resource in the list: the
receiver needs only the name, the namespace, the uid, the annotations and the spec. Dividing the ConfigSyncs between
pods is possible too, and is not built.

## When something is down

- **The receiver is down.** RustFS keeps the events in a queue and delivers them when the receiver is back. This was
  seen on the local cluster: the receiver took the queued events in its first seconds.
- **The operator's admission pods are down.** No ConfigSync can be changed then, so the receiver cannot set the
  annotation. It answers 500. On the local cluster, RustFS sent the event again every five seconds until the answer was
  200, and the change arrived as soon as the admission pods were back.
- **An event is lost all the same.** The refresh interval of each ConfigSync picks the change up, after 30 minutes by
  default.

## Read next

- [Troubleshooting](troubleshooting.md) for a changed file that does nothing.
- [Known limits](limits.md) for what the receiver does not do.
