[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FileSaverOptions

# Interface: FileSaverOptions

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:44](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L44)

Options for creating a FileSaver.

## Extends

- [`CheckpointSaverOptions`](CheckpointSaverOptions.md)

## Properties

### dir

> **dir**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:50](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L50)

Directory path for storing checkpoint files.

The directory will be created if it doesn't exist.

***

### extension?

> `optional` **extension**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:56](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L56)

File extension for checkpoint files.

#### Default Value

```ts
".json"
```

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

***

### pretty?

> `optional` **pretty**: `boolean`

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:62](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L62)

Whether to format JSON with indentation for readability.

#### Default Value

```ts
true
```
