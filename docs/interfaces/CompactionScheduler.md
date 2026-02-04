[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CompactionScheduler

# Interface: CompactionScheduler

Defined in: [packages/agent-sdk/src/context-manager.ts:693](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L693)

Scheduler for managing background compaction tasks.

Provides:
- Debouncing to avoid rapid consecutive compactions
- Background task queue with configurable depth
- Task status tracking
- Automatic cleanup of completed tasks

## Methods

### cancel()

> **cancel**(`id`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/context-manager.ts:732](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L732)

Cancel a pending task.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | Task ID |

#### Returns

`boolean`

True if task was cancelled

***

### cleanup()

> **cleanup**(): `void`

Defined in: [packages/agent-sdk/src/context-manager.ts:737](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L737)

Clear all completed and failed tasks from history.

#### Returns

`void`

***

### getLatestResult()

> **getLatestResult**(): [`CompactionResult`](CompactionResult.md) \| `undefined`

Defined in: [packages/agent-sdk/src/context-manager.ts:725](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L725)

Get the most recent completed task result.
This can be applied to the next generation if available.

#### Returns

[`CompactionResult`](CompactionResult.md) \| `undefined`

The most recent completed result, or undefined

***

### getPendingTasks()

> **getPendingTasks**(): [`CompactionTask`](CompactionTask.md)[]

Defined in: [packages/agent-sdk/src/context-manager.ts:718](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L718)

Get all pending tasks.

#### Returns

[`CompactionTask`](CompactionTask.md)[]

Array of pending tasks

***

### getTask()

> **getTask**(`id`: `string`): [`CompactionTask`](CompactionTask.md) \| `undefined`

Defined in: [packages/agent-sdk/src/context-manager.ts:712](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L712)

Get a task by ID.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | Task ID |

#### Returns

[`CompactionTask`](CompactionTask.md) \| `undefined`

The task, or undefined if not found

***

### schedule()

> **schedule**(`messages`: [`ModelMessage`](../type-aliases/ModelMessage.md)[], `agent`: [`Agent`](Agent.md), `trigger`: [`CompactionTrigger`](../type-aliases/CompactionTrigger.md)): `string`

Defined in: [packages/agent-sdk/src/context-manager.ts:701](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L701)

Schedule a compaction task.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `messages` | [`ModelMessage`](../type-aliases/ModelMessage.md)[] | Messages to compact |
| `agent` | [`Agent`](Agent.md) | Agent to use for summarization |
| `trigger` | [`CompactionTrigger`](../type-aliases/CompactionTrigger.md) | Reason compaction was triggered |

#### Returns

`string`

Task ID

***

### shutdown()

> **shutdown**(): `void`

Defined in: [packages/agent-sdk/src/context-manager.ts:742](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L742)

Shutdown the scheduler and cancel all pending tasks.

#### Returns

`void`
