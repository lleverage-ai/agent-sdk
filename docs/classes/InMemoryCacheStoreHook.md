[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / InMemoryCacheStoreHook

# Class: InMemoryCacheStoreHook

Defined in: [packages/agent-sdk/src/hooks/cache.ts:53](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L53)

Default in-memory cache store implementation with LRU eviction.

## Implements

- [`CacheStoreHook`](../interfaces/CacheStoreHook.md)

## Constructors

### Constructor

> **new InMemoryCacheStoreHook**(`maxSize`: `number`): `InMemoryCacheStore`

Defined in: [packages/agent-sdk/src/hooks/cache.ts:57](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L57)

#### Parameters

| Parameter | Type | Default value |
| :------ | :------ | :------ |
| `maxSize` | `number` | `100` |

#### Returns

`InMemoryCacheStore`

## Accessors

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [packages/agent-sdk/src/hooks/cache.ts:85](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L85)

Get current cache size

##### Returns

`number`

## Methods

### clear()

> **clear**(): `void`

Defined in: [packages/agent-sdk/src/hooks/cache.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L80)

Clear all cache entries

#### Returns

`void`

#### Implementation of

[`CacheStoreHook`](../interfaces/CacheStoreHook.md).[`clear`](../interfaces/CacheStoreHook.md#clear)

***

### delete()

> **delete**(`key`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/hooks/cache.ts:76](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L76)

Delete a cache entry

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

#### Implementation of

[`CacheStoreHook`](../interfaces/CacheStoreHook.md).[`delete`](../interfaces/CacheStoreHook.md#delete)

***

### get()

> **get**(`key`: `string`): [`CacheEntryHook`](../interfaces/CacheEntryHook.md) \| `undefined`

Defined in: [packages/agent-sdk/src/hooks/cache.ts:61](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L61)

Get a cached entry by key

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

[`CacheEntryHook`](../interfaces/CacheEntryHook.md) \| `undefined`

#### Implementation of

[`CacheStoreHook`](../interfaces/CacheStoreHook.md).[`get`](../interfaces/CacheStoreHook.md#get)

***

### set()

> **set**(`key`: `string`, `value`: [`CacheEntryHook`](../interfaces/CacheEntryHook.md)): `void`

Defined in: [packages/agent-sdk/src/hooks/cache.ts:65](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/cache.ts#L65)

Store a cache entry

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | [`CacheEntryHook`](../interfaces/CacheEntryHook.md) |

#### Returns

`void`

#### Implementation of

[`CacheStoreHook`](../interfaces/CacheStoreHook.md).[`set`](../interfaces/CacheStoreHook.md#set)
