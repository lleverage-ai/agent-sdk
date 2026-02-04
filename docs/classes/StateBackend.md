[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / StateBackend

# Class: StateBackend

Defined in: [packages/agent-sdk/src/backends/state.ts:136](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L136)

In-memory backend implementation using AgentState.

All file operations are performed on the in-memory `state.files` map.
Changes are immediately visible but not persisted to disk.

## Example

```typescript
// Create with existing state
const state: AgentState = { todos: [], files: {} };
const backend = new StateBackend(state);

// Write a file
await backend.write("/hello.txt", "Hello, World!");

// Read it back
const content = await backend.read("/hello.txt");
console.log(content); // "     1→Hello, World!"

// State is updated directly
console.log(state.files["/hello.txt"].content); // ["Hello, World!"]
```

## Implements

- [`BackendProtocol`](../interfaces/BackendProtocol.md)

## Constructors

### Constructor

> **new StateBackend**(`state`: [`AgentState`](../interfaces/AgentState.md)): `StateBackend`

Defined in: [packages/agent-sdk/src/backends/state.ts:142](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L142)

Create a new StateBackend.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `state` | [`AgentState`](../interfaces/AgentState.md) | The AgentState to use for storage |

#### Returns

`StateBackend`

## Methods

### edit()

> **edit**(`filePath`: `string`, `oldString`: `string`, `newString`: `string`, `replaceAll?`: `boolean`): [`EditResult`](../interfaces/EditResult.md)

Defined in: [packages/agent-sdk/src/backends/state.ts:379](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L379)

Edit a file by replacing text.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the file to edit |
| `oldString` | `string` | Text to find and replace |
| `newString` | `string` | Replacement text |
| `replaceAll?` | `boolean` | If true, replace all occurrences |

#### Returns

[`EditResult`](../interfaces/EditResult.md)

Result indicating success or failure

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`edit`](../interfaces/BackendProtocol.md#edit)

***

### globInfo()

> **globInfo**(`pattern`: `string`, `path?`: `string`): [`FileInfo`](../interfaces/FileInfo.md)[]

Defined in: [packages/agent-sdk/src/backends/state.ts:307](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L307)

Find files matching a glob pattern.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pattern` | `string` | Glob pattern (e.g., "**/*.ts") |
| `path?` | `string` | Base directory for the search |

#### Returns

[`FileInfo`](../interfaces/FileInfo.md)[]

Array of matching file info

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`globInfo`](../interfaces/BackendProtocol.md#globinfo)

***

### grepRaw()

> **grepRaw**(`pattern`: `string`, `path?`: `string` \| `null`, `glob?`: `string` \| `null`): [`GrepMatch`](../interfaces/GrepMatch.md)[]

Defined in: [packages/agent-sdk/src/backends/state.ts:264](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L264)

Search for pattern matches using regex.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pattern` | `string` | Regular expression pattern to search for |
| `path?` | `string` \| `null` | Directory to search in (defaults to root) |
| `glob?` | `string` \| `null` | Glob pattern to filter files (e.g., "*.ts") |

#### Returns

[`GrepMatch`](../interfaces/GrepMatch.md)[]

Array of matches

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`grepRaw`](../interfaces/BackendProtocol.md#grepraw)

***

### lsInfo()

> **lsInfo**(`path`: `string`): [`FileInfo`](../interfaces/FileInfo.md)[]

Defined in: [packages/agent-sdk/src/backends/state.ts:150](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L150)

List files and directories at the given path.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `path` | `string` | Directory path to list (non-recursive) |

#### Returns

[`FileInfo`](../interfaces/FileInfo.md)[]

Array of file/directory info

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`lsInfo`](../interfaces/BackendProtocol.md#lsinfo)

***

### read()

> **read**(`filePath`: `string`, `offset?`: `number`, `limit?`: `number`): `string`

Defined in: [packages/agent-sdk/src/backends/state.ts:212](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L212)

Read file content with line numbers.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the file to read |
| `offset?` | `number` | Starting line offset (0-indexed) |
| `limit?` | `number` | Maximum number of lines to read |

#### Returns

`string`

Formatted content with line numbers

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`read`](../interfaces/BackendProtocol.md#read)

***

### readRaw()

> **readRaw**(`filePath`: `string`): [`FileData`](../interfaces/FileData.md)

Defined in: [packages/agent-sdk/src/backends/state.ts:240](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L240)

Read raw file content as FileData.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the file to read |

#### Returns

[`FileData`](../interfaces/FileData.md)

Raw file data with content and timestamps (deep copy)

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`readRaw`](../interfaces/BackendProtocol.md#readraw)

***

### write()

> **write**(`filePath`: `string`, `content`: `string`): [`WriteResult`](../interfaces/WriteResult.md)

Defined in: [packages/agent-sdk/src/backends/state.ts:352](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L352)

Create or overwrite a file.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path for the new file |
| `content` | `string` | Content to write |

#### Returns

[`WriteResult`](../interfaces/WriteResult.md)

Result indicating success or failure

#### Implementation of

[`BackendProtocol`](../interfaces/BackendProtocol.md).[`write`](../interfaces/BackendProtocol.md#write)
