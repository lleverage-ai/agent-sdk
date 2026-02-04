[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createBackgroundTask

# Function: createBackgroundTask()

> **createBackgroundTask**(`data`: `Pick`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md), `"id"` \| `"description"` \| `"subagentType"`&gt; & `Partial`&lt;`Omit`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md), `"id"` \| `"description"` \| `"subagentType"`&gt;&gt;): [`BackgroundTask`](../interfaces/BackgroundTask.md)

Defined in: [packages/agent-sdk/src/task-store/types.ts:231](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L231)

Create a new background task with the given data.

This is a convenience function that ensures timestamps are set correctly.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `data` | `Pick`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md), `"id"` \| `"description"` \| `"subagentType"`&gt; & `Partial`&lt;`Omit`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md), `"id"` \| `"description"` \| `"subagentType"`&gt;&gt; | Partial task data (id, subagentType, description required) |

## Returns

[`BackgroundTask`](../interfaces/BackgroundTask.md)

A complete task object

## Example

```typescript
const task = createBackgroundTask({
  id: "task-123",
  subagentType: "researcher",
  description: "Research topic X",
});
```
