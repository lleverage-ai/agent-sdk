[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / tryOperations

# Function: tryOperations()

> **tryOperations**&lt;`T`&gt;(`operations`: () => `Promise`&lt;`T`&gt;[], `options`: \{ `onError?`: (`error`: [`AgentError`](../classes/AgentError.md), `index`: `number`) => `void` \| `Promise`&lt;`void`&gt;; \}): `Promise`&lt;`T`&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:1304](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L1304)

Execute multiple operations until one succeeds.

Tries each operation in order and returns the first successful result.

## Type Parameters

| Type Parameter |
| :------ |
| `T` |

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `operations` | () => `Promise`&lt;`T`&gt;[] | Array of operations to try |
| `options` | \{ `onError?`: (`error`: [`AgentError`](../classes/AgentError.md), `index`: `number`) => `void` \| `Promise`&lt;`void`&gt;; \} | Options including error handling |
| `options.onError?` | (`error`: [`AgentError`](../classes/AgentError.md), `index`: `number`) => `void` \| `Promise`&lt;`void`&gt; | - |

## Returns

`Promise`&lt;`T`&gt;

The first successful result

## Throws

The last error if all operations fail

## Example

```typescript
const result = await tryOperations([
  () => fetchFromPrimaryAPI(),
  () => fetchFromSecondaryAPI(),
  () => fetchFromCache(),
]);
```
