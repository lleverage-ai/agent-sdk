[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / KVStore

# Interface: KVStore

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:25](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L25)

Abstract key-value store interface.

Implement this interface to connect to your KV store backend.

## Methods

### delete()

> **delete**(`key`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:49](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L49)

Delete a key.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `key` | `string` | The key to delete |

#### Returns

`Promise`&lt;`boolean`&gt;

True if deleted, false if not found

***

### exists()

> **exists**(`key`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:57](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L57)

Check if a key exists.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `key` | `string` | The key to check |

#### Returns

`Promise`&lt;`boolean`&gt;

True if exists

***

### get()

> **get**(`key`: `string`): `Promise`&lt;`string` \| `null`&gt;

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:32](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L32)

Get a value by key.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `key` | `string` | The key to get |

#### Returns

`Promise`&lt;`string` \| `null`&gt;

The value if found, null otherwise

***

### keys()

> **keys**(`pattern`: `string`): `Promise`&lt;`string`[]&gt;

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:65](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L65)

List all keys matching a pattern.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pattern` | `string` | Glob pattern (e.g., "tasks:*") |

#### Returns

`Promise`&lt;`string`[]&gt;

Array of matching keys

***

### set()

> **set**(`key`: `string`, `value`: `string`, `options?`: \{ `ttl?`: `number`; \}): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/task-store/kv-store.ts:41](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/kv-store.ts#L41)

Set a value for a key.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `key` | `string` | The key to set |
| `value` | `string` | The value to store |
| `options?` | \{ `ttl?`: `number`; \} | Optional TTL in seconds |
| `options.ttl?` | `number` | - |

#### Returns

`Promise`&lt;`void`&gt;
