/**
 * Core type definitions for the agent SDK.
 *
 * This module re-exports AI SDK types where possible and defines
 * agent-specific extensions for features like subagents, skills, and hooks.
 *
 * @packageDocumentation
 */

import type {
  LanguageModel,
  LanguageModelUsage,
  ModelMessage,
  Output,
  streamText,
  Tool,
  ToolExecutionOptions,
  ToolSet,
  UIDataTypes,
  UIMessage,
  UIMessageStreamWriter,
} from "ai";

import type { BackendProtocol } from "./backend.js";
import type { AgentState } from "./backends/state.js";
import type { BaseCheckpointSaver, Interrupt } from "./checkpointer/types.js";

// =============================================================================
// Re-export AI SDK Types
// =============================================================================

/**
 * Re-export AI SDK message and tool types for convenience.
 * Users can import these directly from this package instead of 'ai'.
 */
export type {
  ModelMessage,
  LanguageModel,
  LanguageModelUsage,
  Tool,
  ToolExecutionOptions,
  ToolSet,
  UIMessage,
};

// =============================================================================
// Tool Interrupt Types
// =============================================================================

/**
 * Function that tools can call to request an interrupt and wait for a response.
 *
 * When called, this function will either:
 * - Return immediately with the response (if resuming from a previous interrupt)
 * - Throw an InterruptSignal to pause execution (if first time)
 *
 * @example
 * ```typescript
 * const askUserTool = tool({
 *   description: "Ask the user a question",
 *   parameters: z.object({ question: z.string() }),
 *   execute: async ({ question }, options) => {
 *     // Get the interrupt function from extended options
 *     const { interrupt } = options as ExtendedToolExecutionOptions;
 *
 *     // Request interrupt - will either return response or throw
 *     const { answer } = await interrupt<
 *       { question: string },
 *       { answer: string }
 *     >({ question });
 *
 *     return { userSaid: answer };
 *   },
 * });
 * ```
 *
 * @category Types
 */
/**
 * Request an interrupt and wait for a response.
 *
 * @param request - Data to include in the interrupt (sent to the client)
 * @param options - Optional configuration for the interrupt
 * @returns Promise that resolves with the response when resumed
 */
export type InterruptFunction = <TRequest = unknown, TResponse = unknown>(
  request: TRequest,
  options?: {
    /** Custom interrupt type (default: "custom") */
    type?: string;
  },
) => Promise<TResponse>;

/**
 * Extended tool execution options that include interrupt capability.
 *
 * This extends the AI SDK's ToolExecutionOptions to add the `interrupt`
 * function for requesting user input during tool execution.
 *
 * @example
 * ```typescript
 * execute: async (input, options) => {
 *   const { interrupt } = options as ExtendedToolExecutionOptions;
 *
 *   if (needsConfirmation) {
 *     const { confirmed } = await interrupt<
 *       { message: string },
 *       { confirmed: boolean }
 *     >({ message: "Are you sure?" });
 *
 *     if (!confirmed) {
 *       return { cancelled: true };
 *     }
 *   }
 *
 *   return performAction(input);
 * }
 * ```
 *
 * @category Types
 */
export interface ExtendedToolExecutionOptions extends ToolExecutionOptions {
  /**
   * Function to request an interrupt during tool execution.
   * Available when the agent has a checkpointer configured.
   */
  interrupt: InterruptFunction;

  /**
   * Task manager for background task tracking.
   * Available when running within an agent context.
   * Used by bash tool for run_in_background support.
   */
  taskManager?: import("./task-manager.js").TaskManager;
}

// =============================================================================
// Streaming Types
// =============================================================================

/**
 * Metadata identifying the source of streamed data.
 *
 * Used to identify which agent or subagent produced data in multi-agent
 * streaming scenarios, similar to LangGraph's namespace pattern.
 *
 * @category Types
 */
export interface StreamingMetadata {
  /** The type of agent (e.g., "ui-builder", "researcher") */
  agentType: string;
  /** Unique identifier for this agent instance */
  agentId: string;
  /** Parent agent ID if this is a subagent */
  parentAgentId?: string;
}

/**
 * Context for streaming data from tools to the client.
 *
 * This is passed to streaming-aware tools created via function-based plugin tools.
 * Tools can use `writer.write()` to send custom data parts to the client
 * incrementally during execution.
 *
 * @example
 * ```typescript
 * const plugin = definePlugin({
 *   name: "my-plugin",
 *   tools: (ctx) => ({
 *     myTool: tool({
 *       description: "Streams data",
 *       inputSchema: z.object({ data: z.string() }),
 *       execute: async ({ data }) => {
 *         if (ctx.writer) {
 *           // Write custom data parts to the stream
 *           ctx.writer.write({
 *             type: "data",
 *             data: { progress: 50 },
 *           });
 *         }
 *         return { success: true };
 *       },
 *     }),
 *   }),
 * });
 * ```
 *
 * @category Types
 */
export interface StreamingContext {
  /**
   * UI Message stream writer for sending custom data to client.
   * Only available when using `streamDataResponse()`.
   * Will be `null` when using `generate()` or regular `streamResponse()`.
   */
  writer: UIMessageStreamWriter | null;

  /**
   * Metadata identifying the source of streamed data.
   * Automatically included when streaming from subagents.
   */
  metadata?: StreamingMetadata;
}

/**
 * Factory function for creating streaming-aware tools.
 *
 * This allows plugins to create tools that can access the streaming context
 * and send incremental data to the client via `ctx.writer`.
 *
 * @example
 * ```typescript
 * const streamingTools: StreamingToolsFactory = (ctx) => ({
 *   renderUI: tool({
 *     description: "Renders UI with streaming updates",
 *     inputSchema: z.object({ tree: UITreeSchema }),
 *     execute: async ({ tree }) => {
 *       if (ctx.writer) {
 *         ctx.writer.write({ type: "data", value: { type: "ui-patch", op: "set", path: "/root", value: tree.root } });
 *       }
 *       return { success: true };
 *     },
 *   }),
 * });
 * ```
 *
 * @category Types
 */
export type StreamingToolsFactory = (ctx: StreamingContext) => ToolSet;

// =============================================================================
// Backend Types
// =============================================================================

/**
 * Factory function for creating backends lazily.
 *
 * Backends can be provided as an instance or as a factory function.
 * Factory functions receive the agent state and return a backend instance,
 * allowing backends to be initialized with the shared state.
 *
 * @example
 * ```typescript
 * // Direct instance
 * const agent = createAgent({
 *   model,
 *   backend: new FilesystemBackend({ rootDir: process.cwd() }),
 * });
 *
 * // Factory function (receives shared state)
 * const agent = createAgent({
 *   model,
 *   backend: (state) => new StateBackend(state),
 * });
 * ```
 *
 * @category Backend
 */
export type BackendFactory = (state: AgentState) => BackendProtocol;

// =============================================================================
// Agent-Specific Data Types for Streaming
// =============================================================================

/**
 * Custom data types for agent-specific streaming events.
 * These extend AI SDK's UIDataTypes to add subagent, progress, and other events.
 *
 * @category Types
 */
export interface AgentDataTypes extends UIDataTypes {
  /** Emitted when a subagent is spawned */
  "subagent-spawn": {
    agentId: string;
    type: string;
    prompt: string;
    parentToolUseId: string;
  };
  /** Emitted when a subagent completes */
  "subagent-complete": {
    agentId: string;
    summary: string;
    duration: number;
  };
  /** Progress updates during agent execution */
  "agent-progress": {
    message: string;
    percent?: number;
  };
  /** Emitted when context compaction occurs */
  "context-compaction": {
    tokensBefore: number;
    tokensAfter: number;
    summary: string;
  };
  /** Emitted when a skill is loaded */
  "skill-loaded": {
    skillName: string;
    prompt: string;
  };
}

/**
 * Agent-specific UIMessage type with custom data types.
 *
 * @category Types
 */
export type AgentUIMessage = UIMessage<AgentDataTypes>;

// =============================================================================
// Agent Configuration
// =============================================================================

/**
 * Configuration options for creating an agent.
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   systemPrompt: "You are a helpful assistant.",
 *   tools: {
 *     weather: tool({
 *       description: "Get weather",
 *       inputSchema: z.object({ city: z.string() }),
 *       execute: async ({ city }) => `Weather in ${city}: sunny`,
 *     }),
 *   },
 * });
 * ```
 *
 * @category Agent
 */
export interface AgentOptions {
  /** The AI model to use for generation */
  model: LanguageModel;

  /**
   * Fallback model to use when the primary model fails.
   *
   * When specified, the agent will automatically retry failed requests with the
   * fallback model if the primary model encounters certain errors:
   * - Rate limits (429 errors, "rate limit" messages)
   * - Timeouts ("timeout" messages)
   * - Model unavailable (503 errors, "unavailable" messages)
   *
   * The fallback model should typically be a faster or more available alternative,
   * such as switching from a premium model to a standard one.
   *
   * @example
   * ```typescript
   * import { anthropic } from "@ai-sdk/anthropic";
   *
   * const agent = createAgent({
   *   model: anthropic("claude-sonnet-4-20250514"),
   *   fallbackModel: anthropic("claude-3-5-haiku-20241022"), // Fallback to faster model
   * });
   * ```
   *
   * @defaultValue undefined
   */
  fallbackModel?: LanguageModel;

  /**
   * System prompt that defines the agent's behavior and personality.
   *
   * Mutually exclusive with {@link promptBuilder}. If neither is provided,
   * the agent will use the default prompt builder.
   *
   * @example
   * ```typescript
   * const agent = createAgent({
   *   model,
   *   systemPrompt: "You are a helpful coding assistant.",
   * });
   * ```
   *
   * @defaultValue undefined
   */
  systemPrompt?: string;

