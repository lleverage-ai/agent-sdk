[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / definePlugin

# Function: definePlugin()

> **definePlugin**(`options`: [`PluginOptions`](../interfaces/PluginOptions.md)): [`AgentPlugin`](../interfaces/AgentPlugin.md)

Defined in: [packages/agent-sdk/src/plugins.ts:56](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/plugins.ts#L56)

Creates a plugin that extends agent functionality.

Plugins bundle related tools and skills together for easy reuse
across multiple agents. They can also include setup logic that runs when
the plugin is loaded into an agent.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`PluginOptions`](../interfaces/PluginOptions.md) | Configuration options for the plugin |

## Returns

[`AgentPlugin`](../interfaces/AgentPlugin.md)

A plugin definition object

## Example

```typescript
import { definePlugin } from "@lleverage-ai/agent-sdk";
import { tool } from "ai";
import { z } from "zod";

const gitPlugin = definePlugin({
  name: "git",
  description: "Git operations for version control",
  tools: {
    gitStatus: tool({
      description: "Get the current git status",
      inputSchema: z.object({}),
      execute: async () => {
        // Run git status...
        return "On branch main, nothing to commit";
      },
    }),
    gitCommit: tool({
      description: "Create a git commit",
      inputSchema: z.object({
        message: z.string().describe("Commit message"),
      }),
      execute: async ({ message }) => {
        // Run git commit...
        return `Committed with message: ${message}`;
      },
    }),
  },
  setup: async (agent) => {
    console.log(`Git plugin loaded into agent ${agent.id}`);
  },
});
```
