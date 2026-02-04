[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createToolRegistry

# Function: createToolRegistry()

> **createToolRegistry**(`options?`: [`ToolRegistryOptions`](../interfaces/ToolRegistryOptions.md)): [`ToolRegistry`](../classes/ToolRegistry.md)

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:871](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L871)

Creates a new tool registry.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options?` | [`ToolRegistryOptions`](../interfaces/ToolRegistryOptions.md) | Configuration options |

## Returns

[`ToolRegistry`](../classes/ToolRegistry.md)

A new ToolRegistry instance

## Example

```typescript
const registry = createToolRegistry({
  onToolsLoaded: (result) => console.log("Loaded:", result.loaded),
});
```
