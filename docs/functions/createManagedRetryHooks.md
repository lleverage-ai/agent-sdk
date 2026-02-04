[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createManagedRetryHooks

# Function: createManagedRetryHooks()

> **createManagedRetryHooks**(`options`: [`RetryHooksOptions`](../interfaces/RetryHooksOptions.md)): \{ `getStats`: () => \{ `failures`: `number`; `retriedFailures`: `number`; `retries`: `number`; `successAfterRetry`: `number`; \}; `hook`: [`HookCallback`](../type-aliases/HookCallback.md); \}

Defined in: [packages/agent-sdk/src/hooks/retry.ts:258](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/retry.ts#L258)

Creates a retry hook with custom statistics tracking.

Returns the hook along with a function to get retry statistics.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`RetryHooksOptions`](../interfaces/RetryHooksOptions.md) | Configuration options |

## Returns

\{ `getStats`: () => \{ `failures`: `number`; `retriedFailures`: `number`; `retries`: `number`; `successAfterRetry`: `number`; \}; `hook`: [`HookCallback`](../type-aliases/HookCallback.md); \}

Object with hook and statistics getter

### getStats()

> **getStats**: () => \{ `failures`: `number`; `retriedFailures`: `number`; `retries`: `number`; `successAfterRetry`: `number`; \}

#### Returns

\{ `failures`: `number`; `retriedFailures`: `number`; `retries`: `number`; `successAfterRetry`: `number`; \}

##### failures

> **failures**: `number`

##### retriedFailures

> **retriedFailures**: `number`

##### retries

> **retries**: `number`

##### successAfterRetry

> **successAfterRetry**: `number`

### hook

> **hook**: [`HookCallback`](../type-aliases/HookCallback.md)

## Example

```typescript
const { hook: retryHook, getStats } = createManagedRetryHooks({
  maxRetries: 5,
  baseDelay: 1000,
});

const agent = createAgent({
  model,
  hooks: {
    PostGenerateFailure: [{ hooks: [retryHook] }],
  },
});

// Later, check statistics
const stats = getStats();
console.log(`Retry rate: ${stats.retries / stats.failures}`);
console.log(`Average retries per failure: ${stats.retries / Math.max(1, stats.retriedFailures)}`);
```
