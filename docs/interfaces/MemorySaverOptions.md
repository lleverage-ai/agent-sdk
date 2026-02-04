[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MemorySaverOptions

# Interface: MemorySaverOptions

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:43](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L43)

Options for creating a MemorySaver.

## Extends

- [`CheckpointSaverOptions`](CheckpointSaverOptions.md)

## Properties

### initialCheckpoints?

> `optional` **initialCheckpoints**: [`Checkpoint`](Checkpoint.md)[]

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:48](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L48)

Initial checkpoints to populate the store with.
Useful for testing or restoring from a backup.

***

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
