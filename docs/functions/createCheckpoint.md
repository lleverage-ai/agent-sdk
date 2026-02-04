[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createCheckpoint

# Function: createCheckpoint()

> **createCheckpoint**(`data`: `Pick`&lt;[`Checkpoint`](../interfaces/Checkpoint.md), `"threadId"` \| `"messages"` \| `"state"`&gt; & `Partial`&lt;`Omit`&lt;[`Checkpoint`](../interfaces/Checkpoint.md), `"threadId"` \| `"messages"` \| `"state"`&gt;&gt;): [`Checkpoint`](../interfaces/Checkpoint.md)

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:319](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L319)

Create a new checkpoint with the given data.

This is a convenience function that ensures timestamps are set correctly.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `data` | `Pick`&lt;[`Checkpoint`](../interfaces/Checkpoint.md), `"threadId"` \| `"messages"` \| `"state"`&gt; & `Partial`&lt;`Omit`&lt;[`Checkpoint`](../interfaces/Checkpoint.md), `"threadId"` \| `"messages"` \| `"state"`&gt;&gt; | Partial checkpoint data (threadId and messages required) |

## Returns

[`Checkpoint`](../interfaces/Checkpoint.md)

A complete checkpoint object

## Example

```typescript
const checkpoint = createCheckpoint({
  threadId: "session-123",
  messages: [...],
  state: { todos: [], files: {} },
});
```
