[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / KeyValueStore

# Interface: KeyValueStore

Defined in: [packages/agent-sdk/src/backends/persistent.ts:87](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L87)

Pluggable key-value store interface.

Implement this interface to add persistence to any storage backend.
The namespace array allows for hierarchical organization of data.

## Example

```typescript
// Example Redis implementation
class RedisStore implements KeyValueStore {
  private redis: RedisClient;

  private makeKey(namespace: string[], key: string): string {
    return [...namespace, key].join(":");
  }

  async get(namespace: string[], key: string) {
    const data = await this.redis.get(this.makeKey(namespace, key));
    return data ? JSON.parse(data) : undefined;
  }

  async put(namespace: string[], key: string, value: Record<string, unknown>) {
    await this.redis.set(this.makeKey(namespace, key), JSON.stringify(value));
  }

  async delete(namespace: string[], key: string) {
    await this.redis.del(this.makeKey(namespace, key));
  }

  async list(namespace: string[]) {
    const pattern = [...namespace, "*"].join(":");
    const keys = await this.redis.keys(pattern);
    return Promise.all(keys.map(async k => ({
      key: k.split(":").pop()!,
      value: JSON.parse(await this.redis.get(k) || "{}"),
    })));
  }
}
```

## Methods

### delete()

> **delete**(`namespace`: `string`[], `key`: `string`): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:119](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L119)

Delete a value by namespace and key.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `namespace` | `string`[] | Hierarchical namespace array |
| `key` | `string` | The key to delete |

#### Returns

`Promise`&lt;`void`&gt;

***

### get()

> **get**(`namespace`: `string`[], `key`: `string`): `Promise`&lt;`Record`&lt;`string`, `unknown`&gt; \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:95](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L95)

Get a value by namespace and key.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `namespace` | `string`[] | Hierarchical namespace array (e.g., ["user-123", "filesystem"]) |
| `key` | `string` | The key to retrieve |

#### Returns

`Promise`&lt;`Record`&lt;`string`, `unknown`&gt; \| `undefined`&gt;

The value if found, undefined otherwise

***

### list()

> **list**(`namespace`: `string`[]): `Promise`&lt;\{ `key`: `string`; `value`: `Record`&lt;`string`, `unknown`&gt;; \}[]&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:127](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L127)

List all keys and values in a namespace.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `namespace` | `string`[] | Hierarchical namespace array |

#### Returns

`Promise`&lt;\{ `key`: `string`; `value`: `Record`&lt;`string`, `unknown`&gt;; \}[]&gt;

Array of key-value pairs in the namespace

***

### put()

> **put**(`namespace`: `string`[], `key`: `string`, `value`: `Record`&lt;`string`, `unknown`&gt;): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:107](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L107)

Store a value at the given namespace and key.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `namespace` | `string`[] | Hierarchical namespace array |
| `key` | `string` | The key to store at |
| `value` | `Record`&lt;`string`, `unknown`&gt; | The value to store (must be JSON-serializable) |

#### Returns

`Promise`&lt;`void`&gt;
