[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CompactionSchedulerOptions

# Interface: CompactionSchedulerOptions

Defined in: [packages/agent-sdk/src/context-manager.ts:652](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L652)

Options for creating a compaction scheduler.

## Properties

### debounceDelayMs?

> `optional` **debounceDelayMs**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:663](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L663)

Debounce delay in milliseconds (default: 5000).
Prevents multiple compactions from running in rapid succession.

***

### enableBackgroundCompaction?

> `optional` **enableBackgroundCompaction**: `boolean`

Defined in: [packages/agent-sdk/src/context-manager.ts:657](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L657)

Enable background compaction (default: false).
When enabled, compaction runs asynchronously after generation completes.

***

### maxPendingTasks?

> `optional` **maxPendingTasks**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:669](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L669)

Maximum pending tasks before dropping oldest (default: 3).
Prevents unbounded queue growth.

***

### onTaskComplete()?

> `optional` **onTaskComplete**: (`task`: [`CompactionTask`](CompactionTask.md)) => `void`

Defined in: [packages/agent-sdk/src/context-manager.ts:674](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L674)

Callback when a compaction task completes.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `task` | [`CompactionTask`](CompactionTask.md) |

#### Returns

`void`

***

### onTaskError()?

> `optional` **onTaskError**: (`task`: [`CompactionTask`](CompactionTask.md)) => `void`

Defined in: [packages/agent-sdk/src/context-manager.ts:679](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L679)

Callback when a compaction task fails.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `task` | [`CompactionTask`](CompactionTask.md) |

#### Returns

`void`
