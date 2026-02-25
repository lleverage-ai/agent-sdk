# API Reference

Complete API documentation for `@lleverage-ai/agent-sdk`.

## Agent Creation

| Function | Description |
|----------|-------------|
| `createAgent(options)` | Create a new agent instance |
| `createSubagent(options)` | Define a subagent for task delegation |
| `createProductionAgent(options)` | Create agent with production security and observability |

### createAgent

```typescript
const agent = createAgent({
  // Required
  model: LanguageModel,

  // Optional
  systemPrompt?: string,
  maxSteps?: number,
  tools?: Record<string, Tool>,
  plugins?: Plugin[],
  hooks?: AgentHooks,
  middleware?: Middleware[],
  backend?: Backend,              // FilesystemBackend or StateBackend
  checkpointer?: Checkpointer,
  contextManager?: ContextManager,
  subagents?: Subagent[],
  taskStore?: TaskStore,
  disabledCoreTools?: string[],
  allowedTools?: string[],
  pluginLoading?: "eager" | "proxy",
  mcpManager?: MCPManager,
  mcpEagerLoad?: boolean,
  toolSearch?: ToolSearchOptions,
});
```

### Agent Methods

```typescript
// Generate a response
const result = await agent.generate({
  prompt?: string,
  messages?: Message[],
  threadId?: string,
  tools?: Record<string, Tool>,
});

// Stream a response (AsyncIterator)
for await (const part of agent.stream(options)) {
  // Handle stream parts
}

// Stream response (for API routes)
const response = agent.streamResponse(options);

// Raw AI SDK stream
const stream = await agent.streamRaw(options);

// Data stream response
const response = agent.streamDataResponse(options);

```

## Tools

| Function | Description |
|----------|-------------|
| `createCoreTools(options)` | Create all core tools |
| `createFilesystemTools(backend)` | Create filesystem tools only |
| `createBashTool(options)` | Create shell execution tool |
| `createTaskTool(options)` | Create subagent delegation tool |
| `createSearchToolsTool(options)` | Create MCP tool search |
| `createCallToolTool(options)` | Create proxy tool invoker |

### Core Tools

```typescript
import { createCoreTools, FilesystemBackend } from "@lleverage-ai/agent-sdk";

const backend = new FilesystemBackend({
  rootDir: "/project",
  enableBash: true, // Enable bash tool
});

const { tools } = createCoreTools({
  backend,
  state,
  disabled: ["bash"], // Optionally disable specific tools
});
```

**Available core tools:**
- `read` — Read file contents
- `write` — Write file contents
- `edit` — Edit file with find/replace
- `glob` — Find files by pattern
- `grep` — Search file contents
- `todo_write` — Manage task list
- `bash` — Execute shell commands (requires backend with `enableBash: true`)
- `search_tools` — Search available tools (when enabled)
- `call_tool` — Invoke proxied/deferred MCP tools (proxy mode)

## Plugins

| Function | Description |
|----------|-------------|
| `definePlugin(options)` | Define a plugin |
| `defineSkill(options)` | Define a skill with tool guidance |

### definePlugin

```typescript
const plugin = definePlugin({
  name: string,
  description?: string,
  tools?: Record<string, Tool>,
  skills?: Skill[],
  hooks?: PluginHooks,
  mcpServer?: MCPServerConfig,
  setup?: (agent: Agent) => Promise<void>,
});
```

### defineSkill

```typescript
const skill = defineSkill({
  name: string,
  description: string,
  instructions: string,
  tools?: Record<string, Tool>,
});
```

## Backends

| Class | Description |
|-------|-------------|
| `FilesystemBackend` | File operations with optional shell execution |
| `StateBackend` | In-memory filesystem (no shell execution) |
| `CompositeBackend` | Route operations to multiple backends |

### FilesystemBackend

