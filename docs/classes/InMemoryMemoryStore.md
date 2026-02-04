[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / InMemoryMemoryStore

# Class: InMemoryMemoryStore

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:317](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L317)

In-memory implementation of MemoryStore for testing.

Documents are stored in a Map and not persisted.

## Example

```typescript
const store = new InMemoryMemoryStore();

await store.write("/test/doc.md", {
  path: "/test/doc.md",
  metadata: {},
  content: "# Test",
  modifiedAt: Date.now(),
});

const doc = await store.read("/test/doc.md");
```

## Implements

- [`MemoryStore`](../interfaces/MemoryStore.md)

## Constructors

### Constructor

> **new InMemoryMemoryStore**(): `InMemoryMemoryStore`

#### Returns

`InMemoryMemoryStore`

## Accessors

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:385](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L385)

Get the number of documents.

##### Returns

`number`

## Methods

### clear()

> **clear**(): `void`

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:378](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L378)

Clear all documents.

Useful for test cleanup.

#### Returns

`void`

***

### delete()

> **delete**(`path`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:349](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L349)

Delete a document from memory.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `path` | `string` |

#### Returns

`Promise`&lt;`boolean`&gt;

#### Implementation of

[`MemoryStore`](../interfaces/MemoryStore.md).[`delete`](../interfaces/MemoryStore.md#delete)

***

### exists()

> **exists**(`path`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:369](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L369)

Check if a document exists.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `path` | `string` |

#### Returns

`Promise`&lt;`boolean`&gt;

#### Implementation of

[`MemoryStore`](../interfaces/MemoryStore.md).[`exists`](../interfaces/MemoryStore.md#exists)

***

### list()

> **list**(`pattern?`: `string`): `Promise`&lt;`string`[]&gt;

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:356](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L356)

List all documents matching a prefix.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `pattern?` | `string` |

#### Returns

`Promise`&lt;`string`[]&gt;

#### Implementation of

[`MemoryStore`](../interfaces/MemoryStore.md).[`list`](../interfaces/MemoryStore.md#list)

***

### read()

> **read**(`path`: `string`): `Promise`&lt;[`MemoryDocument`](../interfaces/MemoryDocument.md) \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:323](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L323)

Read a document from memory.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `path` | `string` |

#### Returns

`Promise`&lt;[`MemoryDocument`](../interfaces/MemoryDocument.md) \| `undefined`&gt;

#### Implementation of

[`MemoryStore`](../interfaces/MemoryStore.md).[`read`](../interfaces/MemoryStore.md#read)

***

### write()

> **write**(`path`: `string`, `document`: [`MemoryDocument`](../interfaces/MemoryDocument.md)): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:337](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L337)

Write a document to memory.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `path` | `string` |
| `document` | [`MemoryDocument`](../interfaces/MemoryDocument.md) |

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`MemoryStore`](../interfaces/MemoryStore.md).[`write`](../interfaces/MemoryStore.md#write)
