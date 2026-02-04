# @lleverage-ai/agent-sdk

A TypeScript framework for building AI agents using the Vercel AI SDK v6.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [Agents](#agents)
  - [Tools](#tools)
  - [Plugins](#plugins)
  - [Skills](#skills)
  - [Hooks](#hooks)
- [Tool Loading Strategies](#tool-loading-strategies)
- [Subagents](#subagents)
- [Streaming](#streaming)
- [MCP Integration](#mcp-integration)
- [Backends](#backends)
- [Middleware](#middleware)
- [Observability](#observability)
- [Memory](#memory)
- [Checkpointing](#checkpointing)
- [Context Compaction](#context-compaction)
- [Error Handling](#error-handling)
- [API Reference](#api-reference)

## Installation

```bash
bun add @lleverage-ai/agent-sdk ai zod
```

You'll also need at least one AI provider:

```bash
bun add @ai-sdk/anthropic  # or @ai-sdk/openai
```

**React Integration:** If you're building React applications, install the React companion package for UI helpers:

```bash
bun add @lleverage-ai/agent-sdk-react react
```

See the [@lleverage-ai/agent-sdk-react README](../agent-sdk-react/README.md) for documentation on `useApprovalFlow` hook and `ApprovalDialog` component.

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
  tools: {
    /* custom tools */
  },
  plugins: [
    /* plugins */
  ],
});

// Disable specific core tools if needed:
const safeAgent = createAgent({
  model,
  disabledCoreTools: ["bash", "write"], // No shell or write access
});
```

**Core tools included:** `read`, `write`, `edit`, `glob`, `grep`, `todo_write`, `bash` (requires sandbox), `search_tools` (when enabled)

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
      case "add":
        return a + b;
      case "subtract":
        return a - b;
      case "multiply":
        return a * b;
      case "divide":
        return a / b;
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
  skills: [
    /* skills */
  ],
  hooks: [
    /* hooks */
  ],
  setup: async (agent) => {
    // Initialization logic
  },
});

const agent = createAgent({
  model,
  plugins: [myPlugin],
});

// Plugin tool available as: mcp__my-plugin__myTool
```

### Skills

Skills provide contextual instructions that guide how the agent behaves. They can be used in several ways:

**Tool guidance** - Bundle a skill with plugin tools to explain how to use them:

```typescript
const dataPlugin = definePlugin({
  name: "data-explorer",
  description: "Data exploration tools",
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

**Instructions only** - A plugin with just a skill loads dynamic instructions (no tools):

```typescript
const codingGuidelinesPlugin = definePlugin({
  name: "coding-guidelines",
  description: "Project coding standards",
  skills: [
    defineSkill({
      name: "guidelines",
      description: "Coding standards for this project",
      prompt: `Follow these coding standards:
- Use TypeScript strict mode
- Prefer named exports
- Write TSDoc for public APIs`,
    }),
  ],
});
```

**Progressive disclosure** - Skills with tools are loaded on-demand via the `skill` tool:

```typescript
const analyzeSkill = defineSkill({
  name: "analyze",
  description: "Deep code analysis",
  prompt: "Perform detailed code analysis.",
  tools: {
    lint: tool({
      /* ... */
    }),
    typeCheck: tool({
      /* ... */
    }),
  },
});
```

### Unified Hooks

Unified hooks allow you to observe and react to agent lifecycle events with a clean, typed API:

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [
      async ({ options }) => {
        console.log("Starting generation...");
        return {};
      },
    ],
    PostGenerate: [
      async ({ result }) => {
        console.log("Generated:", result.text);
        return {};
      },
    ],
    PreToolUse: [
      {
        hooks: [
          async ({ tool_name, tool_input }) => {
            console.log("Tool starting:", tool_name, tool_input);
            return {};
          },
        ],
      },
    ],
    PostToolUse: [
      {
        hooks: [
          async ({ tool_name, tool_response }) => {
            console.log("Tool completed:", tool_name, tool_response);
            return {};
          },
        ],
      },
    ],
    PostToolUseFailure: [
      {
        hooks: [
          async ({ tool_name, error }) => {
            console.warn("Tool failed:", tool_name, error);
            return {};
          },
        ],
      },
    ],
  },
});
```

**Available hooks:**

- `PreGenerate`, `PostGenerate`, `PostGenerateFailure` - Generation lifecycle
- `PreToolUse`, `PostToolUse`, `PostToolUseFailure` - Tool execution lifecycle
- `MCPConnectionFailed`, `MCPConnectionRestored` - MCP server connection lifecycle

**Hook utilities:**

- `createCacheHooks` - Response caching
- `createRetryHooks` - Automatic retries with backoff
- `createRateLimitHooks` - Rate limiting
- `createLoggingHooks` - Structured logging
- `createGuardrailsHooks` - Content guardrails
- `createSecretsFilterHooks` - Secrets redaction

**MCP Connection Monitoring:**

Monitor MCP server connectivity to handle failures and restorations:

```typescript
const agent = createAgent({
  model,
  plugins: [githubPlugin],
  hooks: {
    MCPConnectionFailed: [
      async ({ server_name, config, error, session_id }) => {
        console.error(`MCP server ${server_name} failed:`, error.message);
        // Send alert, log to monitoring system, etc.
      },
    ],
    MCPConnectionRestored: [
      async ({ server_name, tool_count, session_id }) => {
        console.log(
          `MCP server ${server_name} restored with ${tool_count} tools`,
        );
        // Clear alerts, update status, etc.
      },
    ],
  },
});
```

These hooks enable:

- **Observability**: Track MCP server health in logs and metrics
- **Alerting**: Send notifications when servers fail or recover
- **Graceful degradation**: Disable features that depend on unavailable servers
- **Debugging**: Understand connectivity issues in production

**Retry with Automatic Backoff:**

Handle transient failures with automatic retry logic:

```typescript
import { createRetryHooks } from "@lleverage-ai/agent-sdk/hooks";

const agent = createAgent({
  model,
  hooks: {
    PostGenerateFailure: [
      createRetryHooks({
        maxRetries: 3,
        baseDelay: 1000, // 1 second
        backoffMultiplier: 2, // Exponential: 1s, 2s, 4s
        jitter: true, // Add randomness to prevent thundering herd
      }),
    ],
  },
});
```

The retry hook automatically handles:

- **Rate limiting**: Retries 429 errors with exponential backoff
- **Server errors**: Retries 5xx errors (500, 502, 503, 504)
- **Network failures**: Retries ECONNRESET, ECONNREFUSED, ETIMEDOUT
- **Timeout errors**: Retries timeout failures

**Retry statistics tracking:**

```typescript
import { createManagedRetryHooks } from "@lleverage-ai/agent-sdk/hooks";

const { hook, getStats } = createManagedRetryHooks({ maxRetries: 5 });

const agent = createAgent({
  model,
  hooks: {
    PostGenerateFailure: [hook],
  },
});

// After some operations
const stats = getStats();
console.log(`Retry rate: ${stats.retries / stats.failures}`);
```

**Custom retry logic:**

```typescript
const retryHook = createRetryHooks({
  shouldRetry: (error, attempt) => {
    // Only retry rate limits on the first 2 attempts
    return error.message.includes("rate limit") && attempt < 2;
  },
  baseDelay: 2000, // 2 seconds
});
```

**Note:** Retry hooks work consistently across all agent methods (`generate()`, `stream()`, `streamResponse()`, `streamRaw()`, `streamDataResponse()`).

## Tool Loading Strategies

The SDK provides multiple mechanisms for loading tools, each optimized for different scenarios:

- **Eager Loading** (default): Load all tools upfront - best for small tool sets (< 20 tools)
- **Lazy Loading** (`use_tools`): Load tools on-demand via a registry - best for 20-100+ tools
- **Dynamic Discovery** (`search_tools`): Search and load MCP tools dynamically - best for 100+ tools
- **MCP Loading**: Connect to external MCP servers for standardized tool ecosystems

### When to Use Each Approach

**Use Eager Loading when:**

- Small tool set (< 20 tools) that's always needed
- Simplest setup with best performance
- All tools are core to the agent's purpose

**Use Lazy Loading when:**

- Large tool set (20-100+ tools)
- Agent only needs a subset per conversation
- Plugin architecture with domain-specific tools
- Want to minimize context window usage

**Use Dynamic Discovery when:**

- Very large tool set (100+ tools)
- Tool needs are unpredictable
- Using MCP ecosystem with many servers
- Want agent to explore capabilities dynamically

**Use MCP Loading when:**

- Integrating external tool ecosystems (filesystem, databases, APIs)
- Need standardized tool protocols
- Building on existing MCP infrastructure

### Quick Examples

```typescript
// Eager loading (default)
const agent = createAgent({
  model,
  tools: { calculator, weather, database }, // All loaded immediately
});

// Lazy loading with use_tools
const registry = new ToolRegistry();
registry.registerPlugin("stripe", stripePlugin.tools);
registry.registerPlugin("github", githubPlugin.tools);

const agent = createAgent({
  model,
  tools: {
    use_tools: createUseToolsTool({ registry }),
  },
  pluginLoading: "lazy",
});
// Agent loads tools on demand: use_tools({ plugin: "stripe" })
// (Tools also become active after agent.loadTools([...]) in lazy mode)

// Dynamic discovery with search_tools
const mcpManager = new MCPManager();
await mcpManager.connectServer({ name: "filesystem", command: "npx", args: [...] });

const agent = createAgent({
  model,
  mcpManager,
  mcpEagerLoad: false,
  tools: {
    search_tools: createSearchToolsTool({ manager: mcpManager, enableLoad: true }),
  },
});
// Agent discovers tools: search_tools({ query: "list files", load: true })
```

For a comprehensive guide with decision trees, common patterns, and best practices, see the **[Tool Loading Guide](../../docs/TOOL_LOADING_GUIDE.md)**.

## Production Security

⚠️ **Warning**: Default agent settings are permissive to enable rapid development. For production deployments, you should explicitly apply security policies to prevent unauthorized operations.

### Quick Production Setup

The easiest way to create a production-ready agent is using `createProductionAgent()`, which combines security, observability, and recommended hooks in a single function:

```typescript
import { createProductionAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";

// One-line production agent setup
const { agent, observability } = createProductionAgent({
  model: anthropic("claude-sonnet-4-20250514"),
});

// Access observability primitives
observability.logger?.info("Agent started");
observability.metrics?.requests.inc();
```

This function automatically configures:

- **Security**: Production security preset (sandbox, permissions, tool restrictions)
- **Observability**: Logging, metrics, and tracing with hooks
- **Secrets filtering**: Prevents credential leakage in logs and responses
- **Optional guardrails**: Content filtering for input/output validation

**Customization example:**

```typescript
const { agent, observability } = createProductionAgent({
  model: anthropic("claude-sonnet-4-20250514"),

  // Customize security
  securityPreset: "readonly", // Maximum restrictions
  securityOverrides: {
    permissionMode: "approval-required",
  },

  // Customize observability
  observabilityOptions: {
    name: "my-agent",
    loggerOptions: { level: "warn" },
    enableTracing: false,
  },

  // Enable guardrails
  enableGuardrails: true,
  blockedInputPatterns: [/ignore.*instructions/i],
  blockedOutputPatterns: [/\d{3}-\d{2}-\d{4}/], // SSN pattern

  // Add custom options
  additionalOptions: {
    systemPrompt: "You are a helpful assistant.",
    checkpointer: createMemorySaver(),
  },
});
```

For more granular control, you can configure security and observability components individually using the following options.

### Security Policy Presets

The SDK provides four security policy presets that bundle sandbox configuration, permission modes, and tool restrictions:

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";
import { applySecurityPolicy } from "@lleverage-ai/agent-sdk/security";

// Production preset: balanced security for production deployments
const agent = createAgent({
  model,
  ...applySecurityPolicy("production"),
});
```

**Available presets:**

- `"development"` - Permissive settings for rapid iteration (allows all operations)
- `"ci"` - Restrictive settings for CI/CD (blocks network operations, plan mode only)
- `"production"` - Balanced settings for production (blocks destructive operations, limited timeouts)
- `"readonly"` - Maximum restrictions (no writes, no commands, read-only access)

### Guardrails Hooks

Protect against harmful input and filter sensitive output:

```typescript
import { createGuardrailsHooks } from "@lleverage-ai/agent-sdk/hooks";

const agent = createAgent({
  model,
  hooks: createGuardrailsHooks({
    blockedInputPatterns: [
      /ignore\s+previous\s+instructions/i, // Prompt injection
      /system\s+prompt/i, // System prompt extraction
    ],
    blockedOutputPatterns: [
      /\d{3}-\d{2}-\d{4}/g, // SSN
      /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/g, // Credit card
    ],
    blockedInputMessage: "Request blocked by content policy",
    filteredOutputMessage: "[Content filtered]",
  }),
});
```

### Secrets Filtering

Prevent credential leakage in logs and responses:

```typescript
import {
  createSecretsFilterHooks,
  COMMON_SECRET_PATTERNS,
} from "@lleverage-ai/agent-sdk/hooks";

const agent = createAgent({
  model,
  hooks: createSecretsFilterHooks({
    patterns: Object.values(COMMON_SECRET_PATTERNS),
    customPatterns: [/my-api-key-[A-Za-z0-9]+/g],
    redactionText: "[REDACTED]",
    onSecretDetected: (type, pattern, context) => {
      console.warn(`Secret detected in ${type}:`, pattern);
    },
  }),
});
```

**Built-in secret patterns:**

- AWS access keys and secrets
- GitHub tokens (personal access, OAuth)
- JWT tokens
- Private keys (PEM format)
- Slack, Stripe, and other common API keys
- Password and secret variables

### Tool Restrictions

Disable dangerous tools in production:

```typescript
const agent = createAgent({
  model,
  // Explicitly disable core tools that allow code execution or file writes
  disabledCoreTools: ["bash", "write", "edit"],

  // Or use allowlist approach
  allowedTools: ["read", "glob", "grep", "search_tools"],
});
```

### Permission Mode: acceptEdits with Bash Safety

The `acceptEdits` permission mode auto-approves `write` and `edit` tool calls, but **shell commands can still perform file writes** (e.g., `echo > file`, `rm`, `mv`), creating a security gap.

To close this gap, use `applySecurityPolicy()` with `acceptEdits` mode - it automatically configures the sandbox to block shell-based file operations:

```typescript
import { applySecurityPolicy } from "@lleverage-ai/agent-sdk/security";

// acceptEdits mode with shell file operation blocking (default behavior)
const agent = createAgent({
  model,
  ...applySecurityPolicy("development", {
    permissionMode: "acceptEdits",
    // blockShellFileOps: true is the default
  }),
});
```

**What gets blocked in acceptEdits mode:**

- Output redirection: `echo 'text' > file.txt`, `cat input >> output`
- File deletion/movement: `rm file.txt`, `mv old new`
- File creation: `touch file`, `cp source dest`, `mkdir dir`
- Permission changes: `chmod`, `chown`
- Package managers: `npm install`, `yarn add`, `pip install`

**What remains allowed:**

- Read operations: `ls`, `cat`, `grep`, `find`, `head`, `tail`
- The `write` and `edit` tools (approved by acceptEdits mode)

**Manual configuration:**

```typescript
import { getSandboxOptionsForAcceptEdits } from "@lleverage-ai/agent-sdk/security";
import { LocalSandbox } from "@lleverage-ai/agent-sdk/backends";

const agent = createAgent({
  model,
  backend: new LocalSandbox(getSandboxOptionsForAcceptEdits()),
  permissionMode: "acceptEdits",
});
```

**Disable blocking (not recommended for production):**

```typescript
const agent = createAgent({
  model,
  ...applySecurityPolicy("development", {
    permissionMode: "acceptEdits",
    blockShellFileOps: false, // Allow bash file operations
  }),
});
```

### Complete Production Example

Combining security policies, guardrails, and secrets filtering:

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";
import { applySecurityPolicy } from "@lleverage-ai/agent-sdk/security";
import {
  createGuardrailsHooks,
  createSecretsFilterHooks,
  COMMON_SECRET_PATTERNS,
} from "@lleverage-ai/agent-sdk/hooks";

const agent = createAgent({
  model,

  // Apply production security preset
  ...applySecurityPolicy("production"),

  // Add guardrails and secrets filtering
  hooks: {
    ...createGuardrailsHooks({
      blockedInputPatterns: [/ignore\s+previous\s+instructions/i],
      blockedOutputPatterns: [/\d{3}-\d{2}-\d{4}/g],
    }),
    ...createSecretsFilterHooks({
      patterns: Object.values(COMMON_SECRET_PATTERNS),
    }),
  },

  // Additional tool restrictions
  disabledCoreTools: ["bash"],
});
```

## Subagents

Subagents enable task delegation to specialized agents. Define subagents with their own system prompts and tools:

```typescript
import { createSubagent } from "@lleverage-ai/agent-sdk";

const researcherSubagent = createSubagent({
  id: "researcher",
  name: "Researcher",
  description: "Researches topics and gathers information",
  systemPrompt:
    "You are a research specialist. Gather comprehensive information.",
  plugins: [webSearchPlugin],
});

const writerSubagent = createSubagent({
  id: "writer",
  name: "Writer",
  description: "Writes content based on research",
  systemPrompt: "You are a content writer. Create clear, engaging content.",
});

// Provide subagents to the parent agent
const agent = createAgent({
  model,
  systemPrompt: "Coordinate research and writing tasks.",
  subagents: [researcherSubagent, writerSubagent],
});
```

The parent agent receives a `task` tool to delegate work:

```typescript
// Agent can call: task({ subagent: "researcher", prompt: "Research AI trends" })
```

### Advanced Subagent Execution

For programmatic control over subagent execution:

```typescript
import {
  createSubagentContext,
  executeSubagent,
  executeSubagentsParallel,
} from "@lleverage-ai/agent-sdk";

// Create isolated context for subagent
const context = createSubagentContext({
  parentMessages: messages,
  subagentSystemPrompt: "You are a specialist.",
});

// Execute single subagent
const result = await executeSubagent({
  subagent: researcherSubagent,
  model,
  context,
  prompt: "Research this topic",
});

// Execute multiple subagents in parallel
const results = await executeSubagentsParallel({
  subagents: [researcherSubagent, analyzerSubagent],
  model,
  contexts: [context1, context2],
  prompts: ["Research...", "Analyze..."],
});
```

### Background Tasks and Recovery

Background tasks allow subagents to run asynchronously without blocking the parent agent. When persistence is configured, tasks survive process restarts and can be recovered.

#### Task Store Configuration

```typescript
import { FileTaskStore } from "@lleverage-ai/agent-sdk/task-store";

// Configure persistent task storage
const taskStore = new FileTaskStore({
  directory: "./task-data",
  expirationMs: 86400000, // 24 hours
});

// Create agent with task store
const agent = createAgent({
  model,
  subagents: [researcherSubagent],
  taskStore, // Tasks now persist across restarts
});
```

#### Task Lifecycle

Background tasks progress through these states:

1. **pending**: Task created, not yet started
2. **running**: Task is currently executing
3. **completed**: Task finished successfully
4. **failed**: Task encountered an error

```typescript
import {
  listBackgroundTasks,
  getBackgroundTask,
  clearCompletedTasks,
} from "@lleverage-ai/agent-sdk";

// List all running tasks
const runningTasks = await listBackgroundTasks({ status: "running" });

// Get a specific task
const task = await getBackgroundTask("task-123");
console.log(task.status, task.result, task.error);

// Clean up old completed tasks
const cleaned = await clearCompletedTasks();
```

#### Recovery Patterns

The SDK provides utilities for automatic task recovery on agent restart:

**1. Recover Interrupted Tasks**

When your agent restarts, running tasks are interrupted. Mark them as failed:

```typescript
import { recoverRunningTasks } from "@lleverage-ai/agent-sdk";

// On agent startup
const recovered = await recoverRunningTasks(taskStore);
console.log(`Recovered ${recovered} interrupted tasks`);
```

**2. Recover Failed Tasks for Retry**

Load failed tasks and retry those with transient errors:

```typescript
import {
  recoverFailedTasks,
  updateBackgroundTask,
} from "@lleverage-ai/agent-sdk";

// Load failed tasks
const failedTasks = await recoverFailedTasks(taskStore, {
  errorPattern: /timeout|network|ECONNREFUSED/,
  minCreatedAt: new Date(Date.now() - 86400000), // Last 24 hours
});

// Retry transient failures
for (const task of failedTasks) {
  const retryTask = updateBackgroundTask(task, {
    status: "pending",
    error: undefined,
  });
  await taskStore.save(retryTask);
  // Process retryTask through your task execution logic
}
```

**3. Clean Up Stale Tasks**

Prevent unbounded storage growth by removing old tasks:

```typescript
import { cleanupStaleTasks } from "@lleverage-ai/agent-sdk";

// Clean up tasks older than 7 days
const sevenDays = 7 * 24 * 60 * 60 * 1000;
const cleaned = await cleanupStaleTasks(taskStore, sevenDays);
console.log(`Cleaned up ${cleaned} stale tasks`);

// Schedule periodic cleanup
setInterval(async () => {
  await cleanupStaleTasks(taskStore, sevenDays);
}, 86400000); // Once per day
```

**Complete Recovery Pattern**

Combine all recovery utilities on agent startup:

```typescript
async function initializeAgent() {
  const taskStore = new FileTaskStore({ directory: "./task-data" });

  // 1. Recover interrupted tasks
  await recoverRunningTasks(taskStore);

  // 2. Retry failed tasks with transient errors
  const failedTasks = await recoverFailedTasks(taskStore, {
    errorPattern: /timeout|network/,
  });
  for (const task of failedTasks) {
    const retryTask = updateBackgroundTask(task, {
      status: "pending",
      error: undefined,
    });
    await taskStore.save(retryTask);
  }

  // 3. Clean up old tasks
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  await cleanupStaleTasks(taskStore, sevenDays);

  // 4. Create agent
  return createAgent({
    model,
    subagents: [researcherSubagent],
    taskStore,
  });
}
```

## Streaming

Agents support streaming responses for real-time output:

```typescript
// AsyncIterator-based streaming
for await (const part of agent.stream({ prompt: "Tell me a story" })) {
  if (part.type === "text-delta") {
    process.stdout.write(part.text);
  } else if (part.type === "tool-call") {
    console.log("Calling tool:", part.toolName);
  } else if (part.type === "finish") {
    console.log("\nDone:", part.finishReason);
  }
}

// Next.js API route with useChat compatibility
export async function POST(req: Request) {
  const { messages } = await req.json();
  return agent.streamResponse({ messages });
}

// Raw AI SDK streamText result
const stream = await agent.streamRaw({ messages });
```

## MCP Integration

The SDK provides unified tool management through the Model Context Protocol (MCP).

### Plugin-based MCP Tools

Plugin tools are automatically registered as virtual MCP servers:

```typescript
const githubPlugin = definePlugin({
  name: "github",
  mcpServer: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" }, // Expands from process.env
  },
});
```

### Tool Search and Deferred Loading

When you have many plugin tools, enable tool search to reduce context size:

```typescript
const agent = createAgent({
  model,
  plugins: [plugin1, plugin2, plugin3],
  toolSearch: {
    enabled: "auto", // "auto" | "always" | "never"
    threshold: 20, // Defer when plugin tools > 20
    maxResults: 10, // Max search results
  },
});

// Agent gets a `search_tools` tool to discover and load tools on-demand
```

### MCP Tool Utilities

Helper functions for working with MCP tool names:

```typescript
import {
  mcpTools,
  mcpToolsFor,
  toolsFromPlugin,
} from "@lleverage-ai/agent-sdk";

// Get all MCP tool names from an agent
const allMcpTools = mcpTools(agent); // ["mcp__github__list_issues", ...]

// Get tools for a specific plugin
const githubTools = mcpToolsFor(agent, "github");

// Extract tools from a plugin definition
const tools = toolsFromPlugin(myPlugin);
```

### MCP Security Best Practices

When connecting to external MCP servers, apply security controls to protect against malicious or misconfigured tools:

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";

const githubPlugin = definePlugin({
  name: "github",
  mcpServer: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },

    // Security: Only allow specific tools from this server
    allowedTools: ["get_issue", "list_issues", "search_issues"],

    // Security: Validate tool inputs against their JSON Schema
    validateInputs: true,

    // Security: Reject tools without meaningful schemas
    requireSchema: true,
  },
});

const agent = createAgent({
  model,
  plugins: [githubPlugin],
});
```

#### Security Options

- **`allowedTools`**: Allowlist of permitted tool names (without `mcp__` prefix). Only tools in this list will be loaded. Useful for restricting access to dangerous operations.

- **`validateInputs`**: When `true`, tool inputs are validated against their declared JSON Schema before execution. Invalid inputs throw `MCPInputValidationError` instead of being passed to the server. Protects against malformed or malicious inputs.

- **`requireSchema`**: When `true`, tools without meaningful schemas (empty or minimal schemas) are rejected during connection. Ensures all tools have explicit input validation.

#### Example: Secure Production MCP Configuration

```typescript
// Production configuration with all security controls
const docsPlugin = definePlugin({
  name: "docs",
  mcpServer: {
    type: "http",
    url: "https://docs-server.internal/mcp",
    headers: { Authorization: "Bearer ${DOCS_API_TOKEN}" },

    // Only allow read-only operations
    allowedTools: ["search_docs", "get_document", "list_categories"],

    // Validate all inputs
    validateInputs: true,

    // Require schemas for all tools
    requireSchema: true,
  },
});
```

#### Handling Validation Errors

```typescript
import { MCPInputValidationError } from "@lleverage-ai/agent-sdk";

try {
  const result = await agent.generate({
    messages: [{ role: "user", content: "Search the docs" }],
  });
} catch (error) {
  if (error instanceof MCPInputValidationError) {
    console.error(`Invalid input for ${error.toolName}:`);
    console.error(error.errors.join("\n"));
    // Handle validation error (e.g., log, alert, retry with corrected input)
  }
}
```

## Backends

Backends provide filesystem and execution capabilities.

### FilesystemBackend

File operations with security protections:

```typescript
import {
  FilesystemBackend,
  createFilesystemBackend,
} from "@lleverage-ai/agent-sdk";

const backend = new FilesystemBackend({
  rootDir: "/project",
  allowedPaths: ["/project/src", "/project/tests"],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  followSymlinks: false,
});

// Or use factory
const backend = createFilesystemBackend({ rootDir: "/project" });
```

### StateBackend

In-memory filesystem for sandboxed operations:

```typescript
import { StateBackend, createAgentState } from "@lleverage-ai/agent-sdk";

const state = createAgentState();
const backend = new StateBackend(state);
```

### LocalSandbox

Command execution with security controls:

```typescript
import { LocalSandbox, createLocalSandbox } from "@lleverage-ai/agent-sdk";

const sandbox = new LocalSandbox({
  cwd: "/project",
  timeout: 30000,
  maxOutputSize: 1024 * 1024,
  blockedCommands: ["rm -rf /"],
});

// Read-only mode
const readOnlySandbox = LocalSandbox.readOnly({ cwd: "/project" });
```

## Middleware

Middleware intercepts and transforms agent operations.

### Logging Middleware

```typescript
import {
  createLoggingMiddleware,
  createTimingMiddleware,
} from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  middleware: [
    createLoggingMiddleware({ level: "debug" }),
    createTimingMiddleware(),
  ],
});
```

### Caching Middleware

```typescript
import {
  createCacheMiddleware,
  InMemoryCacheStore,
} from "@lleverage-ai/agent-sdk";

const cacheStore = new InMemoryCacheStore();

const agent = createAgent({
  model,
  middleware: [
    createCacheMiddleware({
      store: cacheStore,
      ttl: 60000, // 1 minute
    }),
  ],
});
```

### Retry Middleware

```typescript
import {
  createRetryMiddleware,
  createCircuitBreakerMiddleware,
} from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  middleware: [
    createRetryMiddleware({
      maxRetries: 3,
      backoff: "exponential",
    }),
    createCircuitBreakerMiddleware({
      threshold: 5,
      resetTimeout: 60000,
    }),
  ],
});
```

### Guardrails Middleware

```typescript
import {
  createGuardrailsMiddleware,
  createContentFilterMiddleware,
} from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  middleware: [
    createGuardrailsMiddleware({
      blockedPatterns: [/password/i, /api[_-]?key/i],
    }),
    createContentFilterMiddleware({
      maxLength: 10000,
    }),
  ],
});
```

### Composing Middleware

```typescript
import { composeMiddleware } from "@lleverage-ai/agent-sdk";

const combined = composeMiddleware([
  createLoggingMiddleware(),
  createRetryMiddleware({ maxRetries: 3 }),
  createCacheMiddleware({ store }),
]);
```

## Observability

Built-in logging, metrics, and tracing support.

### Logging

```typescript
import {
  createLogger,
  createConsoleTransport,
  createJsonFormatter,
} from "@lleverage-ai/agent-sdk";

const logger = createLogger({
  level: "info",
  transports: [
    createConsoleTransport({
      formatter: createJsonFormatter(),
    }),
  ],
});

logger.info("Agent started", { agentId: "123" });
```

### Metrics

```typescript
import {
  createMetricsRegistry,
  createAgentMetrics,
  createConsoleMetricsExporter,
} from "@lleverage-ai/agent-sdk";

const registry = createMetricsRegistry({
  exporters: [createConsoleMetricsExporter()],
});

const metrics = createAgentMetrics(registry);
metrics.requestsTotal.inc({ model: "claude-3" });
metrics.latencyHistogram.observe({ model: "claude-3" }, 1500);
```

### Tracing

```typescript
import {
  createTracer,
  createConsoleSpanExporter,
  SemanticAttributes,
} from "@lleverage-ai/agent-sdk";

const tracer = createTracer({
  serviceName: "my-agent",
  exporters: [createConsoleSpanExporter()],
});

const span = tracer.startSpan("agent.generate");
span.setAttribute(SemanticAttributes.MODEL_NAME, "claude-3");
// ... do work
span.end();
```

### Cross-Agent Tracing

When using subagents, you can propagate trace context to maintain distributed tracing across parent and child agents:

```typescript
import {
  createAgent,
  createTaskTool,
  createSubagent,
  createTracer,
  SemanticAttributes,
} from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";

const tracer = createTracer({
  name: "my-app",
  exporters: [createConsoleSpanExporter()],
});

// Create parent agent
const parentAgent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
});

// Start a parent span for the request
const parentSpan = tracer.startSpan("handle-user-request", {
  attributes: {
    [SemanticAttributes.AGENT_NAME]: "parent-agent",
  },
});

// Define subagent with tracing support
const researcherSubagent = {
  type: "researcher",
  description: "Researches information",
  create: (ctx) => {
    // Create child span linked to parent
    if (ctx.parentSpanContext) {
      const span = tracer.startSpan("subagent-research", {
        parent: ctx.parentSpanContext,
        attributes: {
          [SemanticAttributes.SUBAGENT_TYPE]: "researcher",
          [SemanticAttributes.SUBAGENT_ID]: "researcher-1",
        },
      });

      // Track the span for cleanup
      // In production, use a span manager or store spans in agent state
    }

    return createSubagent(parentAgent, {
      name: "researcher",
      systemPrompt: "You are a research assistant.",
    });
  },
};

// Create task tool with parent span context
const task = createTaskTool({
  subagents: [researcherSubagent],
  defaultModel: anthropic("claude-sonnet-4-20250514"),
  parentAgent,
  parentSpanContext: {
    traceId: parentSpan.traceId,
    spanId: parentSpan.spanId,
  },
});

// Use the agent with tracing
const result = await parentAgent.generate({
  prompt: "Research quantum computing",
  tools: { task },
});

// End the parent span
parentSpan.end();
await tracer.flush();
```

This creates a distributed trace where:

- Parent span: `handle-user-request`
- Child span: `subagent-research` (linked to parent)

Both spans share the same `traceId`, allowing you to:

- Track the full request flow across agents
- Measure latency at each level
- Correlate logs and errors across parent and child operations
- Visualize the call graph in tools like Jaeger or Zipkin

**Key points:**

- Pass `parentSpanContext` to `createTaskTool()` to enable trace propagation
- Access `ctx.parentSpanContext` in your subagent factory to create child spans
- Use `SemanticAttributes.SUBAGENT_*` constants for consistent span metadata
- Both parent and child spans will share the same `traceId` for correlation

### Observability Hooks

Automatically instrument agents with logging, metrics, and tracing:

```typescript
import {
  createObservabilityEventStore,
  createObservabilityEventHooks,
} from "@lleverage-ai/agent-sdk";

const store = createObservabilityEventStore();
const hooks = createObservabilityEventHooks(store);

const agent = createAgent({
  model,
  hooks: {
    MCPConnectionFailed: hooks.MCPConnectionFailed,
    MCPConnectionRestored: hooks.MCPConnectionRestored,
    ToolRegistered: hooks.ToolRegistered,
    ToolLoadError: hooks.ToolLoadError,
    PreCompact: hooks.PreCompact,
    PostCompact: hooks.PostCompact,
  },
});

const events = store.getAll();
```

## Memory

Persist agent memory across conversations.

### Filesystem Memory Store

```typescript
import {
  FilesystemMemoryStore,
  loadAgentMemory,
} from "@lleverage-ai/agent-sdk";

const store = new FilesystemMemoryStore({
  rootDir: ".agent/memory",
});

// Load all memory for an agent
const memory = await loadAgentMemory({
  store,
  agentId: "my-agent",
});
```

### In-Memory Store

```typescript
import { InMemoryMemoryStore } from "@lleverage-ai/agent-sdk";

const store = new InMemoryMemoryStore();

// Create memory document
await store.save({
  id: "note-1",
  content: "Important information...",
  metadata: {
    tags: ["important"],
    autoLoad: true,
  },
});
```

### Memory-Aware Middleware

```typescript
import { createAgentMemoryMiddleware } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  middleware: [
    createAgentMemoryMiddleware({
      store,
      autoLoad: true,
    }),
  ],
});
```

## Checkpointing

Save and restore agent state for resumable conversations.

### MemorySaver

In-memory checkpoint storage:

```typescript
import { createMemorySaver } from "@lleverage-ai/agent-sdk";

const checkpointer = createMemorySaver();

const agent = createAgent({
  model,
  checkpointer,
});

// Save checkpoint
await checkpointer.save({
  threadId: "conversation-1",
  messages,
  metadata: { userId: "123" },
});

// Load checkpoint
const checkpoint = await checkpointer.load("conversation-1");
```

### FileSaver

Persistent file-based checkpoints:

```typescript
import { createFileSaver } from "@lleverage-ai/agent-sdk";

const checkpointer = createFileSaver({
  directory: ".agent/checkpoints",
});
```

### KeyValueStoreSaver

Use any key-value store:

```typescript
import {
  createKeyValueStoreSaver,
  InMemoryStore,
} from "@lleverage-ai/agent-sdk";

const store = new InMemoryStore();
const checkpointer = createKeyValueStoreSaver({ store });
```

## Context Compaction

Automatically manage conversation context with intelligent compaction policies.

### Basic Context Management

```typescript
import { createAgent, createContextManager } from "@lleverage-ai/agent-sdk";

const contextManager = createContextManager({
  maxTokens: 100000, // Maximum context window
  policy: {
    enabled: true,
    tokenThreshold: 0.8, // Trigger at 80% capacity
    hardCapThreshold: 0.95, // Force compact at 95% (safety)
    enableGrowthRatePrediction: false, // Predict when next message will exceed
    enableErrorFallback: true, // Auto-compact on context length errors
  },
  summarization: {
    keepMessageCount: 10, // Always keep last 10 messages
    keepToolResultCount: 5, // Keep recent tool results
  },
});

const agent = createAgent({
  model,
  contextManager,
  checkpointer, // Required for error fallback
});
```

### Compaction Triggers

The SDK supports multiple compaction triggers:

1. **Token Threshold** (default: 80%): Triggers when usage exceeds the threshold
2. **Hard Cap** (default: 95%): Safety limit - forces compaction to prevent errors
3. **Growth Rate**: Predicts if the next message will exceed limits
4. **Error Fallback**: Emergency compaction when context length errors occur

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  policy: {
    enabled: true,
    tokenThreshold: 0.75, // Trigger at 75%
    hardCapThreshold: 0.9, // Force at 90%
    enableGrowthRatePrediction: true, // Enable predictive compaction
    enableErrorFallback: true, // Auto-recover from context errors
  },
});
```

### Custom Compaction Policy

Override the default policy logic with custom rules:

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  policy: {
    enabled: true,
    tokenThreshold: 0.8,
    hardCapThreshold: 0.95,
    enableGrowthRatePrediction: false,
    enableErrorFallback: true,
    // Custom compaction logic
    shouldCompact: (budget, messages) => {
      // Trigger if more than 50 messages
      if (messages.length > 50) {
        return { trigger: true, reason: "token_threshold" };
      }
      // Trigger if budget usage high
      if (budget.usage >= 0.85) {
        return { trigger: true, reason: "hard_cap" };
      }
      return { trigger: false };
    },
  },
});
```

### Observability Hooks

Monitor compaction events with PreCompact and PostCompact hooks:

```typescript
const agent = createAgent({
  model,
  contextManager,
  hooks: {
    PreCompact: [
      async (input) => {
        console.log(
          `Compacting ${input.message_count} messages (${input.tokens_before} tokens)`,
        );
        return {};
      },
    ],
    PostCompact: [
      async (input) => {
        console.log(
          `Compacted ${input.messages_before} → ${input.messages_after} messages`,
        );
        console.log(`Saved ${input.tokens_saved} tokens`);
        return {};
      },
    ],
  },
});
```

### Error-Triggered Fallback

When enabled, the SDK automatically attempts emergency compaction if a context length error occurs:

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  policy: {
    enableErrorFallback: true, // Enable auto-recovery
  },
});

const agent = createAgent({
  model,
  contextManager,
  checkpointer, // Required - stores compacted state
});

// If context error occurs, SDK will:
// 1. Detect context length error
// 2. Compact messages from checkpoint
// 3. Save compacted state
// 4. Retry the request
```

**Note**: Error fallback requires a checkpointer to store the compacted state. It only triggers once per request to avoid loops.

### Token Accounting

The SDK uses a hybrid approach to token tracking for more accurate context management:

1. **Pre-call Estimates**: Uses token counters to predict usage before API calls
2. **Post-call Actuals**: Updates tracking with real usage from model responses
3. **Message Caching**: Caches token counts per message to avoid re-counting

```typescript
import {
  createContextManager,
  createCustomTokenCounter,
} from "@lleverage-ai/agent-sdk";
import { encoding_for_model } from "tiktoken";

// Option 1: Use approximate counter (default, with caching)
const contextManager = createContextManager({
  maxTokens: 100000,
  // Uses approximate counter by default (4 chars ≈ 1 token)
});

// Option 2: Use model-specific tokenizer (recommended for production)
const encoder = encoding_for_model("gpt-4");
const contextManager = createContextManager({
  maxTokens: 100000,
  tokenCounter: createCustomTokenCounter({
    countFn: (text) => encoder.encode(text).length,
    messageOverhead: 4, // Tokens per message for structure
  }),
});

// The context manager automatically:
// - Estimates tokens before generation (for compaction decisions)
// - Updates with actual usage after generation (for accurate tracking)
// - Caches token counts to avoid re-counting identical messages

const agent = createAgent({
  model,
  contextManager,
});

// After generation, usage is automatically tracked
const result = await agent.generate({ prompt: "Hello" });
// contextManager now knows the actual token usage from the model
```

**Token Budget Properties**:

- `currentTokens`: Current token count (actual or estimated)
- `maxTokens`: Maximum allowed tokens
- `usage`: Usage percentage (0-1)
- `remaining`: Tokens remaining
- `isActual`: `true` if based on model usage, `false` if estimated

**Benefits**:

- More accurate compaction decisions based on real model usage
- Reduced computation from message caching (especially with custom tokenizers)
- Hybrid approach: estimates for predictions, actuals for accuracy
- Automatic integration - no manual updates needed

### Background Compaction

Avoid blocking user-facing responses by running compaction in the background:

```typescript
import { createContextManager } from "@lleverage-ai/agent-sdk";

const contextManager = createContextManager({
  maxTokens: 100000,
  policy: {
    tokenThreshold: 0.8,
  },
  scheduler: {
    enableBackgroundCompaction: true, // Run compaction asynchronously
    debounceDelayMs: 5000, // Wait 5s before starting compaction
    maxPendingTasks: 3, // Maximum queued compactions
    onTaskComplete: (task) => {
      console.log(
        `Background compaction saved ${task.result.tokens_saved} tokens`,
      );
    },
    onTaskError: (task) => {
      console.error(`Compaction failed:`, task.error);
    },
  },
});

const agent = createAgent({
  model,
  contextManager,
});

// First generation: compaction is scheduled but doesn't block
const result1 = await agent.generate({ prompt: "Hello" });
// Returns immediately with original messages

// Background compaction runs after 5s debounce delay

// Next generation: applies the background compaction result
const result2 = await agent.generate({ prompt: "Follow-up" });
// Uses compacted messages from background task
```

**How it works**:

1. **First Call**: When compaction is needed, it's scheduled in the background and original messages are used
2. **Background Execution**: After debounce delay, compaction runs asynchronously
3. **Next Call**: If background compaction completed, the result is applied automatically
4. **Debouncing**: Multiple rapid compaction triggers are coalesced to avoid redundant work

**Benefits**:

- No latency impact on user-facing responses
- Debouncing prevents excessive compaction during rapid interactions
- Queue management prevents memory issues during bursts
- Graceful failure handling with callbacks

**When to use**:

- Interactive applications where latency matters
- High-volume scenarios with many rapid turns
- Long-running sessions with periodic compaction needs

**When to use synchronous compaction** (default behavior):

- Batch processing where latency isn't critical
- Single-request scenarios without follow-up calls
- When you need guaranteed compaction before the next generation

**Access scheduler directly**:

```typescript
// Check pending compactions
const pendingTasks = contextManager.scheduler?.getPendingTasks();
console.log(`${pendingTasks.length} compactions queued`);

// Get task details
const task = contextManager.scheduler?.getTask(taskId);
console.log(`Task status: ${task.status}`);

// Cancel a pending compaction
contextManager.scheduler?.cancel(taskId);

// Clean up completed tasks
contextManager.scheduler?.cleanup();

// Shutdown scheduler (cancels all pending)
contextManager.scheduler?.shutdown();
```

### Advanced Compaction Strategies

Choose from multiple compaction strategies to optimize context management for your use case.

#### Strategy Types

1. **Rollup** (default): Summarize older messages into a single summary
2. **Tiered**: Create multiple summary layers (summary of summaries) for long conversations
3. **Structured**: Generate structured summaries with distinct sections (decisions, state, questions, references)

```typescript
import { createContextManager } from "@lleverage-ai/agent-sdk";

// Rollup strategy (default): single summary of old messages
const contextManager1 = createContextManager({
  maxTokens: 100000,
  summarization: {
    keepMessageCount: 10,
    strategy: "rollup", // Simple summary rollup
  },
});

// Tiered strategy: progressive summarization over time
const contextManager2 = createContextManager({
  maxTokens: 100000,
  summarization: {
    keepMessageCount: 10,
    strategy: "tiered",
    enableTieredSummaries: true,
    maxSummaryTiers: 3, // Up to 3 summary levels
    messagesPerTier: 5, // Combine 5 summaries into next tier
  },
});

// Structured strategy: summaries with organized sections
const contextManager3 = createContextManager({
  maxTokens: 100000,
  summarization: {
    keepMessageCount: 10,
    strategy: "structured",
    enableStructuredSummary: true,
  },
});
```

**When to use each strategy**:

- **Rollup**: Most use cases - simple and effective
- **Tiered**: Very long conversations (100+ turns) where you want progressive compression
- **Structured**: When you need to parse or query summary content programmatically

#### Structured Summaries

Structured summaries provide organized sections for better context organization:

```typescript
// Structured summary format
{
  decisions: ["Chose TypeScript over JavaScript", "Using REST API"],
  preferences: ["Prefer functional style", "No external dependencies"],
  currentState: ["Authentication implemented", "Tests passing"],
  openQuestions: ["How to handle rate limiting?", "Deploy strategy TBD"],
  references: ["src/auth.ts:45", "API_KEY=abc123", "https://docs.example.com"]
}
```

**Benefits**:

- Easy to parse and extract specific information
- Better for long-term context retention
- Enables semantic search within summaries

#### Pinned Messages

Pin important messages to ensure they're never compacted:

```typescript
import { createContextManager } from "@lleverage-ai/agent-sdk";

const contextManager = createContextManager({
  maxTokens: 100000,
  summarization: {
    keepMessageCount: 10,
    strategy: "rollup",
  },
});

// Pin an important message
contextManager.pinMessage(5, "Contains critical user requirements");

// Check if message is pinned
if (contextManager.isPinned(5)) {
  console.log("Message 5 is protected from compaction");
}

// Unpin when no longer needed
contextManager.unpinMessage(5);

// View all pinned messages
console.log("Pinned messages:", contextManager.pinnedMessages);
// [{ messageIndex: 5, reason: "Contains critical user requirements", pinnedAt: 1770084888000 }]
```

**Use cases for pinning**:

- Critical user requirements or constraints
- Important decisions that must be preserved
- Configuration details referenced throughout the conversation
- High-value context that shouldn't be summarized

**Note**: Pinned messages are always kept in full, regardless of compaction strategy. They appear after the summary and before recent messages in the compacted history.

#### Tiered Summaries

For extremely long conversations, tiered summaries create progressive compression:

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  summarization: {
    keepMessageCount: 10,
    strategy: "tiered",
    enableTieredSummaries: true,
    maxSummaryTiers: 3,
    messagesPerTier: 5,
  },
});

