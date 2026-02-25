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

**Core tools included:** `read`, `write`, `edit`, `glob`, `grep`, `todo_write`, `bash` (requires backend with `enableBash: true`), `skill` (when skills are configured), `search_tools` (when enabled), `call_tool` (proxy mode only)

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

Skills provide contextual instructions that guide agent behavior following the [Agent Skills specification](https://agentskills.io/specification). They support both programmatic (TypeScript) and file-based (SKILL.md) formats.

**Programmatic skills:**
```typescript
import { defineSkill } from "@lleverage-ai/agent-sdk";

const dataPlugin = definePlugin({
  name: "data-explorer",
  tools: { getSchema, queryData, createChart },
  skills: [
    defineSkill({
      name: "data-exploration",
      description: "Query and visualize data",
      instructions: `You have access to data exploration tools.
Available tables: products, users, sales.
Always use getSchema first to see column types.`,
    }),
  ],
});
```

**File-based skills:**
```typescript
import { loadSkillsFromDirectories } from "@lleverage-ai/agent-sdk";

// Load skills from SKILL.md files
const { skills } = await loadSkillsFromDirectories(["/path/to/skills"]);

// Agent auto-creates registry and skill tool
const agent = createAgent({ model, skills });
```

See [Skills Documentation](./docs/skills.md) for complete details on the skills system and Agent Skills spec compliance.

### Prompt Builder

Create dynamic, context-aware system prompts from composable components. Instead of static strings, prompts automatically include tools, skills, backend capabilities, and more.

The default prompt builder is cache-friendly: it avoids per-turn dynamic context sections by default so repeated generations in the same thread can reuse provider prompt caches more effectively.

**Using the default builder:**
```typescript
const agent = createAgent({
  model,
  // No systemPrompt = uses default prompt builder
  tools: { read, write, bash },
});
// Automatically generates:
// "You are a helpful AI assistant.
//
// # Available Tools
// - **read**: Read files
// - **write**: Write files
// - **bash**: Execute commands
//
// # Capabilities
// - Execute shell commands (bash)
// - Read and write files to the filesystem"
```

**Customizing the prompt:**
```typescript
import { createDefaultPromptBuilder } from "@lleverage-ai/agent-sdk";

const builder = createDefaultPromptBuilder()
  .register({
    name: "project-context",
    priority: 95,
    render: () => "You are working on a TypeScript project.",
  });

const agent = createAgent({
  model,
  promptBuilder: builder,
  tools,
});
```

**Static prompts still work:**
```typescript
const agent = createAgent({
  model,
  systemPrompt: "You are a helpful assistant.",
  tools,
});
```

See [Prompt Builder Documentation](./docs/prompt-builder.md) for complete details on dynamic prompts, components, and customization.

### Hooks

Hooks allow you to observe and react to agent lifecycle events:

```typescript
import { createAgent, createToolHook } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  hooks: {
    // Simple observation hook (void return is fine)
    PreGenerate: [async ({ options }) => {
      console.log("Starting generation...");
    }],

    // Use createToolHook helper for tool-specific hooks
    PostToolUse: [
      createToolHook(async ({ tool_name, tool_response }) => {
        console.log("Tool completed:", tool_name);
      }, { matcher: "search_*" }), // Only match tools starting with "search_"
    ],
  },
});
```

**Available hooks:**
- `PreGenerate`, `PostGenerate`, `PostGenerateFailure` — Generation lifecycle
- `PreToolUse`, `PostToolUse`, `PostToolUseFailure` — Tool execution lifecycle
- `MCPConnectionFailed`, `MCPConnectionRestored` — MCP server connection lifecycle
- `Custom` — Plugin-defined custom events (see below)

**Hook utilities:** `createRetryHooks`, `createRateLimitHooks`, `createLoggingHooks`, `createGuardrailsHooks`, `createSecretsFilterHooks`, `createToolHook`

**Plugin hooks:** Plugins can define hooks in their configuration, which are automatically merged into the agent's hook registration:

```typescript
const myPlugin = definePlugin({
  name: "my-plugin",
  tools: { /* ... */ },
  hooks: {
    PostToolUse: [async ({ tool_name }) => {
      console.log("Tool used:", tool_name);
    }],
  },
});
```

**Custom hooks:** Plugins can define their own lifecycle events via `Custom` hooks and `invokeCustomHook()`:

```typescript
import { invokeCustomHook, TEAM_HOOKS } from "@lleverage-ai/agent-sdk";

// Subscribe to custom events
const agent = createAgent({
  model,
  hooks: {
    Custom: {
      [TEAM_HOOKS.TeammateSpawned]: [async (input) => {
        console.log("Teammate spawned:", input.payload);
      }],
    },
  },
});
```

### Background Tasks

Background tasks (bash commands and subagents) are automatically handled. When `generate()`, `stream()`, `streamResponse()`, or `streamDataResponse()` spawns a background task, the agent waits for completion and triggers follow-up generations to process results.

```typescript
const agent = createAgent({
  model,
  subagents: [researcherSubagent],

  // These are the defaults:
  waitForBackgroundTasks: true,

  // Customize follow-up prompt formatting
  formatTaskCompletion: (task) => `Task ${task.id} done: ${task.result}`,
  formatTaskFailure: (task) => `Task ${task.id} failed: ${task.error}`,
});

// generate() returns only after all background tasks are processed
const result = await agent.generate({ prompt: "Research this in the background" });
```

### Agent Teams

Multi-agent coordination where the primary agent becomes a team lead:

```typescript
import {
  createAgent,
  createAgentTeamsPlugin,
  InMemoryTeamCoordinator,
} from "@lleverage-ai/agent-sdk";

const teamsPlugin = createAgentTeamsPlugin({
  teammates: [
    {
      id: "researcher",
      name: "Researcher",
      description: "Researches topics",
      create: ({ model }) => createAgent({ model, systemPrompt: "You research topics." }),
    },
  ],
  coordinator: new InMemoryTeamCoordinator(),
});

const agent = createAgent({
  model,
  plugins: [teamsPlugin],
});
```

The agent gets a `start_team` tool. When called, it gains team management tools (`team_spawn`, `team_message`, `team_task_create`, etc.) at runtime. Teammates run in background sessions and communicate via mailboxes.

See [Subagents & Teams](./docs/subagents.md) for full details.

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

- [Prompt Builder](./docs/prompt-builder.md) — Dynamic, context-aware system prompts
- [Skills System](./docs/skills.md) — Progressive disclosure with Agent Skills spec compliance
- [Tool Loading Strategies](./docs/tool-loading.md) — Eager, deferred discovery, and proxy tool loading
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
