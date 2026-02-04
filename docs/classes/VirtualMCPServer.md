[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / VirtualMCPServer

# Class: VirtualMCPServer

Defined in: [packages/agent-sdk/src/mcp/virtual-server.ts:36](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/virtual-server.ts#L36)

Virtual MCP server that wraps inline plugin tools.

This provides a consistent interface for tools defined in code,
making them appear the same as tools from external MCP servers.

## Example

```typescript
const server = new VirtualMCPServer("my-plugin", {
  greet: tool({
    description: "Greet someone",
    inputSchema: z.object({ name: z.string() }),
    execute: async ({ name }) => `Hello, ${name}!`,
  }),
});

const metadata = server.getToolMetadata();
// [{ name: "mcp__my-plugin__greet", ... }]
```

## Constructors

### Constructor

> **new VirtualMCPServer**(`name`: `string`, `tools`: [`ToolSet`](../type-aliases/ToolSet.md)): `VirtualMCPServer`

Defined in: [packages/agent-sdk/src/mcp/virtual-server.ts:49](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/virtual-server.ts#L49)

Create a virtual MCP server.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | Server/plugin name (used in mcp__\<name\>__\<tool\> naming) |
| `tools` | [`ToolSet`](../type-aliases/ToolSet.md) | AI SDK tools to wrap |

#### Returns

`VirtualMCPServer`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [packages/agent-sdk/src/mcp/virtual-server.ts:38](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/virtual-server.ts#L38)

Server/plugin name

## Methods

### callTool()

> **callTool**(`toolName`: `string`, `args`: `unknown`, `abortSignal?`: `AbortSignal`): `Promise`&lt;`unknown`&gt;

Defined in: [packages/agent-sdk/src/mcp/virtual-server.ts:107](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/virtual-server.ts#L107)

Execute a tool by its original name.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `toolName` | `string` | Original tool name (without mcp__ prefix) |
| `args` | `unknown` | Tool arguments |
| `abortSignal?` | `AbortSignal` | Optional abort signal for cancellation |

#### Returns

`Promise`&lt;`unknown`&gt;

Tool execution result

#### Throws

If tool not found

***

### getToolMetadata()

> **getToolMetadata**(): [`MCPToolMetadata`](../interfaces/MCPToolMetadata.md)[]

Defined in: [packages/agent-sdk/src/mcp/virtual-server.ts:61](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/virtual-server.ts#L61)

Get MCP-formatted metadata for all tools.

#### Returns

[`MCPToolMetadata`](../interfaces/MCPToolMetadata.md)[]

Array of tool metadata with MCP naming

***

### getToolNames()

> **getToolNames**(): `string`[]

Defined in: [packages/agent-sdk/src/mcp/virtual-server.ts:158](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/virtual-server.ts#L158)

Get list of original tool names.

#### Returns

`string`[]

***

### getToolSet()

> **getToolSet**(): [`ToolSet`](../type-aliases/ToolSet.md)

Defined in: [packages/agent-sdk/src/mcp/virtual-server.ts:135](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/virtual-server.ts#L135)

Get AI SDK compatible ToolSet with MCP naming.

#### Returns

[`ToolSet`](../type-aliases/ToolSet.md)

ToolSet with mcp__<name>__<tool> keys

***

### hasTool()

> **hasTool**(`toolName`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/mcp/virtual-server.ts:151](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/virtual-server.ts#L151)

Check if a tool exists by original name.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `toolName` | `string` | Original tool name |

#### Returns

`boolean`
