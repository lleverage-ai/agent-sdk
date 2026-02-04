[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createErrorHandler

# Function: createErrorHandler()

> **createErrorHandler**(`options`: \{ `onError?`: (`error`: [`AgentError`](../classes/AgentError.md)) => `void` \| `Promise`&lt;`void`&gt;; `transform?`: (`error`: `unknown`) => [`AgentError`](../classes/AgentError.md); \}): &lt;`T`&gt;(`fn`: () => `Promise`&lt;`T`&gt;) => `Promise`&lt;`T`&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:1150](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L1150)

Create an error handler that catches and transforms errors.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | \{ `onError?`: (`error`: [`AgentError`](../classes/AgentError.md)) => `void` \| `Promise`&lt;`void`&gt;; `transform?`: (`error`: `unknown`) => [`AgentError`](../classes/AgentError.md); \} | Handler options |
| `options.onError?` | (`error`: [`AgentError`](../classes/AgentError.md)) => `void` \| `Promise`&lt;`void`&gt; | - |
| `options.transform?` | (`error`: `unknown`) => [`AgentError`](../classes/AgentError.md) | - |

## Returns

A function that wraps async operations with error handling

> &lt;`T`&gt;(`fn`: () => `Promise`&lt;`T`&gt;): `Promise`&lt;`T`&gt;

### Type Parameters

| Type Parameter |
| :------ |
| `T` |

### Parameters

| Parameter | Type |
| :------ | :------ |
| `fn` | () => `Promise`&lt;`T`&gt; |

### Returns

`Promise`&lt;`T`&gt;

## Example

```typescript
const handle = createErrorHandler({
  onError: (error) => console.error(error),
  transform: (error) => wrapError(error, "Operation failed"),
});

const result = await handle(async () => {
  return await riskyOperation();
});
```