  /**
   * Prompt builder for creating dynamic, context-aware system prompts.
   *
   * Mutually exclusive with {@link systemPrompt}. If neither is provided,
   * the agent will use the default prompt builder.
   *
   * The prompt builder allows you to construct prompts from composable components
   * that have access to the full agent context (tools, skills, backend, etc.).
   *
   * @example Using default builder
   * ```typescript
   * const agent = createAgent({
   *   model,
   *   // No systemPrompt or promptBuilder = uses default builder
   * });
   * ```
   *
   * @example Customizing default builder
   * ```typescript
   * import { createDefaultPromptBuilder } from "@lleverage-ai/agent-sdk";
   *
   * const builder = createDefaultPromptBuilder()
   *   .register({
   *     name: 'custom-instructions',
   *     priority: 90,
   *     render: (ctx) => `You are an expert in ${ctx.backend?.type} operations.`,
   *   });
   *
   * const agent = createAgent({
   *   model,
   *   promptBuilder: builder,
   * });
   * ```
   *
   * @example Building from scratch
   * ```typescript
   * import { PromptBuilder } from "@lleverage-ai/agent-sdk";
   *
   * const builder = new PromptBuilder().registerMany([
   *   {
   *     name: 'identity',
   *     priority: 100,
   *     render: () => 'You are a code review assistant.',
   *   },
   *   {
   *     name: 'tools',
   *     priority: 80,
   *     condition: (ctx) => ctx.tools && ctx.tools.length > 0,
   *     render: (ctx) => `Available tools: ${ctx.tools!.map(t => t.name).join(', ')}`,
   *   },
   * ]);
   *
   * const agent = createAgent({
   *   model,
   *   promptBuilder: builder,
   * });
   * ```
   *
   * @see {@link PromptBuilder}
   * @see {@link createDefaultPromptBuilder}
   * @defaultValue undefined (uses default builder)
   */
  promptBuilder?: import("./prompt-builder/index.js").PromptBuilder;

  /**
   * Maximum number of tool call steps allowed per generation.
   * @defaultValue 10
   */
  maxSteps?: number;

  /**
   * Tools available to the agent.
   * Use AI SDK's `tool()` function to define tools.
   *
   * @example
   * ```typescript
   * import { tool } from "ai";
   *
   * tools: {
   *   myTool: tool({
   *     description: "Does something",
   *     inputSchema: z.object({ input: z.string() }),
   *     execute: async ({ input }) => `Result: ${input}`,
   *   }),
   * }
   * ```
   */
  tools?: ToolSet;

  /** Plugins to load into the agent */
  plugins?: AgentPlugin[];

  /**
   * Skills providing contextual instructions for the agent.
   *
   * Skills can be:
   * - **Programmatic**: TypeScript objects created with {@link defineSkill}
   * - **File-based**: Loaded from SKILL.md directories via {@link loadSkillsFromDirectories}
   *
   * All skills follow the Agent Skills specification and support progressive disclosure.
   * When skills are provided, the agent automatically creates a skill registry and
   * load_skill tool, enabling on-demand skill loading.
   *
   * @example Programmatic skills
   * ```typescript
   * import { defineSkill } from "@lleverage-ai/agent-sdk";
   *
   * const agent = createAgent({
   *   model,
   *   skills: [
   *     defineSkill({
   *       name: "guidelines",
   *       description: "Project coding standards",
   *       instructions: "Follow TypeScript strict mode.",
   *       license: "MIT",
   *     }),
   *   ],
   * });
   * ```
   *
   * @example File-based skills (Agent Skills spec)
   * ```typescript
   * import { loadSkillsFromDirectories } from "@lleverage-ai/agent-sdk";
   *
   * // Load from SKILL.md files
   * const { skills } = await loadSkillsFromDirectories(["/path/to/skills"]);
   *
   * // Agent auto-creates registry and tool
   * const agent = createAgent({ model, skills });
   * ```
   */
  skills?: import("./tools/skills.js").SkillDefinition[];

  /**
   * Middleware to apply to the agent.
   *
   * Middleware provides a clean API for adding cross-cutting concerns like
   * logging, metrics, caching, and rate limiting. Middleware are processed
   * in order and register hooks via a context object.
   *
   * This is the recommended way to add observability and cross-cutting
   * concerns. For fine-grained hook control, use the `hooks` option instead.
   *
   * @example
   * ```typescript
   * import { createLoggingMiddleware, createConsoleTransport } from "@lleverage-ai/agent-sdk";
   *
   * const agent = createAgent({
   *   model,
   *   middleware: [
   *     createLoggingMiddleware({ transport: createConsoleTransport() }),
   *   ],
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Multiple middleware
   * const agent = createAgent({
   *   model,
   *   middleware: [
   *     createLoggingMiddleware({ transport: consoleTransport }),
   *     createMetricsMiddleware({ registry }),
   *   ],
   * });
   * ```
   */
  middleware?: import("./middleware/types.js").AgentMiddleware[];

  /**
   * Unified hook registrations with enhanced control flow.
   * Supports permission decisions, input/output transformation, caching, and retry.
   *
   * When both `middleware` and `hooks` are provided, middleware hooks are
   * processed first, followed by explicit hooks.
   *
   * @example
   * ```typescript
   * const agent = createAgent({
   *   model,
   *   hooks: {
   *     PreGenerate: [cacheCheckHook],
   *     PostGenerate: [cacheStoreHook, auditLogHook],
   *     PreToolUse: [{ matcher: 'Write|Edit', hooks: [protectFilesHook] }],
   *   },
   * });
   * ```
   */
  hooks?: HookRegistration;

  /**
   * Context manager for automatic message compaction and token tracking.
   *
   * When provided, the agent will automatically manage conversation context
   * by tracking token usage and compacting old messages into summaries when
   * the token budget is exceeded.
   *
   * @example
   * ```typescript
   * import { createContextManager } from "@lleverage-ai/agent-sdk";
   *
   * const agent = createAgent({
   *   model,
   *   contextManager: createContextManager({
   *     maxTokens: 100000,
   *     summarization: {
   *       tokenThreshold: 0.75, // Compact at 75% capacity
   *       keepMessageCount: 10, // Keep last 10 messages
   *     },
   *     onCompact: (result) => {
   *       console.log(`Compacted ${result.messagesBefore} messages to ${result.messagesAfter}`);
   *     },
   *   }),
   * });
   * ```
   */
  contextManager?: import("./context-manager.js").ContextManager;

  /**
   * Storage backend for file operations.
   *
   * Can be a backend instance or a factory function that receives the agent state.
   * If not provided, a StateBackend is created automatically with a fresh state.
   *
   * @example
   * ```typescript
   * // Use filesystem backend for real file operations
   * const agent = createAgent({
   *   model,
   *   backend: new FilesystemBackend({ rootDir: process.cwd() }),
   * });
   *
   * // Use factory to access shared state
   * const agent = createAgent({
   *   model,
   *   backend: (state) => new CompositeBackend(
   *     new StateBackend(state),
   *     { '/persistent/': new PersistentBackend({ store }) }
   *   ),
   * });
   *
   * // Default: StateBackend with fresh state
   * const agent = createAgent({ model });
   * ```
   *
   * @defaultValue StateBackend with empty state
   */
  backend?: BackendProtocol | BackendFactory;

  /**
   * Checkpoint saver for session persistence.
   *
   * When provided, the agent will automatically save checkpoints after each
   * generation step and restore state when a matching threadId is found.
   *
   * @example
   * ```typescript
   * import { FileSaver, createAgent } from "@lleverage-ai/agent-sdk";
   *
   * const agent = createAgent({
   *   model,
   *   checkpointer: new FileSaver({ dir: "./.checkpoints" }),
   * });
   *
   * // First interaction - creates checkpoint
   * await agent.generate({
   *   prompt: "Hello",
   *   threadId: "session-123",
   * });
   *
   * // Later - restores from checkpoint
   * await agent.generate({
   *   prompt: "Continue our conversation",
   *   threadId: "session-123",
   * });
   * ```
   */
  checkpointer?: BaseCheckpointSaver;

  /**
   * Plugin loading mode for tool registration.
   *
   * Controls how plugin tools are made available to the agent:
   * - `"eager"` - Load all plugin tools immediately (current behavior)
   * - `"lazy"` - Register tools with metadata only, load on-demand via use_tools
   * - `"explicit"` - Don't register plugin tools, require manual registration
   *
   * When using "lazy" mode, the agent gets a `use_tools` tool that allows
   * it to search and load tools on-demand, keeping initial context small.
   *
   * @defaultValue "eager"
   *
   * @example
   * ```typescript
   * const agent = createAgent({
   *   model,
   *   plugins: [stripePlugin, twilioPlugin, ...manyPlugins],
   *   pluginLoading: "lazy", // Tools loaded on-demand
   * });
   * ```
   */
  pluginLoading?: PluginLoadingMode;

  /**
   * Plugins to preload when using lazy loading mode.
   *
   * These plugins will have their tools loaded immediately regardless
   * of the pluginLoading setting.
   *
   * @example
   * ```typescript
   * const agent = createAgent({
   *   model,
   *   plugins: [stripePlugin, twilioPlugin, coreUtilsPlugin],
   *   pluginLoading: "lazy",
   *   preloadPlugins: ["core-utils"], // Always load core-utils
   * });
   * ```
   */
  preloadPlugins?: string[];

  /**
   * Restrict which tools the agent can use.
   *
   * When provided, only tools whose names exactly match entries in this array
   * will be available to the agent. For MCP tools, use the full name format:
   * `mcp__<plugin>__<tool>` (e.g., `mcp__github__list_issues`).
   *
   * This is useful for:
   * - Security: limiting agent capabilities in production
   * - Testing: isolating specific tool functionality
   * - Subagents: restricting tools to those relevant for the task
   *
   * @example
   * ```typescript
   * // Only allow read operations
   * const agent = createAgent({
   *   model,
   *   tools: { read, write, edit, bash },
   *   allowedTools: ["read", "glob", "grep"],
   * });
   *
   * // Allow all filesystem tools but not bash
   * const agent = createAgent({
   *   model,
   *   tools: { read, write, edit, bash },
   *   allowedTools: ["read", "write", "edit", "glob", "grep"],
   * });
   * ```
   */
  allowedTools?: string[];

  /**
   * Block specific tools from being used by the agent.
   *
   * When provided, tools whose names exactly match entries in this array
   * will be removed from the available tool set. This is the opposite of
   * `allowedTools` and is useful for:
   * - Security: blocking dangerous operations (e.g., bash, rm)
   * - Testing: disabling specific tools without listing all others
   * - Production hardening: preventing access to risky tools
   *
   * For MCP tools, use the full name format: `mcp__<plugin>__<tool>`
   * (e.g., `mcp__github__delete_repo`).
   *
   * **Priority**: If a tool appears in both `allowedTools` and `disallowedTools`,
   * the tool is blocked (disallow takes precedence).
   *
   * @example
   * ```typescript
   * // Block shell access and file deletion
   * const agent = createAgent({
   *   model,
   *   tools: { read, write, edit, bash, rm },
   *   disallowedTools: ["bash", "rm"],
   * });
   *
   * // Block dangerous MCP operations
   * const agent = createAgent({
   *   model,
   *   plugins: [githubPlugin],
   *   disallowedTools: [
   *     "mcp__github__delete_repo",
   *     "mcp__github__force_push",
   *   ],
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Combine with allowedTools - disallow wins
   * const agent = createAgent({
   *   model,
   *   allowedTools: ["read", "write", "bash"], // Allow these
   *   disallowedTools: ["bash"], // But block bash
   *   // Result: only "read" and "write" are available
   * });
   * ```
   */
  disallowedTools?: string[];

