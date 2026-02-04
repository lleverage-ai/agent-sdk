[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / updateCheckpoint

# Function: updateCheckpoint()

> **updateCheckpoint**(`checkpoint`: [`Checkpoint`](../interfaces/Checkpoint.md), `updates`: `Partial`&lt;`Omit`&lt;[`Checkpoint`](../interfaces/Checkpoint.md), `"threadId"` \| `"createdAt"`&gt;&gt;): [`Checkpoint`](../interfaces/Checkpoint.md)

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:351](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L351)

Update an existing checkpoint with new data.

Automatically updates the `updatedAt` timestamp and increments step.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `checkpoint` | [`Checkpoint`](../interfaces/Checkpoint.md) | The existing checkpoint |
| `updates` | `Partial`&lt;`Omit`&lt;[`Checkpoint`](../interfaces/Checkpoint.md), `"threadId"` \| `"createdAt"`&gt;&gt; | Partial updates to apply |

## Returns

[`Checkpoint`](../interfaces/Checkpoint.md)

A new checkpoint object with updates applied

## Example

```typescript
const updated = updateCheckpoint(checkpoint, {
  messages: [...newMessages],
  step: checkpoint.step + 1,
});
```
