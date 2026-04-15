# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `**BREAKING**:` `ToolCallPart` and `ToolResultPart` now expose a generic `metadata` bag for tool provenance and UI state instead of top-level `toolLabel`, `skillName`, and `skillIcon` fields, keeping canonical transcript storage extensible for app-specific metadata
- `Accumulator` now preserves `payload.metadata` on `tool-call` and `tool-result` events, deep-merges duplicate tool-call metadata updates, and falls back to pending tool-call metadata when the matching result omits it
- `Accumulator` continues to accept legacy top-level `toolLabel`, `skillName`, and `skillIcon` fields on tool event payloads and normalizes them into `payload.metadata` for backward-compatible ingestion during migration

### Fixed

- `ToolPartMetadata` is now constrained to JSON-serializable values so `ToolCallPart.metadata` and `ToolResultPart.metadata` align with canonical transcript persistence
- `Accumulator` payload handling now validates tool event payloads before projecting them into canonical messages, reduces broad type assertions in the ledger reducer, and safely filters metadata keys during normalization/merge while keeping the stream event model open-world

## [0.1.0-alpha.4] - 2026-04-14

### Added

- `ToolCallPart` and `ToolResultPart` now carry optional `toolLabel`, `skillName`, and `skillIcon` metadata from stream events, so canonical transcripts preserve the same display labels shown during streaming
- Accumulator handles duplicate `tool-call` events for the same `toolCallId` (e.g. async LLM-generated label updates) by merging metadata into the existing part instead of appending a duplicate

### Fixed

- `ToolResultPart` now reuses metadata captured on earlier `tool-call` events when the corresponding `tool-result` payload omits `toolLabel`, `skillName`, or `skillIcon`, keeping canonical reloads consistent with streamed tool UI

## [0.1.0-alpha.3] - 2026-02-28

### Added

- Accumulator reducer now handles `user-message` stream events by committing any in-progress assistant output and appending a canonical `role: "user"` message

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

[Unreleased]: https://github.com/lleverage-ai/agent-sdk/compare/agent-threads@0.1.0-alpha.4...HEAD
[0.1.0-alpha.4]: https://github.com/lleverage-ai/agent-sdk/compare/agent-threads@0.1.0-alpha.3...agent-threads@0.1.0-alpha.4
[0.1.0-alpha.3]: https://github.com/lleverage-ai/agent-sdk/compare/agent-threads@0.1.0-alpha.2...agent-threads@0.1.0-alpha.3
[0.1.0-alpha.2]: https://github.com/lleverage-ai/agent-sdk/compare/agent-threads@0.1.0-alpha.1...agent-threads@0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/lleverage-ai/agent-sdk/releases/tag/agent-threads@0.1.0-alpha.1
