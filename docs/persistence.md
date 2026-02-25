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

- When providers return structured `response.messages`, those messages are saved directly
- This includes assistant `tool-call` blocks and tool `tool-result` blocks
- If structured messages are unavailable, the SDK falls back to text-based assistant messages

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

### Checkpoint Hooks

Monitor checkpoint operations:

```typescript
const agent = createAgent({
  model,
  checkpointer,
  hooks: {
    PreCheckpointSave: [
      async ({ threadId, checkpoint }) => {
        console.log(`Saving checkpoint for ${threadId}`);
        return {};
      },
    ],
    PostCheckpointSave: [
      async ({ threadId, checkpoint }) => {
        console.log(`Checkpoint saved for ${threadId}`);
        return {};
      },
    ],
    PostCheckpointLoad: [
      async ({ threadId, checkpoint }) => {
        console.log(`Loaded checkpoint for ${threadId} with ${checkpoint.messages.length} messages`);
        return {};
      },
    ],
  },
});
```

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
