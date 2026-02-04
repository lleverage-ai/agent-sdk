[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createSearchToolsTool

# Function: createSearchToolsTool()

> **createSearchToolsTool**(`options`: [`SearchToolsOptions`](../interfaces/SearchToolsOptions.md)): [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/search.ts:66](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/search.ts#L66)

Creates the search_tools meta-tool for discovering MCP tools.

This tool allows agents to search for available tools by query,
enabling progressive disclosure of capabilities.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`SearchToolsOptions`](../interfaces/SearchToolsOptions.md) | Configuration options |

## Returns

[`Tool`](../type-aliases/Tool.md)

AI SDK tool definition

## Example

```typescript
const searchTool = createSearchToolsTool({
  manager: mcpManager,
  maxResults: 5,
});

// Agent can then use:
// search_tools({ query: "github issues" })

// With loading enabled:
// search_tools({ query: "github issues", load: true })
```
