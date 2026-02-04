[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createManagedRateLimitHooks

# Function: createManagedRateLimitHooks()

> **createManagedRateLimitHooks**(`options`: [`RateLimitHooksOptions`](../interfaces/RateLimitHooksOptions.md)): \{ `getCurrentUsage`: () => `number`; `getRemainingTokens`: () => `number`; `getServerLimits`: () => [`ServerRateLimitInfo`](../interfaces/ServerRateLimitInfo.md) \| `undefined`; `hooks`: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]; `reset`: () => `void`; \}

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:515](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L515)

Creates managed rate limit hooks with programmatic control.

Returns hooks along with functions to get current usage, reset limits,
and check remaining capacity.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`RateLimitHooksOptions`](../interfaces/RateLimitHooksOptions.md) | Configuration options |

## Returns

\{ `getCurrentUsage`: () => `number`; `getRemainingTokens`: () => `number`; `getServerLimits`: () => [`ServerRateLimitInfo`](../interfaces/ServerRateLimitInfo.md) \| `undefined`; `hooks`: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]; `reset`: () => `void`; \}

Object with hooks and rate limit control functions

### getCurrentUsage()

> **getCurrentUsage**: () => `number`

#### Returns

`number`

### getRemainingTokens()

> **getRemainingTokens**: () => `number`

#### Returns

`number`

### getServerLimits()

> **getServerLimits**: () => [`ServerRateLimitInfo`](../interfaces/ServerRateLimitInfo.md) \| `undefined`

#### Returns

[`ServerRateLimitInfo`](../interfaces/ServerRateLimitInfo.md) \| `undefined`

### hooks

> **hooks**: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

### reset()

> **reset**: () => `void`

#### Returns

`void`

## Example

```typescript
const { hooks, getCurrentUsage, getRemainingTokens, reset } = createManagedRateLimitHooks({
  maxTokensPerWindow: 100000,
  windowMs: 60000,
});

const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [{ hooks: [hooks[0]] }],
    PostGenerate: [{ hooks: [hooks[1]] }],
  },
});

// Check current usage
const used = getCurrentUsage();
const remaining = getRemainingTokens();
console.log(`Token usage: ${used} / ${maxTokensPerWindow} (${remaining} remaining)`);

// Reset limits (e.g., for testing or manual override)
reset();
```
