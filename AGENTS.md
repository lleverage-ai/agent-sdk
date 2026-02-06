# AGENTS.md

This file provides guidance for AI assistants working on this codebase.

## Project Overview

This is the Agent SDK (`@lleverage-ai/agent-sdk`) - a framework for building AI agents using the Vercel AI SDK.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Testing**: Vitest
- **Linting/Formatting**: Biome
- **AI SDK**: Vercel AI SDK v6

## Commands

```bash
# Install dependencies
bun install

# Build
bun run build

# Run tests
bun run test
bun run test:watch        # Watch mode

# Lint (Biome)
bun run lint              # Check for lint issues
bun run lint:fix          # Fix lint issues

# Type check
bun run type-check

# Format code (Biome)
bun run format            # Format with fixes
bun run format:check      # Check formatting only

# Combined check (Biome lint + format)
bun run check             # Check all
bun run check:fix         # Fix all

# Documentation
bun run docs              # Generate TypeDoc

# Clean build artifacts
bun run clean
```

## Project Structure

```
agent-sdk/
├── src/
│   ├── index.ts             # Public exports
│   ├── types.ts             # Type definitions
│   ├── agent.ts             # createAgent()
│   ├── session.ts           # AgentSession for event-driven interactions
│   ├── hooks.ts             # Hook system
│   ├── plugins.ts           # definePlugin()
│   ├── tools.ts             # defineSkill()
│   ├── context.ts           # Context management
│   ├── context-manager.ts   # Token budgeting & summarization
│   ├── backend.ts           # Backend abstraction
│   ├── subagents.ts         # createSubagent()
│   ├── generation-helpers.ts # Generation utilities
│   ├── backends/            # Backend implementations
│   ├── checkpointer/        # State checkpointing & interrupts
│   ├── errors/              # Error types & graceful degradation
│   ├── hooks/               # Hook utilities (guardrails, audit, etc.)
│   ├── mcp/                 # MCP (Model Context Protocol) support
│   ├── memory/              # Memory systems & permissions
│   ├── middleware/          # Middleware pipeline
│   ├── observability/       # Logging, tracing, metrics, events
│   ├── presets/             # Production agent presets
│   ├── security/            # Security policy presets
│   ├── subagents/           # Advanced subagent utilities
│   ├── task-store/          # Background task persistence
│   ├── testing/             # Comprehensive test utilities
│   └── tools/               # Core tool implementations
│       ├── filesystem.ts    # read, write, edit, glob, grep
│       ├── execute.ts       # bash
│       ├── todos.ts         # todo_write
│       ├── task.ts          # task (subagent delegation)
│       ├── skills.ts        # skill (progressive disclosure)
│       ├── tool-registry.ts # Tool registry (deferred loading)
│       ├── search.ts        # search_tools (MCP integration)
│       ├── utils.ts         # Tool utilities
│       └── factory.ts       # createCoreTools()
├── tests/
└── docs/
```

## Code Style

- Use TypeScript strict mode
- Prefer `interface` over `type` for object shapes
- Use named exports, not default exports
- Use `.js` extensions in imports (required for ESM)
- Prefix unused parameters with underscore (e.g., `_context`)
- Keep functions small and focused
- Write TSDoc comments for all public APIs (see below)

## TSDoc Guidelines

Documentation is auto-generated using TypeDoc. All public exports must have TSDoc comments.

### Generate Docs

```bash
bun run docs          # Generate docs to ./docs
bun run docs:watch    # Watch mode
```

### TSDoc Format

**Functions:**

````typescript
/**
 * Creates a new agent instance with the specified configuration.
 *
 * @param options - Configuration options for the agent
 * @returns A configured agent instance ready for use
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   model: "anthropic/claude-haiku-4.5",
 *   systemPrompt: "You are a helpful assistant.",
 * });
 * ```
 *
 * @category Agent
 */
