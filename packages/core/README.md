# @kmo/core

**Core** contains the logic of KMO that does not need a cluster. It makes no Kubernetes or network calls, so unit tests
can check each rule with plain data.

**Core** parses dotenv files and merges them in the order of the sources. It calculates the hash of the values and
builds the data of the ConfigMap and the Secret. It also:

- finds the store that a ConfigSync uses and the file paths that it reads,
- finds the ConfigSyncs that a changed file affects,
- detects two ConfigSyncs that claim the same target or output name,
- decides when a ConfigSync needs a sync,
- builds the status of ConfigSyncs and stores, and decides which Events to record.

The operator and the receiver both use **core**. Because they find stores and file paths with the same code, they always
agree.

**Core** has no build step. Other packages import its TypeScript files directly through `src/index.ts`.

- Source: `src/`, with one file for each topic.
- Tests: `test/`. Run them with `mise run test`.

The rules that core implements are described in [ConfigSync](../../docs/configsync.md) and
[Stores](../../docs/stores.md).
