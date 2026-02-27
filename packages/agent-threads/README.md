# @lleverage-ai/agent-threads

Event transport, replay, and durable transcripts for AI agent conversations.

## Installation

```bash
bun add @lleverage-ai/agent-threads zod
```

## Overview

`agent-threads` provides the full infrastructure stack for durable AI agent conversations — from low-level event sourcing and real-time WebSocket transport to high-level canonical transcripts and run lifecycle management.

The package is organized into two layers:

- **Stream layer** — Append-only event stores, projectors, and WebSocket server/client for real-time event transport and replay
- **Ledger layer** — Canonical message schema, run lifecycle orchestration, accumulator (events → messages), and durable transcript stores

## Sub-path Exports

| Export | Description |
|--------|-------------|
| `@lleverage-ai/agent-threads` | Unified barrel (all stream + ledger exports) |
| `@lleverage-ai/agent-threads/stream` | Stream-only API |
| `@lleverage-ai/agent-threads/ledger` | Ledger-only API |
| `@lleverage-ai/agent-threads/server` | WebSocket server |
| `@lleverage-ai/agent-threads/client` | WebSocket client |
| `@lleverage-ai/agent-threads/stores/event-memory` | In-memory event store |
| `@lleverage-ai/agent-threads/stores/event-sqlite` | SQLite event store |
| `@lleverage-ai/agent-threads/stores/ledger-memory` | In-memory ledger store |
| `@lleverage-ai/agent-threads/stores/ledger-sqlite` | SQLite ledger store |

## Quick Start

### Event Stores

```typescript
import { InMemoryEventStore } from "@lleverage-ai/agent-threads/stores/event-memory";

const store = new InMemoryEventStore();

await store.append("thread-1", [
  { kind: "text-delta", payload: { delta: "Hello" } },
]);

const events = await store.replay("thread-1");
```

### Run Lifecycle

```typescript
import { RunManager } from "@lleverage-ai/agent-threads";
import { InMemoryEventStore } from "@lleverage-ai/agent-threads/stores/event-memory";
import { InMemoryLedgerStore } from "@lleverage-ai/agent-threads/stores/ledger-memory";

const eventStore = new InMemoryEventStore();
const ledgerStore = new InMemoryLedgerStore();
const manager = new RunManager(ledgerStore, eventStore);

const run = await manager.beginRun({ threadId: "thread-1" });
await manager.appendEvents(run.runId, events);
await manager.finalizeRun(run.runId, "committed");
```

### Accumulator

```typescript
import { accumulateEvents } from "@lleverage-ai/agent-threads";

const messages = accumulateEvents(storedEvents);
```

### WebSocket Transport

```typescript
import { WsServer } from "@lleverage-ai/agent-threads/server";
import { WsClient } from "@lleverage-ai/agent-threads/client";

const server = new WsServer({ store });
// Call server.handleConnection(ws) from your HTTP server's upgrade handler

const client = new WsClient({ url: "ws://localhost:8080" });
```

## License

MIT