  /**
   * Permission mode controlling default tool approval behavior.
   *
   * Aligned with Claude Agent SDK permission modes:
   * - `default`: Unmatched tools use canUseTool callback or hooks (default behavior)
   * - `acceptEdits`: Auto-approve file edit operations (Write, Edit, mkdir, touch, rm, mv, cp)
   * - `bypassPermissions`: Auto-approve all tools (dangerous - use only for testing/demos)
   * - `plan`: Block all tool execution (planning/analysis only, no actions)
   *
   * Permission checking order:
   * 1. Hooks (PreToolUse with permissionDecision)
   * 2. Permission mode
   * 3. canUseTool callback (if provided)
   *
   * @defaultValue "default"
   *
   * @example
   * ```typescript
   * // Auto-approve file edits for smoother development experience
   * const agent = createAgent({
   *   model,
   *   permissionMode: "acceptEdits",
   * });
   *
   * // Plan mode for analysis without actions
   * const planner = createAgent({
   *   model,
   *   permissionMode: "plan",
   * });
   * ```
   */
  permissionMode?: PermissionMode;

  /**
   * When true and permissionMode is "acceptEdits", automatically configures the
   * sandbox backend (if present) to block shell-based file operations.
   *
   * This prevents bash commands like `echo > file`, `rm`, `mv`, `cp`, etc. from
   * bypassing the file edit tool permission checks in acceptEdits mode.
   *
   * When set to `false` with acceptEdits mode, a warning will be logged to
   * alert you that shell-based file operations can bypass the permission checks.
   *
   * This option only has an effect when:
   * - `permissionMode` is set to `"acceptEdits"`
   * - The `backend` has execute capability (e.g., `FilesystemBackend` with `enableBash: true`)
   *
   * @defaultValue true
   *
   * @example
   * ```typescript
   * // Default: shell file ops are blocked in acceptEdits mode
   * const agent = createAgent({
   *   model,
   *   backend: new FilesystemBackend({ rootDir: process.cwd(), enableBash: true }),
   *   permissionMode: "acceptEdits",
   *   // blockShellFileOps: true is the default
   * });
   *
   * // Explicitly allow shell file ops (not recommended)
   * const agent = createAgent({
   *   model,
   *   backend: new FilesystemBackend({ rootDir: process.cwd(), enableBash: true }),
   *   permissionMode: "acceptEdits",
   *   blockShellFileOps: false, // Warning will be logged
   * });
   * ```
   */
  blockShellFileOps?: boolean;

  /**
   * Runtime callback for tool approval decisions.
   *
   * Called when a tool is not handled by hooks or permission mode.
   * This provides fine-grained runtime control over tool execution,
   * allowing you to implement custom approval logic based on tool name,
   * input, or external state.
   *
   * The callback should return:
   * - `"allow"` - Allow the tool to execute
   * - `"deny"` - Block the tool and throw an error
   * - `"ask"` - Request user approval (requires approval flow integration)
   *
   * Permission checking order:
   * 1. Hooks (PreToolUse with permissionDecision) - checked first
   * 2. Permission mode - checked second
   * 3. canUseTool callback (this option) - checked last
   *
   * @param toolName - Name of the tool being invoked
   * @param input - Input arguments passed to the tool
   * @returns Permission decision ("allow", "deny", or "ask")
   *
   * @example
   * ```typescript
   * const agent = createAgent({
   *   model,
   *   canUseTool: async (toolName, input) => {
   *     // Block bash commands entirely
   *     if (toolName === "bash") return "deny";
   *
   *     // Require approval for file writes
   *     if (toolName === "write" || toolName === "edit") {
   *       return "ask";
   *     }
   *
   *     // Allow everything else
   *     return "allow";
   *   },
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Custom approval logic based on file paths
   * const agent = createAgent({
   *   model,
   *   canUseTool: async (toolName, input) => {
   *     if (toolName === "write") {
   *       const filePath = (input as { file_path?: string }).file_path;
   *       if (filePath?.startsWith("/etc/")) {
   *         return "deny"; // Block system directory writes
   *       }
   *       if (filePath?.endsWith(".env")) {
   *         return "ask"; // Require approval for sensitive files
   *       }
   *     }
   *     return "allow";
   *   },
   * });
   * ```
   */
  canUseTool?: (
    toolName: string,
    input: unknown,
  ) => Promise<PermissionDecision> | PermissionDecision;

  /**
   * Disable specific core tools.
   *
   * Core tools are included by default. Use this to exclude specific
   * tools that should not be available to this agent.
   *
   * @example
   * ```typescript
   * const safeAgent = createAgent({
   *   model,
   *   disabledCoreTools: ["bash"], // No shell access
   * });
   * ```
   */
  disabledCoreTools?: CoreToolName[];

  /**
   * Tool search configuration for progressive disclosure.
   */
  toolSearch?: {
    /**
     * When to enable tool search.
     * - `"auto"` - Enable when tools exceed threshold
     * - `"always"` - Always enable
     * - `"never"` - Never enable
     * @defaultValue "auto"
     */
    enabled?: "auto" | "always" | "never";

    /**
     * Tool count threshold for auto mode.
     * Deferred loading activates when plugin tool count exceeds this value.
     * @defaultValue 20
     */
    threshold?: number;

    /**
     * Maximum results from search.
     * @defaultValue 10
     */
    maxResults?: number;
  };

  /**
   * Whether agent methods should wait for background tasks to complete
   * and automatically trigger follow-up generations with their results.
   *
   * When true (default), generate(), stream(), streamResponse(), and
   * streamDataResponse() won't return until all background tasks have
   * completed and been processed — including tasks spawned by follow-up
   * generations.
   *
   * Set to false for fire-and-forget behavior.
   *
   * @defaultValue true
   */
  waitForBackgroundTasks?: boolean;

  /**
   * Custom formatter for task completion follow-up prompts.
   *
   * @param task - The completed background task
   * @returns The prompt string to send as a follow-up generation
   */
  formatTaskCompletion?: (task: import("./task-store/types.js").BackgroundTask) => string;

  /**
   * Custom formatter for task failure follow-up prompts.
   *
   * @param task - The failed background task
   * @returns The prompt string to send as a follow-up generation
   */
  formatTaskFailure?: (task: import("./task-store/types.js").BackgroundTask) => string;

  /**
   * Subagent definitions for task delegation.
   *
   * When provided, a `task` tool is automatically created that allows
   * the agent to delegate work to specialized subagents.
   *
   * For subagents with `streaming: true`, the task tool will pass
   * the streaming context, allowing them to write directly to the
   * parent's data stream. This requires using `streamDataResponse()`.
   *
   * @example
   * ```typescript
   * const agent = createAgent({
   *   model,
   *   subagents: [
   *     {
   *       type: "researcher",
   *       description: "Searches for information",
   *       create: (ctx) => createSubagent(agent, { model: ctx.model, ... }),
   *     },
   *     {
   *       type: "ui-builder",
   *       description: "Generates UI components",
   *       streaming: true, // Can write to parent's stream
   *       create: (ctx) => createSubagent(agent, { model: ctx.model, ... }),
   *     },
   *   ],
   * });
   *
   * // Use streamDataResponse for streaming subagents
   * return agent.streamDataResponse({ messages });
   * ```
   */
  subagents?: SubagentDefinition[];

  /**
   * Custom delegation instructions to include in the system prompt when subagents exist.
   *
   * When provided, overrides the default delegation guidance. Set to empty string to disable.
   */
  delegationInstructions?: string;
}

/**
 * Plugin loading mode.
 *
 * - `"eager"` - Load all plugin tools immediately into context
 * - `"lazy"` - Register tools with metadata only, load on-demand
 * - `"explicit"` - Don't auto-register, require manual registration
 *
 * @category Plugins
 */
export type PluginLoadingMode = "eager" | "lazy" | "explicit" | "proxy";

/**
 * An agent instance capable of generating responses and executing tools.
 *
 * @example
 * ```typescript
 * const agent = createAgent({ model, systemPrompt: "..." });
 *
 * // Generate a response
 * const result = await agent.generate({ prompt: "Hello" });
 *
 * // Stream for use with useChat
 * const response = await agent.streamResponse({ prompt: "Hello" });
 * ```
 *
 * @category Agent
 */
export interface Agent {
  /** Unique identifier for this agent instance */
  readonly id: string;

  /** The options used to create this agent */
  readonly options: AgentOptions;

  /**
   * The storage backend used by this agent.
   *
   * Provides access to the underlying file operations backend,
   * useful for passing to tools or performing file operations.
   */
  readonly backend: BackendProtocol;

  /**
   * The agent state managed by this agent.
   *
   * Contains todos and virtual filesystem data when using StateBackend.
   * The state is shared with the backend if a factory function was used.
   */
  readonly state: AgentState;

  /**
   * Promise that resolves when the agent is fully initialized.
   *
   * This includes:
   * - MCP server connections for plugins with mcpServer config
   * - Plugin setup functions
   *
   * Await this before using the agent if you need MCP tools to be available.
   *
   * @example
   * ```typescript
   * const agent = createAgent({ model, plugins: [mcpPlugin] });
   * await agent.ready; // Wait for MCP connections
   * return agent.streamResponse({ messages });
   * ```
   */
  readonly ready: Promise<void>;

  /**
   * Generate a complete response.
   *
   * @param options - Generation options including the prompt
   * @returns The complete generation result
   */
  generate(options: GenerateOptions): Promise<GenerateResult>;

  /**
   * Generate a streaming response as an AsyncGenerator.
   * For internal use or custom stream handling.
   *
   * @param options - Generation options including the prompt
   * @yields Stream parts as they're generated
   */
  stream(options: GenerateOptions): AsyncGenerator<StreamPart>;

