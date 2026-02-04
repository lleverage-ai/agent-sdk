[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MemoryTaskStore

# Class: MemoryTaskStore

Defined in: [packages/agent-sdk/src/task-store/memory-store.ts:41](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/memory-store.ts#L41)

In-memory implementation of the task store.

Stores tasks in a Map in memory. All tasks are lost when the process exits.

## Example

```typescript
const store = new MemoryTaskStore();

await store.save({
  id: "task-123",
  subagentType: "researcher",
  description: "Research topic",
  status: "running",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const task = await store.load("task-123");
```

## Implements

- [`BaseTaskStore`](../interfaces/BaseTaskStore.md)

## Constructors

### Constructor

> **new MemoryTaskStore**(`options`: [`TaskStoreOptions`](../interfaces/TaskStoreOptions.md)): `MemoryTaskStore`

Defined in: [packages/agent-sdk/src/task-store/memory-store.ts:51](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/memory-store.ts#L51)

Create a new in-memory task store.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`TaskStoreOptions`](../interfaces/TaskStoreOptions.md) | Configuration options |

#### Returns

`MemoryTaskStore`

## Methods

### cleanup()

> **cleanup**(): `Promise`&lt;`number`&gt;

Defined in: [packages/agent-sdk/src/task-store/memory-store.ts:120](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/memory-store.ts#L120)

Clean up expired tasks.

Removes completed/failed tasks older than the expiration time.

#### Returns

`Promise`&lt;`number`&gt;

Number of tasks cleaned up

#### Implementation of

[`BaseTaskStore`](../interfaces/BaseTaskStore.md).[`cleanup`](../interfaces/BaseTaskStore.md#cleanup)

***

### clear()

> **clear**(): `void`

Defined in: [packages/agent-sdk/src/task-store/memory-store.ts:141](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/memory-store.ts#L141)

Clear all tasks from the store.

Useful for testing.

#### Returns

`void`

***

### delete()

> **delete**(`taskId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/task-store/memory-store.ts:110](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/memory-store.ts#L110)

Delete a task.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `taskId` | `string` | The task ID to delete |

#### Returns

`Promise`&lt;`boolean`&gt;

True if a task was deleted, false if not found

#### Implementation of

[`BaseTaskStore`](../interfaces/BaseTaskStore.md).[`delete`](../interfaces/BaseTaskStore.md#delete)

***

### exists()

> **exists**(`taskId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/task-store/memory-store.ts:115](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/memory-store.ts#L115)

Check if a task exists.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `taskId` | `string` | The task ID to check |

#### Returns

`Promise`&lt;`boolean`&gt;

True if the task exists

#### Implementation of

[`BaseTaskStore`](../interfaces/BaseTaskStore.md).[`exists`](../interfaces/BaseTaskStore.md#exists)

***

### list()

> **list**(`filter?`: \{ `status?`: [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[]; \}): `Promise`&lt;`string`[]&gt;

Defined in: [packages/agent-sdk/src/task-store/memory-store.ts:75](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/memory-store.ts#L75)

List all task IDs.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filter?` | \{ `status?`: [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[]; \} | Optional filter by status |
| `filter.status?` | [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[] | - |

#### Returns

`Promise`&lt;`string`[]&gt;

Array of task IDs

#### Implementation of

[`BaseTaskStore`](../interfaces/BaseTaskStore.md).[`list`](../interfaces/BaseTaskStore.md#list)

***

### listTasks()

> **listTasks**(`filter?`: \{ `status?`: [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[]; \}): `Promise`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md)[]&gt;

Defined in: [packages/agent-sdk/src/task-store/memory-store.ts:82](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/memory-store.ts#L82)

List all tasks.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filter?` | \{ `status?`: [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[]; \} | Optional filter by status |
| `filter.status?` | [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[] | - |

#### Returns

`Promise`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md)[]&gt;

Array of tasks

#### Implementation of

[`BaseTaskStore`](../interfaces/BaseTaskStore.md).[`listTasks`](../interfaces/BaseTaskStore.md#listtasks)

***

### load()

> **load**(`taskId`: `string`): `Promise`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md) \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/task-store/memory-store.ts:69](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/memory-store.ts#L69)

Load a task by ID.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `taskId` | `string` | The unique task identifier |

#### Returns

`Promise`&lt;[`BackgroundTask`](../interfaces/BackgroundTask.md) \| `undefined`&gt;

The task if found, undefined otherwise

#### Implementation of

[`BaseTaskStore`](../interfaces/BaseTaskStore.md).[`load`](../interfaces/BaseTaskStore.md#load)

***

### save()

> **save**(`task`: [`BackgroundTask`](../interfaces/BackgroundTask.md)): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/task-store/memory-store.ts:64](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/memory-store.ts#L64)

Save a task.

If a task with the same `id` exists, it should be updated.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `task` | [`BackgroundTask`](../interfaces/BackgroundTask.md) | The task to save |

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`BaseTaskStore`](../interfaces/BaseTaskStore.md).[`save`](../interfaces/BaseTaskStore.md#save)
