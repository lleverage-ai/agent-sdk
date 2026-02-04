[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LoadAdditionalMemoryOptions

# Interface: LoadAdditionalMemoryOptions

Defined in: [packages/agent-sdk/src/memory/loader.ts:70](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L70)

Options for loading additional memory files.

## Properties

### exclude?

> `optional` **exclude**: `string`[]

Defined in: [packages/agent-sdk/src/memory/loader.ts:81](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L81)

File to exclude (usually agent.md).

#### Default Value

```ts
["agent.md"]
```

***

### homeDir?

> `optional` **homeDir**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:86](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L86)

Override home directory for ~ expansion.

***

### store?

> `optional` **store**: [`MemoryStore`](MemoryStore.md)

Defined in: [packages/agent-sdk/src/memory/loader.ts:75](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L75)

Custom memory store to use.
Defaults to FilesystemMemoryStore.
