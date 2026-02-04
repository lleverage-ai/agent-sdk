[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MCPToolLoadResult

# Interface: MCPToolLoadResult

Defined in: [packages/agent-sdk/src/mcp/types.ts:53](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L53)

Result from loading MCP tools.

## Properties

### alreadyLoaded

> **alreadyLoaded**: `string`[]

Defined in: [packages/agent-sdk/src/mcp/types.ts:58](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L58)

Tools that were already loaded (skipped)

***

### errors?

> `optional` **errors**: \{ `error`: `Error`; `tool`: `string`; \}[]

Defined in: [packages/agent-sdk/src/mcp/types.ts:64](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L64)

Any errors that occurred during loading

#### error

> **error**: `Error`

#### tool

> **tool**: `string`

***

### loaded

> **loaded**: `string`[]

Defined in: [packages/agent-sdk/src/mcp/types.ts:55](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L55)

Tools that were successfully loaded

***

### notFound

> **notFound**: `string`[]

Defined in: [packages/agent-sdk/src/mcp/types.ts:61](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/types.ts#L61)

Tools that could not be found