// First compaction: creates Tier 0 summary (summarizes old messages)
// After 5 more compactions: creates Tier 1 summary (summarizes 5 Tier 0 summaries)
// After 5 more Tier 1 summaries: creates Tier 2 summary (summarizes 5 Tier 1 summaries)
```

**How it works**:

1. When you have < 5 summaries: creates regular Tier 0 summary
2. When you have ≥ 5 summaries: creates Tier 1 summary (consolidates the 5 summaries)
3. Continues creating higher tiers as needed up to `maxSummaryTiers`

**Benefits**:

- Handles extremely long conversations (1000+ turns)
- Maintains important context across many interactions
- Logarithmic memory usage as conversation grows

**Trade-offs**:

- Slightly higher compaction cost (more summarization calls)
- Information loss increases with tier level
- Best for conversations where recent context matters most

### Rich Content Support

The context manager automatically handles messages with images, files, audio, and video content for token counting and summarization.

#### Supported Content Types

The SDK supports all AI SDK content part types:

- **TextPart**: Standard text messages
- **ImagePart**: Images (URLs, base64, data URIs)
- **FilePart**: Files (URLs, base64, data URIs)
- **ToolCallPart**: Tool invocations
- **ToolResultPart**: Tool execution results

```typescript
import { createAgent, createContextManager } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  contextManager: createContextManager({
    maxTokens: 100000,
    summarization: { keepMessageCount: 10 },
  }),
});

