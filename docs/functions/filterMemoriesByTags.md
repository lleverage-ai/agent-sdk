[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / filterMemoriesByTags

# Function: filterMemoriesByTags()

> **filterMemoriesByTags**(`documents`: [`MemoryDocument`](../interfaces/MemoryDocument.md)[], `tags`: `string`[]): [`MemoryDocument`](../interfaces/MemoryDocument.md)[]

Defined in: [packages/agent-sdk/src/memory/rules.ts:419](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L419)

Filter memory documents by tags.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `documents` | [`MemoryDocument`](../interfaces/MemoryDocument.md)[] | Array of memory documents |
| `tags` | `string`[] | Tags to filter by (document must have at least one) |

## Returns

[`MemoryDocument`](../interfaces/MemoryDocument.md)[]

Filtered array of documents

## Example

```typescript
const docs = filterMemoriesByTags(memories, ["api", "security"]);
// Returns documents that have either "api" or "security" tag
```
