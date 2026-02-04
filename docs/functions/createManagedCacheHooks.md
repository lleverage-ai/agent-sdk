[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createManagedCacheHooks

# Function: createManagedCacheHooks()

> **createManagedCacheHooks**(`options`: [`CacheHooksOptions`](../interfaces/CacheHooksOptions.md)): \{ `clearCache`: () => `void` \| `Promise`&lt;`void`&gt;; `deleteEntry`: (`key`: `string`) => `boolean` \| `Promise`&lt;`boolean`&gt;; `getStats`: () => \{ `hits`: `number`; `misses`: `number`; `size`: `number`; \}; `hooks`: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]; \}

Defined in: [packages/agent-sdk/src/hooks/cache.ts:316](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L316)

Creates managed cache hooks with programmatic cache control.

Returns hooks along with functions to clear cache, delete entries,
and get statistics.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`CacheHooksOptions`](../interfaces/CacheHooksOptions.md) | Configuration options |

## Returns

\{ `clearCache`: () => `void` \| `Promise`&lt;`void`&gt;; `deleteEntry`: (`key`: `string`) => `boolean` \| `Promise`&lt;`boolean`&gt;; `getStats`: () => \{ `hits`: `number`; `misses`: `number`; `size`: `number`; \}; `hooks`: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]; \}

Object with hooks and cache control functions

### clearCache()

> **clearCache**: () => `void` \| `Promise`&lt;`void`&gt;

#### Returns

`void` \| `Promise`&lt;`void`&gt;

### deleteEntry()

> **deleteEntry**: (`key`: `string`) => `boolean` \| `Promise`&lt;`boolean`&gt;

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean` \| `Promise`&lt;`boolean`&gt;

### getStats()

> **getStats**: () => \{ `hits`: `number`; `misses`: `number`; `size`: `number`; \}

#### Returns

\{ `hits`: `number`; `misses`: `number`; `size`: `number`; \}

##### hits

> **hits**: `number`

##### misses

> **misses**: `number`

##### size

> **size**: `number`

### hooks

> **hooks**: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

## Example

```typescript
const { hooks, clearCache, getStats } = createManagedCacheHooks();

const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [{ hooks: [hooks[0]] }],
    PostGenerate: [{ hooks: [hooks[1]] }],
  },
});

// Clear cache when needed
await clearCache();

// Get cache statistics
const { size, hits, misses } = getStats();
console.log(`Cache hit rate: ${hits / (hits + misses)}`);
```
