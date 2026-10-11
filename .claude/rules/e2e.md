---
paths:
  - "test/e2e/**"
---

# Work on the end-to-end suites

The suites are in Bash and run against the local cluster.

- `lib.sh` is the helpers that every suite sources. `run.sh` sets the environment up once and runs the suites.
- The suites are `smoke.sh`, `events.sh`, `kinds.sh`, `failures.sh`, `tenants.sh` and `rollout-guard.sh`.
- Each suite works in a namespace of its own and removes it at the end.
- `aws/` holds the scripts for the proof of stores without stored keys. They create and delete AWS resources, so they
  need a go-ahead in the session each time.
- Add a check to the suite that fits for each new behavior that can be seen on the cluster.

## Timing of RustFS

RustFS does not deliver every event at once: one can arrive about five seconds after its upload. After an answer of 500
it sends the event again every five seconds, and it keeps events in a queue while the receiver is down. A check that
counts reconciles must first wait until the events of its own uploads are past.

## Running them

`mise run test:e2e` runs all six, in about twelve minutes. `mise run test:e2e -- smoke` runs one suite.
`docs/commands.md` has the details.
