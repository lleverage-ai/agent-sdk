[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CheckpointSaverOptions

# Interface: CheckpointSaverOptions

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:180](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L180)

Options for creating a checkpoint saver.

## Extended by

- [`FileSaverOptions`](FileSaverOptions.md)
- [`KeyValueStoreSaverOptions`](KeyValueStoreSaverOptions.md)
- [`MemorySaverOptions`](MemorySaverOptions.md)

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
