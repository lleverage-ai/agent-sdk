[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PersistentBackendOptions

# Interface: PersistentBackendOptions

Defined in: [packages/agent-sdk/src/backends/persistent.ts:265](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L265)

Configuration options for PersistentBackend.

## Properties

### namespace?

> `optional` **namespace**: `string`

Defined in: [packages/agent-sdk/src/backends/persistent.ts:287](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L287)

Optional namespace prefix for all keys.

Use this to isolate data between different agents, users, or sessions.

#### Default Value

```ts
undefined (no namespace prefix)
```

#### Example

```typescript
// Isolate by user
new PersistentBackend({ store, namespace: "user-123" });

// Isolate by agent
new PersistentBackend({ store, namespace: "agent-coding" });
```

***

### store

> **store**: [`KeyValueStore`](KeyValueStore.md)

Defined in: [packages/agent-sdk/src/backends/persistent.ts:269](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L269)

The key-value store to use for persistence.