```typescript
const backend = new FilesystemBackend({
  rootDir: string,
  allowedPaths?: string[],
  maxFileSize?: number,
  followSymlinks?: boolean,
  encoding?: string,
  // Shell execution options
  enableBash?: boolean,          // Enable execute() method
  timeout?: number,              // Command timeout in ms
  maxOutputSize?: number,        // Max stdout/stderr size
  blockedCommands?: (string | RegExp)[],
  allowedCommands?: (string | RegExp)[],
  allowDangerous?: boolean,
  shell?: string,
  env?: Record<string, string>,
});

// Check for execute capability
import { hasExecuteCapability } from "@lleverage-ai/agent-sdk";
if (hasExecuteCapability(backend)) {
  const result = await backend.execute("npm test");
}
```

## Middleware

| Function | Description |
|----------|-------------|
| `createLoggingMiddleware()` | Log requests and responses |
| `createCacheMiddleware()` | Cache responses |
| `createRetryMiddleware()` | Retry failed requests |
| `createCircuitBreakerMiddleware()` | Circuit breaker pattern |
| `createGuardrailsMiddleware()` | Content filtering |
| `createContentFilterMiddleware()` | Message length/count limits |
| `createRateLimitMiddleware()` | Rate limiting |
| `composeMiddleware()` | Combine multiple middleware |

## Hooks

| Function | Description |
|----------|-------------|
| `createRetryHooks()` | Automatic retries with backoff |
| `createRateLimitHooks()` | Rate limiting |
| `createLoggingHooks()` | Structured logging |
| `createGuardrailsHooks()` | Content guardrails |
| `createSecretsFilterHooks()` | Secrets redaction |
| `createCacheHooks()` | Response caching |
| `createObservabilityEventHooks()` | Observability events |

### Hook Types

```typescript
interface AgentHooks {
  PreGenerate?: PreGenerateHook[];
  PostGenerate?: PostGenerateHook[];
  PostGenerateFailure?: PostGenerateFailureHook[];
  PreToolUse?: PreToolUseHookConfig[];
  PostToolUse?: PostToolUseHookConfig[];
  PostToolUseFailure?: PostToolUseFailureHookConfig[];
  MCPConnectionFailed?: MCPConnectionFailedHook[];
  MCPConnectionRestored?: MCPConnectionRestoredHook[];
  PreCompact?: PreCompactHook[];
  PostCompact?: PostCompactHook[];
}
```

## Checkpointing

| Class | Description |
|-------|-------------|
| `MemorySaver` | In-memory checkpoints |
| `FileSaver` | File-based checkpoints |
| `KeyValueStoreSaver` | Generic key-value storage |

### Checkpointer Interface

```typescript
interface Checkpointer {
  save(checkpoint: Checkpoint): Promise<void>;
  load(threadId: string): Promise<Checkpoint | null>;
  list(): Promise<string[]>;
  delete(threadId: string): Promise<void>;
}
```

## Memory

| Class | Description |
|-------|-------------|
| `FilesystemMemoryStore` | Persistent memory storage |
| `InMemoryMemoryStore` | In-memory storage |

### MemoryStore Interface

```typescript
interface MemoryStore {
  save(document: MemoryDocument): Promise<void>;
  load(id: string): Promise<MemoryDocument | null>;
  query(filter: MemoryFilter): Promise<MemoryDocument[]>;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
}
```

## Context Management

| Function | Description |
|----------|-------------|
| `createContextManager()` | Create context manager |
| `createApproximateTokenCounter()` | Approximate token counting |
| `createCustomTokenCounter()` | Custom tokenizer |

### ContextManager

```typescript
const contextManager = createContextManager({
  maxTokens: number,
  policy?: CompactionPolicy,
  summarization?: SummarizationOptions,
  scheduler?: SchedulerOptions,
  tokenCounter?: TokenCounter,
});

// Methods
contextManager.getBudget(messages: Message[]): TokenBudget;
contextManager.pinMessage(index: number, reason?: string): void;
contextManager.unpinMessage(index: number): void;
contextManager.isPinned(index: number): boolean;
```

## Observability

