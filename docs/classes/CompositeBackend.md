[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CompositeBackend

# Class: CompositeBackend

Defined in: [packages/agent-sdk/src/backends/composite.ts:118](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L118)

A backend that routes operations to different backends based on path prefixes.

Routes are matched by longest-prefix first. For example, if you have routes for
`/memories/` and `/memories/archived/`, a path like `/memories/archived/old.txt`
will route to the `/memories/archived/` backend.

For aggregate operations (glob, grep), results are collected from all backends
and merged together.

## Example

```typescript
const backend = new CompositeBackend(
  new StateBackend(state),
  {
    '/memories/': new PersistentBackend({ store }),
    '/project/': new FilesystemBackend({ rootDir: './project' }),
  }
);

// Write to different backends based on path
await backend.write('/memories/notes.md', '# Notes');  // PersistentBackend
await backend.write('/project/src/app.ts', '...');     // FilesystemBackend
await backend.write('/temp/scratch.txt', '...');       // StateBackend (default)

// Glob across all backends
const allFiles = await backend.globInfo('**/*.ts');
```

## Implements

- [`BackendProtocol`](../interfaces/BackendProtocol.md)

## Constructors

### Constructor

> **new CompositeBackend**(`defaultBackend`: [`BackendProtocol`](../interfaces/BackendProtocol.md), `routes`: [`RouteConfig`](../type-aliases/RouteConfig.md)): `CompositeBackend`

Defined in: [packages/agent-sdk/src/backends/composite.ts:128](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L128)

Create a new CompositeBackend.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `defaultBackend` | [`BackendProtocol`](../interfaces/BackendProtocol.md) | Backend for paths that don't match any route |
| `routes` | [`RouteConfig`](../type-aliases/RouteConfig.md) | Map of path prefixes to backends |

#### Returns

`CompositeBackend`

## Methods

### edit()

> **edit**(`filePath`: `string`, `oldString`: `string`, `newString`: `string`, `replaceAll?`: `boolean`): `Promise`&lt;[`EditResult`](../interfaces/EditResult.md)&gt;

Defined in: [packages/agent-sdk/src/backends/composite.ts:364](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L364)

Edit a file by replacing text.

Routes to the appropriate backend based on path prefix.

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

### getBackendForPath()

> **getBackendForPath**(`path`: `string`): [`BackendProtocol`](../interfaces/BackendProtocol.md)

Defined in: [packages/agent-sdk/src/backends/composite.ts:401](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L401)

Get the backend that handles a specific path.

Useful for debugging or when you need direct access to a specific backend.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `path` | `string` | Path to check |

#### Returns

[`BackendProtocol`](../interfaces/BackendProtocol.md)

The backend that handles this path

***

### getDefaultBackend()

> **getDefaultBackend**(): [`BackendProtocol`](../interfaces/BackendProtocol.md)

Defined in: [packages/agent-sdk/src/backends/composite.ts:419](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L419)

Get the default backend.

#### Returns

[`BackendProtocol`](../interfaces/BackendProtocol.md)

The default backend for unmatched paths

***

### getRoutes()

> **getRoutes**(): \{ `backend`: [`BackendProtocol`](../interfaces/BackendProtocol.md); `prefix`: `string`; \}[]

Defined in: [packages/agent-sdk/src/backends/composite.ts:410](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L410)

Get all configured routes.

#### Returns

\{ `backend`: [`BackendProtocol`](../interfaces/BackendProtocol.md); `prefix`: `string`; \}[]

Array of route configurations sorted by prefix length (longest first)

***

### globInfo()

> **globInfo**(`pattern`: `string`, `path?`: `string`): `Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/composite.ts:275](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L275)

Find files matching a glob pattern across all backends.

Results are aggregated from all backends that could contain
matching files.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pattern` | `string` | Glob pattern |
| `path?` | `string` | Base directory for the search |

#### Returns

`Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Array of matching file info from all backends

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`globInfo`](../interfaces/BackendProtocol.md#globinfo)

***

### grepRaw()

> **grepRaw**(`pattern`: `string`, `path?`: `string` \| `null`, `glob?`: `string` \| `null`): `Promise`&lt;[`GrepMatch`](../interfaces/GrepMatch.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/composite.ts:203](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L203)

Search for pattern matches using regex across all backends.

Results are aggregated from all backends. Each backend's grep
is limited to its own path scope.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pattern` | `string` | Regular expression pattern to search for |
| `path?` | `string` \| `null` | Directory to search in (defaults to root) |
| `glob?` | `string` \| `null` | Glob pattern to filter files |

#### Returns

`Promise`&lt;[`GrepMatch`](../interfaces/GrepMatch.md)[]&gt;

Array of matches from all backends

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`grepRaw`](../interfaces/BackendProtocol.md#grepraw)

***

### lsInfo()

> **lsInfo**(`path`: `string`): `Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/composite.ts:148](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L148)

List files and directories at the given path.

Routes to the appropriate backend based on path prefix.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `path` | `string` | Directory path to list |

#### Returns

`Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Array of file/directory info

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`lsInfo`](../interfaces/BackendProtocol.md#lsinfo)

***

### read()

> **read**(`filePath`: `string`, `offset?`: `number`, `limit?`: `number`): `Promise`&lt;`string`&gt;

Defined in: [packages/agent-sdk/src/backends/composite.ts:172](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L172)

Read file content with optional line numbers.

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

Defined in: [packages/agent-sdk/src/backends/composite.ts:187](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L187)

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

Defined in: [packages/agent-sdk/src/backends/composite.ts:338](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L338)

Create or overwrite a file.

Routes to the appropriate backend based on path prefix.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path for the new file |
| `content` | `string` | Content to write |

#### Returns

`Promise`&lt;[`WriteResult`](../interfaces/WriteResult.md)&gt;

Result indicating success or failure

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`write`](../interfaces/BackendProtocol.md#write)
