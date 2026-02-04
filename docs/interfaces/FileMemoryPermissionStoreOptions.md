[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FileMemoryPermissionStoreOptions

# Interface: FileMemoryPermissionStoreOptions

Defined in: [packages/agent-sdk/src/memory/permissions.ts:183](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L183)

Options for FileMemoryPermissionStore.

## Properties

### createDirs?

> `optional` **createDirs**: `boolean`

Defined in: [packages/agent-sdk/src/memory/permissions.ts:196](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L196)

Create parent directories if they don't exist.

#### Default Value

```ts
true
```

***

### permissionsFilePath?

> `optional` **permissionsFilePath**: `string`

Defined in: [packages/agent-sdk/src/memory/permissions.ts:189](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L189)

Path to the permissions file.

#### Default Value

```ts
~/.deepagents/.memory-permissions.json
```
