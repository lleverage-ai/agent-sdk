[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createAgent

# Function: createAgent()

> **createAgent**(`options`: [`AgentOptions`](../interfaces/AgentOptions.md)): [`Agent`](../interfaces/Agent.md)

Defined in: [packages/agent-sdk/src/agent.ts:700](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/agent.ts#L700)

Creates a new agent instance with the specified configuration.

Agents are the main abstraction for interacting with AI models. They combine
a language model with tools, plugins, and hooks to create intelligent assistants.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`AgentOptions`](../interfaces/AgentOptions.md) | Configuration options for the agent |

## Returns

[`Agent`](../interfaces/Agent.md)

A configured agent instance

## Examples

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";
import { tool } from "ai";
import { z } from "zod";

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  systemPrompt: "You are a helpful assistant.",
  tools: {
    weather: tool({
      description: "Get weather for a city",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => `Weather in ${city}: sunny`,
    }),
  },
});

const result = await agent.generate({
  prompt: "What's the weather in Tokyo?",
});
```

```typescript
// Use in a Next.js API route with useChat
export async function POST(req: Request) {
  const { messages } = await req.json();
  return agent.streamResponse({ messages });
}
```
