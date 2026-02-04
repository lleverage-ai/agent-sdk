[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FilesystemMemoryStoreOptions

# Interface: FilesystemMemoryStoreOptions

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:46](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L46)

Configuration options for FilesystemMemoryStore.

## Properties

### createDirs?

> `optional` **createDirs**: `boolean`

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:61](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L61)

Create parent directories if they don't exist when writing.

#### Default Value

```ts
true
```

***

### extension?

> `optional` **extension**: `string`

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:68](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L68)

File extension to use for memory documents.

#### Default Value

```ts
".md"
```

***

### homeDir?

> `optional` **homeDir**: `string`

Defined in: [packages/agent-sdk/src/memory/filesystem-store.ts:54](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/filesystem-store.ts#L54)

Override the home directory for `~` expansion.

Useful for testing or running in sandboxed environments.

#### Default Value

```ts
os.homedir()
```
