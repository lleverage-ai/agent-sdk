# @lleverage-ai/agent-sdk

A TypeScript framework for building AI agents with the Vercel AI SDK.

## Installation

```bash
bun add @lleverage-ai/agent-sdk ai zod
```

Install at least one AI provider as well:

```bash
bun add @ai-sdk/anthropic
```

## Quick Start

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { createAgent } from "@lleverage-ai/agent-sdk";
import { tool } from "ai";
import { z } from "zod";

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  systemPrompt: "You are a helpful assistant.",
  tools: {
    greet: tool({
      description: "Greet a person by name",
      inputSchema: z.object({
        name: z.string(),
      }),
      execute: async ({ name }) => `Hello, ${name}!`,
    }),
  },
});

const result = await agent.generate({
  prompt: "Say hello to Alice",
});

console.log(result.text);
```

## What You Get

- `createAgent()` for text generation, streaming, tool use, hooks, and sessions
- Tools built on the AI SDK `tool()` API
- Plugins that bundle tools, skills, hooks, and MCP integrations
- Deferred discovery and proxy loading with `search_tools` and `call_tool`
- Subagents, teams, memory, observability, middleware, and security utilities

## Tool Naming

- Inline plugin tools use `<plugin>__<tool>`
- External MCP tools use `mcp__<server>__<tool>`

This keeps inline plugin tools distinct from real MCP-backed tools while preserving stable names for discovery and proxy calls.

## Documentation

- Getting started: https://github.com/lleverage-ai/agent-sdk#readme
- Tool loading: https://github.com/lleverage-ai/agent-sdk/blob/main/docs/tool-loading.md
- MCP integration: https://github.com/lleverage-ai/agent-sdk/blob/main/docs/mcp.md
- Agent sessions: https://github.com/lleverage-ai/agent-sdk/blob/main/docs/agent-session.md
- Contributing: https://github.com/lleverage-ai/agent-sdk/blob/main/CONTRIBUTING.md

## License

MIT
