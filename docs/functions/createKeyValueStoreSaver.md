[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createKeyValueStoreSaver

# Function: createKeyValueStoreSaver()

> **createKeyValueStoreSaver**(`options`: [`KeyValueStoreSaverOptions`](../interfaces/KeyValueStoreSaverOptions.md)): [`KeyValueStoreSaver`](../classes/KeyValueStoreSaver.md)

Defined in: [packages/agent-sdk/src/checkpointer/kv-saver.ts:223](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/kv-saver.ts#L223)

Create a new KeyValueStoreSaver instance.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`KeyValueStoreSaverOptions`](../interfaces/KeyValueStoreSaverOptions.md) | Configuration including the key-value store |

## Returns

[`KeyValueStoreSaver`](../classes/KeyValueStoreSaver.md)

A new KeyValueStoreSaver instance

## Example

```typescript
import { InMemoryStore, createKeyValueStoreSaver } from "@lleverage-ai/agent-sdk";

// Basic usage with InMemoryStore
const store = new InMemoryStore();
const saver = createKeyValueStoreSaver({ store });

// With namespace for isolation
const userSaver = createKeyValueStoreSaver({
  store,
  namespace: "user-123",
});
```
