[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / Checkpoint

# Interface: Checkpoint

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:143](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L143)

Complete snapshot of an agent session.

A checkpoint captures the full state of a conversation, including:
- Message history for context continuity
- Agent state (todos, virtual files)
- Any pending interrupts (tool approvals, questions, etc.)

## Example

```typescript
const checkpoint: Checkpoint = {
  threadId: "session-123",
  step: 5,
  messages: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there!" },
  ],
  state: { todos: [], files: {} },
  createdAt: "2026-01-30T10:00:00Z",
  updatedAt: "2026-01-30T10:05:00Z",
};
```

## Properties

### createdAt

> **createdAt**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:162](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L162)

ISO 8601 timestamp when this checkpoint was first created

***

### messages

> **messages**: [`ModelMessage`](../type-aliases/ModelMessage.md)[]

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:151](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L151)

Full message history

***

### metadata?

> `optional` **metadata**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:168](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L168)

Optional metadata for custom data

***

### pendingInterrupt?

> `optional` **pendingInterrupt**: [`Interrupt`](Interrupt.md)&lt;`unknown`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:159](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L159)

Pending interrupt if the agent was interrupted.

***

### state

> **state**: [`AgentState`](AgentState.md)

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:154](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L154)

Agent state including todos and virtual filesystem

***

### step

> **step**: `number`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:148](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L148)

Step number when this checkpoint was created

***

### threadId

> **threadId**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:145](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L145)

Unique identifier for this conversation thread

***

### updatedAt

> **updatedAt**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:165](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L165)

ISO 8601 timestamp when this checkpoint was last updated
