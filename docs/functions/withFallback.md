[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / withFallback

# Function: withFallback()

> **withFallback**&lt;`T`&gt;(`fn`: () => `Promise`&lt;`T`&gt;, `options`: [`FallbackOptions`](../interfaces/FallbackOptions.md)&lt;`T`&gt;): `Promise`&lt;`T`&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:1213](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L1213)

Execute an operation with a fallback value on error.

Provides graceful degradation by returning a fallback value when
the primary operation fails.

## Type Parameters

| Type Parameter |
| :------ |
| `T` |

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `fn` | () => `Promise`&lt;`T`&gt; | The operation to execute |
| `options` | [`FallbackOptions`](../interfaces/FallbackOptions.md)&lt;`T`&gt; | Fallback options |

## Returns

`Promise`&lt;`T`&gt;

The result or fallback value

## Example

```typescript
const memory = await withFallback(
  () => loadAgentMemory("/path/to/memory.md"),
  { fallback: "", logError: true }
);
```
