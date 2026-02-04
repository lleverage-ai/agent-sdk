# @lleverage-ai/agent-sdk

A TypeScript framework for building AI agents using the Vercel AI SDK v6.

## Installation

```bash
bun add @lleverage-ai/agent-sdk ai zod
```

You'll also need at least one AI provider:

```bash
bun add @ai-sdk/anthropic  # or @ai-sdk/openai
```

## Quick Start

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";
import { tool } from "ai";
import { z } from "zod";

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  systemPrompt: "You are a friendly assistant.",
  tools: {
    greet: tool({
      description: "Greet a person by name",
      inputSchema: z.object({
        name: z.string().describe("The name of the person to greet"),
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

## Core Concepts

### Agents

Agents combine a language model with tools, plugins, and hooks. Core tools for filesystem operations and task tracking are automatically included.

```typescript
const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  systemPrompt: "You are a helpful assistant.",
  maxSteps: 10,
  tools: { /* custom tools */ },
  plugins: [ /* plugins */ ],
});

// Disable specific core tools if needed
const safeAgent = createAgent({
  model,
  disabledCoreTools: ["bash", "write"],
});
```

**Core tools included:** `read`, `write`, `edit`, `glob`, `grep`, `todo_write`, `bash` (requires backend with `enableBash: true`), `search_tools` (when enabled)

### Tools

Tools use the AI SDK's `tool()` function with `inputSchema`:

```typescript
import { tool } from "ai";
import { z } from "zod";

const calculator = tool({
  description: "Perform basic math operations",
  inputSchema: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number(),
  }),
  execute: async ({ operation, a, b }) => {
    switch (operation) {
      case "add": return a + b;
      case "subtract": return a - b;
      case "multiply": return a * b;
      case "divide": return a / b;
    }
  },
});

const agent = createAgent({
  model,
  tools: { calculator },
});
```

### Plugins

Plugins bundle tools, skills, and hooks. Plugin tools are exposed with MCP naming: `mcp__<plugin>__<tool>`.

```typescript
import { definePlugin } from "@lleverage-ai/agent-sdk";

const myPlugin = definePlugin({
  name: "my-plugin",
  description: "A collection of useful tools",
  tools: {
    myTool: tool({
      description: "Does something useful",
      inputSchema: z.object({ input: z.string() }),
      execute: async ({ input }) => `Result: ${input}`,
    }),
  },
});

const agent = createAgent({
  model,
  plugins: [myPlugin],
});
// Plugin tool available as: mcp__my-plugin__myTool
```

### Skills

Skills provide contextual instructions that guide agent behavior. They can bundle tool guidance, provide instructions-only, or enable progressive disclosure of tools.

```typescript
import { defineSkill } from "@lleverage-ai/agent-sdk";

const dataPlugin = definePlugin({
  name: "data-explorer",
  tools: { getSchema, queryData, createChart },
  skills: [
    defineSkill({
      name: "data-exploration",
      description: "Query and visualize data",
      prompt: `You have access to data exploration tools.
Available tables: products, users, sales.
Always use getSchema first to see column types.`,
    }),
  ],
});
```

### Hooks

Hooks allow you to observe and react to agent lifecycle events:

```typescript
const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [async ({ options }) => {
      console.log("Starting generation...");
      return {};
    }],
    PostToolUse: [{
      hooks: [async ({ tool_name, tool_response }) => {
        console.log("Tool completed:", tool_name);
        return {};
      }],
    }],
  },
});
```

**Available hooks:**
- `PreGenerate`, `PostGenerate`, `PostGenerateFailure` — Generation lifecycle
- `PreToolUse`, `PostToolUse`, `PostToolUseFailure` — Tool execution lifecycle
- `MCPConnectionFailed`, `MCPConnectionRestored` — MCP server connection lifecycle

**Hook utilities:** `createRetryHooks`, `createRateLimitHooks`, `createLoggingHooks`, `createGuardrailsHooks`, `createSecretsFilterHooks`

### Streaming

Agents support streaming responses for real-time output:

```typescript
for await (const part of agent.stream({ prompt: "Tell me a story" })) {
  if (part.type === "text-delta") {
    process.stdout.write(part.text);
  }
}

// Next.js API route
export async function POST(req: Request) {
  const { messages } = await req.json();
  return agent.streamResponse({ messages });
}
```

## Documentation

- [Tool Loading Strategies](./docs/tool-loading.md) — Eager, lazy, and dynamic tool loading
- [Security & Production](./docs/security.md) — Security policies, guardrails, and secrets filtering
- [Subagents](./docs/subagents.md) — Task delegation and background tasks
- [MCP Integration](./docs/mcp.md) — Model Context Protocol tools and servers
- [Backends](./docs/backends.md) — Filesystem and execution backends
- [Middleware](./docs/middleware.md) — Logging, caching, retry, and guardrails
- [Observability](./docs/observability.md) — Logging, metrics, and tracing
- [Persistence](./docs/persistence.md) — Memory and checkpointing
- [Context Compaction](./docs/context-compaction.md) — Automatic context management
- [Error Handling](./docs/errors.md) — Typed errors and recovery
- [API Reference](./docs/api-reference.md) — Complete API documentation

## License

MIT