export function createAgent(options: AgentOptions): Agent {
````

**Interfaces:**

```typescript
/**
 * Configuration options for creating an agent.
 *
 * @category Agent
 */
export interface AgentOptions {
  /** The AI model to use for generation */
  model: LanguageModel;

  /**
   * System prompt that defines the agent's behavior.
   * @defaultValue undefined
   */
  systemPrompt?: string;

  /**
   * Maximum number of tool calls allowed per generation.
   * @defaultValue 10
   */
  maxToolCalls?: number;
}
```

**Types:**

```typescript
/**
 * Reason why the model finished generating.
 *
 * - `stop` - Model generated a stop sequence
 * - `length` - Maximum tokens reached
 * - `tool-calls` - Model requested tool calls
 * - `error` - An error occurred
 * - `other` - Other/unknown reason
 *
 * @category Types
 */
export type FinishReason = "stop" | "length" | "tool-calls" | "error" | "other";
```

### TSDoc Tags Reference

| Tag                         | Usage                                               |
| --------------------------- | --------------------------------------------------- |
| `@param name - desc`        | Document function parameters                        |
| `@returns desc`             | Document return value                               |
| `@example`                  | Code example (use fenced code blocks)               |
| `@defaultValue value`       | Document default values                             |
| `@category Name`            | Group in docs (Agent, Tools, Plugins, Hooks, Types) |
| `@see {@link Thing}`        | Link to related items                               |
| `@throws {Error}`           | Document thrown errors                              |
| `@deprecated Use X instead` | Mark as deprecated                                  |
| `@internal`                 | Exclude from public docs                            |

### Categories

Use these categories consistently:

- `Agent` - Agent creation and core functionality
- `Session` - AgentSession for event-driven interactions
- `Tools` - Tool definitions and utilities
- `Plugins` - Plugin system
- `Hooks` - Hook system and lifecycle events
- `Subagents` - Subagent and task delegation
- `Context` - Context management
- `Types` - Type definitions
- `Backend` - Backend protocols and implementations
- `Observability` - Logging, metrics, tracing, and event exports
- `Security` - Security policy presets and enforcement
- `Presets` - Opinionated agent presets

### Best Practices

1. **Every public export needs docs** - Functions, interfaces, types, constants
2. **First line is summary** - Keep it concise, one sentence
3. **Include examples** - Especially for main APIs
4. **Document all parameters** - Even if they seem obvious
5. **Link related items** - Use `{@link Thing}` for cross-references
6. **Use inline comments** - For interface properties, use `/** comment */` on same line or above

## Testing

- Tests live in `tests/` directory
- Use **Vitest** for testing (NOT `bun:test`)
  - Import from `"vitest"`: `import { describe, it, expect, vi, beforeEach } from "vitest"`
  - Use `vi.fn()` for mocks, NOT `mock()` from bun
- Mock external dependencies (like the AI SDK) at module level
- Test files should match pattern `*.test.ts`

Example test structure:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return { ...actual, generateText: vi.fn() };
});

describe("feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does something", () => {
    // test
  });
});
```

## Key Patterns

### Creating Tools

Tools use the AI SDK's `tool()` function directly for full compatibility:

```typescript
import { tool } from "ai";
import { z } from "zod";

const myTool = tool({
  description: "What the tool does",
  inputSchema: z.object({
    input: z.string(),
  }),
  execute: async ({ input }) => {
    return `Result: ${input}`;
  },
});
```

### Using Core Tools

The SDK provides a set of 10 core tools via `createCoreTools()`:

```typescript
import {
  createCoreTools,
  createAgentState,
  StateBackend,
  FilesystemBackend,
} from "@lleverage-ai/agent-sdk";

// Option 1: In-memory backend (no bash) - safest default
const state = createAgentState();
const backend = new StateBackend(state);
const { tools } = createCoreTools({ backend, state });

// Option 2: Filesystem backend with bash - for real file operations
const fsBackend = new FilesystemBackend({
  rootDir: process.cwd(),
  enableBash: true,  // Enable shell command execution
  timeout: 30000,    // Optional: command timeout in ms
});
const { tools: fsTools } = createCoreTools({
  backend: fsBackend,
  state,
  // Optional: enable subagent delegation
  subagents: [researcherAgent, coderAgent],
  parentAgent,
  defaultModel,
  // Optional: enable MCP tool search
  mcpManager,
});

