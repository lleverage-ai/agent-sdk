[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MCPToolMetadata

# Interface: MCPToolMetadata

Defined in: [packages/agent-sdk/src/mcp/types.ts:28](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L28)

Metadata for an MCP tool.

Used for tool discovery and search without loading full tool definition.

## Properties

### description

> **description**: `string`

Defined in: [packages/agent-sdk/src/mcp/types.ts:36](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L36)

Human-readable description of what the tool does

***

### inputSchema

> **inputSchema**: `JSONSchema7`

Defined in: [packages/agent-sdk/src/mcp/types.ts:39](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L39)

JSON Schema for the tool's input parameters

***

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/mcp/types.ts:33](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L33)

Full MCP tool name.
Format: `mcp__<source>__<tool-name>`

***

### source

> **source**: `string`

Defined in: [packages/agent-sdk/src/mcp/types.ts:42](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L42)

Plugin or server name this tool comes from

***

### sourceType

> **sourceType**: [`MCPToolSource`](../type-aliases/MCPToolSource.md)

Defined in: [packages/agent-sdk/src/mcp/types.ts:45](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L45)

How this tool is provided
