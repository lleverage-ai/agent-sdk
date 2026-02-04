[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / loadAgentMemory

# Function: loadAgentMemory()

> **loadAgentMemory**(`filePath`: `string`, `options?`: [`LoadAgentMemoryOptions`](../interfaces/LoadAgentMemoryOptions.md)): `Promise`&lt;[`MemoryDocument`](../interfaces/MemoryDocument.md) \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/memory/loader.ts:134](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L134)

Load a single agent memory file.

Reads the file, parses YAML frontmatter, and returns the document.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the memory file |
| `options?` | [`LoadAgentMemoryOptions`](../interfaces/LoadAgentMemoryOptions.md) | Loading options |

## Returns

`Promise`&lt;[`MemoryDocument`](../interfaces/MemoryDocument.md) \| `undefined`&gt;

The memory content, or undefined if not found

## Example

```typescript
const memory = await loadAgentMemory("~/.deepagents/my-agent/agent.md");
if (memory) {
  console.log(memory.content);
}
```
