[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createCacheHooks

# Function: createCacheHooks()

> **createCacheHooks**(`options`: [`CacheHooksOptions`](../interfaces/CacheHooksOptions.md)): \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

Defined in: [packages/agent-sdk/src/hooks/cache.ts:212](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L212)

Creates cache hooks for PreGenerate and PostGenerate events.

The PreGenerate hook checks for cached results and returns them via
`respondWith` to short-circuit generation. The PostGenerate hook stores
results in the cache.

This replaces the cache middleware with hook-based caching that works
correctly with streaming (hooks fire at lifecycle boundaries).

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`CacheHooksOptions`](../interfaces/CacheHooksOptions.md) | Configuration options |

## Returns

\[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

Array of two hooks: [PreGenerate cache check, PostGenerate cache store]

## Examples

```typescript
const [cacheCheck, cacheStore] = createCacheHooks({
  ttl: 60000,  // 1 minute
  maxSize: 50,
});

const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [{ hooks: [cacheCheck] }],
    PostGenerate: [{ hooks: [cacheStore] }],
  },
});
```

```typescript
// Custom cache key based on last message
const hooks = createCacheHooks({
  keyGenerator: (input) => {
    const lastMsg = input.options.messages?.[input.options.messages.length - 1];
    return JSON.stringify(lastMsg);
  },
});
```

```typescript
// Conditional caching (only cache when no tools)
const hooks = createCacheHooks({
  shouldCache: (input) => !input.options.tools || Object.keys(input.options.tools).length === 0,
  ttl: 300000,
});
```