// Tools included:
// - read, write, edit, glob, grep (filesystem)
// - bash (shell execution, if backend has enableBash: true)
// - todo_write (task tracking)
// - task (subagent delegation, if subagents provided)
// - skill (progressive disclosure, if skillRegistry provided)
// - search_tools (MCP tool search, if mcpManager provided)
```

### Creating Plugins

```typescript
import { definePlugin } from "@lleverage-ai/agent-sdk";
import { tool } from "ai";
import { z } from "zod";

const myPlugin = definePlugin({
  name: "my-plugin",
  description: "What the plugin does",
  tools: {
    myTool: tool({
      description: "A tool provided by this plugin",
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
    // initialization logic
  },
});
```

### Creating Agents

```typescript
import {
  createAgent,
  createCoreTools,
  createAgentState,
  StateBackend,
  FilesystemBackend,
} from "@lleverage-ai/agent-sdk";

// === Simplest: In-memory agent (no bash, safe default) ===
const state = createAgentState();
const backend = new StateBackend(state);
const { tools } = createCoreTools({ backend, state });

const agent = createAgent({
  model: "anthropic/claude-haiku-4.5",
  systemPrompt: "You are a helpful assistant.",
  tools,
});

// === Filesystem agent with bash ===
const fsBackend = new FilesystemBackend({
  rootDir: process.cwd(),
  enableBash: true,
});
const { tools: fsTools } = createCoreTools({ backend: fsBackend, state });

const fsAgent = createAgent({
  model: "anthropic/claude-haiku-4.5",
  systemPrompt: "You are a helpful coding assistant.",
  tools: fsTools,
});

// === With plugins and custom tools ===
const agent = createAgent({
  model: "anthropic/claude-haiku-4.5",
  systemPrompt: "You are a helpful assistant.",
  plugins: [myPlugin],
  tools: {
    ...tools,
    myCustomTool, // Add custom tools
  },
});

const result = await agent.generate({ prompt: "Hello" });
```

### Using AgentSession

For interactive agents with background tasks, use `AgentSession`:

```typescript
import {
  createAgent,
  createAgentSession,
  FilesystemBackend,
} from "@lleverage-ai/agent-sdk";

const backend = new FilesystemBackend({
  rootDir: process.cwd(),
  enableBash: true,
});

const agent = createAgent({
  model: "anthropic/claude-sonnet-4",
  systemPrompt: "You are a helpful assistant.",
  backend,
});

// AgentSession handles background task completions automatically
const session = createAgentSession({
  agent,
  threadId: "session-123", // Enable checkpointing
});

for await (const output of session.run()) {
  switch (output.type) {
    case "waiting_for_input":
      session.sendMessage(await getUserInput());
      break;
    case "text_delta":
      process.stdout.write(output.text);
      break;
    case "generation_complete":
      console.log("\n");
      break;
    case "interrupt":
      session.respondToInterrupt(output.interrupt.id, await handleInterrupt(output.interrupt));
      break;
  }
}
```

See [Agent Session docs](./docs/agent-session.md) for full details.

## Backend & Bash Execution

The SDK uses a unified backend architecture. `FilesystemBackend` provides both file operations and optional bash execution.

### FilesystemBackend with Bash

```typescript
import { FilesystemBackend, hasExecuteCapability } from "@lleverage-ai/agent-sdk";

const backend = new FilesystemBackend({
  rootDir: process.cwd(),
  enableBash: true,           // Enable shell command execution
  timeout: 30000,             // Command timeout (default: 120000ms)
  maxOutputSize: 100000,      // Max output size (default: 100000 chars)
  shell: "/bin/bash",         // Shell to use (default: /bin/bash or cmd on Windows)
  env: { NODE_ENV: "dev" },   // Additional environment variables
  blockedCommands: [/rm -rf/],// Block dangerous commands
  allowedCommands: [/npm/],   // Allowlist (if set, only these are allowed)
  allowDangerous: false,      // Allow dangerous patterns (default: false)
});

// Check if backend supports execute
if (hasExecuteCapability(backend)) {
  const result = await backend.execute("echo hello");
  console.log(result.output); // "hello\n"
}
```

### Backend Types

| Backend            | File Operations | Bash Execution | Use Case                        |
| ------------------ | --------------- | -------------- | ------------------------------- |
| `StateBackend`     | In-memory       | No             | Testing, sandboxed environments |
| `FilesystemBackend`| Real filesystem | Optional       | Development, production         |

### Unified Backend Architecture

The SDK uses a unified backend architecture with `FilesystemBackend` providing both file operations and bash execution in one interface:

```typescript
import { FilesystemBackend, hasExecuteCapability } from "@lleverage-ai/agent-sdk";

// Single backend for both file ops and bash execution
const backend = new FilesystemBackend({
  rootDir: process.cwd(),
  enableBash: true,
});

const { tools } = createCoreTools({ backend, state });

// Check for bash capability
if (hasExecuteCapability(backend)) {
  const result = await backend.execute("npm test");
}
```

Key points:
- Single `backend` parameter instead of separate `backend` + `sandbox`
- Use `hasExecuteCapability(backend)` to check for bash support
- `createCoreTools()` automatically detects bash capability and includes the bash tool
- Note: The tool is called `bash` (what users interact with), while the backend interface method is called `execute()` (more general-purpose)

## AI SDK v6 Notes

The project uses Vercel AI SDK v6 which has breaking changes from v4/v5:

- `LanguageModelV1` → `LanguageModel`
- Tool definitions use `inputSchema` instead of `parameters`
- Tool calls have `input` instead of `args`
- Tool results have `output` instead of `result`
- Usage has `inputTokens`/`outputTokens` instead of `promptTokens`/`completionTokens`
- Use `stopWhen: stepCountIs(n)` instead of `maxSteps`

## Core Tools

The SDK provides a set of 10 tools (inspired by Claude Code's tool philosophy):

| Tool           | Description                       | Requires                                  |
| -------------- | --------------------------------- | ----------------------------------------- |
| `read`         | Read file contents                | backend                                   |
| `write`        | Write/create files                | backend                                   |
| `edit`         | Edit files via string replacement | backend                                   |
| `glob`         | Find files by pattern             | backend                                   |
| `grep`         | Search file contents              | backend                                   |
| `bash`         | Execute shell commands            | backend with execute capability           |
| `todo_write`   | Update task list                  | state                                     |
| `task`         | Delegate to subagents             | subagents, parentAgent, defaultModel      |
| `skill`        | Load additional capabilities      | skillRegistry                             |
| `search_tools` | Search MCP tools dynamically      | mcpManager                                |

Create tools via `createCoreTools()` or individual factory functions:

```typescript
// All-in-one (returns { tools, skillRegistry })
const { tools } = createCoreTools({ backend, state });

// Or individual tools
import { createReadTool, createBashTool } from "@lleverage-ai/agent-sdk";
const read = createReadTool(backend);
const bash = createBashTool({ backend: executableBackend }); // backend with execute capability

// Tool utilities for working with plugins and MCP
import { mcpTools, toolsFromPlugin } from "@lleverage-ai/agent-sdk";
const pluginTools = toolsFromPlugin(myPlugin);
const allMcpTools = await mcpTools(mcpManager);
```

## Hook Utilities

The SDK provides factory functions for common hook patterns:

### Guardrails (Input/Output Validation)

```typescript
import {
  createGuardrailsHooks,
  raceGuardrails,
  createRegexGuardrail,
  createBufferedOutputGuardrail,
  wrapStreamWithOutputGuardrail,
} from "@lleverage-ai/agent-sdk";

// Simple guardrails with hooks
const guardrailHooks = createGuardrailsHooks({
  blockedPatterns: [/password/i, /secret/i],
  onBlocked: (pattern, text) => console.log(`Blocked: ${pattern}`),
});

// Composable guardrails (race pattern - first to trigger wins)
const piiGuardrail = createRegexGuardrail("pii", /\b\d{3}-\d{2}-\d{4}\b/);
const profanityGuardrail = createRegexGuardrail("profanity", /badword/i);

const result = await raceGuardrails([piiGuardrail, profanityGuardrail], messages);
if (result.blocked) {
  console.log(`Blocked by: ${result.guardrailName}`);
}

// Post-stream output guardrails (with rollback support)
const outputGuardrail = createBufferedOutputGuardrail({
  check: async (text) => {
    if (text.includes("sensitive")) return { blocked: true, reason: "sensitive content" };
    return { blocked: false };
  },
  onBlocked: (reason, buffer) => console.log(`Output blocked: ${reason}`),
});
```

### Secrets Filtering

```typescript
import {
  createSecretsFilterHooks,
  COMMON_SECRET_PATTERNS,
} from "@lleverage-ai/agent-sdk";

const secretsHooks = createSecretsFilterHooks({
  patterns: COMMON_SECRET_PATTERNS, // API keys, tokens, passwords, etc.
  replacement: "[REDACTED]",
  onSecretDetected: (pattern, context) => console.log(`Secret filtered`),
});
```

### Audit Logging

```typescript
import {
  createAuditHooks,
  createInMemoryAuditStore,
  exportAuditEventsJSONLines,
} from "@lleverage-ai/agent-sdk";

const auditStore = createInMemoryAuditStore();
const auditHooks = createAuditHooks({
  store: auditStore,
  categories: ["generation", "tool_use", "permission"],
});

// Export audit trail
const jsonLines = exportAuditEventsJSONLines(auditStore.getEvents());
```

### Other Hook Utilities

```typescript
import {
  createToolHook,          // Helper for creating tool-specific hooks
  createCacheHooks,        // Response caching
  createRetryHooks,        // Automatic retries
  createRateLimitHooks,    // Rate limiting with token bucket
  createLoggingHooks,      // Generation logging
  createToolLoggingHooks,  // Tool execution logging
} from "@lleverage-ai/agent-sdk";

// Example: createToolHook for simple tool-specific hooks
const toolHook = createToolHook(
  async ({ tool_name, tool_response }) => {
    console.log(`Tool ${tool_name} completed`);
  },
  { matcher: "search_*" }, // Optional: only match tools starting with "search_"
);
```

## Memory System

The memory system supports loading and filtering context from markdown files:

```typescript
import {
  loadAllMemory,
  loadAgentMemory,
  filterMemoriesByPath,
  filterMemoriesByTags,
  buildPathMemoryContext,
  findGitRoot,
} from "@lleverage-ai/agent-sdk";

// Load all memory (project + user)
const { memories, additionalFiles, projectPath, userPath } = await loadAllMemory({
  cwd: process.cwd(),
  agentName: "my-agent",
});

// Filter by current working path
const relevantMemories = filterMemoriesByPath(memories, "/src/components");

// Filter by tags
const apiMemories = filterMemoriesByTags(memories, ["api", "backend"]);

// Build context string for system prompt
const memoryContext = buildPathMemoryContext({
  memories,
  additionalFiles,
  currentPath: "/src/components/Button.tsx",
});
```

### Memory Permissions

```typescript
import {
  FileMemoryPermissionStore,
  computeContentHash,
} from "@lleverage-ai/agent-sdk";

const permissionStore = new FileMemoryPermissionStore({ dir: ".agent" });

// Check if memory is approved
const approval = await permissionStore.getApproval(memoryId, contentHash);
if (!approval || approval.status !== "approved") {
  // Request user approval
}
```

## Context Manager

Token budgeting and message summarization:

```typescript
import {
  createContextManager,
  createApproximateTokenCounter,
  createTokenBudget,
  DEFAULT_SUMMARIZATION_CONFIG,
} from "@lleverage-ai/agent-sdk";

const tokenCounter = createApproximateTokenCounter();
const budget = createTokenBudget({ maxTokens: 100000, reserveTokens: 10000 });

const contextManager = createContextManager({
  tokenCounter,
  budget,
  summarizationConfig: {
    ...DEFAULT_SUMMARIZATION_CONFIG,
    model: anthropic("claude-haiku-4-20250514"),
  },
});

// Compact messages when over budget
const { messages: compactedMessages, wasCompacted } = await contextManager.compact(messages);
```

## Testing Utilities

Comprehensive testing support via `@lleverage-ai/agent-sdk/testing`:

```typescript
import {
  // Mock agents
  createMockAgent,
  createMockModel,
  // Recording/playback
  createRecordingAgent,
  createPlaybackAgent,
  parseRecording,
  // Assertions
  assertToolCalled,
  assertToolCalledWith,
  assertToolNotCalled,
  assertResponseContains,
  assertFinishReason,
  // Stream testing
  collectStreamChunks,
  assertStreamHasText,
  getStreamText,
  // State assertions
  assertStateHasFile,
  assertStateHasTodo,
  assertTodoCount,
  // Composite
  assertAgentBehavior,
} from "@lleverage-ai/agent-sdk/testing";

// Mock agent with queued responses
const agent = createMockAgent();
agent.queueResponses(
  { text: "First response" },
  { text: "Second response", steps: [{ toolCalls: [...] }] },
);

// Recording for regression tests
const recordingAgent = createRecordingAgent(realAgent, {
  description: "User flow test",
});
await recordingAgent.generate({ prompt: "Hello" });
const recording = recordingAgent.exportRecording();

// Playback for deterministic tests
const playbackAgent = createPlaybackAgent({
  recording: parseRecording(savedRecording),
  matchMode: "sequence",
});

// Composite assertions
assertAgentBehavior(result, {
  responseContains: ["success"],
  finishReason: "stop",
  toolsCalled: ["read", "write"],
  toolsNotCalled: ["bash"],
  minSteps: 2,
});
```

## Observability

### Logger

```typescript
import {
  createLogger,
  createJsonFormatter,
  createPrettyFormatter,
  createConsoleTransport,
  createMemoryTransport,
} from "@lleverage-ai/agent-sdk";

const logger = createLogger({
  level: "info",
  formatter: createPrettyFormatter(),
  transports: [createConsoleTransport()],
});

logger.info("Agent started", { agentId: "123" });
logger.time("operation").end(); // Timing support
```

### Metrics

```typescript
import {
  createMetricsRegistry,
  createAgentMetrics,
  DEFAULT_LATENCY_BUCKETS,
} from "@lleverage-ai/agent-sdk";

const registry = createMetricsRegistry();
const metrics = createAgentMetrics(registry);

metrics.generationLatency.observe(1234); // ms
metrics.tokenUsage.add(500, { type: "input" });
metrics.toolCalls.inc({ tool: "read", status: "success" });
```

### Tracing (OpenTelemetry Compatible)

```typescript
import {
  createTracer,
  createOTLPSpanExporter,
  SemanticAttributes,
} from "@lleverage-ai/agent-sdk";

const tracer = createTracer({
  serviceName: "my-agent",
  exporters: [createOTLPSpanExporter({ endpoint: "http://localhost:4318" })],
});

const span = tracer.startSpan("agent.generate", {
  attributes: { [SemanticAttributes.AGENT_NAME]: "assistant" },
});
// ... operation
span.end();
```

### Events

```typescript
import {
  createObservabilityEventStore,
  createObservabilityEventHooks,
  exportEventsJSONLines,
  exportEventsPrometheus,
} from "@lleverage-ai/agent-sdk";

const eventStore = createObservabilityEventStore();
const eventHooks = createObservabilityEventHooks({ store: eventStore });

// Export formats
const jsonLines = exportEventsJSONLines(eventStore.getEvents());
const prometheus = exportEventsPrometheus(eventStore.getEvents());
```

## Middleware System

```typescript
import {
  applyMiddleware,
  createLoggingMiddleware,
  mergeHooks,
} from "@lleverage-ai/agent-sdk";

const loggingMiddleware = createLoggingMiddleware({
  logger,
  logToolInputs: true,
  logToolOutputs: true,
});

const agent = createAgent({
  model,
  middleware: [loggingMiddleware],
});

// Or apply dynamically
const enhancedAgent = applyMiddleware(agent, [loggingMiddleware]);
```

## Error Handling

Comprehensive error types and graceful degradation:

```typescript
import {
  // Error classes
  AgentError,
  ToolExecutionError,
  ToolPermissionDeniedError,
  ModelError,
  TimeoutError,
  RateLimitError,
  // Utilities
  wrapError,
  isRetryable,
  getUserMessage,
  formatErrorForLogging,
  // Graceful degradation
  withFallback,
  withFallbackFn,
  tryOperations,
  createCircuitBreaker,
} from "@lleverage-ai/agent-sdk";

// Wrap errors with context
const error = wrapError(originalError, {
  code: "TOOL_EXECUTION",
  context: { toolName: "bash" },
});

// Check if retryable
if (isRetryable(error)) {
  // Retry logic
}

// Fallback pattern
const result = await withFallback(
  () => primaryOperation(),
  fallbackValue,
  { maxRetries: 3 },
);

// Circuit breaker
const breaker = createCircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
});
const result = await breaker.execute(() => riskyOperation());
```

## MCP (Model Context Protocol)

```typescript
import {
  MCPManager,
  MCPInputValidator,
  VirtualMCPServer,
  expandEnvVars,
} from "@lleverage-ai/agent-sdk";

