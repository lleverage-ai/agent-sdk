[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BackendProtocol

# Interface: BackendProtocol

Defined in: [packages/agent-sdk/src/backend.ts:155](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L155)

Core backend protocol interface for file operations.

All storage backends implement this interface, providing a consistent API
for file operations regardless of the underlying storage mechanism.

## Example

```typescript
// Using with StateBackend (in-memory)
const state = { todos: [], files: {} };
const backend: BackendProtocol = new StateBackend(state);

// Using with FilesystemBackend (real filesystem)
const backend: BackendProtocol = new FilesystemBackend({
  rootDir: process.cwd(),
});

// Operations work the same regardless of backend
const content = await backend.read("/src/index.ts");
const files = await backend.globInfo("**/*.ts");
```

## Extended by

- [`SandboxBackendProtocol`](SandboxBackendProtocol.md)

## Methods

### edit()

> **edit**(`filePath`: `string`, `oldString`: `string`, `newString`: `string`, `replaceAll?`: `boolean`): [`EditResult`](EditResult.md) \| `Promise`&lt;[`EditResult`](EditResult.md)&gt;

Defined in: [packages/agent-sdk/src/backend.ts:300](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L300)

Edit a file by replacing text.

The `old_string` must be unique in the file unless `replace_all` is true.
This prevents accidental replacements of unintended matches.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the file to edit |
| `oldString` | `string` | Text to find and replace |
| `newString` | `string` | Replacement text |
| `replaceAll?` | `boolean` | If true, replace all occurrences; if false, fail on non-unique match |

#### Returns

[`EditResult`](EditResult.md) \| `Promise`&lt;[`EditResult`](EditResult.md)&gt;

Result indicating success or failure

#### Example

```typescript
// Replace a single unique occurrence
const result = await backend.edit(
  "/src/config.ts",
  "export const DEBUG = false;",
  "export const DEBUG = true;"
);

// Replace all occurrences
const result = await backend.edit(
  "/src/types.ts",
  "interface",
  "type",
  true
);
```

***

### globInfo()

> **globInfo**(`pattern`: `string`, `path?`: `string`): [`FileInfo`](FileInfo.md)[] \| `Promise`&lt;[`FileInfo`](FileInfo.md)[]&gt;

Defined in: [packages/agent-sdk/src/backend.ts:248](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L248)

Find files matching a glob pattern.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pattern` | `string` | Glob pattern (e.g., "**/*.ts", "src/**/*.test.ts") |
| `path?` | `string` | Base directory for the search |

#### Returns

[`FileInfo`](FileInfo.md)[] \| `Promise`&lt;[`FileInfo`](FileInfo.md)[]&gt;

Array of matching file info

#### Example

```typescript
// Find all TypeScript files
const tsFiles = await backend.globInfo("**/*.ts", "/src");

// Find all test files
const testFiles = await backend.globInfo("**/*.test.ts");
```

***

### grepRaw()

> **grepRaw**(`pattern`: `string`, `path?`: `string` \| `null`, `glob?`: `string` \| `null`): `string` \| [`GrepMatch`](GrepMatch.md)[] \| `Promise`&lt;`string` \| [`GrepMatch`](GrepMatch.md)[]&gt;

Defined in: [packages/agent-sdk/src/backend.ts:226](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L226)

Search for pattern matches using regex.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pattern` | `string` | Regular expression pattern to search for |
| `path?` | `string` \| `null` | Directory to search in (defaults to root) |
| `glob?` | `string` \| `null` | Glob pattern to filter files (e.g., "*.ts") |

#### Returns

`string` \| [`GrepMatch`](GrepMatch.md)[] \| `Promise`&lt;`string` \| [`GrepMatch`](GrepMatch.md)[]&gt;

Array of matches or formatted string

#### Example

```typescript
// Search for TODO comments in TypeScript files
const matches = await backend.grepRaw(
  "TODO:",
  "/src",
  "*.ts"
);
```

***

### lsInfo()

> **lsInfo**(`path`: `string`): [`FileInfo`](FileInfo.md)[] \| `Promise`&lt;[`FileInfo`](FileInfo.md)[]&gt;

Defined in: [packages/agent-sdk/src/backend.ts:169](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L169)

List files and directories with metadata.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `path` | `string` | Directory path to list (non-recursive) |

#### Returns

[`FileInfo`](FileInfo.md)[] \| `Promise`&lt;[`FileInfo`](FileInfo.md)[]&gt;

Array of file/directory info

#### Example

```typescript
const entries = await backend.lsInfo("/src");
const dirs = entries.filter(e => e.is_dir);
const files = entries.filter(e => !e.is_dir);
```

***

### read()

> **read**(`filePath`: `string`, `offset?`: `number`, `limit?`: `number`): `string` \| `Promise`&lt;`string`&gt;

Defined in: [packages/agent-sdk/src/backend.ts:191](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L191)

Read file content with optional line numbers.

Returns content formatted with line numbers for display, suitable for
showing to the model or user.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the file to read |
| `offset?` | `number` | Starting line offset (0-indexed) |
| `limit?` | `number` | Maximum number of lines to read |

#### Returns

`string` \| `Promise`&lt;`string`&gt;

Formatted content with line numbers

#### Example

```typescript
// Read first 50 lines
const content = await backend.read("/src/index.ts", 0, 50);

// Read lines 100-200
const content = await backend.read("/src/index.ts", 100, 100);
```

***

### readRaw()

> **readRaw**(`filePath`: `string`): [`FileData`](FileData.md) \| `Promise`&lt;[`FileData`](FileData.md)&gt;

Defined in: [packages/agent-sdk/src/backend.ts:206](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L206)

Read raw file content as FileData.

Returns the content as an array of lines with timestamps, useful for
programmatic access to file content.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the file to read |

#### Returns

[`FileData`](FileData.md) \| `Promise`&lt;[`FileData`](FileData.md)&gt;

Raw file data with content and timestamps

***

### write()

> **write**(`filePath`: `string`, `content`: `string`): [`WriteResult`](WriteResult.md) \| `Promise`&lt;[`WriteResult`](WriteResult.md)&gt;

Defined in: [packages/agent-sdk/src/backend.ts:268](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L268)

Create or overwrite a file.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path for the new file |
| `content` | `string` | Content to write |

#### Returns

[`WriteResult`](WriteResult.md) \| `Promise`&lt;[`WriteResult`](WriteResult.md)&gt;

Result indicating success or failure

#### Example

```typescript
const result = await backend.write(
  "/src/new-file.ts",
  "export const hello = 'world';\n"
);
if (!result.success) {
  console.error("Write failed:", result.error);
}
```
