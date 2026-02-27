# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha.1] - Unreleased

### Added

- Initial release — merges `@lleverage-ai/agent-stream` and `@lleverage-ai/agent-ledger` into a single package
- Stream layer: event stores (`InMemoryEventStore`, `SQLiteEventStore`), `Projector`, WebSocket server/client, protocol codec, `EventKindRegistry`
- Ledger layer: canonical message schema, `RunManager`, accumulator, reconciliation, `FullContextBuilder`, ledger stores (`InMemoryLedgerStore`, `SQLiteLedgerStore`)
- Subpath exports for granular imports: `./stream`, `./ledger`, `./server`, `./client`, `./stores/*`