  /**
   * Generate a streaming Response for use with useChat/AI SDK UI.
   * Returns a web-standard Response with proper stream protocol.
   *
   * @param options - Generation options including the prompt
   * @returns A web Response that can be returned from API routes
   *
   * @example
   * ```typescript
   * // In a Next.js API route
   * export async function POST(req: Request) {
   *   const { messages } = await req.json();
   *   return agent.streamResponse({ messages });
   * }
   * ```
   */
  streamResponse(options: GenerateOptions): Promise<Response>;

  /**
   * Get the underlying streamText result for advanced use cases.
   * Allows calling toUIMessageStream(), toTextStreamResponse(), etc.
   *
   * @param options - Generation options
   * @returns Promise of the raw streamText result from AI SDK
   */
  streamRaw(options: GenerateOptions): Promise<ReturnType<typeof streamText>>;

  /**
   * Generate a streaming Response with data stream support.
   *
   * This method enables tools to stream custom data to the client using
   * `ctx.writer.write()`. The data is delivered alongside the text stream
   * and can be accessed via `useChat`'s `data` property.
   *
   * Use this method when you need:
   * - Progressive UI updates during tool execution
   * - Streaming structured data to the client
   * - Real-time feedback from long-running tools
   *
   * @param options - Generation options including the prompt
   * @returns A web Response that streams text and custom data
   *
   * @example
   * ```typescript
   * // In a Next.js API route
   * export async function POST(req: Request) {
   *   const { messages } = await req.json();
   *   return agent.streamDataResponse({ messages });
   * }
   *
   * // On the client with useChat
   * const { messages, data } = useChat({ api: "/api/agent" });
   * // `data` contains custom data streamed from tools
   * ```
   */
  streamDataResponse(options: GenerateOptions): Promise<Response>;

  /**
   * Get all skills registered with this agent.
   * @returns Array of skill definitions
   */
  getSkills(): import("./tools/skills.js").SkillDefinition[];

  /**
   * Get all currently active tools.
   *
   * Returns the combined set of core tools and dynamically loaded tools.
   * In lazy loading mode, this includes tools loaded via use_tools.
   *
   * @returns ToolSet containing all active tools
   */
  getActiveTools(): ToolSet;

  /**
   * Load tools from the registry by name.
   *
   * Only available when using lazy plugin loading mode.
   * Tools loaded through this method become available for use.
   *
   * @param toolNames - Names of tools to load
   * @returns Object with loaded tool names and any errors
   */
  loadTools(toolNames: string[]): {
    loaded: string[];
    notFound: string[];
  };

  /**
   * Dynamically change the permission mode.
   *
   * Allows switching permission behavior at runtime, useful for
   * transitioning between planning and execution phases or adjusting
   * security posture based on user actions.
   *
   * @param mode - The new permission mode
   *
   * @example
   * ```typescript
   * // Start in plan mode
   * const agent = createAgent({
   *   model,
   *   permissionMode: "plan",
   * });
   *
   * // After planning, switch to execution
   * agent.setPermissionMode("acceptEdits");
   * ```
   */
  setPermissionMode(mode: PermissionMode): void;

  /**
   * Get the pending interrupt for a thread.
   *
   * Returns the interrupt from the checkpoint if there is a pending interrupt
   * (e.g., tool approval request, custom question). Useful for displaying
   * prompts to users.
   *
   * @param threadId - The thread ID to check for pending interrupts
   * @returns The interrupt if one is pending, undefined otherwise
   *
   * @example
   * ```typescript
   * const interrupt = await agent.getInterrupt(threadId);
   * if (interrupt) {
   *   if (isApprovalInterrupt(interrupt)) {
   *     console.log(`Waiting for approval of ${interrupt.toolName}`);
   *     console.log(`Arguments:`, interrupt.request.args);
   *   }
   * }
   * ```
   */
  getInterrupt(threadId: string): Promise<Interrupt | undefined>;

  /**
   * Resume execution after responding to an interrupt.
   *
   * Use this method to continue the agent's execution after providing a response
   * to an interrupt. For approval interrupts, the response should be an
   * `ApprovalResponse` with `{ approved: boolean }`. For custom interrupts,
   * provide the appropriate response type.
   *
   * @param threadId - The thread ID to resume
   * @param interruptId - The ID of the interrupt being responded to
   * @param response - The response to the interrupt
   * @param options - Optional generation options to override defaults
   * @returns The generation result after resuming
   *
   * @example
   * ```typescript
   * const result = await agent.generate({ prompt, threadId });
   *
   * if (result.status === "interrupted") {
   *   const { interrupt } = result;
   *
   *   if (isApprovalInterrupt(interrupt)) {
   *     const approved = await askUser(`Run ${interrupt.request.toolName}?`);
   *     return agent.resume(threadId, interrupt.id, { approved });
   *   }
   *
   *   // Custom interrupt
   *   const response = await handleCustomInterrupt(interrupt.request);
   *   return agent.resume(threadId, interrupt.id, response);
   * }
   * ```
   */
  resume(
    threadId: string,
    interruptId: string,
    response: unknown,
    options?: Partial<GenerateOptions>,
  ): Promise<GenerateResult>;

  /**
   * The task manager for background task tracking.
   *
   * Provides access to background tasks (bash commands and subagents).
   * Use this to list tasks, kill tasks, or subscribe to task events.
   *
   * @example
   * ```typescript
   * // List running tasks
   * const tasks = agent.taskManager.listTasks({ status: "running" });
   *
   * // Kill a specific task
   * await agent.taskManager.killTask(taskId);
   *
   * // Subscribe to task completion
   * agent.taskManager.on("complete", (task) => {
   *   console.log(`Task ${task.id} completed`);
   * });
   * ```
   */
  readonly taskManager: import("./task-manager.js").TaskManager;

  /**
   * Add tools to the agent at runtime.
   *
   * Runtime tools are included in the active tool set alongside core tools,
   * MCP tools, and registry tools. Adding a tool with the same name as an
   * existing runtime tool overwrites it.
   *
   * This is primarily used by plugins that need to dynamically inject tools
   * (e.g., team management tools that appear only when a team is active).
   *
   * @param tools - The tools to add
   *
   * @example
   * ```typescript
   * agent.addRuntimeTools({
   *   my_tool: tool({
   *     description: "A dynamically added tool",
   *     inputSchema: z.object({ input: z.string() }),
   *     execute: async ({ input }) => `Result: ${input}`,
   *   }),
   * });
   * ```
   */
  addRuntimeTools(tools: ToolSet): void;

  /**
   * Remove runtime tools by name.
   *
   * Removes tools previously added via {@link addRuntimeTools}.
   * Removing a tool name that doesn't exist is a no-op.
   *
   * @param toolNames - Names of the tools to remove
   *
   * @example
   * ```typescript
   * agent.removeRuntimeTools(["my_tool"]);
   * ```
   */
  removeRuntimeTools(toolNames: string[]): void;

  /**
   * Dispose the agent and clean up resources.
   *
   * This method should be called when the agent is no longer needed,
   * especially in ephemeral/serverless environments. It:
   * - Kills all running background tasks
   * - Closes MCP connections
   * - Cleans up any pending resources
   *
   * @returns Promise that resolves when disposal is complete
   *
   * @example
   * ```typescript
   * // In a serverless function
   * const agent = createAgent({ model });
   * try {
   *   const result = await agent.generate({ prompt });
   *   return result;
   * } finally {
   *   await agent.dispose();
   * }
   * ```
   */
  dispose(): Promise<void>;
}

// =============================================================================
// Generation Options and Results
// =============================================================================

/**
 * Options for generating a response.
 *
 * @example
 * ```typescript
 * const result = await agent.generate({
 *   prompt: "What's the weather like?",
 *   maxTokens: 1000,
 *   temperature: 0.7,
 * });
 * ```
 *
 * @category Agent
 */
export interface GenerateOptions {
  /** The user message/prompt */
  prompt?: string;

  /** Conversation history - accepts AI SDK message types */
  messages?: ModelMessage[];

  /**
   * Thread identifier for session persistence.
   *
   * When provided with a checkpointer, the agent will:
   * - Load existing checkpoint for this thread (if any)
   * - Save checkpoint after each step
   *
   * @example
   * ```typescript
   * // Resume a conversation
   * const result = await agent.generate({
   *   prompt: "Continue",
   *   threadId: "session-123",
   * });
   * ```
   */
  threadId?: string;

  /**
   * Fork an existing session into a new thread.
   *
   * When provided with a checkpointer and threadId, creates a new session
   * that starts from the current state of the source thread. Useful for
   * exploring alternative conversation paths without affecting the original.
   *
   * @example
   * ```typescript
   * // Fork a session to explore alternatives
   * const result = await agent.generate({
   *   threadId: "session-123",
   *   forkSession: "session-123-alternative",
   *   prompt: "Let's try a different approach",
   * });
   * // Original session-123 remains unchanged
   * // session-123-alternative contains a copy of session-123's state
   * ```
   */
  forkSession?: string;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /**
   * Temperature for sampling (higher = more random).
   * @defaultValue Model default
   */
  temperature?: number;

  /** Sequences that will stop generation */
  stopSequences?: string[];

  /** Abort signal for cancellation */
  signal?: AbortSignal;

  /**
   * Enable incremental checkpointing during streaming.
   *
   * When enabled, the agent will save a checkpoint after each step (tool call)
   * during streaming, not just at the end. This provides better crash recovery
   * for long-running streams with multiple tool calls.
   *
   * If the process crashes mid-stream, you can resume from the last completed
   * step instead of losing all progress.
   *
   * @defaultValue false
   *
   * @example
   * ```typescript
   * // Enable incremental checkpointing for long-running streams
   * const stream = await agent.stream({
   *   prompt: "Analyze this large dataset",
   *   threadId: "session-123",
   *   checkpointAfterToolCall: true,
   * });
   * ```
   */
  checkpointAfterToolCall?: boolean;

  // === AI SDK Passthrough Options ===

  /**
   * Structured output specification.
   * @see https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
   *
   * @example
   * ```typescript
   * import { Output } from "ai";
   *
   * output: Output.object({
   *   schema: z.object({ summary: z.string() })
   * })
   * ```
   */
  output?: ReturnType<typeof Output.object> | ReturnType<typeof Output.array>;

  /**
   * Provider-specific options passed directly to generateText/streamText.
   * Use this for features like extended thinking, reasoning effort, etc.
   *
   * @example
   * ```typescript
   * providerOptions: {
   *   anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } }
   * }
   * ```
   */
  // biome-ignore lint/suspicious/noExplicitAny: Provider options vary by AI provider (Anthropic, OpenAI, etc.)
  providerOptions?: any;

