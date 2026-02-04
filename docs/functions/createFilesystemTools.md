[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createFilesystemTools

# Function: createFilesystemTools()

> **createFilesystemTools**(`options`: [`FilesystemToolsOptions`](../interfaces/FilesystemToolsOptions.md)): [`FilesystemTools`](../interfaces/FilesystemTools.md)

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:436](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L436)

Creates all filesystem tools from a backend.

This is a convenience factory that creates all filesystem tools at once.
For read-only access, set `includeWrite` and `includeEdit` to false.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`FilesystemToolsOptions`](../interfaces/FilesystemToolsOptions.md) | Configuration options |

## Returns

[`FilesystemTools`](../interfaces/FilesystemTools.md)

Object containing all filesystem tools

## Examples

```typescript
import { createFilesystemTools, FilesystemBackend } from "@lleverage-ai/agent-sdk";

const backend = new FilesystemBackend({ rootDir: process.cwd() });
const fsTools = createFilesystemTools({ backend });

const agent = createAgent({
  model,
  tools: fsTools,
});
```

```typescript
// Read-only mode
const fsTools = createFilesystemTools({
  backend,
  includeWrite: false,
  includeEdit: false,
});
```
