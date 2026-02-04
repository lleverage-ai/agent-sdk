[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LoadAgentMemoryOptions

# Interface: LoadAgentMemoryOptions

Defined in: [packages/agent-sdk/src/memory/loader.ts:52](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L52)

Options for loading agent memory.

## Properties

### homeDir?

> `optional` **homeDir**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:62](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L62)

Override home directory for ~ expansion.

***

### store?

> `optional` **store**: [`MemoryStore`](MemoryStore.md)

Defined in: [packages/agent-sdk/src/memory/loader.ts:57](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L57)

Custom memory store to use.
Defaults to FilesystemMemoryStore.
