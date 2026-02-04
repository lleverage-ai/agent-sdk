[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createUseToolsTool

# Function: createUseToolsTool()

> **createUseToolsTool**(`options`: [`UseToolsToolOptions`](../interfaces/UseToolsToolOptions.md)): [`Tool`](../type-aliases/Tool.md)&lt;\{ `plugin?`: `string`; `query?`: `string`; `tools?`: `string`[]; \}, `Record`&lt;`string`, `unknown`&gt;&gt;

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:750](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L750)

Creates the use_tools meta-tool for discovering and loading tools.

This tool allows agents to search available tools and load them on-demand.
Tools loaded through this tool become available in subsequent agent steps.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`UseToolsToolOptions`](../interfaces/UseToolsToolOptions.md) | Configuration options |

## Returns

[`Tool`](../type-aliases/Tool.md)&lt;\{ `plugin?`: `string`; `query?`: `string`; `tools?`: `string`[]; \}, `Record`&lt;`string`, `unknown`&gt;&gt;

An AI SDK compatible tool

## Example

```typescript
const registry = new ToolRegistry();
registry.registerPlugin("stripe", stripePlugin.tools);

const useToolsTool = createUseToolsTool({ registry });

const agent = createAgent({
  model,
  tools: {
    ...coreTools,
    use_tools: useToolsTool,
  },
  toolRegistry: registry,
});
```
