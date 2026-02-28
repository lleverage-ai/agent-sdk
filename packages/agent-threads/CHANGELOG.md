# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-alpha.2] - 2026-02-28

### Added

- Branch-aware transcript selection via `GetTranscriptOptions.branch`: `"active"`, `"all"`, and explicit `{ selections }`
- `ILedgerStore.getThreadTree(threadId)` metadata for branch-aware UIs (nodes, fork points, and active child resolution)
- Dedicated `branch-resolution` unit coverage for orphan chains, missing run statuses, selection validation, fork tie-breaking, and corruption/cycle safeguards

### Changed

- Committed fork finalization in both ledger stores is now non-destructive: superseded run messages are preserved for `"all"` transcript views
- `RunManager.finalizeRun()` now forwards `forkFromMessageId` into accumulation so first forked outputs are parent-linked correctly
- `ForkPoint.children` now encodes the min-two invariant at the type level via `readonly [string, string, ...string[]]`

### Fixed

- Branch resolution now throws for missing run-status entries instead of defaulting to `"committed"`
- Branch selection parsing now rejects non-string selection values consistently
- SQLite `getTranscript()` / `getThreadTree()` now execute thread-message + run-status reads in a read transaction for consistent snapshots

## [0.1.0-alpha.1] - 2026-02-28

### Added

- Initial release — merges `@lleverage-ai/agent-stream` and `@lleverage-ai/agent-ledger` into a single package
- Stream layer: event stores (`InMemoryEventStore`, `SQLiteEventStore`), `Projector`, WebSocket server/client, protocol codec, `EventKindRegistry`
- Ledger layer: canonical message schema, `RunManager`, accumulator, reconciliation, `FullContextBuilder`, ledger stores (`InMemoryLedgerStore`, `SQLiteLedgerStore`)
- Subpath exports for granular imports: `./stream`, `./ledger`, `./server`, `./client`, `./stores/*`

[Unreleased]: https://github.com/lleverage-ai/agent-sdk/compare/agent-threads@0.1.0-alpha.2...HEAD
[0.1.0-alpha.2]: https://github.com/lleverage-ai/agent-sdk/compare/agent-threads@0.1.0-alpha.1...agent-threads@0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/lleverage-ai/agent-sdk/releases/tag/agent-threads@0.1.0-alpha.1
