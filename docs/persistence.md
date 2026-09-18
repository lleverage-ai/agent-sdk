# Persistence

Memory and checkpointing for agent state management.

## Memory

Persist agent memory across conversations.

### Filesystem Memory Store

```typescript
import {
  FilesystemMemoryStore,
  loadAgentMemory,
} from "@lleverage-ai/agent-sdk";

const store = new FilesystemMemoryStore({
  rootDir: ".agent/memory",
});

// Load all memory for an agent
const memory = await loadAgentMemory({
  store,
  agentId: "my-agent",
});
```

### In-Memory Store

```typescript
import { InMemoryMemoryStore } from "@lleverage-ai/agent-sdk";

const store = new InMemoryMemoryStore();

// Create memory document
await store.save({
  id: "note-1",
  content: "Important information...",
  metadata: {
    tags: ["important"],
    autoLoad: true,
  },
});

// Query memory
const notes = await store.query({
  tags: ["important"],
});

// Delete memory
await store.delete("note-1");
```

### Memory Document Structure

```typescript
interface MemoryDocument {
  id: string;
  content: string;
  metadata: {
    tags?: string[];
    autoLoad?: boolean; // Automatically include in context
    createdAt?: Date;
    updatedAt?: Date;
    expiresAt?: Date;
    [key: string]: any;
  };
}
```

### Memory-Aware Middleware

Automatically load memory into agent context:

```typescript
import { createAgentMemoryMiddleware } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  middleware: [
    createAgentMemoryMiddleware({
      store,
      autoLoad: true, // Load documents with autoLoad: true
      maxDocuments: 10, // Limit number of loaded documents
      filter: (doc) => !doc.metadata.expiresAt || doc.metadata.expiresAt > new Date(),
    }),
  ],
});
```

## Checkpointing

Save and restore agent state for resumable conversations.

### MemorySaver

In-memory checkpoint storage (for development/testing):

```typescript
import { createMemorySaver } from "@lleverage-ai/agent-sdk";

const checkpointer = createMemorySaver();

const agent = createAgent({
  model,
  checkpointer,
});

// Save checkpoint
await checkpointer.save({
  threadId: "conversation-1",
  messages,
  metadata: { userId: "123" },
});

// Load checkpoint
const checkpoint = await checkpointer.load("conversation-1");

// List all checkpoints
const checkpoints = await checkpointer.list();

// Delete checkpoint
await checkpointer.delete("conversation-1");
```

### FileSaver

Persistent file-based checkpoints:

```typescript
import { createFileSaver } from "@lleverage-ai/agent-sdk";

const checkpointer = createFileSaver({
  directory: ".agent/checkpoints",
  maxCheckpoints: 100, // Maximum checkpoints per thread
  compress: true, // Compress checkpoint data
});

const agent = createAgent({
  model,
  checkpointer,
});
```

### KeyValueStoreSaver

Use any key-value store:

```typescript
import {
  createKeyValueStoreSaver,
  InMemoryStore,
} from "@lleverage-ai/agent-sdk";

// In-memory store
const store = new InMemoryStore();
const checkpointer = createKeyValueStoreSaver({ store });

// Redis store (custom implementation)
class RedisStore implements KeyValueStore {
  async get(key: string) { /* ... */ }
  async set(key: string, value: any) { /* ... */ }
  async delete(key: string) { /* ... */ }
  async list(prefix?: string) { /* ... */ }
}

const redisCheckpointer = createKeyValueStoreSaver({
  store: new RedisStore(),
});
```

### Checkpoint Structure

```typescript
interface Checkpoint {
  threadId: string;
  step: number;
  messages: Message[];
  state: AgentState; // todos + virtual files
  pendingInterrupt?: Interrupt;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  metadata?: Record<string, unknown>;
}
```

### Tool Transcript Persistence

Checkpoint message history preserves tool-call and tool-result transcript entries, not just plain assistant text.

- Messages are collected from every step's `response.messages`, so multi-step
  tool runs keep their intermediate tool calls and results (the AI SDK's
  top-level `response.messages` only carries the final step)
- This includes assistant `tool-call` blocks and tool `tool-result` blocks
- If structured messages are unavailable, the SDK falls back to text-based assistant messages
- When mid-run context compaction fires during a streaming run, the
  checkpoint persists the compacted transcript rather than the original history

### Resuming Conversations

