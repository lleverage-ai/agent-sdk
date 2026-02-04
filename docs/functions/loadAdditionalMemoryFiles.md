[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / loadAdditionalMemoryFiles

# Function: loadAdditionalMemoryFiles()

> **loadAdditionalMemoryFiles**(`dirPath`: `string`, `options?`: [`LoadAdditionalMemoryOptions`](../interfaces/LoadAdditionalMemoryOptions.md)): `Promise`&lt;[`AdditionalMemoryFile`](../interfaces/AdditionalMemoryFile.md)[]&gt;

Defined in: [packages/agent-sdk/src/memory/loader.ts:164](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L164)

Load all additional memory files from a directory.

Scans the directory for .md files (excluding agent.md by default)
and returns their content.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `dirPath` | `string` | Path to the agent memory directory |
| `options?` | [`LoadAdditionalMemoryOptions`](../interfaces/LoadAdditionalMemoryOptions.md) | Loading options |

## Returns

`Promise`&lt;[`AdditionalMemoryFile`](../interfaces/AdditionalMemoryFile.md)[]&gt;

Array of additional memory file content

## Example

```typescript
const files = await loadAdditionalMemoryFiles("~/.deepagents/my-agent");
for (const file of files) {
  console.log(`${file.filename}: ${file.content.slice(0, 100)}...`);
}
```
