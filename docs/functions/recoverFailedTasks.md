[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / recoverFailedTasks

# Function: recoverFailedTasks()

> **recoverFailedTasks**(`store`: [`BaseTaskStore`](../interfaces/BaseTaskStore.md), `options?`: \{ `errorPattern?`: `RegExp`; `maxCreatedAt?`: `Date`; `minCreatedAt?`: `Date`; \}): `Promise`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md)[]&gt;

Defined in: [packages/agent-sdk/src/tools/task.ts:306](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L306)

Recover failed tasks for retry.

Loads all "failed" tasks from the store and returns them for inspection
or automatic retry. Applications can decide which tasks to retry based
on error type, retry count, or other criteria.

To retry a task, update its status back to "pending" and process it
through your task execution logic.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `store` | [`BaseTaskStore`](../interfaces/BaseTaskStore.md) | The task store to query |
| `options?` | \{ `errorPattern?`: `RegExp`; `maxCreatedAt?`: `Date`; `minCreatedAt?`: `Date`; \} | Optional filter options |
| `options.errorPattern?` | `RegExp` | Only return tasks with errors matching this pattern |
| `options.maxCreatedAt?` | `Date` | Only return tasks older than this timestamp |
| `options.minCreatedAt?` | `Date` | Only return tasks newer than this timestamp |

## Returns

`Promise`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md)[]&gt;

Array of failed tasks

## Example

```typescript
// Load failed tasks and retry those with transient errors
const failedTasks = await recoverFailedTasks(taskStore);

for (const task of failedTasks) {
  // Check if error is retryable
  if (task.error?.includes("timeout") || task.error?.includes("network")) {
    // Mark for retry
    const retryTask = updateBackgroundTask(task, {
      status: "pending",
      error: undefined,
    });
    await taskStore.save(retryTask);
  }
}
```
