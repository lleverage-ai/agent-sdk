[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CacheHooksOptions

# Interface: CacheHooksOptions

Defined in: [packages/agent-sdk/src/hooks/cache.ts:95](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L95)

Options for creating cache hooks.

## Properties

### keyGenerator()?

> `optional` **keyGenerator**: (`input`: [`PreGenerateInput`](PreGenerateInput.md), `context?`: [`HookCallbackContext`](HookCallbackContext.md)) => `string`

Defined in: [packages/agent-sdk/src/hooks/cache.ts:112](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L112)

Custom cache key generator.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | [`PreGenerateInput`](PreGenerateInput.md) |
| `context?` | [`HookCallbackContext`](HookCallbackContext.md) |

#### Returns

`string`

#### Default Value

```ts
Hashes messages, model, temperature, and maxTokens
```

***

### maxSize?

> `optional` **maxSize**: `number`

Defined in: [packages/agent-sdk/src/hooks/cache.ts:106](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L106)

Maximum number of cache entries (for in-memory store).

#### Default Value

```ts
100
```

***

### shouldCache()?

> `optional` **shouldCache**: (`input`: [`PreGenerateInput`](PreGenerateInput.md)) => `boolean`

Defined in: [packages/agent-sdk/src/hooks/cache.ts:124](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L124)

Optional predicate to determine if a request should be cached.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | [`PreGenerateInput`](PreGenerateInput.md) |

#### Returns

`boolean`

#### Default Value

```ts
Always cache
```

***

### store?

> `optional` **store**: [`CacheStoreHook`](CacheStoreHook.md)

Defined in: [packages/agent-sdk/src/hooks/cache.ts:118](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L118)

Cache storage backend.

#### Default Value

```ts
New InMemoryCacheStore
```

***

### ttl?

> `optional` **ttl**: `number`

Defined in: [packages/agent-sdk/src/hooks/cache.ts:100](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L100)

Time-to-live in milliseconds. Cached entries older than this are ignored.

#### Default Value

```ts
300000 (5 minutes)
```
