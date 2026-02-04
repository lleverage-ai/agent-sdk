[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / mcpToolsFor

# Function: mcpToolsFor()

> **mcpToolsFor**&lt;`T`&gt;(`pluginName`: `string`, `toolNames`: `T`): `{ [K in string]: string }`

Defined in: [packages/agent-sdk/src/tools/utils.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/utils.ts#L80)

Creates a helper for a specific MCP plugin with known tools.

Returns an object with tool name properties for better IDE autocomplete.

## Type Parameters

| Type Parameter |
| :------ |
| `T` *extends* readonly `string`[] |

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pluginName` | `string` | The MCP plugin name |
| `toolNames` | `T` | Array of tool names provided by the plugin |

## Returns

`{ [K in string]: string }`

An object mapping tool names to their full MCP names

## Example

```typescript
const webSearch = mcpToolsFor("web-search", ["search", "extract"] as const);

// Now you get autocomplete:
webSearch.search  // "mcp__web-search__search"
webSearch.extract // "mcp__web-search__extract"

const subagent = createSubagent(parent, {
  allowedTools: [webSearch.search, webSearch.extract],
});
```
