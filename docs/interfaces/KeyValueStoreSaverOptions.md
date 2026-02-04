[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / KeyValueStoreSaverOptions

# Interface: KeyValueStoreSaverOptions

Defined in: [packages/agent-sdk/src/checkpointer/kv-saver.ts:42](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/kv-saver.ts#L42)

Options for creating a KeyValueStoreSaver.

## Extends

- [`CheckpointSaverOptions`](CheckpointSaverOptions.md)

## Properties

### namespace?

> `optional` **namespace**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:189](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L189)

Namespace for isolating checkpoints.

Useful for multi-tenant scenarios where different users or projects
need separate checkpoint storage.

#### Default Value

```ts
undefined (no namespace)
```

#### Inherited from

[`CheckpointSaverOptions`](CheckpointSaverOptions.md).[`namespace`](CheckpointSaverOptions.md#namespace)

***

### store

> **store**: [`KeyValueStore`](KeyValueStore.md)

Defined in: [packages/agent-sdk/src/checkpointer/kv-saver.ts:50](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/kv-saver.ts#L50)

The key-value store to use for persistence.

Can be any implementation of [KeyValueStore](KeyValueStore.md), such as
[InMemoryStore](../classes/InMemoryStore.md) for testing, or custom implementations
for Redis, SQLite, etc.
