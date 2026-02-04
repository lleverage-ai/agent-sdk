[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / KVTaskStore

# Class: KVTaskStore

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:113](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L113)

Key-value store implementation of the task store.

Stores tasks in a key-value store (Redis, DynamoDB, etc.).
Requires a KeyValueStore implementation.

## Example

```typescript
// Using Redis
import { createClient } from "redis";

const redisClient = createClient();
await redisClient.connect();

const kvStore: KeyValueStore = {
  async get(key) {
    return redisClient.get(key);
  },
  async set(key, value, options) {
    if (options?.ttl) {
      await redisClient.setEx(key, options.ttl, value);
    } else {
      await redisClient.set(key, value);
    }
  },
  async delete(key) {
    const result = await redisClient.del(key);
    return result > 0;
  },
  async exists(key) {
    const result = await redisClient.exists(key);
    return result > 0;
  },
  async keys(pattern) {
    return redisClient.keys(pattern);
  },
};

const store = new KVTaskStore(kvStore, {
  namespace: "myapp",
});
```

## Implements

- [`BaseTaskStore`](../interfaces/BaseTaskStore.md)

## Constructors

### Constructor

> **new KVTaskStore**(`kv`: [`KVStore`](../interfaces/KVStore.md), `options`: [`TaskStoreOptions`](../interfaces/TaskStoreOptions.md)): `KVTaskStore`

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:124](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L124)

Create a new KV-based task store.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `kv` | [`KVStore`](../interfaces/KVStore.md) | The key-value store implementation |
| `options` | [`TaskStoreOptions`](../interfaces/TaskStoreOptions.md) | Configuration options |

#### Returns

`KVTaskStore`

## Methods

### cleanup()

> **cleanup**(): `Promise`&lt;`number`&gt;

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:243](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L243)

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

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:233](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L233)

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

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:238](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L238)

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

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:192](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L192)

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

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:199](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L199)

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

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:164](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L164)

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

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:158](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L158)

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
