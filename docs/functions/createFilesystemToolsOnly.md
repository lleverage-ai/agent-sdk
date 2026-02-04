[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createFilesystemToolsOnly

# Function: createFilesystemToolsOnly()

> **createFilesystemToolsOnly**(`options`: [`FilesystemToolsOptions`](../interfaces/FilesystemToolsOptions.md)): [`FilesystemTools`](../interfaces/FilesystemTools.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:533](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L533)

Creates filesystem tools only.

Use this when you only need file operations without other tools.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`FilesystemToolsOptions`](../interfaces/FilesystemToolsOptions.md) | Filesystem tools options |

## Returns

[`FilesystemTools`](../interfaces/FilesystemTools.md)

Object containing filesystem tools

## Example

```typescript
const fsTools = createFilesystemToolsOnly({
  backend: new FilesystemBackend({ rootDir: process.cwd() }),
});
```
