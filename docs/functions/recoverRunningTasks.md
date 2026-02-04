[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / recoverRunningTasks

# Function: recoverRunningTasks()

> **recoverRunningTasks**(`store?`: [`BaseTaskStore`](../interfaces/BaseTaskStore.md)): `Promise`&lt;`number`&gt;

Defined in: [packages/agent-sdk/src/tools/task.ts:249](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L249)

Recover running tasks on agent restart.

When using a task store, this function loads all "running" tasks
and marks them as "failed" since they were interrupted by the restart.

Call this function when initializing your agent to handle crashed tasks.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `store?` | [`BaseTaskStore`](../interfaces/BaseTaskStore.md) | Optional task store to use. If not provided, uses the global task store. |

## Returns

`Promise`&lt;`number`&gt;

Number of tasks recovered

## Example

```typescript
// On agent startup
const recovered = await recoverRunningTasks();
console.log(`Recovered ${recovered} interrupted tasks`);
```
