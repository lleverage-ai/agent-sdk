[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createPersistentBackend

# Function: createPersistentBackend()

> **createPersistentBackend**(`options`: [`PersistentBackendOptions`](../interfaces/PersistentBackendOptions.md)): [`PersistentBackend`](../classes/PersistentBackend.md)

Defined in: [packages/agent-sdk/src/backends/persistent.ts:760](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L760)

Create a new PersistentBackend.

Convenience function that wraps the PersistentBackend constructor.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`PersistentBackendOptions`](../interfaces/PersistentBackendOptions.md) | Configuration options |

## Returns

[`PersistentBackend`](../classes/PersistentBackend.md)

A new PersistentBackend instance

## Example

```typescript
const store = new InMemoryStore();
const backend = createPersistentBackend({ store });
```
