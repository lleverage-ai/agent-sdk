[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / AgentPlugin

# Interface: AgentPlugin

Defined in: [packages/agent-sdk/src/types.ts:1589](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1589)

A plugin that extends agent functionality.

Plugins can provide tools, skills, hooks, and initialization logic.

## Example

```typescript
const plugin: AgentPlugin = {
  name: "my-plugin",
  description: "Adds useful tools",
  tools: { myTool: tool({ ... }) },
  setup: async (agent) => {
    console.log("Plugin initialized for agent:", agent.id);
  },
};
```

## Properties

### description?

> `optional` **description**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1594](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1594)

Human-readable description of what this plugin does

***

### mcpServer?

> `optional` **mcpServer**: [`MCPServerConfig`](../type-aliases/MCPServerConfig.md)

Defined in: [packages/agent-sdk/src/types.ts:1649](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1649)

MCP server configuration for external tool integration.

When provided, the agent will connect to this MCP server and expose
its tools with the naming pattern `mcp__<plugin-name>__<tool-name>`.

#### Example

```typescript
const githubPlugin = definePlugin({
  name: "github",
  mcpServer: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
  },
});
```

***

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1591](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1591)

Unique name identifying this plugin

***

### skills?

> `optional` **skills**: [`SkillDefinition`](SkillDefinition.md)[]

Defined in: [packages/agent-sdk/src/types.ts:1652](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1652)

Skills provided by this plugin

***

### tools?

> `optional` **tools**: [`ToolSet`](../type-aliases/ToolSet.md) \| [`StreamingToolsFactory`](../type-aliases/StreamingToolsFactory.md)

Defined in: [packages/agent-sdk/src/types.ts:1628](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1628)

Tools provided by this plugin.

Can be a static ToolSet or a function that receives StreamingContext.
Use a function when you need to stream data to the client during tool execution.

#### Example

```typescript
// Static tools (no streaming)
tools: {
  myTool: tool({ ... }),
}

// Streaming-aware tools
tools: (ctx) => ({
  myTool: tool({
    execute: async (input) => {
      if (ctx.writer) {
        ctx.writer.write({ type: "data", value: { type: "progress", value: 50 } });
      }
      return result;
    },
  }),
})
```

## Methods

### setup()?

> `optional` **setup**(`agent`: [`Agent`](Agent.md)): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/types.ts:1600](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1600)

Initialize the plugin when it's loaded into an agent.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `agent` | [`Agent`](Agent.md) | The agent instance loading this plugin |

#### Returns

`void` \| `Promise`&lt;`void`&gt;
