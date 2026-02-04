[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / mcpTools

# Function: mcpTools()

> **mcpTools**(`pluginName`: `string`): (`toolName`: `string`) => `string`

Defined in: [packages/agent-sdk/src/tools/utils.ts:52](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/utils.ts#L52)

Creates a helper for generating MCP tool names for a specific plugin.

MCP tools are prefixed with `mcp__<plugin-name>__<tool-name>`. This helper
makes it easier to reference these tools without typing the full name.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pluginName` | `string` | The MCP plugin name (e.g., "web-search") |

## Returns

A function that generates full MCP tool names

> (`toolName`: `string`): `string`

### Parameters

| Parameter | Type |
| :------ | :------ |
| `toolName` | `string` |

### Returns

`string`

## Example

```typescript
const webSearch = mcpTools("web-search");

const subagent = createSubagent(parent, {
  allowedTools: [webSearch("search"), webSearch("extract")],
  // Equivalent to: ["mcp__web-search__search", "mcp__web-search__extract"]
});
```
