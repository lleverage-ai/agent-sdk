[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MemorySaver

# Class: MemorySaver

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:76](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L76)

In-memory checkpoint saver.

Stores checkpoints in a JavaScript Map for fast access.
All data is ephemeral and lost when the process terminates.

## Example

```typescript
const saver = new MemorySaver();

// Save a checkpoint
await saver.save(checkpoint);

// List all threads
const threads = await saver.list();

// Load a specific thread
const loaded = await saver.load(threads[0]);

// Delete when done
await saver.delete(threads[0]);
```

## Implements

- [`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md)

## Constructors

### Constructor

> **new MemorySaver**(`options?`: [`MemorySaverOptions`](../interfaces/MemorySaverOptions.md)): `MemorySaver`

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:85](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L85)

Create a new MemorySaver.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options?` | [`MemorySaverOptions`](../interfaces/MemorySaverOptions.md) | Optional configuration |

#### Returns

`MemorySaver`

## Accessors

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:182](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L182)

Get the number of stored checkpoints.

If a namespace is configured, returns count within that namespace only.

##### Returns

`number`

## Methods

### clear()

> **clear**(): `void`

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:202](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L202)

Clear all stored checkpoints.

If a namespace is configured, only clears checkpoints within that namespace.

#### Returns

`void`

***

### delete()

> **delete**(`threadId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:157](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L157)

Delete a checkpoint.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The thread ID to delete |

#### Returns

`Promise`&lt;`boolean`&gt;

True if a checkpoint was deleted, false if not found

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`delete`](../interfaces/BaseCheckpointSaver.md#delete)

***

### exists()

> **exists**(`threadId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:168](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L168)

Check if a checkpoint exists.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The thread ID to check |

#### Returns

`Promise`&lt;`boolean`&gt;

True if the checkpoint exists

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`exists`](../interfaces/BaseCheckpointSaver.md#exists)

***

### list()

> **list**(): `Promise`&lt;`string`[]&gt;

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:134](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L134)

List all thread IDs that have checkpoints.

If a namespace is configured, only returns threads within that namespace.

#### Returns

`Promise`&lt;`string`[]&gt;

Array of thread IDs

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`list`](../interfaces/BaseCheckpointSaver.md#list)

***

### load()

> **load**(`threadId`: `string`): `Promise`&lt;[`Checkpoint`](../interfaces/Checkpoint.md) \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:120](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L120)

Load a checkpoint by thread ID.

Returns a deep copy to prevent external mutation of stored data.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The thread ID to load |

#### Returns

`Promise`&lt;[`Checkpoint`](../interfaces/Checkpoint.md) \| `undefined`&gt;

The checkpoint if found, undefined otherwise

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`load`](../interfaces/BaseCheckpointSaver.md#load)

***

### save()

> **save**(`checkpoint`: [`Checkpoint`](../interfaces/Checkpoint.md)): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:106](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L106)

Save a checkpoint.

If a checkpoint with the same threadId exists, it will be overwritten.
The checkpoint is deep-copied to prevent external mutation.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `checkpoint` | [`Checkpoint`](../interfaces/Checkpoint.md) | The checkpoint to save |

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`save`](../interfaces/BaseCheckpointSaver.md#save)
