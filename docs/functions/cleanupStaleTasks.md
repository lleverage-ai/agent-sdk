[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / cleanupStaleTasks

# Function: cleanupStaleTasks()

> **cleanupStaleTasks**(`store`: [`BaseTaskStore`](../interfaces/BaseTaskStore.md), `maxAge`: `number`): `Promise`&lt;`number`&gt;

Defined in: [packages/agent-sdk/src/tools/task.ts:370](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L370)

Clean up stale tasks from the task store.

Removes tasks that have been in a terminal state (completed or failed)
for longer than the specified age. This prevents unbounded storage growth
and maintains system health.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `store` | [`BaseTaskStore`](../interfaces/BaseTaskStore.md) | The task store to clean |
| `maxAge` | `number` | Maximum age in milliseconds for terminal tasks |

## Returns

`Promise`&lt;`number`&gt;

Number of tasks cleaned up

## Example

```typescript
// Clean up tasks older than 7 days
const sevenDays = 7 * 24 * 60 * 60 * 1000;
const cleaned = await cleanupStaleTasks(taskStore, sevenDays);
console.log(`Cleaned up ${cleaned} stale tasks`);

// Or use a shorter retention for testing
const oneHour = 60 * 60 * 1000;
await cleanupStaleTasks(taskStore, oneHour);
```
