# @lleverage-ai/agent-stream

Realtime event transport and replay for AI agent conversations.

## Installation

```bash
bun add @lleverage-ai/agent-stream zod
```

## Overview

`agent-stream` provides an append-only event streaming layer with real-time synchronization. It handles persisting, replaying, and broadcasting ordered event streams — the foundation for durable AI agent conversations.

## Core API

### Event Stores

Persist and replay ordered event streams. Two implementations are included:

```typescript
import { InMemoryEventStore } from "@lleverage-ai/agent-stream/stores/memory";
import { SQLiteEventStore } from "@lleverage-ai/agent-stream/stores/sqlite";

const store = new InMemoryEventStore();

// Append events to a stream
await store.append("thread-1", [
  { kind: "text-delta", payload: { text: "Hello" } },
]);

// Replay events (with optional filtering)
const events = await store.replay("thread-1", { afterSeq: 0, limit: 100 });
```

### Projector

Reduces event streams into materialized state:

```typescript
import { Projector } from "@lleverage-ai/agent-stream";

const projector = new Projector({
  reducer: (state, event) => ({ ...state, count: state.count + 1 }),
  init: () => ({ count: 0 }),
});

// Catch up from an event store
await projector.catchUp(store, "thread-1");
console.log(projector.state); // { count: 1 }
```

### WebSocket Server & Client

Real-time event synchronization across clients:

```typescript
import { WsServer } from "@lleverage-ai/agent-stream/server";
import { WsClient } from "@lleverage-ai/agent-stream/client";

// Server: broadcast events to subscribers
const server = new WsServer({ store, port: 8080 });

// Client: subscribe and receive events
const client = new WsClient({ url: "ws://localhost:8080" });
client.on("event", (event) => console.log(event));
client.subscribe("thread-1");
```

## Key Features

- Append-only event streams with monotonic sequence numbers
- Replay filtering (`afterSeq`, `limit`) for efficient catchup
- WebSocket server/client with auto-reconnection and heartbeats
- Protocol versioning for forward compatibility
- Pluggable storage (in-memory, SQLite, or bring your own `IEventStore`)

## Sub-path Exports

| Export | Description |
|--------|-------------|
| `@lleverage-ai/agent-stream` | Core types, projector, protocol, event registry |
| `@lleverage-ai/agent-stream/stores/memory` | In-memory event store |
| `@lleverage-ai/agent-stream/stores/sqlite` | SQLite event store |
| `@lleverage-ai/agent-stream/server` | WebSocket server |
| `@lleverage-ai/agent-stream/client` | WebSocket client |

## License

MIT
