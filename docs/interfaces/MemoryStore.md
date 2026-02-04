[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MemoryStore

# Interface: MemoryStore

Defined in: [packages/agent-sdk/src/memory/store.ts:168](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L168)

Interface for storing and retrieving memory documents.

Implement this interface to create custom storage backends.
The default implementation uses the filesystem.

## Example

```typescript
class CustomMemoryStore implements MemoryStore {
  async read(path: string): Promise<MemoryDocument | undefined> {
    // Custom read implementation
  }

  async write(path: string, document: MemoryDocument): Promise<void> {
    // Custom write implementation
  }

  async delete(path: string): Promise<boolean> {
    // Custom delete implementation
  }

  async list(pattern?: string): Promise<string[]> {
    // Custom list implementation
  }
}
```

## Methods

### delete()

> **delete**(`path`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/store.ts:193](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L193)

Delete a memory document.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `path` | `string` | The path to the document to delete |

#### Returns

`Promise`&lt;`boolean`&gt;

True if the document was deleted, false if it didn't exist

***

### exists()

> **exists**(`path`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/store.ts:209](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L209)

Check if a document exists at the given path.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `path` | `string` | The path to check |

#### Returns

`Promise`&lt;`boolean`&gt;

True if the document exists

***

### list()

> **list**(`pattern?`: `string`): `Promise`&lt;`string`[]&gt;

Defined in: [packages/agent-sdk/src/memory/store.ts:201](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L201)

List all memory document paths matching a pattern.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pattern?` | `string` | Optional glob pattern to filter (defaults to all .md files) |

#### Returns

`Promise`&lt;`string`[]&gt;

Array of paths to matching documents

***

### read()

> **read**(`path`: `string`): `Promise`&lt;[`MemoryDocument`](MemoryDocument.md) \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/memory/store.ts:175](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L175)

Read a memory document by path.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `path` | `string` | The path to the memory document |

#### Returns

`Promise`&lt;[`MemoryDocument`](MemoryDocument.md) \| `undefined`&gt;

The memory document if found, undefined otherwise

***

### write()

> **write**(`path`: `string`, `document`: [`MemoryDocument`](MemoryDocument.md)): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/memory/store.ts:185](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L185)

Write a memory document to the store.

If the document exists, it will be overwritten.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `path` | `string` | The path to write to |
| `document` | [`MemoryDocument`](MemoryDocument.md) | The document to write |

#### Returns

`Promise`&lt;`void`&gt;
