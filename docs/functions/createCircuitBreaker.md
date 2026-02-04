[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createCircuitBreaker

# Function: createCircuitBreaker()

> **createCircuitBreaker**(`options`: \{ `failureThreshold?`: `number`; `onStateChange?`: (`state`: `"closed"` \| `"open"` \| `"half-open"`) => `void`; `resetTimeout?`: `number`; \}): &lt;`T`&gt;(`fn`: () => `Promise`&lt;`T`&gt;) => `Promise`&lt;`T`&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:1355](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L1355)

Create a circuit breaker for error protection.

Opens the circuit after threshold failures to prevent cascading failures.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | \{ `failureThreshold?`: `number`; `onStateChange?`: (`state`: `"closed"` \| `"open"` \| `"half-open"`) => `void`; `resetTimeout?`: `number`; \} | Circuit breaker options |
| `options.failureThreshold?` | `number` | - |
| `options.onStateChange?` | (`state`: `"closed"` \| `"open"` \| `"half-open"`) => `void` | - |
| `options.resetTimeout?` | `number` | - |

## Returns

A function that wraps operations with circuit breaker protection

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
const breaker = createCircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000,
});

const result = await breaker(() => callExternalService());
```
