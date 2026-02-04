[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createRateLimitHooks

# Function: createRateLimitHooks()

> **createRateLimitHooks**(`options`: [`RateLimitHooksOptions`](../interfaces/RateLimitHooksOptions.md)): \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:405](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L405)

Creates rate limiting hooks for PreGenerate and PostGenerate events.

The PreGenerate hook checks if the rate limit would be exceeded and denies
the request if so. The PostGenerate hook records actual token usage.

This replaces rate limiting middleware with hook-based rate limiting that
works correctly with the unified hook system.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`RateLimitHooksOptions`](../interfaces/RateLimitHooksOptions.md) | Configuration options |

## Returns

\[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

Array of two hooks: [PreGenerate rate check, PostGenerate usage tracking]

## Examples

```typescript
const [rateCheck, usageTracker] = createRateLimitHooks({
  maxTokensPerWindow: 50000,  // 50k tokens
  windowMs: 60000,             // per minute
});

const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [{ hooks: [rateCheck] }],
    PostGenerate: [{ hooks: [usageTracker] }],
  },
});
```

```typescript
// Custom rate limit logic
const hooks = createRateLimitHooks({
  shouldAllow: (tokensUsed, maxTokens) => {
    // Allow if under 80% of limit
    return tokensUsed < maxTokens * 0.8;
  },
});
```

```typescript
// With server rate limit integration
const hooks = createRateLimitHooks({
  maxTokensPerWindow: 100000,
  enableServerLimits: true,  // Parse x-ratelimit-* headers
});
```

```typescript
// Custom server limit extraction for non-standard headers
const hooks = createRateLimitHooks({
  enableServerLimits: true,
  extractServerLimits: (result) => {
    const headers = result.response?.headers;
    return {
      remaining: parseInt(headers?.['x-custom-remaining'] || '0'),
      reset: parseInt(headers?.['x-custom-reset'] || '0'),
    };
  },
});
```
