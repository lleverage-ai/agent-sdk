[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createSubagent

# Function: createSubagent()

> **createSubagent**(`parentAgent`: [`Agent`](../interfaces/Agent.md), `options`: [`SubagentOptions`](../interfaces/SubagentOptions.md)): [`Agent`](../interfaces/Agent.md)

Defined in: [packages/agent-sdk/src/subagents.ts:75](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents.ts#L75)

Creates a subagent that inherits configuration from a parent agent.

Subagents are specialized agents that can be spawned by a parent agent
to handle specific tasks. They can inherit the parent's model or use
their own, and can have their own tools, plugins, and configuration.

**Hook Inheritance**:
By default, subagents inherit all hooks from their parent agent. You can control
this behavior with the `inheritHooks` option:
- `true` (default): Inherit all parent hooks
- `false`: No inheritance, use only subagent's own hooks
- `string[]`: Inherit only specific hook events

**Tool Filtering Security**:
When `allowedTools` is specified, subagent gets access to only those tools.
A warning is logged if dangerous tools (bash, write, edit, rm, etc.) are included
without explicit opt-in via `inheritHooks: false` or specific hook controls.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `parentAgent` | [`Agent`](../interfaces/Agent.md) | The parent agent to inherit configuration from |
| `options` | [`SubagentOptions`](../interfaces/SubagentOptions.md) | Configuration options for the subagent |

## Returns

[`Agent`](../interfaces/Agent.md)

A new agent instance configured as a subagent

## Example

```typescript
import { createAgent, createSubagent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";
import { tool } from "ai";
import { z } from "zod";

const mainAgent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  systemPrompt: "You are a helpful assistant.",
  hooks: {
    PreToolUse: [{
      callback: async (input) => {
        console.log("Parent hook:", input.tool_name);
        return {};
      },
    }],
  },
});

// Create a specialized subagent for code review
const reviewerAgent = createSubagent(mainAgent, {
  name: "code-reviewer",
  description: "Reviews code for quality and best practices",
  systemPrompt: "You are an expert code reviewer.",
  inheritHooks: true, // Inherits parent's PreToolUse hook
  tools: {
    analyze: tool({
      description: "Analyze code",
      inputSchema: z.object({ code: z.string() }),
      execute: async ({ code }) => analyzeCode(code),
    }),
  },
});

const result = await reviewerAgent.generate({
  prompt: "Review this function: function add(a, b) { return a + b; }",
});
```
