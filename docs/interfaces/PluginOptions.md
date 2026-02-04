[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PluginOptions

# Interface: PluginOptions

Defined in: [packages/agent-sdk/src/types.ts:1660](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1660)

Options for the [definePlugin](../functions/definePlugin.md) helper function.

## Properties

### description?

> `optional` **description**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1665](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1665)

Human-readable description of what this plugin does

***

### mcpServer?

> `optional` **mcpServer**: [`MCPServerConfig`](../type-aliases/MCPServerConfig.md)

Defined in: [packages/agent-sdk/src/types.ts:1684](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1684)

MCP server configuration for external tool integration.

***

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1662](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1662)

Unique name identifying this plugin

***

### setup()?

> `optional` **setup**: (`agent`: [`Agent`](Agent.md)) => `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/types.ts:1671](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1671)

Initialize the plugin when it's loaded into an agent.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `agent` | [`Agent`](Agent.md) | The agent instance loading this plugin |

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### skills?

> `optional` **skills**: [`SkillDefinition`](SkillDefinition.md)[]

Defined in: [packages/agent-sdk/src/types.ts:1687](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1687)

Skills provided by this plugin

***

### tools?

> `optional` **tools**: [`ToolSet`](../type-aliases/ToolSet.md) \| [`StreamingToolsFactory`](../type-aliases/StreamingToolsFactory.md)

Defined in: [packages/agent-sdk/src/types.ts:1679](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1679)

Tools provided by this plugin.

Can be a static ToolSet or a function that receives StreamingContext.
Use a function when you need to stream data to the client during tool execution.
