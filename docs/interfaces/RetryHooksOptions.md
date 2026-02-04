[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / RetryHooksOptions

# Interface: RetryHooksOptions

Defined in: [packages/agent-sdk/src/hooks/retry.ts:21](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/retry.ts#L21)

Options for creating retry hooks.

## Properties

### backoffMultiplier?

> `optional` **backoffMultiplier**: `number`

Defined in: [packages/agent-sdk/src/hooks/retry.ts:44](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/retry.ts#L44)

Backoff multiplier for exponential backoff.

#### Default Value

```ts
2 (doubles each retry)
```

***

### baseDelay?

> `optional` **baseDelay**: `number`

Defined in: [packages/agent-sdk/src/hooks/retry.ts:32](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/retry.ts#L32)

Base delay in milliseconds for the first retry.

#### Default Value

```ts
1000 (1 second)
```

***

### calculateDelay()?

> `optional` **calculateDelay**: (`attempt`: `number`) => `number`

Defined in: [packages/agent-sdk/src/hooks/retry.ts:63](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/retry.ts#L63)

Custom delay calculator.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `attempt` | `number` |

#### Returns

`number`

#### Default Value

```ts
Exponential backoff with jitter
```

***

### jitter?

> `optional` **jitter**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/retry.ts:51](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/retry.ts#L51)

Whether to add random jitter to retry delays (0-50% of delay).
Helps avoid thundering herd problem.

#### Default Value

```ts
true
```

***

### maxDelay?

> `optional` **maxDelay**: `number`

Defined in: [packages/agent-sdk/src/hooks/retry.ts:38](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/retry.ts#L38)

Maximum delay in milliseconds between retries.

#### Default Value

```ts
30000 (30 seconds)
```

***

### maxRetries?

> `optional` **maxRetries**: `number`

Defined in: [packages/agent-sdk/src/hooks/retry.ts:26](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/retry.ts#L26)

Maximum number of retry attempts.

#### Default Value

```ts
3
```

***

### shouldRetry()?

> `optional` **shouldRetry**: (`error`: `Error`, `attempt`: `number`) => `boolean`

Defined in: [packages/agent-sdk/src/hooks/retry.ts:57](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/retry.ts#L57)

Custom function to determine if an error should trigger a retry.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `error` | `Error` |
| `attempt` | `number` |

#### Returns

`boolean`

#### Default Value

```ts
Retries rate limits, server errors, network errors, timeouts
```