| Function | Description |
|----------|-------------|
| `createLogger()` | Create structured logger |
| `createMetricsRegistry()` | Create metrics collector |
| `createTracer()` | Create distributed tracer |
| `createObservabilityPreset()` | One-line observability setup |
| `createObservabilityEventStore()` | Event store for hooks |

## Security

| Function | Description |
|----------|-------------|
| `applySecurityPolicy()` | Apply security preset |
| `getBackendOptionsForAcceptEdits()` | Backend options for acceptEdits mode |
| `createGuardrailsHooks()` | Input/output guardrails |
| `createSecretsFilterHooks()` | Secrets filtering |

### Security Presets

```typescript
applySecurityPolicy(
  preset: "development" | "ci" | "production" | "readonly",
  options?: {
    permissionMode?: "acceptAll" | "acceptEdits" | "approval-required";
    blockShellFileOps?: boolean;
    backend?: FilesystemBackendOptions;
  }
);
```

## MCP

| Class/Function | Description |
|----------------|-------------|
| `MCPManager` | Manage MCP server connections |
| `mcpTools()` | Get all MCP tool names from agent |
| `mcpToolsFor()` | Get tools for specific plugin |
| `toolsFromPlugin()` | Extract tools from plugin |

### MCPManager

```typescript
const mcpManager = new MCPManager();

await mcpManager.connectServer({
  name: string,
  command?: string,
  args?: string[],
  env?: Record<string, string>,
  url?: string,
  headers?: Record<string, string>,
  type?: "stdio" | "http",
  allowedTools?: string[],
  validateInputs?: boolean,
  requireSchema?: boolean,
});

mcpManager.listTools(): Tool[];
mcpManager.disconnect(name: string): Promise<void>;
```

## Errors

| Class | Description |
|-------|-------------|
| `AgentError` | Base error class |
| `ModelError` | Model errors |
| `ToolExecutionError` | Tool failures |
| `TimeoutError` | Timeouts |
| `RateLimitError` | Rate limits |
| `ContextLengthError` | Context overflow |
| `ValidationError` | Validation failures |
| `MCPError` | MCP errors |
| `MCPInputValidationError` | MCP input validation |

### Error Utilities

```typescript
wrapError(error: unknown, context?: object): AgentError;
isRetryable(error: unknown): boolean;
getUserMessage(error: unknown): string;
createErrorHandler(handlers: ErrorHandlers): ErrorHandler;
```

## Graceful Degradation

| Function | Description |
|----------|-------------|
| `withFallback()` | Single fallback operation |
| `tryOperations()` | Try multiple operations |
| `createCircuitBreaker()` | Circuit breaker pattern |
| `retry()` | Simple retry |
| `retryWithBackoff()` | Exponential backoff |
| `retryIf()` | Conditional retry |

## Task Management

| Function | Description |
|----------|-------------|
| `listBackgroundTasks()` | List background tasks |
| `getBackgroundTask()` | Get task by ID |
| `clearCompletedTasks()` | Clear completed tasks |
| `recoverRunningTasks()` | Recover interrupted tasks |
| `recoverFailedTasks()` | Get failed tasks for retry |
| `cleanupStaleTasks()` | Remove old tasks |
| `updateBackgroundTask()` | Update task state |

### TaskStore

```typescript
interface TaskStore {
  save(task: BackgroundTask): Promise<void>;
  load(id: string): Promise<BackgroundTask | null>;
  list(filter?: TaskFilter): Promise<BackgroundTask[]>;
  delete(id: string): Promise<void>;
}
```

## Types

### Message

```typescript
interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[];
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: URL | string }
  | { type: "file"; data: string; mimeType: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: any }
  | { type: "tool-result"; toolCallId: string; toolName: string; output: any };
```

### GenerateResult

```typescript
interface GenerateResult {
  text: string;
  messages: Message[];
  finishReason: "stop" | "length" | "tool-calls" | "error";
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}
```

### StreamPart

```typescript
type StreamPart =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: any }
  | { type: "tool-result"; toolCallId: string; toolName: string; output: any }
  | { type: "finish"; finishReason: string }
  | { type: "error"; error: Error };
```
