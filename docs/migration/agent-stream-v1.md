# Migrating to @lleverage-ai/agent-stream v1

## Overview

`@lleverage-ai/agent-stream` provides realtime event transport and replay for AI agent conversations. It builds on an event-sourcing foundation with three layers:

| Layer | Purpose |
|---|---|
| **Event stores** | Append-only persistence (`InMemoryEventStore`, `SQLiteEventStore`) |
| **Projector** | Deterministic state materialization from event streams |
| **WebSocket transport** | `WsServer` (Node.js) + `WsClient` (universal) for live streaming with replay |

## Installation

```bash
npm install @lleverage-ai/agent-stream
```

## API Mapping

| Old pattern | New API |
|---|---|
| Custom event bus | `IEventStore.append()` + `WsServer.broadcast()` |
| Manual WebSocket handling | `WsClient.subscribe()` returns `AsyncIterable` |
| Polling for new events | `WsClient` auto-reconnects and resumes from last seq |
| Manual state reconstruction | `Projector.catchUp(store, streamId)` |
| Custom heartbeat logic | Built-in ping/pong with configurable intervals |

## Step-by-Step Adoption

### 1. Set up an event store

```typescript
import { InMemoryEventStore } from "@lleverage-ai/agent-stream/stores/memory";

// Or for persistence:
// import { SQLiteEventStore } from "@lleverage-ai/agent-stream/stores/sqlite";

const store = new InMemoryEventStore<MyEvent>();
```

### 2. Define a projector for state materialization

```typescript
import { Projector } from "@lleverage-ai/agent-stream";
import type { StoredEvent } from "@lleverage-ai/agent-stream";

interface ChatState {
  messages: string[];
  lastSeq: number;
}

type ChatEvent = { kind: "message"; text: string } | { kind: "clear" };

const projector = new Projector<ChatState, ChatEvent>({
  initialState: { messages: [], lastSeq: 0 },
  reducer: (state, event: StoredEvent<ChatEvent>) => {
    switch (event.event.kind) {
      case "message":
        return {
          messages: [...state.messages, event.event.text],
          lastSeq: event.seq,
        };
      case "clear":
        return { messages: [], lastSeq: event.seq };
    }
  },
});
```

### 3. Wire up the server

```typescript
import { WsServer } from "@lleverage-ai/agent-stream/server";

const server = new WsServer({
  store,
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 10_000,
  maxBufferSize: 1000,
});

// In your HTTP upgrade handler (works with any WebSocket library):
httpServer.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    server.handleConnection(ws);
  });
});

// After appending events, broadcast to connected clients:
const stored = await store.append("session-123", [
  { kind: "message", text: "Hello!" },
]);
server.broadcast("session-123", stored);
```

### 4. Connect from the client

```typescript
import { WsClient } from "@lleverage-ai/agent-stream/client";

const client = new WsClient({
  url: "ws://localhost:8080",
  // WebSocket constructor is optional — defaults to globalThis.WebSocket
  reconnect: true,
  maxReconnectAttempts: 10,
  baseReconnectDelayMs: 1_000,
  maxReconnectDelayMs: 30_000,
});

client.on("stateChange", (state) => {
  console.log("Connection state:", state);
});

client.connect();

// Subscribe returns an AsyncIterable
for await (const item of client.subscribe("session-123")) {
  if ("type" in item && item.type === "replay-end") {
    console.log("Caught up! Now receiving live events.");
    continue;
  }
  // item is a StoredEvent
  projector.apply([item]);
  console.log("State:", projector.getState());
}
```

### 5. Node.js WebSocket constructor (server-side client)

The client uses `globalThis.WebSocket` by default (available in browsers). For Node.js, inject a constructor:

```typescript
import WebSocket from "ws";
import { WsClient } from "@lleverage-ai/agent-stream/client";

const client = new WsClient({
  url: "ws://localhost:8080",
  WebSocket: WebSocket as unknown as WebSocketConstructor,
});
```

## Reference Example

Full working example wiring all components together:

```typescript
import { InMemoryEventStore } from "@lleverage-ai/agent-stream/stores/memory";
import { Projector } from "@lleverage-ai/agent-stream";
import { WsServer } from "@lleverage-ai/agent-stream/server";
import { WsClient } from "@lleverage-ai/agent-stream/client";
import type { StoredEvent } from "@lleverage-ai/agent-stream";

// -- Types --
type AgentEvent =
  | { kind: "text-delta"; text: string }
  | { kind: "tool-call"; name: string; args: unknown }
  | { kind: "step-finished" };

interface TranscriptState {
  text: string;
  toolCalls: string[];
  steps: number;
}

// -- Store --
const store = new InMemoryEventStore<AgentEvent>();

// -- Projector --
const projector = new Projector<TranscriptState, AgentEvent>({
  initialState: { text: "", toolCalls: [], steps: 0 },
  reducer: (state, event: StoredEvent<AgentEvent>) => {
    switch (event.event.kind) {
      case "text-delta":
        return { ...state, text: state.text + event.event.text };
      case "tool-call":
        return {
          ...state,
          toolCalls: [...state.toolCalls, event.event.name],
        };
      case "step-finished":
        return { ...state, steps: state.steps + 1 };
    }
  },
});

// -- Server --
const wsServer = new WsServer({ store });

// When your agent produces events:
async function onAgentEvent(sessionId: string, event: AgentEvent) {
  const stored = await store.append(sessionId, [event]);
  wsServer.broadcast(sessionId, stored);
}

// -- Client --
const client = new WsClient({ url: "ws://localhost:8080" });
client.connect();

async function watchSession(sessionId: string) {
  for await (const item of client.subscribe<AgentEvent>(sessionId)) {
    if ("type" in item && item.type === "replay-end") {
      console.log("Replay complete, now live");
      continue;
    }
    projector.apply([item as StoredEvent<AgentEvent>]);
    console.log("Transcript:", projector.getState());
  }
}
```

## Key Behaviors

- **Replay + live**: On subscribe, the server replays historical events from the store, sends a `replay-end` marker, then switches to live delivery
- **Deduplication**: Events that arrive via both replay and live broadcast are automatically deduped by sequence number
- **Reconnection**: The client automatically reconnects with exponential backoff and resumes subscriptions from the last confirmed sequence
- **Heartbeat**: Server sends periodic pings; client responds with pongs. Both sides detect stale connections
- **Backpressure**: Server disconnects clients that accumulate too many buffered events
- **Protocol negotiation**: Version handshake ensures client and server compatibility

## Sub-path Exports

| Import path | Contents |
|---|---|
| `@lleverage-ai/agent-stream` | Types, Projector, EventKindRegistry, protocol codec, WS types |
| `@lleverage-ai/agent-stream/stores/memory` | `InMemoryEventStore` |
| `@lleverage-ai/agent-stream/stores/sqlite` | `SQLiteEventStore` |
| `@lleverage-ai/agent-stream/server` | `WsServer` |
| `@lleverage-ai/agent-stream/client` | `WsClient` |

## Deprecation Notice

Direct WebSocket management and custom event transports are deprecated in favor of `WsServer`/`WsClient`. The event store and projector APIs are stable and unchanged from v0.0.1.
