[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / updateBackgroundTask

# Function: updateBackgroundTask()

> **updateBackgroundTask**(`task`: [`BackgroundTask`](../interfaces/BackgroundTask.md), `updates`: `Partial`&lt;`Omit`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md), `"id"` \| `"createdAt"`&gt;&gt;): [`BackgroundTask`](../interfaces/BackgroundTask.md)

Defined in: [packages/agent-sdk/src/task-store/types.ts:264](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L264)

Update an existing task with new data.

Automatically updates the `updatedAt` timestamp.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `task` | [`BackgroundTask`](../interfaces/BackgroundTask.md) | The existing task |
| `updates` | `Partial`&lt;`Omit`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md), `"id"` \| `"createdAt"`&gt;&gt; | Partial updates to apply |

## Returns

[`BackgroundTask`](../interfaces/BackgroundTask.md)

A new task object with updates applied

## Example

```typescript
const updated = updateBackgroundTask(task, {
  status: "completed",
  result: "Task completed successfully",
  completedAt: new Date().toISOString(),
});
```
