[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / withFallbackFn

# Function: withFallbackFn()

> **withFallbackFn**&lt;`T`&gt;(`fn`: () => `Promise`&lt;`T`&gt;, `fallbackFn`: (`error`: [`AgentError`](../classes/AgentError.md)) => `T` \| `Promise`&lt;`T`&gt;, `onError?`: (`error`: [`AgentError`](../classes/AgentError.md)) => `void` \| `Promise`&lt;`void`&gt;): `Promise`&lt;`T`&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:1265](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L1265)

Execute an operation with a fallback function on error.

Similar to withFallback but allows computing the fallback value.

## Type Parameters

| Type Parameter |
| :------ |
| `T` |

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `fn` | () => `Promise`&lt;`T`&gt; | The primary operation |
| `fallbackFn` | (`error`: [`AgentError`](../classes/AgentError.md)) => `T` \| `Promise`&lt;`T`&gt; | Function to compute the fallback |
| `onError?` | (`error`: [`AgentError`](../classes/AgentError.md)) => `void` \| `Promise`&lt;`void`&gt; | Optional error callback |

## Returns

`Promise`&lt;`T`&gt;

The result or computed fallback

## Example

```typescript
const data = await withFallbackFn(
  () => fetchFromPrimary(),
  (error) => fetchFromBackup(error)
);
```
