[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CacheStoreHook

# Interface: CacheStoreHook

Defined in: [packages/agent-sdk/src/hooks/cache.ts:37](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L37)

Cache storage interface.

Implement this interface to provide custom cache backends
(Redis, file-based, etc.).

## Methods

### clear()

> **clear**(): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/hooks/cache.ts:45](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L45)

Clear all cache entries

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### delete()

> **delete**(`key`: `string`): `boolean` \| `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/hooks/cache.ts:43](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L43)

Delete a cache entry

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean` \| `Promise`&lt;`boolean`&gt;

***

### get()

> **get**(`key`: `string`): [`CacheEntryHook`](CacheEntryHook.md) \| `Promise`&lt;[`CacheEntryHook`](CacheEntryHook.md) \| `undefined`&gt; \| `undefined`

Defined in: [packages/agent-sdk/src/hooks/cache.ts:39](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L39)

Get a cached entry by key

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

[`CacheEntryHook`](CacheEntryHook.md) \| `Promise`&lt;[`CacheEntryHook`](CacheEntryHook.md) \| `undefined`&gt; \| `undefined`

***

### set()

> **set**(`key`: `string`, `value`: [`CacheEntryHook`](CacheEntryHook.md)): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/hooks/cache.ts:41](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L41)

Store a cache entry

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | [`CacheEntryHook`](CacheEntryHook.md) |

#### Returns

`void` \| `Promise`&lt;`void`&gt;
