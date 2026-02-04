[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BaseTaskStore

# Interface: BaseTaskStore

Defined in: [packages/agent-sdk/src/task-store/types.ts:144](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L144)

Abstract storage interface for background tasks.

Implement this interface to create custom task storage backends
such as Redis, SQLite, cloud storage, or any other persistence layer.

## Example

```typescript
class RedisTaskStore implements BaseTaskStore {
  constructor(private redis: RedisClient) {}

  async save(task: BackgroundTask): Promise<void> {
    const key = `task:${task.id}`;
    await this.redis.set(key, JSON.stringify(task));
  }

  async load(taskId: string): Promise<BackgroundTask | undefined> {
    const key = `task:${taskId}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : undefined;
  }

  // ... other methods
}
```

## Methods

### cleanup()

> **cleanup**(): `Promise`&lt;`number`&gt;

Defined in: [packages/agent-sdk/src/task-store/types.ts:205](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L205)

Clean up expired tasks.

Removes completed/failed tasks older than the expiration time.

#### Returns

`Promise`&lt;`number`&gt;

Number of tasks cleaned up

***

### delete()

> **delete**(`taskId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/task-store/types.ts:188](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L188)

Delete a task.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `taskId` | `string` | The task ID to delete |

#### Returns

`Promise`&lt;`boolean`&gt;

True if a task was deleted, false if not found

***

### exists()

> **exists**(`taskId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/task-store/types.ts:196](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L196)

Check if a task exists.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `taskId` | `string` | The task ID to check |

#### Returns

`Promise`&lt;`boolean`&gt;

True if the task exists

***

### list()

> **list**(`filter?`: \{ `status?`: [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[]; \}): `Promise`&lt;`string`[]&gt;

Defined in: [packages/agent-sdk/src/task-store/types.ts:168](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L168)

List all task IDs.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filter?` | \{ `status?`: [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[]; \} | Optional filter by status |
| `filter.status?` | [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[] | - |

#### Returns

`Promise`&lt;`string`[]&gt;

Array of task IDs

***

### listTasks()

> **listTasks**(`filter?`: \{ `status?`: [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[]; \}): `Promise`&lt;[`BackgroundTask`](BackgroundTask.md)[]&gt;

Defined in: [packages/agent-sdk/src/task-store/types.ts:178](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L178)

List all tasks.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filter?` | \{ `status?`: [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[]; \} | Optional filter by status |
| `filter.status?` | [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md) \| [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)[] | - |

#### Returns

`Promise`&lt;[`BackgroundTask`](BackgroundTask.md)[]&gt;

Array of tasks

***

### load()

> **load**(`taskId`: `string`): `Promise`&lt;[`BackgroundTask`](BackgroundTask.md) \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/task-store/types.ts:160](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L160)

Load a task by ID.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `taskId` | `string` | The unique task identifier |

#### Returns

`Promise`&lt;[`BackgroundTask`](BackgroundTask.md) \| `undefined`&gt;

The task if found, undefined otherwise

***

### save()

> **save**(`task`: [`BackgroundTask`](BackgroundTask.md)): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/task-store/types.ts:152](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L152)

Save a task.

If a task with the same `id` exists, it should be updated.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `task` | [`BackgroundTask`](BackgroundTask.md) | The task to save |

#### Returns

`Promise`&lt;`void`&gt;