// Messages with images
const result = await agent.generate({
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What's in this screenshot?" },
        {
          type: "image",
          image: new URL("https://example.com/screenshot.png"),
        },
      ],
    },
  ],
});

// Messages with files
const result2 = await agent.generate({
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Analyze this document" },
        {
          type: "file",
          data: "base64data",
          mimeType: "application/pdf",
        },
      ],
    },
  ],
});
```

#### Token Counting for Rich Content

The token counter automatically accounts for rich content:

- **Images**: ~1000 tokens per image (approximate vision model cost)
- **Files**: ~500 tokens per file (varies by size and type)
- **Text**: Character-based approximation or custom tokenizer

```typescript
import {
  createContextManager,
  createApproximateTokenCounter,
} from "@lleverage-ai/agent-sdk";

const counter = createApproximateTokenCounter();

const messages = [
  {
    role: "user",
    content: [
      { type: "text", text: "Compare these images" },
      { type: "image", image: new URL("https://example.com/before.png") },
      { type: "image", image: new URL("https://example.com/after.png") },
    ],
  },
];

// Counts: text (~5) + 2 images (2000) + overhead (4) = ~2009 tokens
const tokenCount = counter.countMessages(messages);

const contextManager = createContextManager({
  maxTokens: 10000,
  tokenCounter: counter, // Optional: use custom counter
});
```

#### Rich Content in Summaries

When compaction occurs, the summarizer extracts metadata from rich content:

```typescript
const contextManager = createContextManager({
  maxTokens: 50000,
  summarization: {
    keepMessageCount: 10,
    strategy: "structured", // Best for rich content
    enableStructuredSummary: true,
  },
});

