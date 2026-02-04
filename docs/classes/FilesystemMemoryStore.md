[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FilesystemMemoryStore

# Class: FilesystemMemoryStore

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:102](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L102)

Filesystem-based implementation of MemoryStore.

Stores memory documents as markdown files on disk.
Handles `~` expansion for home directory paths.

## Example

```typescript
import { FilesystemMemoryStore } from "@lleverage-ai/agent-sdk";

// Create with default options
const store = new FilesystemMemoryStore();

// Create with custom home directory
const store = new FilesystemMemoryStore({
  homeDir: "/custom/home",
});

// Read a memory document
const doc = await store.read("~/.deepagents/my-agent/agent.md");

// List all memory documents
const paths = await store.list("~/.deepagents/my-agent");
```

## Implements

- [`MemoryStore`](../interfaces/MemoryStore.md)

## Constructors

### Constructor

> **new FilesystemMemoryStore**(`options`: [`FilesystemMemoryStoreOptions`](../interfaces/FilesystemMemoryStoreOptions.md)): `FilesystemMemoryStore`

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:112](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L112)

Create a new FilesystemMemoryStore.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`FilesystemMemoryStoreOptions`](../interfaces/FilesystemMemoryStoreOptions.md) | Configuration options |

#### Returns

`FilesystemMemoryStore`

## Methods

### delete()

> **delete**(`filePath`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:194](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L194)

Delete a memory document from the filesystem.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to delete |

#### Returns

`Promise`&lt;`boolean`&gt;

True if deleted, false if it didn't exist

#### Implementation of

[`MemoryStore`](../interfaces/MemoryStore.md).[`delete`](../interfaces/MemoryStore.md#delete)

***

### exists()

> **exists**(`filePath`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:244](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L244)

Check if a memory document exists.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to check |

#### Returns

`Promise`&lt;`boolean`&gt;

True if the file exists

#### Implementation of

[`MemoryStore`](../interfaces/MemoryStore.md).[`exists`](../interfaces/MemoryStore.md#exists)

***

### list()

> **list**(`pattern?`: `string`): `Promise`&lt;`string`[]&gt;

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:214](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L214)

List memory documents matching a pattern.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pattern?` | `string` | Directory or glob pattern to search |

#### Returns

`Promise`&lt;`string`[]&gt;

Array of paths to matching documents

#### Implementation of

[`MemoryStore`](../interfaces/MemoryStore.md).[`list`](../interfaces/MemoryStore.md#list)

***

### read()

> **read**(`filePath`: `string`): `Promise`&lt;[`MemoryDocument`](../interfaces/MemoryDocument.md) \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:139](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L139)

Read a memory document from the filesystem.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the memory document |

#### Returns

`Promise`&lt;[`MemoryDocument`](../interfaces/MemoryDocument.md) \| `undefined`&gt;

The memory document if found, undefined otherwise

#### Implementation of

[`MemoryStore`](../interfaces/MemoryStore.md).[`read`](../interfaces/MemoryStore.md#read)

***

### write()

> **write**(`filePath`: `string`, `document`: [`MemoryDocument`](../interfaces/MemoryDocument.md)): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:170](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L170)

Write a memory document to the filesystem.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to write to |
| `document` | [`MemoryDocument`](../interfaces/MemoryDocument.md) | Document to write |

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`MemoryStore`](../interfaces/MemoryStore.md).[`write`](../interfaces/MemoryStore.md#write)
