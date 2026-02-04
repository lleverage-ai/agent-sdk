[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PersistentBackend

# Class: PersistentBackend

Defined in: [packages/agent-sdk/src/backends/persistent.ts:325](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L325)

Backend implementation using a pluggable key-value store.

All file operations are persisted to the underlying store, allowing
data to survive across process restarts and agent sessions.

Files are stored at: [namespace?, "filesystem", encodedPath]

## Example

```typescript
import { PersistentBackend, InMemoryStore } from "@lleverage-ai/agent-sdk";

// Create with in-memory store
const store = new InMemoryStore();
const backend = new PersistentBackend({ store });

// Write persists to store
await backend.write("/notes.md", "# Notes");

// Read retrieves from store
const content = await backend.read("/notes.md");

// With namespace for multi-tenant isolation
const userBackend = new PersistentBackend({
  store,
  namespace: "user-456",
});
```

## Implements

- [`BackendProtocol`](../interfaces/BackendProtocol.md)

## Constructors

### Constructor

> **new PersistentBackend**(`options`: [`PersistentBackendOptions`](../interfaces/PersistentBackendOptions.md)): `PersistentBackend`

Defined in: [packages/agent-sdk/src/backends/persistent.ts:334](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L334)

Create a new PersistentBackend.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`PersistentBackendOptions`](../interfaces/PersistentBackendOptions.md) | Configuration options |

#### Returns

`PersistentBackend`

## Methods

### edit()

> **edit**(`filePath`: `string`, `oldString`: `string`, `newString`: `string`, `replaceAll?`: `boolean`): `Promise`&lt;[`EditResult`](../interfaces/EditResult.md)&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:644](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L644)

Edit a file by replacing text.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `filePath` | `string` |
| `oldString` | `string` |
| `newString` | `string` |
| `replaceAll?` | `boolean` |

#### Returns

`Promise`&lt;[`EditResult`](../interfaces/EditResult.md)&gt;

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`edit`](../interfaces/BackendProtocol.md#edit)

***

### globInfo()

> **globInfo**(`pattern`: `string`, `path?`: `string`): `Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:568](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L568)

Find files matching a glob pattern.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `pattern` | `string` |
| `path?` | `string` |

#### Returns

`Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`globInfo`](../interfaces/BackendProtocol.md#globinfo)

***

### grepRaw()

> **grepRaw**(`pattern`: `string`, `path?`: `string` \| `null`, `glob?`: `string` \| `null`): `Promise`&lt;[`GrepMatch`](../interfaces/GrepMatch.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:523](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L523)

Search for pattern matches using regex.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `pattern` | `string` |
| `path?` | `string` \| `null` |
| `glob?` | `string` \| `null` |

#### Returns

`Promise`&lt;[`GrepMatch`](../interfaces/GrepMatch.md)[]&gt;

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`grepRaw`](../interfaces/BackendProtocol.md#grepraw)

***

### lsInfo()

> **lsInfo**(`path`: `string`): `Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:409](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L409)

List files and directories at the given path.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `path` | `string` |

#### Returns

`Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`lsInfo`](../interfaces/BackendProtocol.md#lsinfo)

***

### read()

> **read**(`filePath`: `string`, `offset?`: `number`, `limit?`: `number`): `Promise`&lt;`string`&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:470](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L470)

Read file content with line numbers.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `filePath` | `string` |
| `offset?` | `number` |
| `limit?` | `number` |

#### Returns

`Promise`&lt;`string`&gt;

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`read`](../interfaces/BackendProtocol.md#read)

***

### readRaw()

> **readRaw**(`filePath`: `string`): `Promise`&lt;[`FileData`](../interfaces/FileData.md)&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:501](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L501)

Read raw file content as FileData.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `filePath` | `string` |

#### Returns

`Promise`&lt;[`FileData`](../interfaces/FileData.md)&gt;

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`readRaw`](../interfaces/BackendProtocol.md#readraw)

***

### write()

> **write**(`filePath`: `string`, `content`: `string`): `Promise`&lt;[`WriteResult`](../interfaces/WriteResult.md)&gt;

Defined in: [packages/agent-sdk/src/backends/persistent.ts:614](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/persistent.ts#L614)

Create or overwrite a file.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `filePath` | `string` |
| `content` | `string` |

#### Returns

`Promise`&lt;[`WriteResult`](../interfaces/WriteResult.md)&gt;

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`write`](../interfaces/BackendProtocol.md#write)
