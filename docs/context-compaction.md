# Context Compaction

Automatically manage conversation context with intelligent compaction policies.

## Basic Context Management

```typescript
import { createAgent, createContextManager } from "@lleverage-ai/agent-sdk";

const contextManager = createContextManager({
  maxTokens: 100000, // Maximum context window
  policy: {
    enabled: true,
    tokenThreshold: 0.8, // Trigger at 80% capacity
    hardCapThreshold: 0.95, // Force compact at 95% (safety)
    enableGrowthRatePrediction: false,
    enableErrorFallback: true, // Auto-compact on context length errors
  },
  summarization: {
    keepMessageCount: 10, // Always keep last 10 messages
    keepToolResultCount: 5, // Keep recent tool results
  },
});

const agent = createAgent({
  model,
  contextManager,
  checkpointer, // Required for error fallback
});
```

## Compaction Triggers

The SDK supports multiple compaction triggers:

| Trigger | Description | Default |
|---------|-------------|---------|
| Token Threshold | Triggers when usage exceeds the threshold | 80% |
| Hard Cap | Safety limit — forces compaction to prevent errors | 95% |
| Growth Rate | Predicts if next message will exceed limits | Disabled |
| Error Fallback | Emergency compaction on context length errors | Enabled |

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  policy: {
    enabled: true,
    tokenThreshold: 0.75, // Trigger at 75%
    hardCapThreshold: 0.9, // Force at 90%
    enableGrowthRatePrediction: true, // Enable predictive compaction
    enableErrorFallback: true, // Auto-recover from context errors
  },
});
```

## Custom Compaction Policy

Override the default policy logic with custom rules:

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  policy: {
    enabled: true,
    tokenThreshold: 0.8,
    hardCapThreshold: 0.95,
    enableGrowthRatePrediction: false,
    enableErrorFallback: true,
    // Custom compaction logic
    shouldCompact: (budget, messages) => {
      // Trigger if more than 50 messages
      if (messages.length > 50) {
        return { trigger: true, reason: "token_threshold" };
      }
      // Trigger if budget usage high
      if (budget.usage >= 0.85) {
        return { trigger: true, reason: "hard_cap" };
      }
      return { trigger: false };
    },
  },
});
```

## Compaction Strategies

Choose from multiple compaction strategies:

### Rollup (Default)

Summarize older messages into a single summary:

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  summarization: {
    keepMessageCount: 10,
    strategy: "rollup",
  },
});
```

### Tiered

Create multiple summary layers for very long conversations:

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  summarization: {
    keepMessageCount: 10,
    strategy: "tiered",
    enableTieredSummaries: true,
    maxSummaryTiers: 3, // Up to 3 summary levels
    messagesPerTier: 5, // Combine 5 summaries into next tier
  },
});
```

How tiered summaries work:
1. When you have < 5 summaries: creates regular Tier 0 summary
2. When you have ≥ 5 summaries: creates Tier 1 summary (consolidates 5 summaries)
3. Continues creating higher tiers as needed up to `maxSummaryTiers`

### Structured

Generate structured summaries with distinct sections:

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  summarization: {
    keepMessageCount: 10,
    strategy: "structured",
    enableStructuredSummary: true,
  },
});

// Produces summaries like:
// {
//   decisions: ["Chose TypeScript over JavaScript", "Using REST API"],
//   preferences: ["Prefer functional style", "No external dependencies"],
//   currentState: ["Authentication implemented", "Tests passing"],
//   openQuestions: ["How to handle rate limiting?"],
//   references: ["src/auth.ts:45", "https://docs.example.com"]
// }
```

### When to Use Each Strategy

| Strategy | Best For |
|----------|----------|
| Rollup | Most use cases — simple and effective |
| Tiered | Very long conversations (100+ turns) |
| Structured | When you need to parse or query summary content |

## Pinned Messages

Pin important messages to ensure they're never compacted:

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  summarization: {
    keepMessageCount: 10,
    strategy: "rollup",
  },
});

// Pin an important message
contextManager.pinMessage(5, "Contains critical user requirements");

// Check if message is pinned
if (contextManager.isPinned(5)) {
  console.log("Message 5 is protected from compaction");
}

// Unpin when no longer needed
contextManager.unpinMessage(5);

// View all pinned messages
console.log("Pinned messages:", contextManager.pinnedMessages);
```

Use cases for pinning:
- Critical user requirements or constraints
- Important decisions that must be preserved
- Configuration details referenced throughout the conversation

## Observability Hooks

Monitor compaction events:

```typescript
const agent = createAgent({
  model,
  contextManager,
  hooks: {
    PreCompact: [
      async (input) => {
        console.log(`Compacting ${input.message_count} messages (${input.tokens_before} tokens)`);
        return {};
      },
    ],
    PostCompact: [
      async (input) => {
        console.log(`Compacted ${input.messages_before} → ${input.messages_after} messages`);
        console.log(`Saved ${input.tokens_saved} tokens`);
        return {};
      },
    ],
  },
});
```

