[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FileSaver

# Class: FileSaver

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:95](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L95)

File-based checkpoint saver using JSON files.

Stores each checkpoint as a separate JSON file in the specified directory.
Thread IDs are sanitized to create safe filenames.

## Example

```typescript
const saver = new FileSaver({ dir: "./.checkpoints" });

// Save multiple checkpoints
await saver.save(checkpoint1);
await saver.save(checkpoint2);

// List all threads
const threads = await saver.list();
// ["session-1", "session-2"]

// Clean up
for (const thread of threads) {
  await saver.delete(thread);
}
```

## Implements

- [`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md)

## Constructors

### Constructor

> **new FileSaver**(`options`: [`FileSaverOptions`](../interfaces/FileSaverOptions.md)): `FileSaver`

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:107](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L107)

Create a new FileSaver.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`FileSaverOptions`](../interfaces/FileSaverOptions.md) | Configuration including the directory path |

#### Returns

`FileSaver`

## Methods

### delete()

> **delete**(`threadId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:209](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L209)

Delete a checkpoint file.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The thread ID to delete |

#### Returns

`Promise`&lt;`boolean`&gt;

True if a file was deleted, false if not found

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`delete`](../interfaces/BaseCheckpointSaver.md#delete)

***

### exists()

> **exists**(`threadId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:233](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L233)

Check if a checkpoint file exists.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The thread ID to check |

#### Returns

`Promise`&lt;`boolean`&gt;

True if the file exists

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`exists`](../interfaces/BaseCheckpointSaver.md#exists)

***

### getDir()

> **getDir**(): `string`

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:251](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L251)

Get the directory path where checkpoints are stored.

#### Returns

`string`

***

### getFilePath()

> **getFilePath**(`threadId`: `string`): `string`

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:261](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L261)

Get the full file path for a thread ID.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The thread ID |

#### Returns

`string`

The full file path

***

### list()

> **list**(): `Promise`&lt;`string`[]&gt;

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:173](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L173)

List all thread IDs that have checkpoint files.

#### Returns

`Promise`&lt;`string`[]&gt;

Array of thread IDs

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`list`](../interfaces/BaseCheckpointSaver.md#list)

***

### load()

> **load**(`threadId`: `string`): `Promise`&lt;[`Checkpoint`](../interfaces/Checkpoint.md) \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:139](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L139)

Load a checkpoint from a JSON file.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The thread ID to load |

#### Returns

`Promise`&lt;[`Checkpoint`](../interfaces/Checkpoint.md) \| `undefined`&gt;

The checkpoint if found and valid, undefined otherwise

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`load`](../interfaces/BaseCheckpointSaver.md#load)

***

### save()

> **save**(`checkpoint`: [`Checkpoint`](../interfaces/Checkpoint.md)): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:122](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L122)

Save a checkpoint to a JSON file.

Creates the directory if it doesn't exist.
Overwrites existing checkpoint with the same threadId.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `checkpoint` | [`Checkpoint`](../interfaces/Checkpoint.md) | The checkpoint to save |

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`save`](../interfaces/BaseCheckpointSaver.md#save)