// After compaction, summaries include:
// - Image URLs and descriptions (e.g., "Image: screenshot.png showing login form")
// - File references with MIME types (e.g., "File: document.pdf (application/pdf)")
// - Context about what the media contained (from model analysis)

// Example structured summary with rich content:
// {
//   "decisions": ["Use responsive design based on provided mockups"],
//   "preferences": ["User prefers dark color scheme"],
//   "currentState": ["Analyzed 3 screenshots showing current UI"],
//   "openQuestions": ["Should we support mobile tablets?"],
//   "references": [
//     "Image: https://example.com/screenshot1.png showing header",
//     "Image: https://example.com/screenshot2.png showing footer",
//     "File: spec.pdf containing technical requirements"
//   ]
// }
```

**Best Practices**:

1. **Use structured summaries** for conversations with many images/files to organize references
2. **Pin important media messages** if they contain critical information that shouldn't be summarized
3. **Monitor token budgets** - rich content uses significantly more tokens than text
4. **Consider background compaction** for image-heavy conversations to avoid blocking
5. **Use descriptive text** alongside media to help the summarizer capture context

**Token Budget Example**:

```typescript
const contextManager = createContextManager({
  maxTokens: 100000,
  policy: {
    tokenThreshold: 0.7, // Lower threshold for image-heavy conversations
  },
});

