[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / buildPathMemoryContext

# Function: buildPathMemoryContext()

> **buildPathMemoryContext**(`options`: [`BuildPathMemoryContextOptions`](../interfaces/BuildPathMemoryContextOptions.md)): [`PathMemoryContext`](../interfaces/PathMemoryContext.md)

Defined in: [packages/agent-sdk/src/memory/rules.ts:312](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L312)

Build memory context filtered by current file path.

This function filters all memory sources based on their path patterns
and the current file being worked on. Useful for providing context-aware
memory injection.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`BuildPathMemoryContextOptions`](../interfaces/BuildPathMemoryContextOptions.md) | Context building options |

## Returns

[`PathMemoryContext`](../interfaces/PathMemoryContext.md)

Path-filtered memory context

## Example

```typescript
const context = buildPathMemoryContext({
  userMemory,
  projectMemory,
  additionalFiles,
  currentPath: "src/api/users.ts",
});

if (context.combinedContent) {
  systemPrompt += `\n\n## Relevant Context\n\n${context.combinedContent}`;
}
```