  /**
   * Additional headers for API requests.
   * Useful for custom authentication or provider-specific headers.
   */
  headers?: Record<string, string>;

  /**
   * Callback invoked when the stream writer becomes available.
   *
   * This is only called by `streamDataResponse()` and provides access to the
   * underlying `UIMessageStreamWriter` for custom data streaming. Useful for
   * setting up log transports that write to the stream.
   *
   * @example
   * ```typescript
   * // Stream logs to the client via the writer
   * const logEntries: LogEntry[] = [];
   * const logTransport: LogTransport = {
   *   name: "stream",
   *   write: (entry) => {
   *     // Will be updated when writer is ready
   *     if (writerRef.current) {
   *       writerRef.current.write({ type: "data", value: { type: "log", entry } });
   *     }
   *   },
   * };
   *
   * return agent.streamDataResponse({
   *   messages,
   *   onStreamWriterReady: (writer) => {
   *     writerRef.current = writer;
   *   },
   * });
   * ```
   */
  onStreamWriterReady?: (writer: UIMessageStreamWriter) => void;

  /**
   * Internal flag to skip compaction during summary generation.
   * @internal
   */
  _skipCompaction?: boolean;
}

/**
 * Result from a completed generation request.
 *
 * This is returned when the agent completes successfully without interruption.
 *
 * @category Agent
 */
export interface GenerateResultComplete {
  /** Status indicating the generation completed successfully */
  status: "complete";

  /** The generated text */
  text: string;

  /** Token usage information (AI SDK type) */
  usage?: LanguageModelUsage;

  /** Reason why generation finished */
  finishReason: FinishReason;

  /** Structured output if responseSchema was provided */
  output?: unknown;

  /** All steps from the generation (includes tool calls) */
  steps: GenerateStep[];

  /** New session ID if session was forked via forkSession option */
  forkedSessionId?: string;
}

/**
 * Partial result data available when generation is interrupted.
 *
 * @category Agent
 */
export interface PartialGenerateResult {
  /** Text generated before the interrupt */
  text: string;

  /** Steps completed before the interrupt */
  steps: GenerateStep[];

  /** Token usage up to the point of interruption */
  usage?: LanguageModelUsage;
}

/**
 * Result from an interrupted generation request.
 *
 * This is returned when the agent pauses for user input (e.g., tool approval,
 * custom questions during tool execution).
 *
 * @example
 * ```typescript
 * const result = await agent.generate({ prompt, threadId });
 *
 * if (result.status === "interrupted") {
 *   const { interrupt } = result;
 *
 *   if (isApprovalInterrupt(interrupt)) {
 *     const approved = await askUser(`Run ${interrupt.request.toolName}?`);
 *     return agent.resume(threadId, interrupt.id, { approved });
 *   }
 * }
 * ```
 *
 * @category Agent
 */
export interface GenerateResultInterrupted {
  /** Status indicating the generation was interrupted */
  status: "interrupted";

  /** The interrupt that caused the pause */
  interrupt: Interrupt;

  /** Partial results available at the time of interruption */
  partial?: PartialGenerateResult;
}

/**
 * Result from a generation request.
 *
 * This is a discriminated union - check `status` to determine the result type:
 * - `"complete"`: Generation finished successfully
 * - `"interrupted"`: Generation paused for user input
 *
 * @example
 * ```typescript
 * const result = await agent.generate({ prompt, threadId });
 *
 * if (result.status === "complete") {
 *   console.log(result.text);
 * } else if (result.status === "interrupted") {
 *   // Handle interrupt
 *   const response = await handleInterrupt(result.interrupt);
 *   return agent.resume(threadId, result.interrupt.id, response);
 * }
 * ```
 *
 * @category Agent
 */
export type GenerateResult = GenerateResultComplete | GenerateResultInterrupted;

// =============================================================================
// Result Type Guards
// =============================================================================

/**
 * Type guard to check if a generation result is complete.
 *
 * @param result - The generation result to check
 * @returns True if the result is a complete result
 *
 * @example
 * ```typescript
 * const result = await agent.generate({ prompt, threadId });
 *
 * if (isCompleteResult(result)) {
 *   console.log("Generation complete:", result.text);
 * } else {
 *   console.log("Generation interrupted:", result.interrupt.type);
 * }
 * ```
 *
 * @category Agent
 */
export function isCompleteResult(result: GenerateResult): result is GenerateResultComplete {
  return result.status === "complete";
}

/**
 * Type guard to check if a generation result is interrupted.
 *
 * @param result - The generation result to check
 * @returns True if the result is an interrupted result
 *
 * @example
 * ```typescript
 * const result = await agent.generate({ prompt, threadId });
 *
 * if (isInterruptedResult(result)) {
 *   const { interrupt } = result;
 *   // Handle the interrupt...
 * }
 * ```
 *
 * @category Agent
 */
export function isInterruptedResult(result: GenerateResult): result is GenerateResultInterrupted {
  return result.status === "interrupted";
}

/**
 * A single step in the generation process.
 *
 * @category Agent
 */
export interface GenerateStep {
  /** Text generated in this step */
  text: string;

  /** Tool calls made in this step */
  toolCalls: ToolCallResult[];

  /** Tool results from this step */
  toolResults: ToolResultPart[];

  /** Finish reason for this step */
  finishReason: FinishReason;

  /** Usage for this step */
  usage?: LanguageModelUsage;
}

/**
 * A tool call made by the model.
 *
 * @category Agent
 */
export interface ToolCallResult {
  /** Unique identifier for this tool call */
  toolCallId: string;

  /** Name of the tool that was called */
  toolName: string;

  /** Arguments passed to the tool */
  input: unknown;
}

/**
 * Result from a tool execution.
 *
 * @category Agent
 */
export interface ToolResultPart {
  /** The tool call ID this result corresponds to */
  toolCallId: string;

  /** Name of the tool */
  toolName: string;

  /** The result from the tool */
  output: unknown;
}

/**
 * Reason why the model finished generating.
 *
 * - `stop` - Model generated a stop sequence or natural end
 * - `length` - Maximum tokens reached
 * - `tool-calls` - Model requested tool calls
 * - `error` - An error occurred
 * - `other` - Other/unknown reason
 *
 * @category Types
 */
export type FinishReason = "stop" | "length" | "tool-calls" | "error" | "other";

/**
 * Core tool names that can be disabled.
 *
 * @category Types
 */
export type CoreToolName =
  | "read"
  | "write"
  | "edit"
  | "glob"
  | "grep"
  | "bash"
  | "todo_write"
  | "task"
  | "task_output"
  | "kill_task"
  | "list_tasks"
  | "skill"
  | "search_tools"
  | "call_tool";

/**
 * A part from streaming generation.
 * Aligns with AI SDK stream parts plus agent-specific events.
 *
 * @category Agent
 */
export type StreamPart =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; output: unknown }
  | { type: "finish"; finishReason: FinishReason; usage?: LanguageModelUsage }
  | { type: "error"; error: Error }
  // Agent-specific events
  | { type: "subagent-spawn"; data: AgentDataTypes["subagent-spawn"] }
  | { type: "subagent-complete"; data: AgentDataTypes["subagent-complete"] }
  | { type: "agent-progress"; data: AgentDataTypes["agent-progress"] };

// =============================================================================
// Plugins
// =============================================================================

/**
 * Configuration for a plugin's dedicated subagent.
 *
 * When a plugin defines a `subagent`, the tools listed here are scoped to
 * an auto-created subagent instead of the main agent's context. The main
 * agent delegates to this subagent via the `task` tool.
 *
 * @example
 * ```typescript
 * definePlugin({
 *   name: "github",
 *   subagent: {
 *     description: "GitHub specialist",
 *     prompt: "You handle GitHub operations.",
 *     model: haiku,
 *     tools: { list_issues, create_pr },
 *   },
 * });
 * ```
 *
 * @category Plugins
 */
export interface PluginSubagent {
  /** Description of what this subagent specializes in */
  description: string;

  /**
   * System prompt for the subagent.
   * @defaultValue `You are a ${plugin.name} specialist. Complete the requested task using available tools and return a clear summary.`
   */
  prompt?: string;

  /** Model override for the subagent. Inherits from parent agent if omitted. */
  model?: LanguageModel;

  /** Tools scoped to this subagent */
  tools: ToolSet;
}

/**
 * A plugin that extends agent functionality.
 *
 * Plugins can provide tools, skills, hooks, and initialization logic.
 *
 * @example
 * ```typescript
 * const plugin: AgentPlugin = {
 *   name: "my-plugin",
 *   description: "Adds useful tools",
 *   tools: { myTool: tool({ ... }) },
 *   setup: async (agent) => {
 *     console.log("Plugin initialized for agent:", agent.id);
 *   },
 * };
 * ```
 *
 * @category Plugins
 */
export interface AgentPlugin {
  /** Unique name identifying this plugin */
  name: string;

  /** Human-readable description of what this plugin does */
  description?: string;

  /**
   * Initialize the plugin when it's loaded into an agent.
   * @param agent - The agent instance loading this plugin
   */
  setup?(agent: Agent): void | Promise<void>;

  /**
   * Tools provided by this plugin.
   *
   * Can be a static ToolSet or a function that receives StreamingContext.
   * Use a function when you need to stream data to the client during tool execution.
   *
   * @example
   * ```typescript
   * // Static tools (no streaming)
   * tools: {
   *   myTool: tool({ ... }),
   * }
   *
   * // Streaming-aware tools
   * tools: (ctx) => ({
   *   myTool: tool({
   *     execute: async (input) => {
   *       if (ctx.writer) {
   *         ctx.writer.write({ type: "data", value: { type: "progress", value: 50 } });
   *       }
   *       return result;
   *     },
   *   }),
   * })
   * ```
   */
  tools?: ToolSet | StreamingToolsFactory;

  /**
   * MCP server configuration for external tool integration.
   *
   * When provided, the agent will connect to this MCP server and expose
   * its tools with the naming pattern `mcp__<plugin-name>__<tool-name>`.
   *
   * @example
   * ```typescript
   * const githubPlugin = definePlugin({
   *   name: "github",
   *   mcpServer: {
   *     type: "stdio",
   *     command: "npx",
   *     args: ["-y", "@modelcontextprotocol/server-github"],
   *     env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
   *   },
   * });
   * ```
   */
  mcpServer?: MCPServerConfig;

  /** Skills provided by this plugin */
  skills?: import("./tools/skills.js").SkillDefinition[];

