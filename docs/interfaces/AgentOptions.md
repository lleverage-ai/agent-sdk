[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / AgentOptions

# Interface: AgentOptions

Defined in: [packages/agent-sdk/src/types.ts:330](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L330)

Configuration options for creating an agent.

## Example

```typescript
const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  systemPrompt: "You are a helpful assistant.",
  tools: {
    weather: tool({
      description: "Get weather",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => `Weather in ${city}: sunny`,
    }),
  },
});
```

## Properties

### allowedTools?

> `optional` **allowedTools**: `string`[]

Defined in: [packages/agent-sdk/src/types.ts:614](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L614)

Restrict which tools the agent can use.

When provided, only tools whose names exactly match entries in this array
will be available to the agent. For MCP tools, use the full name format:
`mcp__<plugin>__<tool>` (e.g., `mcp__github__list_issues`).

This is useful for:
- Security: limiting agent capabilities in production
- Testing: isolating specific tool functionality
- Subagents: restricting tools to those relevant for the task

#### Example

```typescript
// Only allow read operations
const agent = createAgent({
  model,
  tools: { read, write, edit, bash },
  allowedTools: ["read", "glob", "grep"],
});

// Allow all filesystem tools but not bash
const agent = createAgent({
  model,
  tools: { read, write, edit, bash },
  allowedTools: ["read", "write", "edit", "glob", "grep"],
});
```

***

### backend?

> `optional` **backend**: [`BackendProtocol`](BackendProtocol.md) \| [`BackendFactory`](../type-aliases/BackendFactory.md)

Defined in: [packages/agent-sdk/src/types.ts:511](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L511)

Storage backend for file operations.

Can be a backend instance or a factory function that receives the agent state.
If not provided, a StateBackend is created automatically with a fresh state.

#### Example

```typescript
// Use filesystem backend for real file operations
const agent = createAgent({
  model,
  backend: new FilesystemBackend({ rootDir: process.cwd() }),
});

// Use factory to access shared state
const agent = createAgent({
  model,
  backend: (state) => new CompositeBackend(
    new StateBackend(state),
    { '/persistent/': new PersistentBackend({ store }) }
  ),
});

// Default: StateBackend with fresh state
const agent = createAgent({ model });
```

#### Default Value

```ts
StateBackend with empty state
```

***

### blockShellFileOps?

> `optional` **blockShellFileOps**: `boolean`

Defined in: [packages/agent-sdk/src/types.ts:733](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L733)

When true and permissionMode is "acceptEdits", automatically configures the
sandbox backend (if present) to block shell-based file operations.

This prevents bash commands like `echo > file`, `rm`, `mv`, `cp`, etc. from
bypassing the file edit tool permission checks in acceptEdits mode.

When set to `false` with acceptEdits mode, a warning will be logged to
alert you that shell-based file operations can bypass the permission checks.

This option only has an effect when:
- `permissionMode` is set to `"acceptEdits"`
- The `backend` is a sandbox backend (e.g., `LocalSandbox`)

#### Default Value

```ts
true
```

#### Example

```typescript
// Default: shell file ops are blocked in acceptEdits mode
const agent = createAgent({
  model,
  backend: new LocalSandbox({ cwd: process.cwd() }),
  permissionMode: "acceptEdits",
  // blockShellFileOps: true is the default
});

// Explicitly allow shell file ops (not recommended)
const agent = createAgent({
  model,
  backend: new LocalSandbox({ cwd: process.cwd() }),
  permissionMode: "acceptEdits",
  blockShellFileOps: false, // Warning will be logged
});
```

***

### canUseTool()?

> `optional` **canUseTool**: (`toolName`: `string`, `input`: `unknown`) => [`PermissionDecision`](../type-aliases/PermissionDecision.md) \| `Promise`&lt;[`PermissionDecision`](../type-aliases/PermissionDecision.md)&gt;

Defined in: [packages/agent-sdk/src/types.ts:796](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L796)

Runtime callback for tool approval decisions.

Called when a tool is not handled by hooks or permission mode.
This provides fine-grained runtime control over tool execution,
allowing you to implement custom approval logic based on tool name,
input, or external state.

The callback should return:
- `"allow"` - Allow the tool to execute
- `"deny"` - Block the tool and throw an error
- `"ask"` - Request user approval (requires approval flow integration)

Permission checking order:
1. Hooks (PreToolUse with permissionDecision) - checked first
2. Permission mode - checked second
3. canUseTool callback (this option) - checked last

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `toolName` | `string` | Name of the tool being invoked |
| `input` | `unknown` | Input arguments passed to the tool |

#### Returns

[`PermissionDecision`](../type-aliases/PermissionDecision.md) \| `Promise`&lt;[`PermissionDecision`](../type-aliases/PermissionDecision.md)&gt;

Permission decision ("allow", "deny", or "ask")

#### Examples

```typescript
const agent = createAgent({
  model,
  canUseTool: async (toolName, input) => {
    // Block bash commands entirely
    if (toolName === "bash") return "deny";

    // Require approval for file writes
    if (toolName === "write" || toolName === "edit") {
      return "ask";
    }

    // Allow everything else
    return "allow";
  },
});
```

```typescript
// Custom approval logic based on file paths
const agent = createAgent({
  model,
  canUseTool: async (toolName, input) => {
    if (toolName === "write") {
      const filePath = (input as { file_path?: string }).file_path;
      if (filePath?.startsWith("/etc/")) {
        return "deny"; // Block system directory writes
      }
      if (filePath?.endsWith(".env")) {
        return "ask"; // Require approval for sensitive files
      }
    }
    return "allow";
  },
});
```

***

### checkpointer?

> `optional` **checkpointer**: [`BaseCheckpointSaver`](BaseCheckpointSaver.md)

Defined in: [packages/agent-sdk/src/types.ts:541](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L541)

Checkpoint saver for session persistence.

When provided, the agent will automatically save checkpoints after each
generation step and restore state when a matching threadId is found.

#### Example

```typescript
import { FileSaver, createAgent } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  checkpointer: new FileSaver({ dir: "./.checkpoints" }),
});

// First interaction - creates checkpoint
await agent.generate({
  prompt: "Hello",
  threadId: "session-123",
});

// Later - restores from checkpoint
await agent.generate({
  prompt: "Continue our conversation",
  threadId: "session-123",
});
```

***

### contextManager?

> `optional` **contextManager**: [`ContextManager`](ContextManager.md)

Defined in: [packages/agent-sdk/src/types.ts:480](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L480)

Context manager for automatic message compaction and token tracking.

When provided, the agent will automatically manage conversation context
by tracking token usage and compacting old messages into summaries when
the token budget is exceeded.

#### Example

```typescript
import { createContextManager } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  contextManager: createContextManager({
    maxTokens: 100000,
    summarization: {
      tokenThreshold: 0.75, // Compact at 75% capacity
      keepMessageCount: 10, // Keep last 10 messages
    },
    onCompact: (result) => {
      console.log(`Compacted ${result.messagesBefore} messages to ${result.messagesAfter}`);
    },
  }),
});
```

***

### disabledCoreTools?

> `optional` **disabledCoreTools**: [`CoreToolName`](../type-aliases/CoreToolName.md)[]

Defined in: [packages/agent-sdk/src/types.ts:812](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L812)

Disable specific core tools.

Core tools are included by default. Use this to exclude specific
tools that should not be available to this agent.

#### Example

```typescript
const safeAgent = createAgent({
  model,
  disabledCoreTools: ["bash"], // No shell access
});
```

***

### disallowedTools?

> `optional` **disallowedTools**: `string`[]

Defined in: [packages/agent-sdk/src/types.ts:663](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L663)

Block specific tools from being used by the agent.

When provided, tools whose names exactly match entries in this array
will be removed from the available tool set. This is the opposite of
`allowedTools` and is useful for:
- Security: blocking dangerous operations (e.g., bash, rm)
- Testing: disabling specific tools without listing all others
- Production hardening: preventing access to risky tools

For MCP tools, use the full name format: `mcp__<plugin>__<tool>`
(e.g., `mcp__github__delete_repo`).

**Priority**: If a tool appears in both `allowedTools` and `disallowedTools`,
the tool is blocked (disallow takes precedence).

#### Examples

```typescript
// Block shell access and file deletion
const agent = createAgent({
  model,
  tools: { read, write, edit, bash, rm },
  disallowedTools: ["bash", "rm"],
});

// Block dangerous MCP operations
const agent = createAgent({
  model,
  plugins: [githubPlugin],
  disallowedTools: [
    "mcp__github__delete_repo",
    "mcp__github__force_push",
  ],
});
```

```typescript
// Combine with allowedTools - disallow wins
const agent = createAgent({
  model,
  allowedTools: ["read", "write", "bash"], // Allow these
  disallowedTools: ["bash"], // But block bash
  // Result: only "read" and "write" are available
});
```

***

### fallbackModel?

> `optional` **fallbackModel**: [`LanguageModel`](../type-aliases/LanguageModel.md)

Defined in: [packages/agent-sdk/src/types.ts:358](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L358)

Fallback model to use when the primary model fails.

When specified, the agent will automatically retry failed requests with the
fallback model if the primary model encounters certain errors:
- Rate limits (429 errors, "rate limit" messages)
- Timeouts ("timeout" messages)
- Model unavailable (503 errors, "unavailable" messages)

The fallback model should typically be a faster or more available alternative,
such as switching from a premium model to a standard one.

#### Example

```typescript
import { anthropic } from "@ai-sdk/anthropic";

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  fallbackModel: anthropic("claude-3-5-haiku-20241022"), // Fallback to faster model
});
```

#### Default Value

```ts
undefined
```

***

### hooks?

> `optional` **hooks**: [`HookRegistration`](HookRegistration.md)

Defined in: [packages/agent-sdk/src/types.ts:452](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L452)

Unified hook registrations with enhanced control flow.
Supports permission decisions, input/output transformation, caching, and retry.

When both `middleware` and `hooks` are provided, middleware hooks are
processed first, followed by explicit hooks.

#### Example

```typescript
const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [cacheCheckHook],
    PostGenerate: [cacheStoreHook, auditLogHook],
    PreToolUse: [{ matcher: 'Write|Edit', hooks: [protectFilesHook] }],
  },
});
```

***

### maxSteps?

> `optional` **maxSteps**: `number`

Defined in: [packages/agent-sdk/src/types.ts:370](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L370)

Maximum number of tool call steps allowed per generation.

#### Default Value

```ts
10
```

***

### middleware?

> `optional` **middleware**: [`AgentMiddleware`](AgentMiddleware.md)[]

Defined in: [packages/agent-sdk/src/types.ts:431](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L431)

Middleware to apply to the agent.

Middleware provides a clean API for adding cross-cutting concerns like
logging, metrics, caching, and rate limiting. Middleware are processed
in order and register hooks via a context object.

This is the recommended way to add observability and cross-cutting
concerns. For fine-grained hook control, use the `hooks` option instead.

#### Examples

```typescript
import { createLoggingMiddleware, createConsoleTransport } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  middleware: [
    createLoggingMiddleware({ transport: createConsoleTransport() }),
  ],
});
```

```typescript
// Multiple middleware
const agent = createAgent({
  model,
  middleware: [
    createLoggingMiddleware({ transport: consoleTransport }),
    createMetricsMiddleware({ registry }),
  ],
});
```

***

### model

> **model**: [`LanguageModel`](../type-aliases/LanguageModel.md)

Defined in: [packages/agent-sdk/src/types.ts:332](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L332)

The AI model to use for generation

***

### permissionMode?

> `optional` **permissionMode**: [`PermissionMode`](../type-aliases/PermissionMode.md)

Defined in: [packages/agent-sdk/src/types.ts:696](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L696)

Permission mode controlling default tool approval behavior.

Aligned with Claude Agent SDK permission modes:
- `default`: Unmatched tools use canUseTool callback or hooks (default behavior)
- `acceptEdits`: Auto-approve file edit operations (Write, Edit, mkdir, touch, rm, mv, cp)
- `bypassPermissions`: Auto-approve all tools (dangerous - use only for testing/demos)
- `plan`: Block all tool execution (planning/analysis only, no actions)

Permission checking order:
1. Hooks (PreToolUse with permissionDecision)
2. Permission mode
3. canUseTool callback (if provided)

#### Default Value

```ts
"default"
```

#### Example

```typescript
// Auto-approve file edits for smoother development experience
const agent = createAgent({
  model,
  permissionMode: "acceptEdits",
});

// Plan mode for analysis without actions
const planner = createAgent({
  model,
  permissionMode: "plan",
});
```

***

### pluginLoading?

> `optional` **pluginLoading**: [`PluginLoadingMode`](../type-aliases/PluginLoadingMode.md)

Defined in: [packages/agent-sdk/src/types.ts:565](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L565)

Plugin loading mode for tool registration.

Controls how plugin tools are made available to the agent:
- `"eager"` - Load all plugin tools immediately (current behavior)
- `"lazy"` - Register tools with metadata only, load on-demand via use_tools
- `"explicit"` - Don't register plugin tools, require manual registration

When using "lazy" mode, the agent gets a `use_tools` tool that allows
it to search and load tools on-demand, keeping initial context small.

#### Default Value

```ts
"eager"
```

#### Example

```typescript
const agent = createAgent({
  model,
  plugins: [stripePlugin, twilioPlugin, ...manyPlugins],
  pluginLoading: "lazy", // Tools loaded on-demand
});
```

***

### plugins?

> `optional` **plugins**: [`AgentPlugin`](AgentPlugin.md)[]

Defined in: [packages/agent-sdk/src/types.ts:392](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L392)

Plugins to load into the agent

***

### preloadPlugins?

> `optional` **preloadPlugins**: `string`[]

Defined in: [packages/agent-sdk/src/types.ts:583](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L583)

Plugins to preload when using lazy loading mode.

These plugins will have their tools loaded immediately regardless
of the pluginLoading setting.

#### Example

```typescript
const agent = createAgent({
  model,
  plugins: [stripePlugin, twilioPlugin, coreUtilsPlugin],
  pluginLoading: "lazy",
  preloadPlugins: ["core-utils"], // Always load core-utils
});
```

***

### skills?

> `optional` **skills**: [`SkillDefinition`](SkillDefinition.md)[]

Defined in: [packages/agent-sdk/src/types.ts:395](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L395)

Skills providing contextual instructions for the agent

***

### subagents?

> `optional` **subagents**: [`SubagentDefinition`](SubagentDefinition.md)[]

Defined in: [packages/agent-sdk/src/types.ts:874](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L874)

Subagent definitions for task delegation.

When provided, a `task` tool is automatically created that allows
the agent to delegate work to specialized subagents.

For subagents with `streaming: true`, the task tool will pass
the streaming context, allowing them to write directly to the
parent's data stream. This requires using `streamDataResponse()`.

#### Example

```typescript
const agent = createAgent({
  model,
  subagents: [
    {
      type: "researcher",
      description: "Searches for information",
      create: (ctx) => createSubagent(agent, { model: ctx.model, ... }),
    },
    {
      type: "ui-builder",
      description: "Generates UI components",
      streaming: true, // Can write to parent's stream
      create: (ctx) => createSubagent(agent, { model: ctx.model, ... }),
    },
  ],
});

// Use streamDataResponse for streaming subagents
return agent.streamDataResponse({ messages });
```

***

### systemPrompt?

> `optional` **systemPrompt**: `string`

Defined in: [packages/agent-sdk/src/types.ts:364](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L364)

System prompt that defines the agent's behavior and personality.

#### Default Value

```ts
undefined
```

***

### tools?

> `optional` **tools**: [`ToolSet`](../type-aliases/ToolSet.md)

Defined in: [packages/agent-sdk/src/types.ts:389](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L389)

Tools available to the agent.
Use AI SDK's `tool()` function to define tools.

#### Example

```typescript
import { tool } from "ai";

tools: {
  myTool: tool({
    description: "Does something",
    inputSchema: z.object({ input: z.string() }),
    execute: async ({ input }) => `Result: ${input}`,
  }),
}
```

***

### toolSearch?

> `optional` **toolSearch**: \{ `enabled?`: `"auto"` \| `"always"` \| `"never"`; `maxResults?`: `number`; `threshold?`: `number`; \}

Defined in: [packages/agent-sdk/src/types.ts:817](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L817)

Tool search configuration for progressive disclosure.

#### enabled?

> `optional` **enabled**: `"auto"` \| `"always"` \| `"never"`

When to enable tool search.
- `"auto"` - Enable when tools exceed threshold
- `"always"` - Always enable
- `"never"` - Never enable

##### Default Value

```ts
"auto"
```

#### maxResults?

> `optional` **maxResults**: `number`

Maximum results from search.

##### Default Value

```ts
10
```

#### threshold?

> `optional` **threshold**: `number`

Tool count threshold for auto mode.
Deferred loading activates when plugin tool count exceeds this value.

##### Default Value

```ts
20
```
