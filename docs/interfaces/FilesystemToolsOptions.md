[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FilesystemToolsOptions

# Interface: FilesystemToolsOptions

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:367](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L367)

Options for creating filesystem tools.

## Properties

### backend

> **backend**: [`BackendProtocol`](BackendProtocol.md)

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:369](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L369)

The backend to use for file operations

***

### includeEdit?

> `optional` **includeEdit**: `boolean`

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:381](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L381)

Whether to include the edit tool.

#### Default Value

```ts
true
```

***

### includeWrite?

> `optional` **includeWrite**: `boolean`

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:375](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L375)

Whether to include the write tool.

#### Default Value

```ts
true
```