// Check budget with rich content
const budget = contextManager.getBudget(messages);
console.log(`Usage: ${(budget.usage * 100).toFixed(1)}%`);
console.log(`Images cost: ~${imageCount * 1000} tokens`);
```

**Note**: Token costs for images and files are approximations. Actual costs depend on:

- Image resolution and complexity (for vision models)
- File size and content type
- Model-specific encoding

For accurate token tracking, use model-specific tokenizers with `createCustomTokenCounter()` and update costs based on your provider's pricing.

## Error Handling

Typed errors with recovery utilities.

### Error Types

```typescript
import {
  AgentError,
  ToolExecutionError,
  ModelError,
  TimeoutError,
  RateLimitError,
} from "@lleverage-ai/agent-sdk";

try {
  await agent.generate({ prompt });
} catch (error) {
  if (error instanceof RateLimitError) {
    // Wait and retry
  } else if (error instanceof TimeoutError) {
    // Handle timeout
  } else if (error instanceof ToolExecutionError) {
    console.error("Tool failed:", error.toolName, error.cause);
  }
}
```

### Error Utilities

```typescript
import {
  wrapError,
  isRetryable,
  getUserMessage,
  createErrorHandler,
} from "@lleverage-ai/agent-sdk";

// Wrap unknown errors
const agentError = wrapError(unknownError, { context: "generation" });