// MCP Manager for unified server management
const mcpManager = new MCPManager();
await mcpManager.addServer("filesystem", {
  type: "stdio",
  command: "npx",
  args: ["-y", "@anthropic/mcp-server-filesystem", "/path/to/dir"],
});

const tools = await mcpManager.getTools();

// Virtual MCP server (for testing)
const virtualServer = new VirtualMCPServer({
  tools: { myTool: { ... } },
});

// Input validation
const validator = new MCPInputValidator();
const validatedInput = validator.validate(schema, input);
```

## Task Store (Background Tasks)

Persistence for long-running background tasks:

```typescript
import {
  MemoryTaskStore,
  FileTaskStore,
  KVTaskStore,
  createBackgroundTask,
  updateBackgroundTask,
  recoverRunningTasks,
  recoverFailedTasks,
} from "@lleverage-ai/agent-sdk";

// In-memory (development)
const memoryStore = new MemoryTaskStore();

// File-based (persistence)
const fileStore = new FileTaskStore({ dir: ".agent/tasks" });

// Key-value store (cloud)
const kvStore = new KVTaskStore({ store: myKVStore });

// Create and track tasks
const task = createBackgroundTask({
  id: "task-123",
  description: "Processing data",
  status: "running",
});
await store.save(task);

// Recover tasks after restart
const runningTasks = await recoverRunningTasks(store);
const failedTasks = await recoverFailedTasks(store);
```

## Security Policies

Apply security presets for different environments:

```typescript
import { applySecurityPolicy } from "@lleverage-ai/agent-sdk";

