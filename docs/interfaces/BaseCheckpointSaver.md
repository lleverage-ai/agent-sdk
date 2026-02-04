[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BaseCheckpointSaver

# Interface: BaseCheckpointSaver

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:220](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L220)

Abstract storage interface for checkpoints.

Implement this interface to create custom checkpoint storage backends
such as Redis, SQLite, cloud storage, or any other persistence layer.

## Example

```typescript
class RedisCheckpointSaver implements BaseCheckpointSaver {
  constructor(private redis: RedisClient) {}

  async save(checkpoint: Checkpoint): Promise<void> {
    const key = `checkpoint:${checkpoint.threadId}`;
    await this.redis.set(key, JSON.stringify(checkpoint));
  }

  async load(threadId: string): Promise<Checkpoint | undefined> {
    const key = `checkpoint:${threadId}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : undefined;
  }

  // ... other methods
}
```

## Methods

### delete()

> **delete**(`threadId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:251](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L251)

Delete a checkpoint.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The thread ID to delete |

#### Returns

`Promise`&lt;`boolean`&gt;

True if a checkpoint was deleted, false if not found

***

### exists()

> **exists**(`threadId`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:259](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L259)

Check if a checkpoint exists.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The thread ID to check |

#### Returns

`Promise`&lt;`boolean`&gt;

True if the checkpoint exists

***

### list()

> **list**(): `Promise`&lt;`string`[]&gt;

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:243](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L243)

List all thread IDs that have checkpoints.

#### Returns

`Promise`&lt;`string`[]&gt;

Array of thread IDs

***

### load()

> **load**(`threadId`: `string`): `Promise`&lt;[`Checkpoint`](Checkpoint.md) \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:236](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L236)

Load a checkpoint by thread ID.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The unique thread identifier |

#### Returns

`Promise`&lt;[`Checkpoint`](Checkpoint.md) \| `undefined`&gt;

The checkpoint if found, undefined otherwise

***

### save()

> **save**(`checkpoint`: [`Checkpoint`](Checkpoint.md)): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:228](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L228)

Save a checkpoint.

If a checkpoint with the same `threadId` exists, it should be updated.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `checkpoint` | [`Checkpoint`](Checkpoint.md) | The checkpoint to save |

#### Returns

`Promise`&lt;`void`&gt;
