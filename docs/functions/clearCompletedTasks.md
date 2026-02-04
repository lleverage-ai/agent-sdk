[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / clearCompletedTasks

# Function: clearCompletedTasks()

> **clearCompletedTasks**(): `Promise`&lt;`number`&gt;

Defined in: [packages/agent-sdk/src/tools/task.ts:214](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L214)

Clear completed/failed background tasks.

Removes tasks older than the expiration time (if using task store)
or all completed/failed tasks (if using in-memory storage).

## Returns

`Promise`&lt;`number`&gt;

Number of tasks cleared
