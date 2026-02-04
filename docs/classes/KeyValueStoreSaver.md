[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / KeyValueStoreSaver

# Class: KeyValueStoreSaver

Defined in: [packages/agent-sdk/src/checkpointer/kv-saver.ts:85](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/kv-saver.ts#L85)

Checkpoint saver that wraps a KeyValueStore.

Stores checkpoints at: `[namespace?, "checkpoints", threadId]`

This adapter allows using any KeyValueStore implementation for checkpoint
persistence, making it easy to integrate with existing storage systems.

## Example

```typescript
// Use with InMemoryStore for testing
import { InMemoryStore, KeyValueStoreSaver } from "@lleverage-ai/agent-sdk";

const store = new InMemoryStore();
const saver = new KeyValueStoreSaver({ store });

await saver.save(checkpoint);
const loaded = await saver.load("session-123");

// Use with namespace for multi-tenant isolation
const userSaver = new KeyValueStoreSaver({
  store,
  namespace: "user-456",
});
```

## Implements

- [`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md)

## Constructors

### Constructor

> **new KeyValueStoreSaver**(`options`: [`KeyValueStoreSaverOptions`](../interfaces/KeyValueStoreSaverOptions.md)): `KeyValueStoreSaver`

Defined in: [packages/agent-sdk/src/checkpointer/kv-saver.ts:94](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/kv-saver.ts#L94)

Create a new KeyValueStoreSaver.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`KeyValueStoreSaverOptions`](../interfaces/KeyValueStoreSaverOptions.md) | Configuration including the key-value store |

#### Returns

`KeyValueStoreSaver`

## Methods

### delete()

> **delete**(`threadId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/kv-saver.ts:155](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/kv-saver.ts#L155)

Delete a checkpoint from the key-value store.

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

Defined in: [packages/agent-sdk/src/checkpointer/kv-saver.ts:174](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/kv-saver.ts#L174)

Check if a checkpoint exists in the key-value store.

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

Defined in: [packages/agent-sdk/src/checkpointer/kv-saver.ts:142](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/kv-saver.ts#L142)

List all thread IDs that have checkpoints.

#### Returns

`Promise`&lt;`string`[]&gt;

Array of thread IDs

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`list`](../interfaces/BaseCheckpointSaver.md#list)

***

### load()

> **load**(`threadId`: `string`): `Promise`&lt;[`Checkpoint`](../interfaces/Checkpoint.md) \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/kv-saver.ts:118](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/kv-saver.ts#L118)

Load a checkpoint from the key-value store.

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

Defined in: [packages/agent-sdk/src/checkpointer/kv-saver.ts:104](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/kv-saver.ts#L104)

Save a checkpoint to the key-value store.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `checkpoint` | [`Checkpoint`](../interfaces/Checkpoint.md) | The checkpoint to save |

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`BaseCheckpointSaver`](../interfaces/BaseCheckpointSaver.md).[`save`](../interfaces/BaseCheckpointSaver.md#save)
