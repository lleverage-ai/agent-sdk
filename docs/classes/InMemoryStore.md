[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / InMemoryStore

# Class: InMemoryStore

Defined in: [packages/agent-sdk/src/backends/persistent.ts:158](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L158)

In-memory implementation of KeyValueStore for development and testing.

Data is stored in a Map and lost when the process ends.
Use this for development or as a reference implementation.

## Example

```typescript
const store = new InMemoryStore();

// Store data
await store.put(["app", "users"], "user-1", { name: "Alice" });

// Retrieve data
const user = await store.get(["app", "users"], "user-1");

// List all users
const users = await store.list(["app", "users"]);
```

## Implements

- [`KeyValueStore`](../interfaces/KeyValueStore.md)

## Constructors

### Constructor

> **new InMemoryStore**(): `InMemoryStore`

#### Returns

`InMemoryStore`

## Accessors

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [packages/agent-sdk/src/backends/persistent.ts:251](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L251)

Get the number of entries in the store.

Useful for testing.

##### Returns

`number`

## Methods

### clear()

> **clear**(): `void`

Defined in: [packages/agent-sdk/src/backends/persistent.ts:242](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L242)

Clear all data from the store.

Useful for testing cleanup.

#### Returns

`void`

***

### delete()

> **delete**(`namespace`: `string`[], `key`: `string`): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:213](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L213)

Delete a value by namespace and key.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `namespace` | `string`[] | Hierarchical namespace array |
| `key` | `string` | The key to delete |

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`KeyValueStore`](../interfaces/KeyValueStore.md).[`delete`](../interfaces/KeyValueStore.md#delete)

***

### get()

> **get**(`namespace`: `string`[], `key`: `string`): `Promise`&lt;`Record`&lt;`string`, `unknown`&gt; \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:193](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L193)

Get a value by namespace and key.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `namespace` | `string`[] | Hierarchical namespace array (e.g., ["user-123", "filesystem"]) |
| `key` | `string` | The key to retrieve |

#### Returns

`Promise`&lt;`Record`&lt;`string`, `unknown`&gt; \| `undefined`&gt;

The value if found, undefined otherwise

#### Implementation of

[`KeyValueStore`](../interfaces/KeyValueStore.md).[`get`](../interfaces/KeyValueStore.md#get)

***

### list()

> **list**(`namespace`: `string`[]): `Promise`&lt;\{ `key`: `string`; `value`: `Record`&lt;`string`, `unknown`&gt;; \}[]&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:218](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L218)

List all keys and values in a namespace.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `namespace` | `string`[] | Hierarchical namespace array |

#### Returns

`Promise`&lt;\{ `key`: `string`; `value`: `Record`&lt;`string`, `unknown`&gt;; \}[]&gt;

Array of key-value pairs in the namespace

#### Implementation of

[`KeyValueStore`](../interfaces/KeyValueStore.md).[`list`](../interfaces/KeyValueStore.md#list)

***

### put()

> **put**(`namespace`: `string`[], `key`: `string`, `value`: `Record`&lt;`string`, `unknown`&gt;): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:203](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L203)

Store a value at the given namespace and key.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `namespace` | `string`[] | Hierarchical namespace array |
| `key` | `string` | The key to store at |
| `value` | `Record`&lt;`string`, `unknown`&gt; | The value to store (must be JSON-serializable) |

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`KeyValueStore`](../interfaces/KeyValueStore.md).[`put`](../interfaces/KeyValueStore.md#put)
