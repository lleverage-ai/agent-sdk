[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ToolReference

# Type Alias: ToolReference

> **ToolReference** = `string` \| [`Tool`](Tool.md) \| [`PluginOptions`](../interfaces/PluginOptions.md) \| [`ToolSet`](ToolSet.md) \| `ToolReference`[]

Defined in: [packages/agent-sdk/src/tools/utils.ts:24](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/utils.ts#L24)

A reference to a tool that can be resolved to a tool name.

Can be:
- A string (tool name directly)
- A Tool object (name extracted from key when in a ToolSet)
- A Plugin (all tool names extracted, or MCP tool names generated)
- A ToolSet record (all keys extracted as tool names)
