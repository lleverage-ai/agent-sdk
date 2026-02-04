[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FilesystemBackend

# Class: FilesystemBackend

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:172](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L172)

Filesystem backend implementation for real disk operations.

Provides secure file operations with protections against:
- Directory traversal attacks (../ paths)
- Symlink attacks
- Excessive file sizes

## Example

```typescript
const backend = new FilesystemBackend({
  rootDir: "/home/user/project",
  maxFileSizeMb: 10,
  followSymlinks: false,
});

// List files
const files = await backend.lsInfo("./src");

// Read with line numbers
const content = await backend.read("./src/index.ts");

// Search for patterns
const matches = await backend.grepRaw("TODO", "./src", "*.ts");
```

## Implements

- [`BackendProtocol`](../interfaces/BackendProtocol.md)

## Constructors

### Constructor

> **new FilesystemBackend**(`options`: [`FilesystemBackendOptions`](../interfaces/FilesystemBackendOptions.md)): `FilesystemBackend`

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:183](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L183)

Create a new FilesystemBackend.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`FilesystemBackendOptions`](../interfaces/FilesystemBackendOptions.md) | Configuration options |

#### Returns

`FilesystemBackend`

## Methods

### edit()

> **edit**(`filePath`: `string`, `oldString`: `string`, `newString`: `string`, `replaceAll?`: `boolean`): `Promise`&lt;[`EditResult`](../interfaces/EditResult.md)&gt;

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:428](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L428)

Edit a file by replacing text.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the file to edit |
| `oldString` | `string` | Text to find and replace |
| `newString` | `string` | Replacement text |
| `replaceAll?` | `boolean` | If true, replace all occurrences |

#### Returns

`Promise`&lt;[`EditResult`](../interfaces/EditResult.md)&gt;

Result indicating success or failure

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`edit`](../interfaces/BackendProtocol.md#edit)

***

### globInfo()

> **globInfo**(`pattern`: `string`, `basePath?`: `string`): `Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:360](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L360)

Find files matching a glob pattern.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pattern` | `string` | Glob pattern (e.g., "**/*.ts") |
| `basePath?` | `string` | Base directory for the search |

#### Returns

`Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Array of matching file info

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`globInfo`](../interfaces/BackendProtocol.md#globinfo)

***

### grepRaw()

> **grepRaw**(`pattern`: `string`, `searchPath?`: `string` \| `null`, `glob?`: `string` \| `null`): `Promise`&lt;[`GrepMatch`](../interfaces/GrepMatch.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:316](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L316)

Search for pattern matches using regex.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pattern` | `string` | Regular expression pattern to search for |
| `searchPath?` | `string` \| `null` | Directory to search in (defaults to root) |
| `glob?` | `string` \| `null` | Glob pattern to filter files (e.g., "*.ts") |

#### Returns

`Promise`&lt;[`GrepMatch`](../interfaces/GrepMatch.md)[]&gt;

Array of matches

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`grepRaw`](../interfaces/BackendProtocol.md#grepraw)

***

### lsInfo()

> **lsInfo**(`dirPath`: `string`): `Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:214](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L214)

List files and directories at the given path.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `dirPath` | `string` | Directory path to list (non-recursive) |

#### Returns

`Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Array of file/directory info

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`lsInfo`](../interfaces/BackendProtocol.md#lsinfo)

***

### read()

> **read**(`filePath`: `string`, `offset?`: `number`, `limit?`: `number`): `Promise`&lt;`string`&gt;

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:261](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L261)

Read file content with line numbers.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the file to read |
| `offset?` | `number` | Starting line offset (0-indexed) |
| `limit?` | `number` | Maximum number of lines to read |

#### Returns

`Promise`&lt;`string`&gt;

Formatted content with line numbers

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`read`](../interfaces/BackendProtocol.md#read)

***

### readRaw()

> **readRaw**(`filePath`: `string`): `Promise`&lt;[`FileData`](../interfaces/FileData.md)&gt;

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:292](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L292)

Read raw file content as FileData.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the file to read |

#### Returns

`Promise`&lt;[`FileData`](../interfaces/FileData.md)&gt;

Raw file data with content and timestamps

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`readRaw`](../interfaces/BackendProtocol.md#readraw)

***

### write()

> **write**(`filePath`: `string`, `content`: `string`): `Promise`&lt;[`WriteResult`](../interfaces/WriteResult.md)&gt;

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:396](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L396)

Create or overwrite a file.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path for the file |
| `content` | `string` | Content to write |

#### Returns

`Promise`&lt;[`WriteResult`](../interfaces/WriteResult.md)&gt;

Result indicating success or failure

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`write`](../interfaces/BackendProtocol.md#write)