// Check if error is retryable
if (isRetryable(error)) {
  // Retry logic
}

// Get user-friendly message
const message = getUserMessage(error);
```

### Graceful Degradation

```typescript
import {
  withFallback,
  tryOperations,
  createCircuitBreaker,
} from "@lleverage-ai/agent-sdk";

// Single fallback
const result = await withFallback(
  () => primaryOperation(),
  () => fallbackOperation(),
);

// Try multiple operations
const result = await tryOperations([
  () => attempt1(),
  () => attempt2(),
  () => attempt3(),
]);

// Circuit breaker pattern
const breaker = createCircuitBreaker({
  threshold: 5,
  resetTimeout: 60000,
});

const result = await breaker.execute(() => riskyOperation());
```

## API Reference

### Agent Creation

| Function                  | Description                           |
| ------------------------- | ------------------------------------- |
| `createAgent(options)`    | Create a new agent instance           |
| `createSubagent(options)` | Define a subagent for task delegation |

### Tools

| Function                         | Description                     |
| -------------------------------- | ------------------------------- |
| `createCoreTools(options)`       | Create all core tools           |
| `createFilesystemTools(backend)` | Create filesystem tools only    |
| `createBashTool(options)`        | Create shell execution tool     |
| `createTaskTool(options)`        | Create subagent delegation tool |
| `createSearchToolsTool(options)` | Create MCP tool search          |

### Plugins

| Function                | Description                       |
| ----------------------- | --------------------------------- |
| `definePlugin(options)` | Define a plugin                   |
| `defineSkill(options)`  | Define a skill with tool guidance |

### Backends

| Class               | Description                           |
| ------------------- | ------------------------------------- |
| `FilesystemBackend` | File operations with security         |
| `StateBackend`      | In-memory filesystem                  |
| `LocalSandbox`      | Command execution sandbox             |
| `CompositeBackend`  | Route operations to multiple backends |

### Middleware

| Function                       | Description                 |
| ------------------------------ | --------------------------- |
| `createLoggingMiddleware()`    | Log requests and responses  |
| `createCacheMiddleware()`      | Cache responses             |
| `createRetryMiddleware()`      | Retry failed requests       |
| `createGuardrailsMiddleware()` | Content filtering           |
| `composeMiddleware()`          | Combine multiple middleware |

### Checkpointing

| Class                | Description               |
| -------------------- | ------------------------- |
| `MemorySaver`        | In-memory checkpoints     |
| `FileSaver`          | File-based checkpoints    |
| `KeyValueStoreSaver` | Generic key-value storage |

### Memory

| Class                   | Description               |
| ----------------------- | ------------------------- |
| `FilesystemMemoryStore` | Persistent memory storage |
| `InMemoryMemoryStore`   | In-memory storage         |

### Observability

| Function                          | Description                  |
| --------------------------------- | ---------------------------- |
| `createLogger()`                  | Create structured logger     |
| `createMetricsRegistry()`         | Create metrics collector     |
| `createTracer()`                  | Create distributed tracer    |
| `createObservabilityPreset()`     | One-line observability setup |
| `createObservabilityEventHooks()` | Collect observability events |

## License

MIT
