[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / filterAdditionalFilesByPath

# Function: filterAdditionalFilesByPath()

> **filterAdditionalFilesByPath**(`files`: [`AdditionalMemoryFile`](../interfaces/AdditionalMemoryFile.md)[], `currentPath`: `string`): [`AdditionalMemoryFile`](../interfaces/AdditionalMemoryFile.md)[]

Defined in: [packages/agent-sdk/src/memory/rules.ts:183](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L183)

Filter additional memory files by path relevance.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `files` | [`AdditionalMemoryFile`](../interfaces/AdditionalMemoryFile.md)[] | Array of additional memory files |
| `currentPath` | `string` | The current file path to match against |

## Returns

[`AdditionalMemoryFile`](../interfaces/AdditionalMemoryFile.md)[]

Array of relevant files, sorted by priority
