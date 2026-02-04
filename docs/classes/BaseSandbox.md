[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BaseSandbox

# Abstract Class: BaseSandbox

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:232](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L232)

Abstract base class for sandbox implementations.

This class provides the foundation for various sandbox backends. Subclasses
must implement the core execution method, while file operations can optionally
be delegated to a wrapped backend.

## Example

```typescript
class MyCloudSandbox extends BaseSandbox {
  async execute(command: string): Promise<ExecuteResponse> {
    // Implement cloud-based execution
    return await this.cloudProvider.runCommand(command);
  }
}
```

## Extended by

- [`LocalSandbox`](LocalSandbox.md)

## Implements

- [`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md)

## Constructors

### Constructor

> **new BaseSandbox**(`fileBackend`: [`BackendProtocol`](../interfaces/BackendProtocol.md), `id?`: `string`): `BaseSandbox`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:245](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L245)

Create a new BaseSandbox.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `fileBackend` | [`BackendProtocol`](../interfaces/BackendProtocol.md) | Backend to use for file operations |
| `id?` | `string` | Optional unique identifier (auto-generated if not provided) |

#### Returns

`BaseSandbox`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:234](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L234)

Unique identifier for this sandbox instance

#### Implementation of

[`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md).[`id`](../interfaces/SandboxBackendProtocol.md#id)

## Methods

### downloadFiles()

> **downloadFiles**(`paths`: `string`[]): `Promise`&lt;\{ `content`: `Uint8Array`; `path`: `string`; \}[]&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:375](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L375)

Download files from the sandbox.

Default implementation reads files using the file backend.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `paths` | `string`[] | Paths to download |

#### Returns

`Promise`&lt;\{ `content`: `Uint8Array`; `path`: `string`; \}[]&gt;

Array of { path, content } objects

#### Implementation of

[`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md).[`downloadFiles`](../interfaces/SandboxBackendProtocol.md#downloadfiles)

***

### edit()

> **edit**(`filePath`: `string`, `oldString`: `string`, `newString`: `string`, `replaceAll?`: `boolean`): [`EditResult`](../interfaces/EditResult.md) \| `Promise`&lt;[`EditResult`](../interfaces/EditResult.md)&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:319](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L319)

Edit a file by replacing text.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `filePath` | `string` |
| `oldString` | `string` |
| `newString` | `string` |
| `replaceAll?` | `boolean` |

#### Returns

[`EditResult`](../interfaces/EditResult.md) \| `Promise`&lt;[`EditResult`](../interfaces/EditResult.md)&gt;

#### Implementation of

[`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md).[`edit`](../interfaces/SandboxBackendProtocol.md#edit)

***

### execute()

> `abstract` **execute**(`command`: `string`): `Promise`&lt;[`ExecuteResponse`](../interfaces/ExecuteResponse.md)&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:260](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L260)

Execute a shell command in the sandbox.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `command` | `string` | Shell command to execute |

#### Returns

`Promise`&lt;[`ExecuteResponse`](../interfaces/ExecuteResponse.md)&gt;

Execution result with output and exit code

#### Implementation of

[`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md).[`execute`](../interfaces/SandboxBackendProtocol.md#execute)

***

### globInfo()

> **globInfo**(`pattern`: `string`, `path?`: `string`): [`FileInfo`](../interfaces/FileInfo.md)[] \| `Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:305](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L305)

Find files matching a glob pattern.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `pattern` | `string` |
| `path?` | `string` |

#### Returns

[`FileInfo`](../interfaces/FileInfo.md)[] \| `Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

#### Implementation of

[`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md).[`globInfo`](../interfaces/SandboxBackendProtocol.md#globinfo)

***

### grepRaw()

> **grepRaw**(`pattern`: `string`, `path?`: `string` \| `null`, `glob?`: `string` \| `null`): `string` \| [`GrepMatch`](../interfaces/GrepMatch.md)[] \| `Promise`&lt;`string` \| [`GrepMatch`](../interfaces/GrepMatch.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:294](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L294)

Search for pattern matches using regex.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `pattern` | `string` |
| `path?` | `string` \| `null` |
| `glob?` | `string` \| `null` |

#### Returns

`string` \| [`GrepMatch`](../interfaces/GrepMatch.md)[] \| `Promise`&lt;`string` \| [`GrepMatch`](../interfaces/GrepMatch.md)[]&gt;

#### Implementation of

[`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md).[`grepRaw`](../interfaces/SandboxBackendProtocol.md#grepraw)

***

### lsInfo()

> **lsInfo**(`path`: `string`): [`FileInfo`](../interfaces/FileInfo.md)[] \| `Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:269](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L269)

List files and directories at the given path.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `path` | `string` |

#### Returns

[`FileInfo`](../interfaces/FileInfo.md)[] \| `Promise`&lt;[`FileInfo`](../interfaces/FileInfo.md)[]&gt;

#### Implementation of

[`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md).[`lsInfo`](../interfaces/SandboxBackendProtocol.md#lsinfo)

***

### read()

> **read**(`filePath`: `string`, `offset?`: `number`, `limit?`: `number`): `string` \| `Promise`&lt;`string`&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:276](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L276)

Read file content with line numbers.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `filePath` | `string` |
| `offset?` | `number` |
| `limit?` | `number` |

#### Returns

`string` \| `Promise`&lt;`string`&gt;

#### Implementation of

[`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md).[`read`](../interfaces/SandboxBackendProtocol.md#read)

***

### readRaw()

> **readRaw**(`filePath`: `string`): [`FileData`](../interfaces/FileData.md) \| `Promise`&lt;[`FileData`](../interfaces/FileData.md)&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:287](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L287)

Read raw file content as FileData.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `filePath` | `string` |

#### Returns

[`FileData`](../interfaces/FileData.md) \| `Promise`&lt;[`FileData`](../interfaces/FileData.md)&gt;

#### Implementation of

[`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md).[`readRaw`](../interfaces/SandboxBackendProtocol.md#readraw)

***

### uploadFiles()

> **uploadFiles**(`files`: \[`string`, `Uint8Array`&lt;`ArrayBufferLike`&gt;\][]): `Promise`&lt;[`FileUploadResponse`](../interfaces/FileUploadResponse.md)[]&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:340](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L340)

Upload files to the sandbox.

Default implementation writes files using the file backend.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `files` | \[`string`, `Uint8Array`&lt;`ArrayBufferLike`&gt;\][] | Array of [path, content] tuples |

#### Returns

`Promise`&lt;[`FileUploadResponse`](../interfaces/FileUploadResponse.md)[]&gt;

Array of upload results

#### Implementation of

[`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md).[`uploadFiles`](../interfaces/SandboxBackendProtocol.md#uploadfiles)

***

### write()

> **write**(`filePath`: `string`, `content`: `string`): [`WriteResult`](../interfaces/WriteResult.md) \| `Promise`&lt;[`WriteResult`](../interfaces/WriteResult.md)&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:312](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L312)

Create or overwrite a file.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `filePath` | `string` |
| `content` | `string` |

#### Returns

[`WriteResult`](../interfaces/WriteResult.md) \| `Promise`&lt;[`WriteResult`](../interfaces/WriteResult.md)&gt;

#### Implementation of

[`SandboxBackendProtocol`](../interfaces/SandboxBackendProtocol.md).[`write`](../interfaces/SandboxBackendProtocol.md#write)
