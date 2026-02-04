[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / toolsFromPlugin

# Function: toolsFromPlugin()

> **toolsFromPlugin**(`plugin`: [`PluginOptions`](../interfaces/PluginOptions.md), `mcpToolNames?`: `string`[]): `string`[]

Defined in: [packages/agent-sdk/src/tools/utils.ts:115](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/utils.ts#L115)

Extracts tool names from a plugin.

For regular plugins, extracts tool names from the tools property.
For MCP plugins, generates tool names based on the plugin name and
optionally specified tool names.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `plugin` | [`PluginOptions`](../interfaces/PluginOptions.md) | The plugin to extract tool names from |
| `mcpToolNames?` | `string`[] | For MCP plugins, the specific tool names to include |

## Returns

`string`[]

Array of tool name strings

## Example

```typescript
// Regular plugin with tools
const names = toolsFromPlugin(myPlugin);
// Returns: ["tool1", "tool2", ...]

// MCP plugin with specific tools
const names = toolsFromPlugin(webSearchPlugin, ["search", "extract"]);
// Returns: ["mcp__web-search__search", "mcp__web-search__extract"]
```
