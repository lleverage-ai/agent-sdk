[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / listBackgroundTasks

# Function: listBackgroundTasks()

> **listBackgroundTasks**(`filter?`: \{ `status?`: [`TaskStatus`](../type-aliases/TaskStatus.md) \| [`TaskStatus`](../type-aliases/TaskStatus.md)[]; \}): `Promise`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md)[]&gt;

Defined in: [packages/agent-sdk/src/tools/task.ts:185](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L185)

List all background tasks.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filter?` | \{ `status?`: [`TaskStatus`](../type-aliases/TaskStatus.md) \| [`TaskStatus`](../type-aliases/TaskStatus.md)[]; \} | Optional filter by status |
| `filter.status?` | [`TaskStatus`](../type-aliases/TaskStatus.md) \| [`TaskStatus`](../type-aliases/TaskStatus.md)[] | - |

## Returns

`Promise`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md)[]&gt;

Array of all tracked tasks
