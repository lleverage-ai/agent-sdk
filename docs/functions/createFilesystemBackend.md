[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createFilesystemBackend

# Function: createFilesystemBackend()

> **createFilesystemBackend**(`options?`: [`FilesystemBackendOptions`](../interfaces/FilesystemBackendOptions.md)): [`FilesystemBackend`](../classes/FilesystemBackend.md)

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:760](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L760)

Create a FilesystemBackend with the specified options.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options?` | [`FilesystemBackendOptions`](../interfaces/FilesystemBackendOptions.md) | Configuration options |

## Returns

[`FilesystemBackend`](../classes/FilesystemBackend.md)

A new FilesystemBackend instance

## Example

```typescript
const backend = createFilesystemBackend({
  rootDir: "/home/user/project",
  maxFileSizeMb: 5,
});
```
