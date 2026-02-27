# @lleverage-ai/agent-ledger

Durable transcript layer for AI agent conversations.

## Installation

```bash
bun add @lleverage-ai/agent-ledger @lleverage-ai/agent-stream zod
```

## Overview

`agent-ledger` converts raw streaming events into canonical conversation messages and manages the full lifecycle of agent generation runs. It supports multi-branch transcripts (regenerations/forks) without losing history, built on top of `@lleverage-ai/agent-stream`.

## Core API

### RunManager

Orchestrates the lifecycle of generation runs:

```typescript
import { RunManager } from "@lleverage-ai/agent-ledger";
import { InMemoryEventStore } from "@lleverage-ai/agent-stream/stores/memory";
import { InMemoryLedgerStore } from "@lleverage-ai/agent-ledger/stores/memory";

const manager = new RunManager({ eventStore, ledgerStore });

// Start a run
const run = await manager.beginRun("thread-1");

// Stream events into it
await manager.appendEvents(run.runId, events);

// Finalize when done
await manager.finalizeRun(run.runId, "committed", messages);
```

### Accumulator

Reduces streaming events into canonical messages:

```typescript
import { accumulateEvents } from "@lleverage-ai/agent-ledger";

const state = accumulateEvents(events);
// state.committed — array of CanonicalMessage objects
// state.pending — message currently being streamed
```

### ContextBuilder

Builds model context from conversation transcripts:

```typescript
import { FullContextBuilder } from "@lleverage-ai/agent-ledger";

const builder = new FullContextBuilder({ ledgerStore });
const { messages, provenance } = await builder.build("thread-1");
```

## Key Types

- **`CanonicalMessage`** — Immutable conversation message with ULID-based ID, role, parts (text, reasoning, tool calls, tool results, files), and versioned metadata
- **`RunRecord`** — Tracks a generation attempt through its lifecycle: `created` -> `streaming` -> `committed`/`failed`/`cancelled`/`superseded`
- **`CanonicalPart`** — Discriminated union: `TextPart | ReasoningPart | ToolCallPart | ToolResultPart | FilePart`

## Key Features

- Event-sourced architecture (all state derivable from events)
- Multi-branch transcript support for regenerations and forks
- Stale run detection and automatic recovery
- Schema-versioned message metadata
- Pluggable storage (in-memory, SQLite, or implement `ILedgerStore`)

## Sub-path Exports

| Export | Description |
|--------|-------------|
| `@lleverage-ai/agent-ledger` | Core types, RunManager, accumulator, context builder, reconciliation |
| `@lleverage-ai/agent-ledger/stores/memory` | In-memory ledger store |
| `@lleverage-ai/agent-ledger/stores/sqlite` | SQLite ledger store |

## License

MIT
