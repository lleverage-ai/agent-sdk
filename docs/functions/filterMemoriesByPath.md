[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / filterMemoriesByPath

# Function: filterMemoriesByPath()

> **filterMemoriesByPath**(`documents`: [`MemoryDocument`](../interfaces/MemoryDocument.md)[], `currentPath`: `string`): [`MemoryDocument`](../interfaces/MemoryDocument.md)[]

Defined in: [packages/agent-sdk/src/memory/rules.ts:145](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L145)

Filter memory documents by path relevance.

A memory document is considered relevant if:
1. It has no `paths` metadata (applies to all files)
2. The file path matches any of the patterns in `paths` metadata

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `documents` | [`MemoryDocument`](../interfaces/MemoryDocument.md)[] | Array of memory documents to filter |
| `currentPath` | `string` | The current file path to match against |

## Returns

[`MemoryDocument`](../interfaces/MemoryDocument.md)[]

Array of relevant memory documents, sorted by priority

## Example

```typescript
const memories: MemoryDocument[] = [
  {
    path: "/memory/api.md",
    metadata: { paths: ["src/api/**/*.ts"], priority: 10 },
    content: "API rules...",
    modifiedAt: Date.now(),
  },
  {
    path: "/memory/general.md",
    metadata: {}, // No paths = applies to all
    content: "General rules...",
    modifiedAt: Date.now(),
  },
];

const relevant = filterMemoriesByPath(memories, "src/api/users.ts");
// Returns both, sorted by priority (api.md first)
```