  /** Hooks provided by this plugin. Merged into the agent's hook registration during initialization. */
  hooks?: HookRegistration;

  /**
   * When true, this plugin's tools are accessible only via `call_tool` proxy.
   *
   * In `pluginLoading: "proxy"` mode, all plugins are deferred by default.
   * In `pluginLoading: "eager"` (default), only plugins with `deferred: true`
   * are proxied; the rest load eagerly as before.
   *
   * Deferred tools are discoverable via `search_tools` and callable via `call_tool`,
   * but never added to the active tool set — keeping the schema stable and cacheable.
   *
   * @defaultValue false
   */
  deferred?: boolean;

  /**
   * Subagent configuration for this plugin.
   *
   * When provided, the tools defined here are scoped to an auto-created subagent
   * instead of being loaded into the main agent's context. The main agent
   * delegates to this subagent via the `task` tool.
   *
   * Tools on `plugin.tools` go to the main agent; tools on `plugin.subagent.tools`
   * go to a dedicated subagent. A plugin can have both.
   *
   * @example
   * ```typescript
   * definePlugin({
   *   name: "github",
   *   subagent: {
   *     description: "GitHub specialist",
   *     prompt: "You handle GitHub operations.",
   *     model: haiku,
   *     tools: { list_issues, create_pr },
   *   },
   * });
   * ```
   */
  subagent?: PluginSubagent;
}

/**
 * Options for the {@link definePlugin} helper function.
 *
 * @category Plugins
 */
export interface PluginOptions {
  /** Unique name identifying this plugin */
  name: string;

  /** Human-readable description of what this plugin does */
  description?: string;

  /**
   * Initialize the plugin when it's loaded into an agent.
   * @param agent - The agent instance loading this plugin
   */
  setup?: (agent: Agent) => void | Promise<void>;

  /**
   * Tools provided by this plugin.
   *
   * Can be a static ToolSet or a function that receives StreamingContext.
   * Use a function when you need to stream data to the client during tool execution.
   */
  tools?: ToolSet | StreamingToolsFactory;

  /**
   * MCP server configuration for external tool integration.
   */
  mcpServer?: MCPServerConfig;

  /** Skills provided by this plugin */
  skills?: import("./tools/skills.js").SkillDefinition[];

  /** Hooks provided by this plugin. Merged into the agent's hook registration during initialization. */
  hooks?: HookRegistration;

  /**
   * When true, this plugin's tools are accessible only via `call_tool` proxy.
   * @see {@link AgentPlugin.deferred}
   * @defaultValue false
   */
  deferred?: boolean;

  /**
   * Subagent configuration for this plugin.
   * @see {@link AgentPlugin.subagent}
   */
  subagent?: PluginSubagent;
}

// =============================================================================
// Skills
// =============================================================================

/**
 * Options for the {@link defineSkill} helper function.
 *
 * Used to create programmatic skills. For file-based skills,
 * use {@link loadSkillFromDirectory} or {@link loadSkillsFromDirectories}.
 *
 * @example
 * ```typescript
 * import { defineSkill } from "@lleverage-ai/agent-sdk";
 *
 * const dataSkill = defineSkill({
 *   name: "data-exploration",
 *   description: "Query and visualize data",
 *   instructions: "Use getSchema first to see available columns.",
 *   license: "MIT",
 * });
 * ```
 *
 * @category Tools
 */
export interface SkillOptions {
  /** Name of the skill (1-64 chars, lowercase + hyphens) */
  name: string;

  /** Description of what this skill does (1-1024 chars) */
  description: string;

  /** Instructions to provide when this skill is loaded */
  instructions: string | ((args?: string) => string);

  /** Optional tools specific to this skill (AI SDK ToolSet) */
  tools?: ToolSet;

  /** Optional license for this skill */
  license?: string;

  /** Optional compatibility requirements (max 500 chars) */
  compatibility?: string;

  /** Optional arbitrary metadata */
  metadata?: Record<string, string>;
}

// =============================================================================
// Hooks - Unified System (Claude SDK Aligned)
// =============================================================================

/**
 * Types of events that can trigger hooks.
 *
 * Hook names follow Claude Code conventions for consistency.
 * @see https://code.claude.com/docs/en/hooks
 *
 * @category Hooks
 */
export type HookEvent =
  // Session lifecycle
  | "SessionStart"
  | "SessionEnd"

  // User input
  | "UserPromptSubmit"

  // Generation lifecycle
  | "PreGenerate"
  | "PostGenerate"
  | "PostGenerateFailure"

  // Tool lifecycle
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"

  // Subagent lifecycle
  | "SubagentStart"
  | "SubagentStop"

  // Agent completion
  | "Stop"

  // Context
  | "PreCompact"
  | "PostCompact"

  // Checkpoint lifecycle
  | "PreCheckpointSave"
  | "PostCheckpointSave"
  | "PreCheckpointLoad"
  | "PostCheckpointLoad"

  // Interrupt lifecycle
  | "InterruptRequested"
  | "InterruptResolved"

  // MCP connection lifecycle
  | "MCPConnectionFailed"
  | "MCPConnectionRestored"

  // Tool registry lifecycle
  | "ToolRegistered"
  | "ToolLoadError"

  // Plugin-defined custom hook events
  | "Custom";

// =============================================================================
// New Unified Hook System Types
// =============================================================================

/**
 * Common fields in all hook inputs.
 * @category Hooks
 */
export interface BaseHookInput {
  /** The event type that triggered this hook */
  hook_event_name: HookEvent;
  /** Session identifier */
  session_id: string;
  /** Current working directory */
  cwd: string;
}

/**
 * Input for PreToolUse hooks.
 * @category Hooks
 */
export interface PreToolUseInput extends BaseHookInput {
  hook_event_name: "PreToolUse";
  /** Name of the tool about to be executed */
  tool_name: string;
  /** Input parameters for the tool */
  tool_input: Record<string, unknown>;
}

/**
 * Input for PostToolUse hooks.
 * @category Hooks
 */
export interface PostToolUseInput extends BaseHookInput {
  hook_event_name: "PostToolUse";
  /** Name of the tool that was executed */
  tool_name: string;
  /** Input parameters for the tool */
  tool_input: Record<string, unknown>;
  /** Result from the tool execution */
  tool_response: unknown;
}

/**
 * Input for PostToolUseFailure hooks.
 * @category Hooks
 */
export interface PostToolUseFailureInput extends BaseHookInput {
  hook_event_name: "PostToolUseFailure";
  /** Name of the tool that failed */
  tool_name: string;
  /** Input parameters for the tool */
  tool_input: Record<string, unknown>;
  /** Error message or error object */
  error: string | Error;
}

/**
 * Input for PreGenerate hooks.
 * @category Hooks
 */
export interface PreGenerateInput extends BaseHookInput {
  hook_event_name: "PreGenerate";
  /** Generation options */
  options: GenerateOptions;
}

/**
 * Input for PostGenerate hooks.
 * @category Hooks
 */
export interface PostGenerateInput extends BaseHookInput {
  hook_event_name: "PostGenerate";
  /** Generation options */
  options: GenerateOptions;
  /**
   * Generated result.
   * Note: PostGenerate is only called for complete results - interrupts
   * are returned immediately without calling PostGenerate hooks.
   */
  result: GenerateResultComplete;
}

/**
 * Input for PostGenerateFailure hooks.
 * @category Hooks
 */
export interface PostGenerateFailureInput extends BaseHookInput {
  hook_event_name: "PostGenerateFailure";
  /** Generation options */
  options: GenerateOptions;
  /** Error that occurred */
  error: Error;
}

/**
 * Input for SubagentStart hooks.
 * @category Hooks
 */
export interface SubagentStartInput extends BaseHookInput {
  hook_event_name: "SubagentStart";
  /** Unique identifier for the subagent */
  agent_id: string;
  /** Type of subagent */
  agent_type: string;
  /** Task prompt for the subagent */
  prompt?: string;
}

/**
 * Input for SubagentStop hooks.
 * @category Hooks
 */
export interface SubagentStopInput extends BaseHookInput {
  hook_event_name: "SubagentStop";
  /** Unique identifier for the subagent */
  agent_id: string;
  /** Type of subagent */
  agent_type: string;
  /** Result from subagent execution */
  result?: unknown;
  /** Error from subagent execution */
  error?: Error;
}

/**
 * Input for MCPConnectionFailed hooks.
 * @category Hooks
 */
export interface MCPConnectionFailedInput extends BaseHookInput {
  hook_event_name: "MCPConnectionFailed";
  /** Name of the MCP server that failed to connect */
  server_name: string;
  /** Server configuration */
  config: MCPServerConfig;
  /** Error that occurred during connection */
  error: Error;
}

/**
 * Input for MCPConnectionRestored hooks.
 * @category Hooks
 */
export interface MCPConnectionRestoredInput extends BaseHookInput {
  hook_event_name: "MCPConnectionRestored";
  /** Name of the MCP server that was restored */
  server_name: string;
  /** Number of tools now available from this server */
  tool_count: number;
}

/**
 * Input for ToolRegistered hooks.
 * @category Hooks
 */
export interface ToolRegisteredInput extends BaseHookInput {
  hook_event_name: "ToolRegistered";
  /** Name of the tool that was registered */
  tool_name: string;
  /** Tool description */
  description: string;
  /** Source plugin or server (if any) */
  source?: string;
}

/**
 * Input for ToolLoadError hooks.
 * @category Hooks
 */
export interface ToolLoadErrorInput extends BaseHookInput {
  hook_event_name: "ToolLoadError";
  /** Name of the tool that failed to load */
  tool_name: string;
  /** Error that occurred during loading */
  error: Error;
  /** Source plugin or server (if any) */
  source?: string;
}

/**
 * Input for PreCompact hooks.
 * @category Hooks
 */
export interface PreCompactInput extends BaseHookInput {
  hook_event_name: "PreCompact";
  /** Number of messages before compaction */
  message_count: number;
  /** Estimated token count before compaction */
  tokens_before: number;
}

/**
 * Input for PostCompact hooks.
 * @category Hooks
 */
export interface PostCompactInput extends BaseHookInput {
  hook_event_name: "PostCompact";
  /** Number of messages before compaction */
  messages_before: number;
  /** Number of messages after compaction */
  messages_after: number;
  /** Token count before compaction */
  tokens_before: number;
  /** Token count after compaction */
  tokens_after: number;
  /** Token savings from compaction */
  tokens_saved: number;
}