// Presets: "development", "ci", "production", "readonly"
const secureOptions = applySecurityPolicy(agentOptions, "production");

// Production preset includes:
// - Blocked dangerous commands (rm -rf, sudo, etc.)
// - Path restrictions
// - Rate limiting
// - Input/output validation
```

## Production Presets

Quick setup for production-ready agents:

```typescript
import {
  createProductionAgent,
  createSecureProductionAgent,
  DEFAULT_BLOCKED_INPUT_PATTERNS,
  DEFAULT_BLOCKED_OUTPUT_PATTERNS,
} from "@lleverage-ai/agent-sdk";

// Full production setup with hooks, logging, metrics
const { agent, logger, metrics, hooks } = await createProductionAgent({
  model,
  systemPrompt: "You are a helpful assistant.",
  tools: myTools,
  // Automatically includes: logging, metrics, tracing, guardrails
});

// Secure variant with additional protections
const { agent } = await createSecureProductionAgent({
  model,
  systemPrompt: "...",
  securityPolicy: "production",
});
```

## Checkpointer & Interrupts

State persistence and interrupt handling:

```typescript
import {
  MemorySaver,
  FileSaver,
  KeyValueStoreSaver,
  createCheckpoint,
  createInterrupt,
  createApprovalInterrupt,
  isInterrupt,
} from "@lleverage-ai/agent-sdk";

// Checkpoint savers
const memorySaver = new MemorySaver();
const fileSaver = new FileSaver({ dir: ".agent/checkpoints" });

// Create checkpoints
const checkpoint = createCheckpoint({
  threadId: "thread-123",
  messages,
  state: agentState,
});
await saver.save(checkpoint);

// Interrupts for user approval flows
const interrupt = createApprovalInterrupt({
  type: "tool_approval",
  request: {
    toolName: "bash",
    input: { command: "rm file.txt" },
    reason: "Destructive operation",
  },
});

// Check for interrupts in results
if (isInterrupt(result)) {
  // Handle approval flow
  const approved = await getUserApproval(result.interrupt);
  // Resume with approval
}
```
