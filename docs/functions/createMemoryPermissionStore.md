[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createMemoryPermissionStore

# Function: createMemoryPermissionStore()

> **createMemoryPermissionStore**(`options?`: [`FileMemoryPermissionStoreOptions`](../interfaces/FileMemoryPermissionStoreOptions.md)): [`FileMemoryPermissionStore`](../classes/FileMemoryPermissionStore.md)

Defined in: [packages/agent-sdk/src/memory/permissions.ts:438](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L438)

Create a new FileMemoryPermissionStore.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options?` | [`FileMemoryPermissionStoreOptions`](../interfaces/FileMemoryPermissionStoreOptions.md) | Configuration options |

## Returns

[`FileMemoryPermissionStore`](../classes/FileMemoryPermissionStore.md)

A new FileMemoryPermissionStore instance

## Example

```typescript
const store = createMemoryPermissionStore({
  permissionsFilePath: "/path/to/.memory-permissions.json",
});
```