## Error-Triggered Fallback

When enabled, the SDK automatically attempts emergency compaction if a context length error occurs:

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  policy: {
    enableErrorFallback: true,
  },
});

const agent = createAgent({
  model,
  contextManager,
  checkpointer, // Required — stores compacted state
});

// If context error occurs, SDK will:
// 1. Detect context length error
// 2. Compact messages from checkpoint
// 3. Save compacted state
// 4. Retry the request
```

**Note**: Error fallback requires a checkpointer and only triggers once per request to avoid loops.

## Token Accounting

The SDK uses a hybrid approach to token tracking:

```typescript
import {
  createContextManager,
  createCustomTokenCounter,
} from "@lleverage-ai/agent-sdk";
import { encoding_for_model } from "tiktoken";

// Option 1: Approximate counter (default)
const contextManager = createContextManager({
  maxTokens: 100000,
  // Uses approximate counter (4 chars ≈ 1 token)
});

// Option 2: Model-specific tokenizer (recommended for production)
const encoder = encoding_for_model("gpt-4");
const contextManager = createContextManager({
  maxTokens: 100000,
  tokenCounter: createCustomTokenCounter({
    countFn: (text) => encoder.encode(text).length,
    messageOverhead: 4, // Tokens per message for structure
  }),
});
```

### Token Budget Properties

| Property | Description |
|----------|-------------|
| `currentTokens` | Current token count (actual or estimated) |
| `maxTokens` | Maximum allowed tokens |
| `usage` | Usage percentage (0-1) |
| `remaining` | Tokens remaining |
| `isActual` | `true` if based on model usage, `false` if estimated |

```typescript
const budget = contextManager.getBudget(messages);
console.log(`Usage: ${(budget.usage * 100).toFixed(1)}%`);
console.log(`Remaining: ${budget.remaining} tokens`);
```

## Background Compaction

Avoid blocking user-facing responses by running compaction in the background:

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  policy: {
    tokenThreshold: 0.8,
  },
  scheduler: {
    enableBackgroundCompaction: true,
    debounceDelayMs: 5000, // Wait 5s before starting
    maxPendingTasks: 3,
    onTaskComplete: (task) => {
      console.log(`Background compaction saved ${task.result.tokens_saved} tokens`);
    },
    onTaskError: (task) => {
      console.error(`Compaction failed:`, task.error);
    },
  },
});
```

### How Background Compaction Works

1. **First Call**: When compaction needed, it's scheduled in background; original messages used
2. **Background Execution**: After debounce delay, compaction runs asynchronously
3. **Next Call**: If background compaction completed, result is applied automatically
4. **Debouncing**: Multiple rapid triggers are coalesced to avoid redundant work

### When to Use Background Compaction

**Use background compaction:**
- Interactive applications where latency matters
- High-volume scenarios with many rapid turns
- Long-running sessions with periodic compaction needs

**Use synchronous compaction (default):**
- Batch processing where latency isn't critical
- Single-request scenarios without follow-up calls
- When you need guaranteed compaction before the next generation

### Scheduler API

```typescript
// Check pending compactions
const pendingTasks = contextManager.scheduler?.getPendingTasks();

// Get task details
const task = contextManager.scheduler?.getTask(taskId);
console.log(`Task status: ${task.status}`);

// Cancel a pending compaction
contextManager.scheduler?.cancel(taskId);

// Clean up completed tasks
contextManager.scheduler?.cleanup();

// Shutdown scheduler
contextManager.scheduler?.shutdown();
```

## Rich Content Support

The context manager handles messages with images, files, and other rich content:

```typescript
const agent = createAgent({
  model,
  contextManager: createContextManager({
    maxTokens: 100000,
    summarization: { keepMessageCount: 10 },
  }),
});

// Messages with images
const result = await agent.generate({
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What's in this screenshot?" },
        { type: "image", image: new URL("https://example.com/screenshot.png") },
      ],
    },
  ],
});
```

### Token Costs for Rich Content

| Content Type | Approximate Cost |
|--------------|------------------|
| Images | ~1000 tokens per image |
| Files | ~500 tokens per file |
| Text | Character-based approximation |

### Best Practices for Rich Content

1. **Use structured summaries** for conversations with many images/files
2. **Pin important media messages** if they contain critical information
3. **Monitor token budgets** — rich content uses significantly more tokens
4. **Consider background compaction** for image-heavy conversations
5. **Use descriptive text** alongside media to help the summarizer

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  policy: {
    tokenThreshold: 0.7, // Lower threshold for image-heavy conversations
  },
});
```
