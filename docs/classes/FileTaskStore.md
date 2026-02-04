[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FileTaskStore

# Class: FileTaskStore

Defined in: [packages/agent-sdk/src/task-store/file-store.ts:46](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/file-store.ts#L46)

File-based implementation of the task store.

Stores each task as a JSON file in the specified directory.
Tasks persist across process restarts.

## Example

```typescript
const store = new FileTaskStore({
  directory: "./task-data",
});

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

> **new FileTaskStore**(`options`: [`TaskStoreOptions`](../interfaces/TaskStoreOptions.md) & \{ `directory`: `string`; \}): `FileTaskStore`

Defined in: [packages/agent-sdk/src/task-store/file-store.ts:56](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/file-store.ts#L56)

Create a new file-based task store.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`TaskStoreOptions`](../interfaces/TaskStoreOptions.md) & \{ `directory`: `string`; \} | Configuration options including directory path |

#### Returns

`FileTaskStore`

## Methods

### cleanup()

> **cleanup**(): `Promise`&lt;`number`&gt;

Defined in: [packages/agent-sdk/src/task-store/file-store.ts:219](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/file-store.ts#L219)

Clean up expired tasks.

Removes completed/failed tasks older than the expiration time.

#### Returns

`Promise`&lt;`number`&gt;

Number of tasks cleaned up

#### Implementation of

[`BaseTaskStore`](../interfaces/BaseTaskStore.md).[`cleanup`](../interfaces/BaseTaskStore.md#cleanup)

***

### delete()

> **delete**(`taskId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/task-store/file-store.ts:194](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/file-store.ts#L194)

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

Defined in: [packages/agent-sdk/src/task-store/file-store.ts:208](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/file-store.ts#L208)

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

Defined in: [packages/agent-sdk/src/task-store/file-store.ts:145](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/file-store.ts#L145)

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

Defined in: [packages/agent-sdk/src/task-store/file-store.ts:152](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/file-store.ts#L152)

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

Defined in: [packages/agent-sdk/src/task-store/file-store.ts:122](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/file-store.ts#L122)

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

Defined in: [packages/agent-sdk/src/task-store/file-store.ts:115](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/file-store.ts#L115)

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
