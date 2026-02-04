[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createMemorySaver

# Function: createMemorySaver()

> **createMemorySaver**(`options?`: [`MemorySaverOptions`](../interfaces/MemorySaverOptions.md)): [`MemorySaver`](../classes/MemorySaver.md)

Defined in: [packages/agent-sdk/src/checkpointer/memory-saver.ts:257](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/memory-saver.ts#L257)

Create a new MemorySaver instance.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options?` | [`MemorySaverOptions`](../interfaces/MemorySaverOptions.md) | Optional configuration |

## Returns

[`MemorySaver`](../classes/MemorySaver.md)

A new MemorySaver instance

## Example

```typescript
const saver = createMemorySaver();

// Or with namespace for multi-tenant isolation
const userSaver = createMemorySaver({ namespace: "user-123" });
```
