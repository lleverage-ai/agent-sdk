[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LocalSandbox

# Class: LocalSandbox

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:428](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L428)

Local sandbox for shell command execution.

Provides secure command execution with:
- Timeout enforcement
- Output size limits
- Command blocking/allowlisting
- Dangerous pattern detection

File operations are delegated to a FilesystemBackend with the same security
protections (path traversal, symlink, file size).

## Example

```typescript
const sandbox = new LocalSandbox({
  cwd: "/home/user/project",
  timeout: 30000,
  blockedCommands: ["rm -rf"],
});

// Execute a command
const result = await sandbox.execute("ls -la");
console.log(result.output);

// File operations work too
const files = await sandbox.lsInfo("./src");
```

## Extends

- [`BaseSandbox`](BaseSandbox.md)

## Constructors

### Constructor

> **new LocalSandbox**(`options`: [`LocalSandboxOptions`](../interfaces/LocalSandboxOptions.md)): `LocalSandbox`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:443](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L443)

Create a new LocalSandbox.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`LocalSandboxOptions`](../interfaces/LocalSandboxOptions.md) | Configuration options |

#### Returns

`LocalSandbox`

#### Overrides

[`BaseSandbox`](BaseSandbox.md).[`constructor`](BaseSandbox.md#constructor)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:234](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L234)

Unique identifier for this sandbox instance

#### Inherited from

[`BaseSandbox`](BaseSandbox.md).[`id`](BaseSandbox.md#id)

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

#### Inherited from

[`BaseSandbox`](BaseSandbox.md).[`downloadFiles`](BaseSandbox.md#downloadfiles)

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

#### Inherited from

[`BaseSandbox`](BaseSandbox.md).[`edit`](BaseSandbox.md#edit)

***

### execute()

> **execute**(`command`: `string`): `Promise`&lt;[`ExecuteResponse`](../interfaces/ExecuteResponse.md)&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:472](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L472)

Execute a shell command.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `command` | `string` | Shell command to execute |

#### Returns

`Promise`&lt;[`ExecuteResponse`](../interfaces/ExecuteResponse.md)&gt;

Execution result with output and exit code

#### Throws

If the command is blocked

#### Throws

If the command times out

#### Overrides

[`BaseSandbox`](BaseSandbox.md).[`execute`](BaseSandbox.md#execute)

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

#### Inherited from

[`BaseSandbox`](BaseSandbox.md).[`globInfo`](BaseSandbox.md#globinfo)

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

#### Inherited from

[`BaseSandbox`](BaseSandbox.md).[`grepRaw`](BaseSandbox.md#grepraw)

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

#### Inherited from

[`BaseSandbox`](BaseSandbox.md).[`lsInfo`](BaseSandbox.md#lsinfo)

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

#### Inherited from

[`BaseSandbox`](BaseSandbox.md).[`read`](BaseSandbox.md#read)

***

### readOnly()

> `static` **readOnly**(`options`: `Omit`&lt;[`LocalSandboxOptions`](../interfaces/LocalSandboxOptions.md), `"allowedCommands"` \| `"blockedCommands"`&gt;): `LocalSandbox`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:622](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L622)

Create a LocalSandbox with restricted permissions.

This factory creates a sandbox that only allows read-only commands.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | `Omit`&lt;[`LocalSandboxOptions`](../interfaces/LocalSandboxOptions.md), `"allowedCommands"` \| `"blockedCommands"`&gt; | Base options |

#### Returns

`LocalSandbox`

A restricted LocalSandbox

#### Example

```typescript
const sandbox = LocalSandbox.readOnly({ cwd: "/home/user/project" });
await sandbox.execute("ls -la"); // OK
await sandbox.execute("rm file.txt"); // Throws CommandBlockedError
```

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

#### Inherited from

[`BaseSandbox`](BaseSandbox.md).[`readRaw`](BaseSandbox.md#readraw)

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

#### Inherited from

[`BaseSandbox`](BaseSandbox.md).[`uploadFiles`](BaseSandbox.md#uploadfiles)

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

#### Inherited from

[`BaseSandbox`](BaseSandbox.md).[`write`](BaseSandbox.md#write)