/**
 * Input for InterruptRequested hooks.
 *
 * Emitted when an interrupt is created (approval request, custom interrupt, etc.).
 * @category Hooks
 */
export interface InterruptRequestedInput extends BaseHookInput {
  hook_event_name: "InterruptRequested";
  /** Unique identifier for the interrupt */
  interrupt_id: string;
  /** Type of interrupt (e.g., "approval", "custom") */
  interrupt_type: string;
  /** Tool call ID if related to a tool call */
  tool_call_id?: string;
  /** Tool name if related to a tool call */
  tool_name?: string;
  /** The interrupt request data */
  request: unknown;
}

/**
 * Input for InterruptResolved hooks.
 *
 * Emitted when an interrupt is resolved (approved, denied, or custom response).
 * @category Hooks
 */
export interface InterruptResolvedInput extends BaseHookInput {
  hook_event_name: "InterruptResolved";
  /** Unique identifier for the interrupt */
  interrupt_id: string;
  /** Type of interrupt (e.g., "approval", "custom") */
  interrupt_type: string;
  /** Tool call ID if related to a tool call */
  tool_call_id?: string;
  /** Tool name if related to a tool call */
  tool_name?: string;
  /** The response that resolved the interrupt */
  response: unknown;
  /** For approval interrupts: whether the request was approved */
  approved?: boolean;
}

/**
 * Input for Custom hooks defined by plugins.
 *
 * Plugins can define arbitrary custom hook events with string-keyed names.
 * The custom_event field identifies the specific event (e.g., "team:TeammateIdle").
 *
 * @category Hooks
 */
export interface CustomHookInput extends BaseHookInput {
  hook_event_name: "Custom";
  /** The custom event name (e.g., "team:TeammateIdle") */
  custom_event: string;
  /** Event payload */
  payload: Record<string, unknown>;
}

/**
 * Union type of all hook input types.
 * @category Hooks
 */
export type HookInput =
  | PreToolUseInput
  | PostToolUseInput
  | PostToolUseFailureInput
  | PreGenerateInput
  | PostGenerateInput
  | PostGenerateFailureInput
  | SubagentStartInput
  | SubagentStopInput
  | MCPConnectionFailedInput
  | MCPConnectionRestoredInput
  | ToolRegisteredInput
  | ToolLoadErrorInput
  | PreCompactInput
  | PostCompactInput
  | InterruptRequestedInput
  | InterruptResolvedInput
  | CustomHookInput;

/**
 * Permission decision for a tool or generation operation.
 * @category Hooks
 */
export type PermissionDecision = "allow" | "deny" | "ask";

/**
 * Permission mode controlling default tool approval behavior.
 *
 * Aligned with Claude Agent SDK permission modes:
 * - `default`: Unmatched tools trigger canUseTool callback or hooks
 * - `acceptEdits`: Auto-approve file edit operations (Write, Edit, filesystem commands)
 * - `bypassPermissions`: Auto-approve all tools (dangerous - use only for testing/demos)
 * - `plan`: Block all tool execution (planning/analysis only)
 *
 * @category Permissions
 */
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

/**
 * Hook-specific output that controls operation behavior.
 * @category Hooks
 */
export interface HookSpecificOutput {
  /** Required: identifies which hook type this output is for */
  hookEventName: HookEvent;

  // === PreToolUse / PreGenerate ===

  /** Permission decision for the operation */
  permissionDecision?: PermissionDecision;

  /** Explanation for the decision (shown to model and logs) */
  permissionDecisionReason?: string;

  /** Message IDs that caused the block (for client-side cleanup) */
  blockedMessageIds?: string[];

  /** Modified input (PreToolUse: tool input, PreGenerate: options) */
  updatedInput?: unknown;

  /** Short-circuit with cached/mock result (skips actual execution) */
  respondWith?: unknown;

  // === PostToolUse / PostGenerate ===

  /** Modified output (transform result before returning) */
  updatedResult?: unknown;

  // === PostToolUseFailure / PostGenerateFailure ===

  /** Signal to retry the failed operation */
  retry?: boolean;

  /** Delay before retry in milliseconds */
  retryDelayMs?: number;
}

/**
 * Output from a hook callback.
 *
 * Hooks return control information via `hookSpecificOutput`, which contains
 * event-specific fields like permission decisions, input/output transformations,
 * cache responses, and retry signals.
 *
 * @category Hooks
 */
export interface HookOutput {
  /** Hook-specific control fields */
  hookSpecificOutput?: HookSpecificOutput;
}

/**
 * Context passed to hook callbacks.
 * @category Hooks
 */
export interface HookCallbackContext {
  /** AbortSignal for cancellation (pass to fetch, etc.) */
  signal: AbortSignal;

  /** Agent instance */
  agent: Agent;

  /** Current retry attempt (0 = first attempt) */
  retryAttempt?: number;
}

/**
 * Hook callback function signature.
 *
 * Hooks can return:
 * - `HookOutput` object with control fields (e.g., permission decisions, transformations)
 * - `void` or `undefined` for observation-only hooks (e.g., logging, metrics)
 *
 * @category Hooks
 */
export type HookCallback = (
  input: HookInput,
  toolUseId: string | null,
  context: HookCallbackContext,
) => Promise<HookOutput | undefined> | HookOutput | undefined;

/**
 * Matcher for filtering which tools trigger hooks.
 * @category Hooks
 */
export interface HookMatcher {
  /**
   * Regex pattern to match tool names (omit for all tools).
   * Examples:
   * - 'Write|Edit' - File modification tools
   * - '^mcp__' - All MCP tools
   * - 'mcp__playwright__' - Specific MCP server
   * - undefined - All tools (no filter)
   */
  matcher?: string;

  /** Hook callbacks to run when pattern matches */
  hooks: HookCallback[];

  /**
   * Timeout in milliseconds for hook execution.
   * @defaultValue 60000 (60 seconds)
   */
  timeout?: number;
}

/**
 * Configuration for registering hooks with matchers.
 * @category Hooks
 */
export interface HookRegistration {
  /**
   * Tool lifecycle hooks with matchers.
   * Array of matchers, each with optional regex pattern and hook callbacks.
   */
  PreToolUse?: HookMatcher[];
  PostToolUse?: HookMatcher[];
  PostToolUseFailure?: HookMatcher[];

  /**
   * Generation lifecycle hooks (no matchers - not tool-specific).
   * Array of hook callbacks.
   */
  PreGenerate?: HookCallback[];
  PostGenerate?: HookCallback[];
  PostGenerateFailure?: HookCallback[];

  /**
   * Session lifecycle hooks.
   * Array of hook callbacks.
   */
  SessionStart?: HookCallback[];
  SessionEnd?: HookCallback[];

  /**
   * Subagent lifecycle hooks.
   * Array of hook callbacks.
   */
  SubagentStart?: HookCallback[];
  SubagentStop?: HookCallback[];

  /**
   * MCP connection lifecycle hooks.
   * Array of hook callbacks.
   */
  MCPConnectionFailed?: HookCallback[];
  MCPConnectionRestored?: HookCallback[];

  /**
   * Tool registry lifecycle hooks.
   * Array of hook callbacks.
   */
  ToolRegistered?: HookCallback[];
  ToolLoadError?: HookCallback[];

  /**
   * Context compaction lifecycle hooks.
   * Array of hook callbacks.
   */
  PreCompact?: HookCallback[];
  PostCompact?: HookCallback[];

  /**
   * Interrupt lifecycle hooks.
   * Called when interrupts are requested (approval, custom) and resolved.
   */
  InterruptRequested?: HookCallback[];
  InterruptResolved?: HookCallback[];

  /**
   * Custom hooks defined by plugins, keyed by event name.
   *
   * Plugins can register callbacks for arbitrary custom events.
   * Use `invokeCustomHook()` to fire these hooks.
   *
   * @example
   * ```typescript
   * Custom: {
   *   "team:TeammateIdle": [handleTeammateIdle],
   *   "team:TaskCompleted": [logTaskCompletion],
   * }
   * ```
   */
  Custom?: Record<string, HookCallback[]>;
}

// =============================================================================
// Subagents
// =============================================================================

/**
 * Configuration for creating a subagent.
 *
 * @category Subagents
 */
export interface SubagentOptions extends Omit<AgentOptions, "model" | "allowedTools"> {
  /** Name for the subagent */
  name: string;

  /** Description of what this subagent does */
  description: string;

  /** Model to use (inherits from parent if not specified) */
  model?: LanguageModel;

  /**
   * Control hook inheritance from parent agent.
   *
   * Options:
   * - `true`: Inherit all hooks from parent (default for backward compatibility)
   * - `false`: No hook inheritance, use only hooks defined in this subagent
   * - `string[]`: Inherit only specific hook events (e.g., ["PreToolUse", "PostGenerate"])
   *
   * @example
   * ```typescript
   * // Inherit all hooks from parent
   * const subagent1 = createSubagent(parentAgent, {
   *   name: "helper",
   *   description: "Inherits parent hooks",
   *   inheritHooks: true, // Default
   * });
   *
   * // No hook inheritance - isolated execution
   * const subagent2 = createSubagent(parentAgent, {
   *   name: "sandbox",
   *   description: "Runs without parent hooks",
   *   inheritHooks: false,
   * });
   *
   * // Selective inheritance - only tool hooks
   * const subagent3 = createSubagent(parentAgent, {
   *   name: "monitored",
   *   description: "Inherits only tool lifecycle hooks",
   *   inheritHooks: ["PreToolUse", "PostToolUse", "PostToolUseFailure"],
   * });
   * ```
   *
   * @defaultValue true
   */
  inheritHooks?: boolean | HookEvent[];

  /**
   * Restrict which tools this subagent can use.
   *
   * When provided, only tools whose names are in this array will be
   * available to the subagent. This applies on top of any tools
   * inherited from the parent agent.
   *
   * @example
   * ```typescript
   * const subagent = createSubagent(parentAgent, {
   *   name: "reader",
   *   description: "Read-only research agent",
   *   allowedTools: ["read", "glob", "grep"],  // No write access
   * });
   * ```
   */
  allowedTools?: string[];
}

/**
 * Configuration for creating a task delegation tool.
 *
 * @category Subagents
 */
export interface TaskToolOptions {
  /**
   * Name for the task tool.
   * @defaultValue "task"
   */
  name?: string;

  /** Description of what the task tool does */
  description?: string;

  /** Available subagent types that can be delegated to */
  subagents: SubagentDefinition[];
}

/**
 * Definition of a subagent type for task delegation.
 *
 * @category Subagents
 */
