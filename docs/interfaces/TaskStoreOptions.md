[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / TaskStoreOptions

# Interface: TaskStoreOptions

Defined in: [packages/agent-sdk/src/task-store/types.ts:95](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L95)

Options for creating a task store.

## Properties

### expirationMs?

> `optional` **expirationMs**: `number`

Defined in: [packages/agent-sdk/src/task-store/types.ts:113](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L113)

Task expiration time in milliseconds.

Completed/failed tasks older than this will be automatically cleaned up.

#### Default Value

```ts
86400000 (24 hours)
```

***

### namespace?

> `optional` **namespace**: `string`

Defined in: [packages/agent-sdk/src/task-store/types.ts:104](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L104)

Namespace for isolating tasks.

Useful for multi-tenant scenarios where different users or sessions
need separate task storage.

#### Default Value

```ts
undefined (no namespace)
```
