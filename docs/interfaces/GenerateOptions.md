[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / GenerateOptions

# Interface: GenerateOptions

Defined in: [packages/agent-sdk/src/types.ts:1153](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1153)

Options for generating a response.

## Example

```typescript
const result = await agent.generate({
  prompt: "What's the weather like?",
  maxTokens: 1000,
  temperature: 0.7,
});
```

## Properties

### checkpointAfterToolCall?

> `optional` **checkpointAfterToolCall**: `boolean`

Defined in: [packages/agent-sdk/src/types.ts:1236](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1236)

Enable incremental checkpointing during streaming.

When enabled, the agent will save a checkpoint after each step (tool call)
during streaming, not just at the end. This provides better crash recovery
for long-running streams with multiple tool calls.

If the process crashes mid-stream, you can resume from the last completed
step instead of losing all progress.

#### Default Value

```ts
false
```

#### Example

```typescript
// Enable incremental checkpointing for long-running streams
const stream = await agent.stream({
  prompt: "Analyze this large dataset",
  threadId: "session-123",
  checkpointAfterToolCall: true,
});
```

***

### forkSession?

> `optional` **forkSession**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1197](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1197)

Fork an existing session into a new thread.

When provided with a checkpointer and threadId, creates a new session
that starts from the current state of the source thread. Useful for
exploring alternative conversation paths without affecting the original.

#### Example

```typescript
// Fork a session to explore alternatives
const result = await agent.generate({
  threadId: "session-123",
  forkSession: "session-123-alternative",
  prompt: "Let's try a different approach",
});
// Original session-123 remains unchanged
// session-123-alternative contains a copy of session-123's state
```

***

### headers?

> `optional` **headers**: `Record`&lt;`string`, `string`&gt;

Defined in: [packages/agent-sdk/src/types.ts:1273](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1273)

Additional headers for API requests.
Useful for custom authentication or provider-specific headers.

***

### maxTokens?

> `optional` **maxTokens**: `number`

Defined in: [packages/agent-sdk/src/types.ts:1200](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1200)

Maximum tokens to generate

***

### messages?

> `optional` **messages**: [`ModelMessage`](../type-aliases/ModelMessage.md)[]

Defined in: [packages/agent-sdk/src/types.ts:1158](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1158)

Conversation history - accepts AI SDK message types

***

### onStreamWriterReady()?

> `optional` **onStreamWriterReady**: (`writer`: `UIMessageStreamWriter`) => `void`

Defined in: [packages/agent-sdk/src/types.ts:1304](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1304)

Callback invoked when the stream writer becomes available.

This is only called by `streamDataResponse()` and provides access to the
underlying `UIMessageStreamWriter` for custom data streaming. Useful for
setting up log transports that write to the stream.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `writer` | `UIMessageStreamWriter` |

#### Returns

`void`

#### Example

```typescript
// Stream logs to the client via the writer
const logEntries: LogEntry[] = [];
const logTransport: LogTransport = {
  name: "stream",
  write: (entry) => {
    // Will be updated when writer is ready
    if (writerRef.current) {
      writerRef.current.write({ type: "data", value: { type: "log", entry } });
    }
  },
};

return agent.streamDataResponse({
  messages,
  onStreamWriterReady: (writer) => {
    writerRef.current = writer;
  },
});
```

***

### output?

> `optional` **output**: `Output`&lt;`unknown`, `unknown`, `never`&gt; \| `Output`&lt;`unknown`[], `unknown`[], `unknown`&gt;

Defined in: [packages/agent-sdk/src/types.ts:1253](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1253)

Structured output specification.

#### See

https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data

#### Example

```typescript
import { Output } from "ai";

output: Output.object({
  schema: z.object({ summary: z.string() })
})
```

***

### prompt?

> `optional` **prompt**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1155](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1155)

The user message/prompt

***

### providerOptions?

> `optional` **providerOptions**: `any`

Defined in: [packages/agent-sdk/src/types.ts:1267](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1267)

Provider-specific options passed directly to generateText/streamText.
Use this for features like extended thinking, reasoning effort, etc.

#### Example

```typescript
providerOptions: {
  anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } }
}
```

***

### signal?

> `optional` **signal**: `AbortSignal`

Defined in: [packages/agent-sdk/src/types.ts:1212](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1212)

Abort signal for cancellation

***

### stopSequences?

> `optional` **stopSequences**: `string`[]

Defined in: [packages/agent-sdk/src/types.ts:1209](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1209)

Sequences that will stop generation

***

### temperature?

> `optional` **temperature**: `number`

Defined in: [packages/agent-sdk/src/types.ts:1206](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1206)

Temperature for sampling (higher = more random).

#### Default Value

```ts
Model default
```

***

### threadId?

> `optional` **threadId**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1176](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1176)

Thread identifier for session persistence.

When provided with a checkpointer, the agent will:
- Load existing checkpoint for this thread (if any)
- Save checkpoint after each step

#### Example

```typescript
// Resume a conversation
const result = await agent.generate({
  prompt: "Continue",
  threadId: "session-123",
});
```