export interface SubagentDefinition {
  /** Unique type identifier for this subagent */
  type: string;

  /** Description of what this subagent specializes in */
  description: string;

  /**
   * Model to use for this subagent.
   *
   * - If not specified, inherits from parent agent
   * - Use `"inherit"` to explicitly inherit from parent
   * - Provide a LanguageModel instance to override
   *
   * @example
   * ```typescript
   * const subagents = [
   *   {
   *     type: "fast-researcher",
   *     description: "Quick research tasks",
   *     model: anthropic("claude-haiku-4.5"),  // Use faster model
   *   },
   *   {
   *     type: "deep-analyst",
   *     description: "Complex analysis",
   *     model: anthropic("claude-sonnet-4-20250514"),  // Use more capable model
   *   },
   * ];
   * ```
   */
  model?: LanguageModel | "inherit";

  /**
   * Restrict which tools this subagent can use.
   *
   * When provided, only the specified tools will be available to
   * the subagent, even if more tools are available in the parent.
   * This provides security and context control for delegated tasks.
   *
   * @example
   * ```typescript
   * const subagents = [
   *   {
   *     type: "reader",
   *     description: "Read-only research agent",
   *     allowedTools: ["read", "glob", "grep"],  // No write access
   *   },
   *   {
   *     type: "coder",
   *     description: "Code writing agent",
   *     allowedTools: ["read", "write", "edit", "bash"],
   *   },
   * ];
   * ```
   */
  allowedTools?: string[];

  /**
   * Plugins to load for this subagent.
   *
   * Unlike tools inherited from the parent, these plugins are loaded
   * exclusively for this subagent. This is useful for giving a subagent
   * access to an MCP server without polluting the parent's tool set.
   *
   * @example
   * ```typescript
   * const subagents = [
   *   {
   *     type: "web-researcher",
   *     description: "Web research specialist",
   *     plugins: [webSearchPlugin],  // Only this subagent gets web search
   *     allowedTools: [webSearch("search")],
   *     create: (ctx) => createSubagent(parentAgent, {
   *       name: "web-researcher",
   *       plugins: ctx.plugins,
   *       allowedTools: ctx.allowedTools,
   *     }),
   *   },
   * ];
   * ```
   */
  plugins?: PluginOptions[];

  /**
   * Enable streaming from this subagent to the parent's data stream.
   *
   * When true, the subagent receives a StreamingContext and can write
   * custom data directly to the parent's stream. This enables:
   * - Progressive UI rendering
   * - Real-time progress updates
   * - Streaming structured data to the client
   *
   * The streaming context includes metadata identifying this subagent
   * as the source, similar to LangGraph's namespace pattern.
   *
   * @defaultValue false
   *
   * @example
   * ```typescript
   * const subagents = [
   *   {
   *     type: "ui-builder",
   *     description: "Generates UI components with streaming",
   *     streaming: true,
   *     create: (ctx) => createSubagent(parentAgent, {
   *       name: "ui-builder",
   *       systemPrompt: generateCatalogPrompt(catalog),
   *       // Subagent can use ctx.streamingContext.writer
   *     }),
   *   },
   * ];
   * ```
   */
  streaming?: boolean;

  /**
   * Factory function to create the subagent.
   *
   * Receives a context object containing the resolved model and any
   * tool restrictions. Use these values when calling createSubagent.
   *
   * @param context - Context for subagent creation
   * @returns The subagent instance
   *
   * @example
   * ```typescript
   * const subagents = [
   *   {
   *     type: "researcher",
   *     description: "Research agent",
   *     model: anthropic("claude-haiku-4.5"),
   *     allowedTools: ["read", "glob", "grep"],
   *     create: (ctx) => createSubagent(parentAgent, {
   *       name: "researcher",
   *       description: "Research agent",
   *       model: ctx.model,  // Use resolved model
   *       allowedTools: ctx.allowedTools,  // Use tool restrictions
   *     }),
   *   },
   * ];
   * ```
   */
  create: (context: SubagentCreateContext) => Agent | Promise<Agent>;
}

/**
 * Context passed to subagent factory functions.
 *
 * @category Subagents
 */
export interface SubagentCreateContext {
  /**
   * The resolved model to use for the subagent.
   *
   * This is determined by priority:
   * 1. SubagentDefinition.model (if not "inherit")
   * 2. TaskToolOptions.defaultModel
   * 3. Parent agent's model
   */
  model: LanguageModel;

  /**
   * Tool restrictions for this subagent, if any.
   * Comes from SubagentDefinition.allowedTools.
   */
  allowedTools?: string[];

  /**
   * Plugins to load for this subagent.
   * Comes from SubagentDefinition.plugins.
   */
  plugins?: PluginOptions[];

  /**
   * Streaming context from the parent agent.
   *
   * Only provided when SubagentDefinition.streaming is true and the
   * parent agent is using streamDataResponse(). Allows the subagent
   * to write custom data directly to the parent's data stream.
   *
   * The context includes metadata identifying this subagent as the
   * source of any streamed data.
   *
   * @example
   * ```typescript
   * create: (ctx) => {
   *   // Subagent can pass streaming context to its tools
   *   const tools = createStreamingTools(ctx.streamingContext);
   *   return createSubagent(parent, { tools });
   * }
   * ```
   */
  streamingContext?: StreamingContext;

  /**
   * Parent span context for distributed tracing.
   *
   * When provided, the subagent should create child spans linked to
   * this parent span, enabling cross-agent trace correlation in
   * distributed tracing systems.
   *
   * This allows you to track the full request flow across parent
   * and child agents in tools like Jaeger, Zipkin, or OpenTelemetry
   * collectors.
   *
   * @example
   * ```typescript
   * import { createTracer, SemanticAttributes } from "@lleverage-ai/agent-sdk";
   *
   * const tracer = createTracer({ name: "my-agent" });
   *
   * const subagentDef: SubagentDefinition = {
   *   type: "researcher",
   *   create: (ctx) => {
   *     const subagent = createSubagent(parentAgent, { ... });
   *
   *     // Create child spans from parent context
   *     if (ctx.parentSpanContext) {
   *       const span = tracer.startSpan("subagent-execution", {
   *         parent: ctx.parentSpanContext,
   *         attributes: {
   *           [SemanticAttributes.SUBAGENT_TYPE]: "researcher",
   *         },
   *       });
   *       // ... perform work ...
   *       span.end();
   *     }
   *
   *     return subagent;
   *   },
   * };
   * ```
   */
  parentSpanContext?: import("./observability/tracing.js").SpanContext;
}

// =============================================================================
// Context
// =============================================================================

/**
 * Context for managing state during agent execution.
 *
 * @example
 * ```typescript
 * const ctx = createContext();
 * ctx.set("user", { id: 123, name: "Alice" });
 *
 * const user = ctx.get<{ id: number; name: string }>("user");
 * ```
 *
 * @category Context
 */
export interface AgentContext {
  /** The underlying data store */
  data: Map<string, unknown>;

  /**
   * Get a value from context.
   * @typeParam T - The expected type of the value
   * @param key - The key to look up
   * @returns The value, or undefined if not found
   */
  get<T>(key: string): T | undefined;

  /**
   * Set a value in context.
   * @typeParam T - The type of the value
   * @param key - The key to set
   * @param value - The value to store
   */
  set<T>(key: string, value: T): void;

  /**
   * Check if a key exists in context.
   * @param key - The key to check
   */
  has(key: string): boolean;

  /**
   * Delete a key from context.
   * @param key - The key to delete
   * @returns True if the key existed and was deleted
   */
  delete(key: string): boolean;

  /** Clear all values from context. */
  clear(): void;
}

// =============================================================================
// MCP Server Configuration
// =============================================================================

/**
 * Base configuration for MCP servers.
 *
 * @category MCP
 */
interface MCPServerConfigBase {
  /**
   * Environment variables for the MCP server.
   * Supports `${VAR}` syntax for expansion at runtime.
   */
  env?: Record<string, string>;

  /**
   * Security: Allowlist of permitted tool names from this server.
   * If specified, only tools in this list will be loaded and available for use.
   * Tool names should be the original names (without the mcp__ prefix).
   *
   * @example
   * ```typescript
   * // Only allow specific GitHub tools
   * allowedTools: ["get_issue", "list_issues"]
   * ```
   */
  allowedTools?: string[];

  /**
   * Security: Validate tool inputs against their declared JSON Schema.
   * When enabled, tool inputs will be validated before execution.
   * Invalid inputs will throw an error instead of being passed to the server.
   *
   * @default false
   */
  validateInputs?: boolean;

  /**
   * Security: Reject tools that don't have a proper input schema.
   * When enabled, tools without schemas or with empty schemas will not be loaded.
   * Useful for enforcing that all tools have explicit input validation.
   *
   * @default false
   */
  requireSchema?: boolean;
}

/**
 * Configuration for stdio-based MCP servers.
 * These run as local processes communicating via stdin/stdout.
 *
 * @example
 * ```typescript
 * const config: StdioMCPServerConfig = {
 *   type: "stdio",
 *   command: "npx",
 *   args: ["-y", "@modelcontextprotocol/server-github"],
 *   env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
 * };
 * ```
 *
 * @category MCP
 */
export interface StdioMCPServerConfig extends MCPServerConfigBase {
  type: "stdio";
  /** Command to execute */
  command: string;
  /** Arguments for the command */
  args?: string[];
}

/**
 * Configuration for HTTP-based MCP servers.
 *
 * @example
 * ```typescript
 * const config: HttpMCPServerConfig = {
 *   type: "http",
 *   url: "https://api.example.com/mcp",
 *   headers: { Authorization: "Bearer ${TOKEN}" },
 * };
 * ```
 *
 * @category MCP
 */
export interface HttpMCPServerConfig extends MCPServerConfigBase {
  type: "http";
  /** Server URL */
  url: string;
  /** HTTP headers (supports ${VAR} expansion) */
  headers?: Record<string, string>;
}

/**
 * Configuration for SSE-based MCP servers (streaming).
 *
 * @category MCP
 */
export interface SseMCPServerConfig extends MCPServerConfigBase {
  type: "sse";
  /** Server URL */
  url: string;
  /** HTTP headers (supports ${VAR} expansion) */
  headers?: Record<string, string>;
}

/**
 * Union type for all MCP server configurations.
 *
 * @category MCP
 */
export type MCPServerConfig = StdioMCPServerConfig | HttpMCPServerConfig | SseMCPServerConfig;