```typescript
const agent = createAgent({
  model,
  checkpointer,
});

// Start new conversation
const result1 = await agent.generate({
  threadId: "conversation-1",
  prompt: "Hello, my name is Alice",
});

// Resume later
const result2 = await agent.generate({
  threadId: "conversation-1",
  prompt: "What's my name?",
});
// Agent remembers: "Your name is Alice"
```

### Incremental Checkpointing for Streaming

For long-running streams, enable checkpoint updates after each step:

```typescript
for await (const _part of agent.stream({
  threadId: "conversation-1",
  prompt: "Continue",
  checkpointAfterToolCall: true,
})) {
  // consume stream
}
```

### Pausing at a Step Boundary

`shouldStopAfterStep` is evaluated after every completed step. When it returns
`true`, the loop stops before the next model call. With
`checkpointAfterToolCall` enabled, the last step is already persisted, so a
later call on the same `threadId` picks up where the run left off. This is
the primitive for draining in-flight runs before a process exits.

```typescript
let draining = false;
process.on("SIGTERM", () => {
  draining = true;
});

for await (const _part of agent.stream({
  threadId: "conversation-1",
  prompt: "Continue",
  checkpointAfterToolCall: true,
  shouldStopAfterStep: () => draining,
})) {
  // consume stream
}
```

A paused run reports `finishReason: "tool-calls"` on its last step; a run
that finished naturally reports `"stop"`.

Tools can also end the turn from the inside by calling `options.stop()` in
their `execute()`. The current step's tool results are recorded, no further
model call is made, and the background-task follow-up loop is skipped. Use it
for terminal presentation tools (rendering a set of buttons, for example)
where another model call would only add redundant text.

### Checkpoint Hooks

`PostCheckpointLoad` fires each time the agent loads a thread from the
checkpointer: after the saver's `load()` returns a checkpoint and before that
generation's compaction check. Loaded checkpoints are cached per agent
instance, so sequential generations on a thread fire it once; concurrent
generations on the same not-yet-cached thread each load and each fire it.
Forking a session fires it for the source thread. It is the only hook that sees the
restored transcript, because `PreGenerate` runs before the checkpoint is
prepended and tool hooks carry only the tool call.

The hook is observation only: its return value is ignored, and `messages` and
`metadata` are the checkpoint's own references, so do not mutate them. A hook
that throws or times out is logged and the generation continues.

```typescript
const agent = createAgent({
  model,
  checkpointer,
  contextManager,
  hooks: {
    PostCheckpointLoad: [
      async ({ thread_id, step, messages, metadata, has_pending_interrupt }) => {
        console.log(`Restored ${thread_id} at step ${step}: ${messages.length} messages`);

        // Seed the context manager from the previous run's recorded usage so
        // the first compaction decision sees the real context size rather than
        // an estimate. The SDK does not record or interpret this metadata;
        // whatever the host wrote on save is what it reads here.
        const contextTokens = (metadata?.lastRunUsage as { contextTokens?: number })?.contextTokens;
        if (typeof contextTokens === "number") {
          contextManager.updateUsage?.({
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: contextTokens,
          });
        }
        return {};
      },
    ],
  },
});
```

The `resume()` pre-flight read and `getPendingInterrupt()` do not fire it.

## Combining Memory and Checkpoints

Use both for comprehensive state management:

```typescript
import {
  createAgent,
  createFileSaver,
  FilesystemMemoryStore,
  createAgentMemoryMiddleware,
} from "@lleverage-ai/agent-sdk";

const memoryStore = new FilesystemMemoryStore({
  rootDir: ".agent/memory",
});

const checkpointer = createFileSaver({
  directory: ".agent/checkpoints",
});

const agent = createAgent({
  model,
  checkpointer,
  middleware: [
    createAgentMemoryMiddleware({
      store: memoryStore,
      autoLoad: true,
    }),
  ],
});

// Memory: Long-term knowledge (user preferences, learned facts)
await memoryStore.save({
  id: "user-preference-1",
  content: "User prefers concise responses",
  metadata: { autoLoad: true },
});

// Checkpoints: Conversation state (message history, context)
// Automatically managed by the agent
```

## Migration Between Stores

```typescript
import { migrateCheckpoints } from "@lleverage-ai/agent-sdk";

const oldStore = createMemorySaver();
const newStore = createFileSaver({ directory: ".agent/checkpoints" });

// Migrate all checkpoints
await migrateCheckpoints({
  source: oldStore,
  destination: newStore,
  transform: (checkpoint) => ({
    ...checkpoint,
    metadata: {
      ...checkpoint.metadata,
      migratedAt: new Date(),
    },
  }),
});
```
