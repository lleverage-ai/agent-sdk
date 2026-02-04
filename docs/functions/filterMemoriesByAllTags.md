[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / filterMemoriesByAllTags

# Function: filterMemoriesByAllTags()

> **filterMemoriesByAllTags**(`documents`: [`MemoryDocument`](../interfaces/MemoryDocument.md)[], `tags`: `string`[]): [`MemoryDocument`](../interfaces/MemoryDocument.md)[]

Defined in: [packages/agent-sdk/src/memory/rules.ts:452](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L452)

Filter memory documents by all required tags.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `documents` | [`MemoryDocument`](../interfaces/MemoryDocument.md)[] | Array of memory documents |
| `tags` | `string`[] | Tags to filter by (document must have all) |

## Returns

[`MemoryDocument`](../interfaces/MemoryDocument.md)[]

Filtered array of documents

## Example

```typescript
const docs = filterMemoriesByAllTags(memories, ["api", "security"]);
// Returns documents that have both "api" AND "security" tags
```
