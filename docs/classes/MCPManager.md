[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MCPManager

# Class: MCPManager

Defined in: [packages/agent-sdk/src/mcp/manager.ts:84](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L84)

Manages MCP tool registration, discovery, and execution.

Provides a unified interface for tools from:
- Inline plugin definitions (wrapped as virtual MCP servers)
- External MCP servers (stdio, http, sse)

## Example

```typescript
const manager = new MCPManager();

// Register inline plugin tools
manager.registerPluginTools("my-plugin", { myTool: tool(...) });

// Connect to external MCP server
await manager.connectServer("github", {
  type: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
});

// Search and use tools
const tools = manager.searchTools("github issues");
const toolSet = manager.getToolSet();
```

## Constructors

### Constructor

> **new MCPManager**(`options`: [`MCPManagerOptions`](../interfaces/MCPManagerOptions.md)): `MCPManager`

Defined in: [packages/agent-sdk/src/mcp/manager.ts:117](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L117)

Creates a new MCP manager.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`MCPManagerOptions`](../interfaces/MCPManagerOptions.md) | Configuration options including hook callbacks |

#### Returns

`MCPManager`

## Methods

### callTool()

> **callTool**(`mcpName`: `string`, `args`: `unknown`): `Promise`&lt;`unknown`&gt;

Defined in: [packages/agent-sdk/src/mcp/manager.ts:439](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L439)

Call a tool by its MCP name.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `mcpName` | `string` | Full MCP tool name (mcp__\<source\>__\<tool\>) |
| `args` | `unknown` | Tool arguments |

#### Returns

`Promise`&lt;`unknown`&gt;

Tool execution result

***

### connectServer()

> **connectServer**(`name`: `string`, `config`: [`MCPServerConfig`](../type-aliases/MCPServerConfig.md)): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/mcp/manager.ts:147](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L147)

Connect to an external MCP server.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | Unique name for this server (used in tool naming) |
| `config` | [`MCPServerConfig`](../type-aliases/MCPServerConfig.md) | Server connection configuration |

#### Returns

`Promise`&lt;`void`&gt;

#### Throws

If server with same name is already connected

#### Example

```typescript
// Connect to stdio server
await manager.connectServer("github", {
  type: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
});

// Connect to HTTP server
await manager.connectServer("docs", {
  type: "http",
  url: "https://docs.example.com/mcp",
  headers: { Authorization: "Bearer ${API_TOKEN}" },
});
```

***

### disconnect()

> **disconnect**(): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/mcp/manager.ts:515](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L515)

Disconnect all external MCP servers.

#### Returns

`Promise`&lt;`void`&gt;

***

### getToolSet()

> **getToolSet**(`filter?`: `string`[]): [`ToolSet`](../type-aliases/ToolSet.md)

Defined in: [packages/agent-sdk/src/mcp/manager.ts:345](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L345)

Get AI SDK compatible ToolSet.

Only returns tools that have been loaded (either via autoLoad or explicit loadTools call).

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filter?` | `string`[] | Optional list of tool names to include |

#### Returns

[`ToolSet`](../type-aliases/ToolSet.md)

ToolSet with MCP-named tools

***

### listTools()

> **listTools**(): [`MCPToolMetadata`](../interfaces/MCPToolMetadata.md)[]

Defined in: [packages/agent-sdk/src/mcp/manager.ts:306](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L306)

List all available tools from all sources.

#### Returns

[`MCPToolMetadata`](../interfaces/MCPToolMetadata.md)[]

Array of tool metadata

***

### loadTools()

> **loadTools**(`toolNames`: `string`[]): [`MCPToolLoadResult`](../interfaces/MCPToolLoadResult.md)

Defined in: [packages/agent-sdk/src/mcp/manager.ts:489](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L489)

Load specific tools by name, making them available via getToolSet().

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `toolNames` | `string`[] | MCP tool names to load |

#### Returns

[`MCPToolLoadResult`](../interfaces/MCPToolLoadResult.md)

Load result with loaded/alreadyLoaded/notFound lists

***

### registerPluginTools()

> **registerPluginTools**(`pluginName`: `string`, `tools`: [`ToolSet`](../type-aliases/ToolSet.md), `options`: \{ `autoLoad?`: `boolean`; \}): `void`

Defined in: [packages/agent-sdk/src/mcp/manager.ts:279](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L279)

Register inline plugin tools as a virtual MCP server.

Tools will be exposed with naming pattern `mcp__<pluginName>__<toolName>`.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pluginName` | `string` | Plugin/server name |
| `tools` | [`ToolSet`](../type-aliases/ToolSet.md) | AI SDK tools to register |
| `options` | \{ `autoLoad?`: `boolean`; \} | Registration options |
| `options.autoLoad?` | `boolean` | - |

#### Returns

`void`

***

### searchTools()

> **searchTools**(`query`: `string`, `limit`: `number`): [`MCPToolMetadata`](../interfaces/MCPToolMetadata.md)[]

Defined in: [packages/agent-sdk/src/mcp/manager.ts:320](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L320)

Search tools by query string.

Matches against tool name and description (case-insensitive).

#### Parameters

| Parameter | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `query` | `string` | `undefined` | Search query |
| `limit` | `number` | `10` | Maximum results to return |

#### Returns

[`MCPToolMetadata`](../interfaces/MCPToolMetadata.md)[]

Matching tool metadata
