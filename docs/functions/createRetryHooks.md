[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createRetryHooks

# Function: createRetryHooks()

> **createRetryHooks**(`options`: [`RetryHooksOptions`](../interfaces/RetryHooksOptions.md)): [`HookCallback`](../type-aliases/HookCallback.md)

Defined in: [packages/agent-sdk/src/hooks/retry.ts:162](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/retry.ts#L162)

Creates a retry hook for PostGenerateFailure events.

The hook implements exponential backoff with optional jitter for handling
transient failures. When a retryable error occurs, the hook signals the
agent to retry with an appropriate delay.

This replaces the retry middleware with hook-based retry that works
correctly with the unified hook system.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`RetryHooksOptions`](../interfaces/RetryHooksOptions.md) | Configuration options |

## Returns

[`HookCallback`](../type-aliases/HookCallback.md)

A PostGenerateFailure hook that handles retries

## Examples

```typescript
const retryHook = createRetryHooks({
  maxRetries: 3,
  baseDelay: 1000,
  backoffMultiplier: 2,
});

const agent = createAgent({
  model,
  hooks: {
    PostGenerateFailure: [{ hooks: [retryHook] }],
  },
});
```

```typescript
// Custom retry logic for specific errors
const retryHook = createRetryHooks({
  shouldRetry: (error, attempt) => {
    // Only retry rate limits, and only up to 5 times
    return error.message.includes('rate limit') && attempt < 5;
  },
  baseDelay: 2000,
});
```

```typescript
// Custom delay calculation (linear backoff)
const retryHook = createRetryHooks({
  calculateDelay: (attempt) => attempt * 1000, // 1s, 2s, 3s, ...
});
```
