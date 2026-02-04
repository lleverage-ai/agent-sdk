[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MCPManagerOptions

# Interface: MCPManagerOptions

Defined in: [packages/agent-sdk/src/mcp/manager.ts:41](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L41)

Options for MCPManager initialization.

## Properties

### onConnectionFailed()?

> `optional` **onConnectionFailed**: (`input`: \{ `config`: [`MCPServerConfig`](../type-aliases/MCPServerConfig.md); `error`: `Error`; `server_name`: `string`; \}) => `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/mcp/manager.ts:43](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L43)

Hook callbacks for MCP lifecycle events

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | \{ `config`: [`MCPServerConfig`](../type-aliases/MCPServerConfig.md); `error`: `Error`; `server_name`: `string`; \} |
| `input.config` | [`MCPServerConfig`](../type-aliases/MCPServerConfig.md) |
| `input.error` | `Error` |
| `input.server_name` | `string` |

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### onConnectionRestored()?

> `optional` **onConnectionRestored**: (`input`: \{ `server_name`: `string`; `tool_count`: `number`; \}) => `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/mcp/manager.ts:49](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/manager.ts#L49)

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | \{ `server_name`: `string`; `tool_count`: `number`; \} |
| `input.server_name` | `string` |
| `input.tool_count` | `number` |

#### Returns

`void` \| `Promise`&lt;`void`&gt;
