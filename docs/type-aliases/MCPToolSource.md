[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MCPToolSource

# Type Alias: MCPToolSource

> **MCPToolSource** = `"inline"` \| `"stdio"` \| `"http"` \| `"sse"`

Defined in: [packages/agent-sdk/src/mcp/types.ts:19](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L19)

Source type for MCP tools.

- `inline` - Tool defined in plugin code (virtual MCP server)
- `stdio` - Tool from stdio-based MCP server
- `http` - Tool from HTTP-based MCP server
- `sse` - Tool from SSE-based MCP server
