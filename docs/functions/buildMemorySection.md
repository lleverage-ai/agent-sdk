[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / buildMemorySection

# Function: buildMemorySection()

> **buildMemorySection**(`userMemory`: [`MemoryDocument`](../interfaces/MemoryDocument.md) \| `undefined`, `projectMemory`: [`MemoryDocument`](../interfaces/MemoryDocument.md) \| `undefined`, `additionalFiles`: [`AdditionalMemoryFile`](../interfaces/AdditionalMemoryFile.md)[], `options?`: [`BuildMemorySectionOptions`](../interfaces/BuildMemorySectionOptions.md)): `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:350](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L350)

Build a formatted memory section for injection into prompts.

Combines user memory, project memory, and additional files into
a single formatted string suitable for system prompt injection.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `userMemory` | [`MemoryDocument`](../interfaces/MemoryDocument.md) \| `undefined` | User-level memory document |
| `projectMemory` | [`MemoryDocument`](../interfaces/MemoryDocument.md) \| `undefined` | Project-level memory document |
| `additionalFiles` | [`AdditionalMemoryFile`](../interfaces/AdditionalMemoryFile.md)[] | Additional memory files |
| `options?` | [`BuildMemorySectionOptions`](../interfaces/BuildMemorySectionOptions.md) | Formatting options |

## Returns

`string`

Formatted memory section string

## Example

```typescript
const userMemory = await loadAgentMemory("~/.deepagents/agent/agent.md");
const projectMemory = await loadAgentMemory("/project/.deepagents/agent.md");
const additional = await loadAdditionalMemoryFiles("~/.deepagents/agent");

const section = buildMemorySection(userMemory, projectMemory, additional);
const systemPrompt = `You are a helpful assistant.\n\n${section}`;
```
