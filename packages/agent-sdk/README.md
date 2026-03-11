# @lleverage-ai/agent-sdk

A TypeScript framework for building AI agents with the Vercel AI SDK.

`@lleverage-ai/agent-sdk` is the package most users should start with. It provides the application-layer agent framework: models, tools, plugins, hooks, sessions, subagents, and higher-level runtime behavior.

If you need lower-level conversation infrastructure such as event transport, replay, or durable transcripts, use the companion package `@lleverage-ai/agent-threads` as well. You do not need `@lleverage-ai/agent-threads` for basic agent usage.

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

## When To Use This Package

Use `@lleverage-ai/agent-sdk` when you want to:

- build and run agents
- give agents tools, plugins, hooks, and skills
- stream model output or serve chat/API responses
- add subagents, teams, middleware, observability, and security controls

Add `@lleverage-ai/agent-threads` when you also need:

- durable thread history and transcript storage
- event replay
- WebSocket transport primitives
- explicit run lifecycle orchestration outside the core agent runtime

## Tool Naming

- Inline plugin tools use `<plugin>__<tool>`
- External MCP tools use `mcp__<server>__<tool>`

This keeps inline plugin tools distinct from real MCP-backed tools while preserving stable names for discovery and proxy calls.

## Documentation

- Getting started: https://github.com/lleverage-ai/agent-sdk#readme
- Companion infrastructure package: https://github.com/lleverage-ai/agent-sdk/tree/main/packages/agent-threads
- Tool loading: https://github.com/lleverage-ai/agent-sdk/blob/main/docs/tool-loading.md
- MCP integration: https://github.com/lleverage-ai/agent-sdk/blob/main/docs/mcp.md
- Agent sessions: https://github.com/lleverage-ai/agent-sdk/blob/main/docs/agent-session.md
- Contributing: https://github.com/lleverage-ai/agent-sdk/blob/main/CONTRIBUTING.md

## License

MIT
