/**
 * Core agent implementation.
 *
 * @packageDocumentation
 */

import type { ModelMessage, Tool, ToolCallRepairFunction, ToolExecutionOptions, ToolSet } from "ai";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  NoSuchToolError,
  streamText,
} from "ai";
import { createCheckpointRuntime, getCheckpointRunId } from "./agent/checkpoint-runtime.js";
import {
  buildStopConditions,
  createToolPipeline,
  filterToolsByAllowed,
  type GenerateSignalState,
  InterruptSignal,
  isInterruptSignal,
  wrapToolsWithExecutionContext,
} from "./agent/tool-pipeline.js";
import type { BackendProtocol, ExecutableBackend } from "./backend.js";
import { hasExecuteCapability } from "./backend.js";
import { CommandBlockedError } from "./backends/filesystem.js";
import type { AgentState } from "./backends/state.js";
import { createAgentState, StateBackend } from "./backends/state.js";
import {
  formatDefaultTaskCompletionPrompt,
  formatDefaultTaskFailurePrompt,
} from "./background-task-formatting.js";
import type { Checkpoint, Interrupt } from "./checkpointer/types.js";
import {
  createCheckpoint,
  createInterrupt,
  isApprovalInterrupt,
  updateCheckpoint,
} from "./checkpointer/types.js";
import type { AgentError } from "./errors/index.js";
import {
  createRetryLoopState,
  handleGenerationError,
  invokePreGenerateHooks,
  normalizeError,
  updateRetryLoopState,
  waitForRetryDelay,
} from "./generation-helpers.js";
import { extractUpdatedResult, invokeHooksWithTimeout } from "./hooks.js";
import { MCPManager } from "./mcp/manager.js";
import { applyMiddleware, mergeHooks, setupMiddleware } from "./middleware/index.js";
import {
  buildExecutionTelemetry,
  buildExecutionTelemetryFromIds,
  createRunId,
} from "./observability/execution-metadata.js";
import { createDefaultPromptBuilder } from "./prompt-builder/components.js";
import type {
  PromptContext,
  PromptInstructionLayer,
  PromptMemoryContext,
} from "./prompt-builder/index.js";
import { ACCEPT_EDITS_BLOCKED_PATTERNS } from "./security/index.js";
import { createSubagent } from "./subagents.js";
import { TaskManager } from "./task-manager.js";
import type { BackgroundTask } from "./task-store/types.js";
import { formatPluginToolName, resolveStaticToolDescription } from "./tool-names.js";
import { createCallToolTool } from "./tools/call-tool.js";
import { coreToolsToToolSet, createCoreTools, createSearchToolsTool } from "./tools/factory.js";
import type { SkillDefinition } from "./tools/skills.js";
import type {
  Agent,
  AgentOptions,
  BackendFactory,
  GenerateOptions,
  GenerateResult,
  GenerateResultComplete,
  GenerateResultInterrupted,
  GenerateStep,
  InterruptRequestedInput,
  InterruptResolvedInput,
  MCPConnectionFailedInput,
  MCPConnectionRestoredInput,
  ModelInputCapabilities,
  PostGenerateInput,
  StreamingContext,
  StreamPart,
  SubagentDefinition,
  ToolCallResult,
  ToolResultPart,
} from "./types.js";

let agentIdCounter = 0;

type ToolContentOutputPart =
  | { type: "text"; text: string; [key: string]: unknown }
  | { type: "media"; data: string; mediaType: string; [key: string]: unknown }
  | { type: "image-data"; data: string; mediaType: string; [key: string]: unknown }
  | { type: "image-url"; url: string; [key: string]: unknown }
  | { type: "image-file-id"; fileId: string | Record<string, string>; [key: string]: unknown }
  | {
      type: "file-data";
      data: string;
      mediaType: string;
      filename?: string;
      [key: string]: unknown;
    }
  | { type: "file-url"; url: string; [key: string]: unknown }
  | { type: "file-id"; fileId: string | Record<string, string>; [key: string]: unknown }
  | { type: "custom"; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

type ToolContentOutput = {
  type: "content";
  value: ToolContentOutputPart[];
  [key: string]: unknown;
};

/** @internal */
function isToolContentOutput(output: unknown): output is ToolContentOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { type?: unknown }).type === "content" &&
    Array.isArray((output as { value?: unknown }).value)
  );
}

/** @internal */
function resolveModelInputCapabilities(
  options: AgentOptions,
  model: AgentOptions["model"],
): ModelInputCapabilities | undefined {
  const resolver = options.modelCapabilities;

  if (!resolver) {
    return undefined;
  }

  return typeof resolver === "function" ? resolver(model) : resolver;
}

/** @internal */
function createToolExecutionContext(
  options: AgentOptions,
  model: AgentOptions["model"],
): {
  agentSdk: { currentModel: AgentOptions["model"]; modelCapabilities?: ModelInputCapabilities };
} {
  const modelCapabilities = resolveModelInputCapabilities(options, model);

  return {
    agentSdk: {
      currentModel: model,
      ...(modelCapabilities ? { modelCapabilities } : {}),
    },
  };
}

/** @internal */
async function createToolModelOutput({
  tool,
  toolCallId,
  input,
  output,
}: {
  tool: Tool | undefined;
  toolCallId: string;
  input: unknown;
  output: unknown;
}): Promise<unknown> {
  const toolWithModelOutput = tool as
    | {
        toModelOutput?: (options: {
          toolCallId: string;
          input: unknown;
          output: unknown;
        }) => unknown | PromiseLike<unknown>;
      }
    | undefined;

  if (toolWithModelOutput?.toModelOutput) {
    return toolWithModelOutput.toModelOutput({ toolCallId, input, output });
  }

  return typeof output === "string"
    ? { type: "text" as const, value: output }
    : { type: "json" as const, value: output ?? null };
}

/** @internal */
function downgradeToolContentOutput(
  output: unknown,
  capabilities: ModelInputCapabilities | undefined,
): unknown {
  if (
    typeof output === "object" &&
    output !== null &&
    (output as { type?: unknown }).type === "json" &&
    "value" in output
  ) {
    return {
      ...output,
      value: downgradeToolContentOutput((output as { value: unknown }).value, capabilities),
    };
  }

  if (!isToolContentOutput(output)) {
    return output;
  }

  const value: ToolContentOutputPart[] = [];

  for (const part of output.value) {
    switch (part.type) {
      case "text":
        value.push(part);
        break;
      case "image-data":
      case "image-url":
      case "image-file-id":
      case "media":
        value.push(
          capabilities?.imageInput === false
            ? {
                type: "text",
                text: "[Image omitted: active model does not support image input.]",
              }
            : part,
        );
        break;
      case "file-data":
      case "file-url":
      case "file-id":
        value.push(
          capabilities?.fileInput === false
            ? {
                type: "text",
                text: "[File omitted: active model does not support file input.]",
              }
            : part,
        );
        break;
      case "custom":
        value.push(part);
        break;
      default:
        value.push(part);
        break;
    }
  }

  return { ...output, value };
}

/** @internal */
function projectMessagesForModel(
  messages: ModelMessage[],
  capabilities: ModelInputCapabilities | undefined,
): ModelMessage[] {
  if (capabilities?.imageInput !== false && capabilities?.fileInput !== false) {
    return messages;
  }

  return messages.map((message) => {
    if (message.role !== "tool" || !Array.isArray(message.content)) {
      return message;
    }

    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result") {
          return part;
        }

        const output = "output" in part ? part.output : undefined;
        const result = "result" in part ? (part as { result?: unknown }).result : undefined;

        return {
          ...part,
          ...("output" in part ? { output: downgradeToolContentOutput(output, capabilities) } : {}),
          ...("result" in part ? { result: downgradeToolContentOutput(result, capabilities) } : {}),
        };
      }),
    };
  }) as ModelMessage[];
}

/**
 * Internal marker for errors thrown by nested background follow-up turns.
 *
 * Nested follow-up requests run their own retry pipeline. If they fail
 * terminally, the parent request must surface that failure directly instead of
 * re-entering the parent's retry handler under the wrong request class.
 *
 * @internal
 */
class NestedBackgroundGenerationError extends Error {
  readonly originalError: Error;

  constructor(originalError: Error) {
    super(originalError.message);
    this.name = "NestedBackgroundGenerationError";
    this.originalError = originalError;
  }
}

/**
 * Wraps a backend with execute capability to add additional blocked command patterns.
 * This creates a proxy that intercepts execute() calls and validates
 * commands against the additional patterns before delegating.
 * @internal
 */
function wrapBackendWithBlockedPatterns<T extends ExecutableBackend>(
  backend: T,
  additionalPatterns: RegExp[],
): T {
  // Create a proxy that intercepts execute() calls
  return new Proxy(backend, {
    get(target, prop, receiver) {
      if (prop === "execute") {
        return async (command: string) => {
          // Check additional patterns before delegating
          for (const pattern of additionalPatterns) {
            if (pattern.test(command)) {
              throw new CommandBlockedError(
                command,
                "Command blocked by acceptEdits shell file operation safety",
              );
            }
          }
          // Delegate to original execute
          return target.execute(command);
        };
      }
      // For all other properties, delegate to target
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Determines if an error is related to context length/token limits.
 * @internal
 */
function isContextLengthError(error: AgentError): boolean {
  const message = error.message.toLowerCase();
  const causeMessage = error.cause?.message?.toLowerCase() ?? "";

  // Check for common context length error patterns
  const contextErrorPatterns = [
    "context length",
    "context_length",
    "token limit",
    "maximum context",
    "too long",
    "exceeds",
    "max tokens",
    "context size",
  ];

  return contextErrorPatterns.some(
    (pattern) => message.includes(pattern) || causeMessage.includes(pattern),
  );
}

/**
 * Check if a value is a backend factory function.
 */
function isBackendFactory(value: BackendProtocol | BackendFactory): value is BackendFactory {
  return typeof value === "function";
}

/**
 * Creates a new agent instance with the specified configuration.
 *
 * Agents are the main abstraction for interacting with AI models. They combine
 * a language model with tools, plugins, and hooks to create intelligent assistants.
 *
 * @param options - Configuration options for the agent
 * @returns A configured agent instance
 *
 * @example
 * ```typescript
 * import { createAgent } from "@lleverage-ai/agent-sdk";
 * import { anthropic } from "@ai-sdk/anthropic";
 * import { tool } from "ai";
 * import { z } from "zod";
 *
 * const agent = createAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   systemPrompt: "You are a helpful assistant.",
 *   tools: {
 *     weather: tool({
 *       description: "Get weather for a city",
 *       inputSchema: z.object({ city: z.string() }),
 *       execute: async ({ city }) => `Weather in ${city}: sunny`,
 *     }),
 *   },
 * });
 *
 * const result = await agent.generate({
 *   prompt: "What's the weather in Tokyo?",
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Use in a Next.js API route with useChat
 * export async function POST(req: Request) {
 *   const { messages } = await req.json();
 *   return agent.streamResponse({ messages });
 * }
 * ```
 *
 * @category Agent
 */
export function createAgent(options: AgentOptions): Agent {
  const id = `agent-${++agentIdCounter}`;

  // Validate mutually exclusive prompt options
  if (options.systemPrompt !== undefined && options.promptBuilder) {
    throw new Error(
      "Cannot specify both systemPrompt and promptBuilder - they are mutually exclusive",
    );
  }

  // Determine prompt mode
  // - 'static': Use systemPrompt string directly
  // - 'builder': Use PromptBuilder to generate dynamic prompts
  const promptMode: "static" | "builder" =
    options.systemPrompt !== undefined ? "static" : "builder";

  // Get or create prompt builder
  const promptBuilder =
    options.promptBuilder ?? (promptMode === "builder" ? createDefaultPromptBuilder() : undefined);

  // Process middleware to get hooks (middleware hooks come before explicit hooks)
  const middleware = options.middleware ?? [];
  const middlewareHooks = applyMiddleware(middleware);
  const pluginHooks = (options.plugins ?? []).filter((p) => p.hooks).map((p) => p.hooks!);
  const mergedHooks = mergeHooks(middlewareHooks, ...pluginHooks, options.hooks);

  // Create options with merged hooks for all hook lookups
  const effectiveHooks = mergedHooks;

  // Permission mode (mutable for setPermissionMode)
  let permissionMode = options.permissionMode ?? "default";

  // Store approval decisions in-memory (keyed by toolUseId)
  // In production, this could be persisted via checkpointer
  const approvalDecisions = new Map<string, boolean>();

  // Store pending interrupt responses (keyed by interrupt ID or tool call ID)
  // Used by the new interrupt/resume system
  const pendingResponses = new Map<string, unknown>();

  // Initialize agent state (shared with backend if using factory)
  const state: AgentState = createAgentState();

  // Initialize backend - default to StateBackend if not provided
  let backend: BackendProtocol;
  if (options.backend) {
    if (isBackendFactory(options.backend)) {
      // Factory function - create backend with shared state
      backend = options.backend(state);
    } else {
      // Direct backend instance
      backend = options.backend;
    }
  } else {
    // Default: StateBackend with shared state
    backend = new StateBackend(state);
  }

  // Initialize task manager for background task tracking
  const taskManager = new TaskManager();

  // Background task completion options
  const waitForBackgroundTasks = options.waitForBackgroundTasks ?? true;
  const formatTaskCompletion =
    options.formatTaskCompletion ??
    ((task: BackgroundTask): string => formatDefaultTaskCompletionPrompt(task));
  const formatTaskFailure =
    options.formatTaskFailure ??
    ((task: BackgroundTask): string => formatDefaultTaskFailurePrompt(task));

  // Determine plugin loading mode
  const pluginLoadingMode = options.pluginLoading ?? "eager";

  // Collect skills from options and plugins
  const skills: SkillDefinition[] = [...(options.skills ?? [])];

  // Initialize MCP manager for unified plugin tool handling
  // Note: The callbacks reference `agent` which is defined later, but they
  // won't be called until MCP connections happen in initPromise, by which
  // time `agent` is already defined.
  const mcpManager = new MCPManager({
    onConnectionFailed: async (input) => {
      const hooks = effectiveHooks?.MCPConnectionFailed ?? [];
      if (hooks.length === 0) return;

      const hookInput: MCPConnectionFailedInput = {
        hook_event_name: "MCPConnectionFailed",
        session_id: "default",
        cwd: process.cwd(),
        server_name: input.server_name,
        config: input.config,
        error: input.error,
      };

      await invokeHooksWithTimeout(hooks, hookInput, null, agent);
    },
    onConnectionRestored: async (input) => {
      const hooks = effectiveHooks?.MCPConnectionRestored ?? [];
      if (hooks.length === 0) return;

      const hookInput: MCPConnectionRestoredInput = {
        hook_event_name: "MCPConnectionRestored",
        session_id: "default",
        cwd: process.cwd(),
        server_name: input.server_name,
        tool_count: input.tool_count,
      };

      await invokeHooksWithTimeout(hooks, hookInput, null, agent);
    },
  });

  // Determine if backend has execute capability
  // Also support legacy sandbox pattern for backward compatibility
  let effectiveBackend: BackendProtocol = backend;

  // Apply acceptEdits shell file operation blocking
  // When permissionMode is "acceptEdits" and backend has execute capability,
  // automatically block shell-based file operations unless explicitly disabled
  if (permissionMode === "acceptEdits" && hasExecuteCapability(backend)) {
    const blockShellFileOps = options.blockShellFileOps ?? true;

    if (blockShellFileOps) {
      // Wrap the backend to block shell file operations
      effectiveBackend = wrapBackendWithBlockedPatterns(backend, ACCEPT_EDITS_BLOCKED_PATTERNS);
    } else {
      // User explicitly disabled shell blocking - log a warning
      console.warn(
        "[agent-sdk] Warning: blockShellFileOps is disabled in acceptEdits mode. " +
          "Shell commands like 'echo > file', 'rm', 'mv', etc. can bypass file edit permissions. " +
          "This is not recommended for production use.",
      );
    }
  }

  // Tool search configuration
  const toolSearchConfig = options.toolSearch ?? {};
  const toolSearchEnabled = toolSearchConfig.enabled ?? "auto";
  const toolSearchThreshold = toolSearchConfig.threshold ?? 20;
  const toolSearchMaxResults = toolSearchConfig.maxResults ?? 10;

  // Track whether deferred loading is active
  let deferredLoadingActive = false;

  // Track whether any deferred or proxy plugins exist (for call_tool creation)
  let hasProxiedTools = false;

  // Auto-created subagent definitions from delegated plugins
  const autoSubagents: SubagentDefinition[] = [];

  // Collect plugin skills early so they're available for skill tool creation.
  // IMPORTANT: Plugin skills must be collected BEFORE createCoreTools() is called
  // so the skill tool includes them in progressive disclosure.
  for (const plugin of options.plugins ?? []) {
    if (plugin.tools) {
      // Fail fast on reserved inline plugin namespaces during agent creation.
      formatPluginToolName(plugin.name, "__validation__");
    }
    if (plugin.skills) {
      skills.push(...plugin.skills);
    }
  }

  // Determine if we should use deferred loading based on tool search settings
  // Note: Only activate deferred loading if explicitly requested, not based on auto threshold
  // The auto threshold should only affect whether search_tools is created, not loading behavior
  if (toolSearchEnabled === "always" || pluginLoadingMode === "proxy") {
    deferredLoadingActive = true;
  }
  // Removed: auto threshold no longer forces deferred loading
  // The default eager loading should be respected

  const isPluginDeferred = (plugin: { deferred?: boolean }): boolean =>
    plugin.deferred === true || (pluginLoadingMode === "proxy" && plugin.deferred !== false);

  // Auto-create core tools (unless user provides explicit tools)
  // Note: search_tools is created separately below based on loading mode
  const { tools: autoCreatedCoreTools, skillRegistry: createdSkillRegistry } = createCoreTools({
    backend: effectiveBackend,
    state,
    taskManager,
    // Don't pass mcpManager here - we create search_tools manually below
    mcpManager: undefined,
    disabled: options.disabledCoreTools,
    skills,
  });

  // Start with auto-created core tools, then overlay user-provided tools
  const coreTools: ToolSet = {
    ...coreToolsToToolSet(autoCreatedCoreTools),
    ...(options.tools ?? {}),
  };

  // Process plugins based on loading mode, deferred, and delegation settings
  // Note: Plugin skills are collected earlier (before createCoreTools) so
  // the skill tool can include them in progressive disclosure.
  for (const plugin of options.plugins ?? []) {
    if (plugin.tools) {
      const isDeferred = isPluginDeferred(plugin);
      const autoLoad = !(isDeferred || (deferredLoadingActive && plugin.deferred !== false));

      if (isDeferred) {
        hasProxiedTools = true;
      }

      // Register all plugin tools through the shared discovery manager.
      // Eager tools auto-load into the active ToolSet; deferred/proxy tools stay
      // discoverable via search_tools + call_tool.
      mcpManager.registerPluginTools(plugin.name, plugin.tools, { autoLoad });
    }
  }

  // Only tools registered in MCP are discoverable via search_tools.
  const discoverablePluginToolCount = mcpManager.listTools().length;

  // Create subagent definitions from plugins with subagent config
  for (const plugin of options.plugins ?? []) {
    if (plugin.subagent) {
      autoSubagents.push({
        type: `plugin-${plugin.name}`,
        description: plugin.subagent.description,
        model: plugin.subagent.model ?? "inherit",
        create: (_ctx) =>
          createSubagent(agent, {
            name: `plugin-${plugin.name}`,
            description: plugin.subagent!.description,
            model: _ctx.model,
            tools: plugin.subagent!.tools,
            systemPrompt:
              plugin.subagent!.prompt ??
              `You are a ${plugin.name} specialist. Complete the requested task using available tools and return a clear summary.`,
          }),
      });
    }
  }

  // Merge auto-created subagents with user-provided ones
  const allSubagents: SubagentDefinition[] = [...(options.subagents ?? []), ...autoSubagents];
  const hasSubagents = allSubagents.length > 0;

  // In proxy mode, create call_tool and configure search_tools with schema disclosure
  const isProxyMode = pluginLoadingMode === "proxy" || hasProxiedTools;
  const hasProxyTargets = hasProxiedTools || mcpManager.hasExternalServers();
  if (isProxyMode && hasProxyTargets && !options.disabledCoreTools?.includes("call_tool")) {
    coreTools.call_tool = createCallToolTool({
      mcpManager,
    });
  }

  // Create search_tools for MCP tool discovery and/or plugin loading
  // New behavior:
  // - Create when auto threshold is exceeded (for lazy discovery)
  // - Create when deferred loading is active (explicitly requested)
  // - Create when proxy mode is active (for call_tool discovery)
  // - Create when external MCP servers exist (for MCP tool search)
  // - Always auto-load tools when found (no manual load step) — unless proxy mode
  const shouldCreateSearchToolsForAutoThreshold =
    toolSearchEnabled === "auto" && discoverablePluginToolCount > toolSearchThreshold;

  const shouldCreateSearchTools =
    !options.disabledCoreTools?.includes("search_tools") &&
    ((deferredLoadingActive &&
      (discoverablePluginToolCount > 0 || mcpManager.hasExternalServers())) ||
      (isProxyMode && hasProxyTargets) ||
      shouldCreateSearchToolsForAutoThreshold ||
      (mcpManager.hasExternalServers() && toolSearchEnabled !== "never"));

  if (shouldCreateSearchTools) {
    coreTools.search_tools = createSearchToolsTool({
      manager: mcpManager,
      maxResults: toolSearchMaxResults,
      // In proxy mode: don't auto-load, include schema for call_tool usage
      enableLoad: !isProxyMode,
      autoLoad: !isProxyMode,
      includeSchema: isProxyMode,
      onToolsLoaded: (toolNames) => {
        // Tools are now loaded in MCPManager and will be included by the tool pipeline
        // This callback can be used for logging/notifications
      },
    });
  }

  /**
   * Route exact, currently discoverable proxy targets through `call_tool` when
   * a model emits their qualified name directly. The AI SDK reparses the
   * returned call against the active ToolSet, preserving the original call ID
   * and sending execution through the normal validation/approval pipeline.
   *
   * Returns `null` (no repair) unless every precondition holds: repair is
   * enabled, the failure is `NoSuchToolError`, `call_tool` is active, the
   * requested name is a known discoverable tool, and the raw input parses to a
   * plain JSON object.
   *
   * Repair is enabled by default. It can be disabled per agent via
   * `repairDiscoveredToolCalls: false`, or globally (e.g. in tests that assert
   * the unrepaired error path) with `AGENT_SDK_DISABLE_TOOL_CALL_REPAIR=true`.
   * The explicit option wins over the environment variable.
   */
  const isDiscoveredToolCallRepairEnabled = (): boolean => {
    if (options.repairDiscoveredToolCalls !== undefined) {
      return options.repairDiscoveredToolCalls;
    }
    return process.env.AGENT_SDK_DISABLE_TOOL_CALL_REPAIR !== "true";
  };

  const repairDiscoveredToolCall: ToolCallRepairFunction<ToolSet> = async ({
    error,
    toolCall,
    tools,
  }) => {
    if (
      !isDiscoveredToolCallRepairEnabled() ||
      !NoSuchToolError.isInstance(error) ||
      !Object.hasOwn(tools, "call_tool") ||
      !mcpManager.getToolMetadata(toolCall.toolName)
    ) {
      return null;
    }

    const rawInput = toolCall.input.trim();
    let parsedInput: unknown;
    try {
      parsedInput = rawInput.length === 0 ? {} : JSON.parse(rawInput);
    } catch {
      return null;
    }
    if (typeof parsedInput !== "object" || parsedInput === null || Array.isArray(parsedInput)) {
      return null;
    }

    return {
      ...toolCall,
      toolName: "call_tool",
      input: JSON.stringify({
        tool_name: toolCall.toolName,
        arguments: parsedInput,
      }),
    };
  };

  /**
   * AI SDK `repairToolCall` hook.
   *
   * Invalid-input / unknown-tool failures happen before `execute()`, so the
   * execute wrapper cannot sanitise them. First try the discovered-tool routing
   * above; if it does not apply, route the parse failure through the configured
   * `transformToolError` and deliberately throw the transformed value so the AI
   * SDK records only that in the next model step and checkpoint.
   */
  const repairToolCall: ToolCallRepairFunction<ToolSet> = async (params) => {
    const repaired = await repairDiscoveredToolCall(params);
    if (repaired) {
      return repaired;
    }
    if (options.transformToolError) {
      throw options.transformToolError(params.error, { toolName: params.toolCall.toolName });
    }
    return null;
  };

  /**
   * `repairToolCall` under both names the AI SDK accepts. Versions before
   * 7.0.20 only read `experimental_repairToolCall` (the stable name is bound
   * from it with a default); newer versions prefer the stable name. Passing
   * both keeps the `ai` peer range at `^7.0.0` without silently losing repair
   * on older installs.
   */
  const repairToolCallOptions = {
    repairToolCall,
    experimental_repairToolCall: repairToolCall,
  } as const;

  const mergeInstructionLayers = (
    ...layerSets: Array<PromptInstructionLayer[] | undefined>
  ): PromptInstructionLayer[] | undefined => {
    const merged = layerSets.flatMap((layers) => (layers ?? []).map((layer) => ({ ...layer })));
    return merged.length > 0 ? merged : undefined;
  };

  const mergePromptMemory = (
    base?: PromptMemoryContext,
    override?: PromptMemoryContext,
  ): PromptMemoryContext | undefined => {
    const standingInstructions = [
      ...(base?.standingInstructions ?? []),
      ...(override?.standingInstructions ?? []),
    ]
      .filter((entry) => entry.content.trim().length > 0)
      .map((entry) => ({ ...entry }));
    const recall = [...(base?.recall ?? []), ...(override?.recall ?? [])]
      .filter((entry) => entry.content.trim().length > 0)
      .map((entry) => ({ ...entry }));

    if (standingInstructions.length === 0 && recall.length === 0) {
      return undefined;
    }

    return {
      standingInstructions: standingInstructions.length > 0 ? standingInstructions : undefined,
      recall: recall.length > 0 ? recall : undefined,
    };
  };

  // Helper to build prompt context from current agent state
  const buildPromptContext = (
    genOptions: Pick<GenerateOptions, "instructionLayers" | "memory"> | undefined,
    messages?: ModelMessage[],
    threadId?: string,
  ): PromptContext => {
    // Get filtered tools (respecting allowedTools/disallowedTools) so the prompt
    // only advertises tools the agent will actually expose
    const filteredTools = filterToolsByAllowed(
      (() => {
        const allTools: ToolSet = { ...coreTools };
        Object.assign(allTools, runtimeTools);
        Object.assign(allTools, mcpManager.getToolSet());
        return allTools;
      })(),
      options.allowedTools,
      options.disallowedTools,
    );

    // Extract tool metadata for context
    const toolsMetadata = Object.entries(filteredTools).map(([name, tool]) => ({
      name,
      // AI SDK 7 allows a dynamic (function) description (the skill tool uses
      // one); evaluate it so the prompt listing matches what the model sees.
      description: resolveStaticToolDescription(tool.description),
    }));

    // Extract skills metadata — exclude skills in the registry (accessible via skill tool)
    const nonRegistrySkills = createdSkillRegistry
      ? skills.filter((s) => !createdSkillRegistry.has(s.name))
      : skills;
    const skillsMetadata = nonRegistrySkills.map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));

    const loadedSkillsMetadata = createdSkillRegistry?.listLoadedDetails().map((skill) => ({
      name: skill.name,
      summary: skill.description,
      instructions: skill.instructions,
    }));

    // Extract plugins metadata
    const pluginsMetadata = (options.plugins ?? []).map((plugin) => ({
      name: plugin.name,
      description: plugin.description ?? "",
    }));

    // Build backend info
    const backendInfo = {
      type: backend.constructor.name.toLowerCase().replace("backend", "") || "unknown",
      hasExecuteCapability: hasExecuteCapability(backend),
      rootDir: "rootDir" in backend ? (backend.rootDir as string | undefined) : undefined,
    };

    const memoryContext = mergePromptMemory(options.memory, genOptions?.memory);

    return {
      tools: toolsMetadata.length > 0 ? toolsMetadata : undefined,
      skills: skillsMetadata.length > 0 ? skillsMetadata : undefined,
      plugins: pluginsMetadata.length > 0 ? pluginsMetadata : undefined,
      instructionLayers: mergeInstructionLayers(
        options.instructionLayers,
        genOptions?.instructionLayers,
      ),
      memory: memoryContext,
      loadedSkills:
        loadedSkillsMetadata && loadedSkillsMetadata.length > 0 ? loadedSkillsMetadata : undefined,
      backend: backendInfo,
      state,
      // Model ID extraction is not reliable across all LanguageModel types
      // Users can access the full model via their custom context if needed
      model: undefined,
      maxSteps: options.maxSteps,
      permissionMode,
      currentMessages: messages,
      threadId,
      memoryAvailable: options.memoryAvailable ?? false,
      custom: {
        hasSubagents,
        delegationInstructions: options.delegationInstructions,
      },
    };
  };

  // Helper to get system prompt (either static or built from context)
  const getSystemPrompt = (context: PromptContext): string | undefined => {
    if (promptMode === "static") {
      return options.systemPrompt;
    }
    // Build prompt using prompt builder
    return promptBuilder!.build(context);
  };

  const responseMessagesToModelMessages = (messages: unknown[] | undefined): ModelMessage[] =>
    Array.isArray(messages) ? (messages as ModelMessage[]) : [];

  const appendResponseMessages = (
    baseMessages: ModelMessage[],
    responseMessages: unknown[] | undefined,
    fallbackAssistantText?: string,
  ): ModelMessage[] => {
    const normalized = responseMessagesToModelMessages(responseMessages);
    if (normalized.length > 0) {
      return [...baseMessages, ...normalized];
    }

    return fallbackAssistantText
      ? [...baseMessages, { role: "assistant" as const, content: fallbackAssistantText }]
      : baseMessages;
  };

  /**
   * Build the full transcript for persistence from a multi-step result.
   *
   * The AI SDK's top-level `response.messages` only holds the FINAL step's
   * messages, so a run that called tools in earlier steps would lose those
   * tool calls/results if we used it directly. Prefer the per-step response
   * messages; fall back to `fallbackResponseMessages` (the top-level
   * `response.messages`) and finally to the assistant text.
   */
  const buildMessagesFromStepResponses = (
    baseMessages: ModelMessage[],
    steps: Array<{ text?: string; response?: { messages?: unknown[] } }>,
    fallbackAssistantText?: string,
    fallbackResponseMessages?: unknown[],
  ): ModelMessage[] => {
    const stepResponseMessages = steps.flatMap((step) =>
      responseMessagesToModelMessages(step.response?.messages),
    );
    if (stepResponseMessages.length > 0) {
      return [...baseMessages, ...stepResponseMessages];
    }

    const lastText = steps.at(-1)?.text || fallbackAssistantText;
    return appendResponseMessages(baseMessages, fallbackResponseMessages, lastText);
  };

  // Runtime tools added/removed dynamically by plugins at runtime
  const runtimeTools: ToolSet = {};

  /**
   * Tool execution pipeline. Composes permission mode, task tools, task
   * manager injection, hooks, streaming context and signal catching in a
   * fixed order; see `./agent/tool-pipeline.ts` for the layer diagram.
   */
  const toolPipeline = createToolPipeline({
    options,
    // `agent` is assigned below; the pipeline only dereferences it per call.
    getAgent: () => agent,
    coreTools,
    runtimeTools,
    mcpManager,
    taskManager,
    hooks: effectiveHooks,
    getPermissionMode: () => permissionMode,
    approvalDecisions,
    pendingResponses,
    subagents: allSubagents,
  });

  /**
   * Checkpoint cache and persistence; see `./agent/checkpoint-runtime.ts`.
   */
  const checkpoints = createCheckpointRuntime({ checkpointer: options.checkpointer, state });
  const { load: loadCheckpoint, save: saveCheckpoint, fork: forkCheckpoint } = checkpoints;

  /**
   * Compact a message list when the configured context policy requires it.
   *
   * Shared by the run-boundary load (`buildMessages`) and the streaming tool
   * loop (`createStreamingCompactionState`) so long runs cannot grow past the
   * compaction threshold between model generations. Emits the PreCompact and
   * PostCompact hooks around the compaction.
   *
   * @returns The (possibly compacted) messages and whether compaction ran
   */
  async function compactMessagesIfNeeded(
    messages: ModelMessage[],
    genOptions: GenerateOptions,
    threadId: string | undefined,
  ): Promise<{ compacted: boolean; messages: ModelMessage[] }> {
    // Skip compaction if _skipCompaction flag is set (used during summary generation)
    if (!options.contextManager || genOptions._skipCompaction) {
      return { compacted: false, messages };
    }

    const contextManager = options.contextManager;
    const { trigger, reason } = contextManager.shouldCompact(messages);
    if (!trigger || !reason) {
      return { compacted: false, messages };
    }

    const compactionTelemetry = buildExecutionTelemetryFromIds({
      runId: genOptions._runId ?? createRunId(),
      threadId,
      requestedModel: options.model,
    });
    // Calculate token count before compaction
    const tokensBefore = contextManager.tokenCounter.countMessages(messages);
    const messagesBefore = messages.length;

    // Emit PreCompact hook
    const preCompactHooks = effectiveHooks?.PreCompact ?? [];
    if (preCompactHooks.length > 0) {
      const preCompactInput: import("./types.js").PreCompactInput = {
        hook_event_name: "PreCompact",
        session_id: genOptions.threadId ?? "default",
        cwd: process.cwd(),
        telemetry: compactionTelemetry,
        message_count: messagesBefore,
        tokens_before: tokensBefore,
      };
      await invokeHooksWithTimeout(preCompactHooks, preCompactInput, null, agent);
    }

    // Perform compaction
    const compactionResult = await contextManager.compact(messages, agent, reason);

    // Emit PostCompact hook with metrics
    const postCompactHooks = effectiveHooks?.PostCompact ?? [];
    if (postCompactHooks.length > 0) {
      const postCompactInput: import("./types.js").PostCompactInput = {
        hook_event_name: "PostCompact",
        session_id: genOptions.threadId ?? "default",
        cwd: process.cwd(),
        telemetry: compactionTelemetry,
        messages_before: compactionResult.messagesBefore,
        messages_after: compactionResult.messagesAfter,
        tokens_before: compactionResult.tokensBefore,
        tokens_after: compactionResult.tokensAfter,
        tokens_saved: compactionResult.tokensBefore - compactionResult.tokensAfter,
      };
      await invokeHooksWithTimeout(postCompactHooks, postCompactInput, null, agent);
    }

    return { compacted: true, messages: compactionResult.newMessages };
  }

  /**
   * Tracks the durable message base for a streaming tool loop and compacts it
   * before each model generation that does not have a run-boundary check.
   *
   * `buildMessages` already compacts before step 0, so by default the first
   * step is skipped. Follow-up generations (background-task loops) build their
   * own message list without going through `buildMessages`, so they pass
   * `compactFirstStep = true`.
   *
   * The tracked `messages` are authoritative for checkpointing: once
   * `prepareStep` has discarded earlier history, re-deriving the transcript
   * from `response.messages` would resurrect it. `finalize()` falls back to
   * the step responses only when no step was ever appended (e.g. a provider
   * or test double that never invokes `onStepFinish`).
   */
  function createStreamingCompactionState(
    initialMessages: ModelMessage[],
    genOptions: GenerateOptions,
    threadId: string | undefined,
    compactFirstStep = false,
  ) {
    let currentMessages: ModelMessage[] = [...initialMessages];
    let appendedSteps = 0;

    return {
      prepareStep: async ({
        messages,
        stepNumber,
      }: {
        messages: ModelMessage[];
        stepNumber: number;
      }): Promise<{ messages: ModelMessage[] } | undefined> => {
        if (stepNumber === 0 && !compactFirstStep) {
          return undefined;
        }
        const compaction = await compactMessagesIfNeeded(messages, genOptions, threadId);
        if (!compaction.compacted) {
          return undefined;
        }
        currentMessages = compaction.messages;
        return { messages: compaction.messages };
      },
      appendStep(stepResult: {
        text?: string;
        response?: { messages?: unknown[] };
      }): ModelMessage[] {
        appendedSteps++;
        currentMessages = appendResponseMessages(
          currentMessages,
          stepResult.response?.messages,
          stepResult.text,
        );
        return currentMessages;
      },
      /**
       * Final transcript for persistence. Uses the tracked messages when steps
       * were appended via `onStepFinish`; otherwise derives them from `steps`.
       */
      finalize(
        steps: Array<{ text?: string; response?: { messages?: unknown[] } }>,
        fallbackAssistantText?: string,
      ): ModelMessage[] {
        if (appendedSteps > 0 || steps.length === 0) {
          return [...currentMessages];
        }
        return buildMessagesFromStepResponses(currentMessages, steps, fallbackAssistantText);
      },
      get messages(): ModelMessage[] {
        return [...currentMessages];
      },
    };
  }

  /**
   * Build the messages array for AI SDK from GenerateOptions.
   * If a checkpoint exists for the threadId, prepends checkpoint messages.
   * If forkSession is specified, creates a new session from the source.
   * If contextManager is provided, applies automatic compaction if needed.
   */
  async function buildMessages(genOptions: GenerateOptions): Promise<{
    messages: ModelMessage[];
    checkpoint?: Checkpoint;
    forkedSessionId?: string;
  }> {
    const messages: ModelMessage[] = [];
    let checkpoint: Checkpoint | undefined;
    let forkedSessionId: string | undefined;

    // Handle session forking
    if (genOptions.forkSession && genOptions.threadId) {
      forkedSessionId = genOptions.forkSession;
      checkpoint = await forkCheckpoint(genOptions.threadId, forkedSessionId);
      if (checkpoint) {
        // Prepend forked checkpoint messages
        messages.push(...checkpoint.messages);
      }
    } else if (genOptions.threadId) {
      // Normal checkpoint loading
      checkpoint = await loadCheckpoint(genOptions.threadId);
      if (checkpoint) {
        // Prepend checkpoint messages
        messages.push(...checkpoint.messages);
      }
    }

    // Add conversation history if provided
    if (genOptions.messages) {
      messages.push(...genOptions.messages);
    }

    // Add user prompt if provided
    if (genOptions.prompt) {
      messages.push({ role: "user" as const, content: genOptions.prompt });
    }

    // Apply context compaction if contextManager is configured
    const compaction = await compactMessagesIfNeeded(
      messages,
      genOptions,
      forkedSessionId ?? genOptions.threadId,
    );

    return { messages: compaction.messages, checkpoint, forkedSessionId };
  }

  /**
   * Map AI SDK steps to our GenerateStep format.
   */
  function mapSteps(steps: Awaited<ReturnType<typeof generateText>>["steps"]): GenerateStep[] {
    return steps.map((step) => ({
      text: step.text,
      toolCalls: step.toolCalls.map(
        (tc): ToolCallResult => ({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
        }),
      ),
      toolResults: step.toolResults.map(
        (tr): ToolResultPart => ({
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          output: tr.output,
        }),
      ),
      finishReason: step.finishReason as GenerateStep["finishReason"],
      usage: step.usage,
    }));
  }

  /**
   * Get the next actionable task prompt from the background task queue.
   *
   * Waits for a task to reach terminal state, skips already-consumed and killed
   * tasks, formats the result as a prompt, removes the task, and returns it.
   * Returns null when no more tasks need processing.
   */
  async function getNextTaskPrompt(): Promise<string | null> {
    while (taskManager.hasActiveTasks() || taskManager.hasTerminalTasks()) {
      const completedTask = await taskManager.waitForNextCompletion();

      // Dedup: skip if already consumed via task_output tool
      if (!taskManager.getTask(completedTask.id)) {
        continue;
      }

      // Skip killed tasks (user already knows)
      if (completedTask.status === "killed") {
        taskManager.removeTask(completedTask.id);
        continue;
      }

      // Format as follow-up prompt
      const prompt =
        completedTask.status === "completed"
          ? formatTaskCompletion(completedTask)
          : formatTaskFailure(completedTask);

      taskManager.removeTask(completedTask.id);
      return prompt;
    }

    return null;
  }

  async function invokeCachedPostGenerateHooks(
    cachedResult: GenerateResult,
    genOptions: GenerateOptions,
    requestedModel: AgentOptions["model"],
  ): Promise<GenerateResult> {
    if (cachedResult.status !== "complete") {
      return cachedResult;
    }

    const telemetry = buildExecutionTelemetryFromIds({
      runId: genOptions._runId ?? createRunId(),
      threadId: genOptions.threadId,
      requestedModel,
    });
    const result: GenerateResultComplete = {
      ...cachedResult,
      telemetry,
    };

    const postGenerateHooks = effectiveHooks?.PostGenerate ?? [];
    if (postGenerateHooks.length === 0) {
      return result;
    }

    const postGenerateInput: PostGenerateInput = {
      hook_event_name: "PostGenerate",
      session_id: genOptions.threadId ?? "default",
      cwd: process.cwd(),
      telemetry,
      options: genOptions,
      result,
    };
    const hookOutputs = await invokeHooksWithTimeout(
      postGenerateHooks,
      postGenerateInput,
      null,
      agent,
    );
    const updatedResult = extractUpdatedResult<GenerateResultComplete>(hookOutputs);
    return updatedResult
      ? { ...updatedResult, telemetry: updatedResult.telemetry ?? telemetry }
      : result;
  }

  /**
   * Starts a `streamText()` request with the same retry pipeline used by the
   * top-level streaming entrypoints.
   *
   * This only retries failures thrown while creating the stream, matching the
   * outer streaming methods' current retry behavior.
   */
  async function startRetriedStreamText(
    initialGenOptions: GenerateOptions,
    createRequest: (
      requestOptions: GenerateOptions,
      currentModel: AgentOptions["model"],
    ) => ReturnType<typeof streamText>,
  ): Promise<{
    result: ReturnType<typeof streamText>;
    effectiveOptions: GenerateOptions;
    currentModel: AgentOptions["model"];
  }> {
    let requestOptions = initialGenOptions;
    const retryState = createRetryLoopState(
      options.model,
      options.generationRetryPolicy?.maxRetries,
    );

    while (retryState.retryAttempt <= retryState.maxRetries) {
      try {
        return {
          result: createRequest(requestOptions, retryState.currentModel),
          effectiveOptions: requestOptions,
          currentModel: retryState.currentModel,
        };
      } catch (error) {
        const normalizedError = normalizeError(
          error,
          "Stream generation failed",
          requestOptions.threadId,
        );

        const postGenerateFailureHooks = effectiveHooks?.PostGenerateFailure ?? [];
        const retryDecisionHooks = effectiveHooks?.GenerationRetryDecision ?? [];
        const errorDecision = await handleGenerationError({
          error: normalizedError,
          failureHooks: postGenerateFailureHooks,
          decisionHooks: retryDecisionHooks,
          genOptions: requestOptions,
          agent,
          state: retryState,
          fallbackModel: options.fallbackModel,
          retryPolicy: options.generationRetryPolicy,
        });

        if (errorDecision.shouldRetry) {
          if (errorDecision.updatedOptions) {
            requestOptions = errorDecision.updatedOptions;
          }
          Object.assign(retryState, updateRetryLoopState(retryState, errorDecision));
          await waitForRetryDelay(errorDecision.retryDelayMs);
          continue;
        }

        throw normalizedError;
      }
    }

    throw new Error("Unexpected: retry loop exited without return or throw");
  }

  /**
   * Collect all tools (core + static plugin tools + MCP tools) for
   * deterministic tool execution during resume. This is the unwrapped set
   * — no permission mode, hooks, or signal-catching wrappers applied.
   */
  function collectAllTools(): ToolSet {
    const allTools: ToolSet = { ...coreTools };
    for (const plugin of options.plugins ?? []) {
      if (plugin.tools && typeof plugin.tools !== "function") {
        Object.assign(allTools, plugin.tools);
      }
    }
    Object.assign(allTools, mcpManager.getToolSet());
    return allTools;
  }

  /**
   * Discriminated union returned by executeResumeCore.
   *
   * - `continue`: The tool executed successfully and generation should continue.
   * - `re-interrupted`: The tool threw another interrupt during resume (e.g. a
   *   multi-step wizard). The new interrupt has been persisted to the checkpoint.
   */
  type ResumeOutcome =
    | { type: "continue"; threadId: string; genOptions?: Partial<GenerateOptions> }
    | { type: "re-interrupted"; interrupt: Interrupt; checkpoint: Checkpoint };

  /**
   * Shared logic for resume() and resumeDataResponse().
   *
   * Validates the checkpoint/interrupt, stores the user response, emits hooks,
   * executes the interrupted tool (approval or custom), updates the checkpoint,
   * and returns a discriminated outcome so the caller can decide how to continue.
   */
  async function executeResumeCore(
    threadId: string,
    interruptId: string,
    response: unknown,
    genOptions?: Partial<GenerateOptions>,
  ): Promise<ResumeOutcome> {
    if (!options.checkpointer) {
      throw new Error("Cannot resume: checkpointer is required");
    }

    const checkpoint = await options.checkpointer.load(threadId);
    if (!checkpoint) {
      throw new Error(`Cannot resume: no checkpoint found for thread ${threadId}`);
    }

    const interrupt = checkpoint.pendingInterrupt;
    if (!interrupt) {
      throw new Error(`Cannot resume: no pending interrupt found for thread ${threadId}`);
    }

    const resumeTelemetry = buildExecutionTelemetryFromIds({
      runId: getCheckpointRunId(checkpoint) ?? createRunId(),
      threadId,
      requestedModel: options.model,
    });

    if (interrupt.id !== interruptId) {
      throw new Error(
        `Cannot resume: interrupt ID mismatch. Expected ${interrupt.id}, got ${interruptId}`,
      );
    }

    // Store the response keyed by interrupt ID (format: "int_<toolCallId>").
    // The interrupt() function in the tool wrapper looks up responses using
    // this exact key format, so we must use interrupt.id — NOT the raw
    // toolCallId which would never match.
    pendingResponses.set(interrupt.id, response);

    // Emit InterruptResolved hook
    const interruptResolvedHooks = effectiveHooks?.InterruptResolved ?? [];
    if (interruptResolvedHooks.length > 0) {
      const isApproval = isApprovalInterrupt(interrupt);
      const approvalResponse = isApproval ? (response as { approved: boolean }) : undefined;
      const hookInput: InterruptResolvedInput = {
        hook_event_name: "InterruptResolved",
        session_id: threadId,
        cwd: process.cwd(),
        telemetry: resumeTelemetry,
        interrupt_id: interrupt.id,
        interrupt_type: interrupt.type,
        tool_call_id: interrupt.toolCallId,
        tool_name: interrupt.toolName,
        response,
        approved: approvalResponse?.approved,
      };
      await invokeHooksWithTimeout(interruptResolvedHooks, hookInput, null, agent);
    }

    // Handle approval interrupt
    if (isApprovalInterrupt(interrupt)) {
      const approvalResponse = response as { approved: boolean; reason?: string };

      // For backward compatibility, also store in approvalDecisions
      approvalDecisions.set(interrupt.toolCallId, approvalResponse.approved);

      // Build the assistant message with the tool call
      const assistantMessage: ModelMessage = {
        role: "assistant" as const,
        content: [
          {
            type: "tool-call" as const,
            toolCallId: interrupt.toolCallId,
            toolName: interrupt.toolName,
            input: interrupt.request.args,
          },
        ],
      };

      let toolResultOutput: unknown;

      if (approvalResponse.approved) {
        // Approved: Execute the tool deterministically
        const unwrappedTools = collectAllTools();

        const tool = unwrappedTools[interrupt.toolName];
        if (!tool?.execute) {
          throw new Error(
            `Cannot resume: tool "${interrupt.toolName}" not found or has no execute function`,
          );
        }

        try {
          const toolExecutionContext = createToolExecutionContext(options, options.model);
          toolResultOutput = await tool.execute(interrupt.request.args, {
            toolCallId: interrupt.toolCallId,
            messages: checkpoint.messages,
            abortSignal: genOptions?.signal,
            experimental_context: toolExecutionContext,
            executionTelemetry: resumeTelemetry,
          } as unknown as ToolExecutionOptions<unknown>);
        } catch (error) {
          toolResultOutput = `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      } else {
        // Denied: Create a synthetic denial result
        toolResultOutput = `Tool "${interrupt.toolName}" was denied by user${
          approvalResponse.reason ? `: ${approvalResponse.reason}` : ""
        }`;
      }

      const approvalOutput = await createToolModelOutput({
        tool: approvalResponse.approved ? collectAllTools()[interrupt.toolName] : undefined,
        toolCallId: interrupt.toolCallId,
        input: interrupt.request.args,
        output: toolResultOutput,
      });

      const toolResultMessage = {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: interrupt.toolCallId,
            toolName: interrupt.toolName,
            output: approvalOutput,
          },
        ],
      } as ModelMessage;

      // Update checkpoint with the tool call and result messages, clear interrupt
      const updatedMessages: ModelMessage[] = [
        ...checkpoint.messages,
        assistantMessage,
        toolResultMessage,
      ];

      const updatedCheckpoint = updateCheckpoint(checkpoint, {
        messages: updatedMessages,
        pendingInterrupt: undefined,
        step: checkpoint.step + 1,
      });
      await checkpoints.commit(threadId, updatedCheckpoint);

      // Clean up the response from our maps
      pendingResponses.delete(interrupt.id);
      approvalDecisions.delete(interrupt.toolCallId);

      return {
        type: "continue",
        threadId,
        genOptions: { ...genOptions, _runId: resumeTelemetry.runId },
      };
    }

    // For custom interrupts (e.g. ask_user), manually execute the tool so
    // that its interrupt() call receives the stored response deterministically.
    // Re-running generate() would rely on the model re-calling the same tool,
    // but tool call IDs change each generation so pendingResponses would never
    // be matched.
    const customToolCallId = interrupt.toolCallId;
    const customToolName = interrupt.toolName;

    if (!customToolCallId || !customToolName) {
      throw new Error(
        "Cannot resume custom interrupt: missing toolCallId or toolName on interrupt",
      );
    }

    // Build the assistant message with the original tool call
    const customAssistantMessage: ModelMessage = {
      role: "assistant" as const,
      content: [
        {
          type: "tool-call" as const,
          toolCallId: customToolCallId,
          toolName: customToolName,
          input: interrupt.request,
        },
      ],
    };

    // Collect all tools
    const customTools = collectAllTools();

    const customTool = customTools[customToolName];
    if (!customTool?.execute) {
      throw new Error(
        `Cannot resume: tool "${customToolName}" not found or has no execute function`,
      );
    }

    let customToolResult: unknown;
    try {
      const toolExecutionContext = createToolExecutionContext(options, options.model);
      // Execute the tool, providing an interrupt function that returns
      // the stored user response. This mirrors what happens inside the
      // permission-mode tool wrapper when pendingResponses has a match.
      customToolResult = await customTool.execute(interrupt.request, {
        toolCallId: customToolCallId,
        messages: checkpoint.messages,
        abortSignal: genOptions?.signal,
        experimental_context: toolExecutionContext,
        executionTelemetry: resumeTelemetry,
        interrupt: async (request: unknown) => {
          // First call: return the stored user response (mirrors the
          // permission-mode wrapper when pendingResponses has a match).
          if (pendingResponses.has(interrupt.id)) {
            const stored = pendingResponses.get(interrupt.id);
            pendingResponses.delete(interrupt.id);
            return stored;
          }

          // Subsequent calls: no stored response — throw InterruptSignal
          // so the tool can pause again (e.g. multi-step wizards).
          const newInterruptData = createInterrupt({
            id: `int_${customToolCallId}`,
            threadId,
            type: "custom",
            toolCallId: customToolCallId,
            toolName: customToolName,
            request,
            step: checkpoint.step,
          });
          throw new InterruptSignal(newInterruptData);
        },
      } as unknown as ToolExecutionOptions<unknown>);
    } catch (executeError) {
      if (isInterruptSignal(executeError)) {
        // Tool threw another interrupt — persist it and return re-interrupted
        const newInterrupt = executeError.interrupt;
        const reInterruptCheckpoint = await checkpoints.markPendingInterrupt(
          threadId,
          newInterrupt,
          resumeTelemetry.runId,
          checkpoint,
        );
        return {
          type: "re-interrupted",
          interrupt: newInterrupt,
          checkpoint: reInterruptCheckpoint ?? checkpoint,
        };
      }
      customToolResult = `Tool execution failed: ${executeError instanceof Error ? executeError.message : String(executeError)}`;
    }

    const customOutput = await createToolModelOutput({
      tool: customTool,
      toolCallId: customToolCallId,
      input: interrupt.request,
      output: customToolResult,
    });

    const customToolResultMessage = {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: customToolCallId,
          toolName: customToolName,
          output: customOutput,
        },
      ],
    } as ModelMessage;

    // Update checkpoint with tool call + result, clear interrupt
    const customUpdatedMessages: ModelMessage[] = [
      ...checkpoint.messages,
      customAssistantMessage,
      customToolResultMessage,
    ];

    const customUpdatedCheckpoint = updateCheckpoint(checkpoint, {
      messages: customUpdatedMessages,
      pendingInterrupt: undefined,
      step: checkpoint.step + 1,
    });
    await checkpoints.commit(threadId, customUpdatedCheckpoint);

    // Clean up
    pendingResponses.delete(interrupt.id);

    return {
      type: "continue",
      threadId,
      genOptions: { ...genOptions, _runId: resumeTelemetry.runId },
    };
  }

  const agent: Agent = {
    id,
    options,
    backend,
    state,
    taskManager,

    getSkills() {
      return [...skills];
    },

    async generate(genOptions: GenerateOptions): Promise<GenerateResult> {
      const runId = await checkpoints.resolveRunId(genOptions);

      // Invoke unified PreGenerate hooks
      const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
      const preGenResult = await invokePreGenerateHooks<GenerateResult>(
        preGenerateHooks,
        { ...genOptions, _runId: runId },
        agent,
      );

      // Check for cache short-circuit via respondWith
      if (preGenResult.cachedResult !== undefined) {
        return await invokeCachedPostGenerateHooks(
          preGenResult.cachedResult,
          { ...preGenResult.effectiveOptions, _runId: runId },
          options.model,
        );
      }

      let effectiveGenOptions = { ...preGenResult.effectiveOptions, _runId: runId };

      // Initialize retry loop state
      const retryState = createRetryLoopState(
        options.model,
        options.generationRetryPolicy?.maxRetries,
      );
      // Track messages for emergency compaction (accessible in catch block)
      let lastBuiltMessages: ModelMessage[] = [];

      while (retryState.retryAttempt <= retryState.maxRetries) {
        try {
          const { messages, checkpoint, forkedSessionId } =
            await buildMessages(effectiveGenOptions);
          const checkpointThreadId = forkedSessionId ?? effectiveGenOptions.threadId;
          const executionBaseTelemetry = buildExecutionTelemetryFromIds({
            runId: effectiveGenOptions._runId ?? createRunId(),
            threadId: checkpointThreadId,
            requestedModel: retryState.currentModel,
          });
          // Store for potential emergency compaction in catch block
          lastBuiltMessages = messages;
          const maxSteps = options.maxSteps ?? 10;
          const startStep = checkpoint?.step ?? 0;

          // Shared signal state: flow-control signals (interrupt) thrown by tools
          // are caught by the outermost wrapper and stored here. A custom
          // stopWhen condition stops generation after the current step completes.
          const signalState: GenerateSignalState = {};

          const activeTools = toolPipeline.buildTools({
            threadId: effectiveGenOptions.threadId,
            telemetry: executionBaseTelemetry,
            signalState,
          });

          // Build prompt context and generate system prompt
          const promptContext = buildPromptContext(
            effectiveGenOptions,
            messages,
            effectiveGenOptions.threadId,
          );
          const systemPrompt = getSystemPrompt(promptContext);

          const initialParams = {
            system: systemPrompt,
            messages,
            tools: activeTools,
            maxTokens: effectiveGenOptions.maxTokens,
            temperature: effectiveGenOptions.temperature,
            stopSequences: effectiveGenOptions.stopSequences,
            abortSignal: effectiveGenOptions.signal,
            providerOptions: effectiveGenOptions.providerOptions,
            headers: effectiveGenOptions.headers,
            telemetry: effectiveGenOptions.telemetry ?? effectiveGenOptions.experimental_telemetry,
          };

          const generationStartTime = Date.now();
          const toolExecutionContext = createToolExecutionContext(options, retryState.currentModel);

          // Execute generation
          const response = await generateText({
            model: retryState.currentModel,
            ...repairToolCallOptions,
            system: initialParams.system,
            messages: projectMessagesForModel(
              initialParams.messages,
              toolExecutionContext.agentSdk.modelCapabilities,
            ),
            tools: wrapToolsWithExecutionContext(
              initialParams.tools as ToolSet,
              toolExecutionContext,
            ),
            maxOutputTokens: initialParams.maxTokens,
            temperature: initialParams.temperature,
            stopSequences: initialParams.stopSequences,
            abortSignal: initialParams.abortSignal,
            stopWhen: buildStopConditions(signalState, effectiveGenOptions, maxSteps),
            // Passthrough AI SDK options
            output: effectiveGenOptions.output,
            // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
            providerOptions: initialParams.providerOptions as any,
            headers: initialParams.headers,
            telemetry: initialParams.telemetry,
            // Preserve AI SDK 6 behavior: allow system-role messages within the
            // message history (AI SDK 7 rejects them by default).
            allowSystemInMessages: true,
          });

          // Check for intercepted interrupt signal (cooperative path)
          if (signalState.interrupt) {
            const interrupt = signalState.interrupt.interrupt;
            const interruptTelemetry = buildExecutionTelemetry({
              runId: executionBaseTelemetry.runId,
              threadId: checkpointThreadId,
              requestedModel: retryState.currentModel,
              responseModelId: response.response?.modelId,
              usage: response.usage,
              providerMetadata: (response as { providerMetadata?: unknown }).providerMetadata,
              durationMs: Date.now() - generationStartTime,
            });

            // Save checkpoint with messages AND the pending interrupt.
            // The normal completion path saves messages at the end of generate(),
            // but when interrupted we return early. Without saving here, resume()
            // cannot find the checkpoint (or finds one without messages/interrupt).
            //
            // `response.response.messages` only holds the FINAL step's messages;
            // build from every step so intermediate tool calls/results survive.
            if (checkpointThreadId && options.checkpointer) {
              const finalMessages = buildMessagesFromStepResponses(
                messages,
                response.steps,
                response.text,
                response.response?.messages,
              );
              const savedCheckpoint = await saveCheckpoint(
                checkpointThreadId,
                finalMessages,
                startStep + response.steps.length,
                interruptTelemetry.runId,
              );
              await checkpoints.markPendingInterrupt(
                checkpointThreadId,
                interrupt,
                interruptTelemetry.runId,
                savedCheckpoint,
              );
            }

            // Emit InterruptRequested hook
            const interruptRequestedHooks = effectiveHooks?.InterruptRequested ?? [];
            if (interruptRequestedHooks.length > 0) {
              const hookInput: InterruptRequestedInput = {
                hook_event_name: "InterruptRequested",
                session_id: effectiveGenOptions.threadId ?? "default",
                cwd: process.cwd(),
                telemetry: interruptTelemetry,
                interrupt_id: interrupt.id,
                interrupt_type: interrupt.type,
                tool_call_id: interrupt.toolCallId,
                tool_name: interrupt.toolName,
                request: interrupt.request,
              };
              await invokeHooksWithTimeout(interruptRequestedHooks, hookInput, null, agent);
            }

            // Return interrupted result with partial results from the response
            const interruptedResult: GenerateResultInterrupted = {
              status: "interrupted",
              telemetry: interruptTelemetry,
              interrupt,
              partial: {
                text: response.text,
                steps: mapSteps(response.steps),
                usage: response.usage,
              },
            };
            return interruptedResult;
          }

          // Only access output if an output schema was provided
          // (accessing response.output throws AI_NoOutputGeneratedError otherwise)
          let output: GenerateResultComplete["output"];
          if (effectiveGenOptions.output) {
            try {
              output = response.output;
            } catch {
              // No structured output was generated
            }
          }

          const telemetry = buildExecutionTelemetry({
            runId: executionBaseTelemetry.runId,
            threadId: checkpointThreadId,
            requestedModel: retryState.currentModel,
            responseModelId: response.response?.modelId,
            usage: response.usage,
            providerMetadata: (response as { providerMetadata?: unknown }).providerMetadata,
            durationMs: Date.now() - generationStartTime,
          });

          const result: GenerateResultComplete = {
            status: "complete",
            telemetry,
            text: response.text,
            usage: response.usage,
            finishReason: response.finishReason as GenerateResultComplete["finishReason"],
            output,
            steps: mapSteps(response.steps),
            forkedSessionId,
          };

          // Update context manager with actual usage if available
          if (options.contextManager?.updateUsage && response.usage) {
            options.contextManager.updateUsage({
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              totalTokens: response.usage.totalTokens,
            });
          }

          // Save checkpoint - use forked session ID if forking, otherwise use original threadId.
          // `response.response.messages` only holds the FINAL step's messages;
          // build from every step so intermediate tool calls/results survive.
          if (checkpointThreadId && options.checkpointer) {
            const finalMessages = buildMessagesFromStepResponses(
              messages,
              response.steps,
              response.text,
              response.response?.messages,
            );
            await saveCheckpoint(
              checkpointThreadId,
              finalMessages,
              startStep + response.steps.length,
              executionBaseTelemetry.runId,
            );
          }

          // Invoke unified PostGenerate hooks
          const postGenerateHooks = effectiveHooks?.PostGenerate ?? [];
          let finalResult = result;
          if (postGenerateHooks.length > 0) {
            const postGenerateInput: PostGenerateInput = {
              hook_event_name: "PostGenerate",
              session_id: effectiveGenOptions.threadId ?? "default",
              cwd: process.cwd(),
              telemetry,
              options: effectiveGenOptions,
              result,
            };
            const hookOutputs = await invokeHooksWithTimeout(
              postGenerateHooks,
              postGenerateInput,
              null,
              agent,
            );

            // Apply output transformation via updatedResult
            // Note: Hooks can only return complete results, not interrupted ones
            const updatedResult = extractUpdatedResult<GenerateResultComplete>(hookOutputs);
            if (updatedResult !== undefined) {
              finalResult = updatedResult;
            }
          }

          // --- Background task completion loop ---
          if (!waitForBackgroundTasks || signalState.stop) {
            return finalResult;
          }

          // When checkpointing is active, the checkpoint already contains the
          // full conversation history (saved above). Passing explicit messages
          // would cause buildMessages() to load checkpoint messages AND append
          // the same messages again, causing duplication.
          const hasCheckpointing = !!(effectiveGenOptions.threadId && options.checkpointer);
          let lastResult: GenerateResult = finalResult;
          let runningMessages: ModelMessage[] = hasCheckpointing
            ? []
            : buildMessagesFromStepResponses(
                messages,
                response.steps,
                finalResult.text,
                response.response?.messages,
              );

          let followUpPrompt = await getNextTaskPrompt();
          while (followUpPrompt !== null) {
            const followUpOptions: GenerateOptions = {
              ...effectiveGenOptions,
              requestClass: "background",
              prompt: followUpPrompt,
              messages: hasCheckpointing ? undefined : runningMessages,
            };
            try {
              lastResult = await agent.generate(followUpOptions);
            } catch (error) {
              throw new NestedBackgroundGenerationError(
                normalizeError(
                  error,
                  "Background follow-up generation failed",
                  followUpOptions.threadId,
                ),
              );
            }

            if (lastResult.status === "interrupted") {
              return lastResult;
            }

            if (!hasCheckpointing) {
              runningMessages = [
                ...runningMessages,
                { role: "user" as const, content: followUpPrompt },
                ...(lastResult.text
                  ? [{ role: "assistant" as const, content: lastResult.text }]
                  : []),
              ];
            }

            followUpPrompt = await getNextTaskPrompt();
          }

          return lastResult;
        } catch (error) {
          if (error instanceof NestedBackgroundGenerationError) {
            throw error.originalError;
          }

          // Check if this is an InterruptSignal (new interrupt system)
          if (isInterruptSignal(error)) {
            const interrupt = error.interrupt;
            const interruptTelemetry = buildExecutionTelemetryFromIds({
              runId: effectiveGenOptions._runId ?? createRunId(),
              threadId: effectiveGenOptions.threadId,
              requestedModel: retryState.currentModel,
            });

            // Save checkpoint with messages AND the pending interrupt (catch-block path).
            // lastBuiltMessages holds the messages built before generateText was called.
            if (effectiveGenOptions.threadId && options.checkpointer) {
              const savedCheckpoint = await saveCheckpoint(
                effectiveGenOptions.threadId,
                lastBuiltMessages ?? [],
                0,
                interruptTelemetry.runId,
              );
              await checkpoints.markPendingInterrupt(
                effectiveGenOptions.threadId,
                interrupt,
                interruptTelemetry.runId,
                savedCheckpoint,
              );
            }

            // Emit InterruptRequested hook
            const interruptRequestedHooks = effectiveHooks?.InterruptRequested ?? [];
            if (interruptRequestedHooks.length > 0) {
              const hookInput: InterruptRequestedInput = {
                hook_event_name: "InterruptRequested",
                session_id: effectiveGenOptions.threadId ?? "default",
                cwd: process.cwd(),
                telemetry: interruptTelemetry,
                interrupt_id: interrupt.id,
                interrupt_type: interrupt.type,
                tool_call_id: interrupt.toolCallId,
                tool_name: interrupt.toolName,
                request: interrupt.request,
              };
              await invokeHooksWithTimeout(interruptRequestedHooks, hookInput, null, agent);
            }

            // Return interrupted result
            const interruptedResult: GenerateResultInterrupted = {
              status: "interrupted",
              telemetry: interruptTelemetry,
              interrupt,
              partial: {
                text: "",
                steps: [],
                usage: undefined,
              },
            };
            return interruptedResult;
          }

          // Normalize error to AgentError
          const normalizedError = normalizeError(
            error,
            "Generation failed",
            effectiveGenOptions.threadId,
          );

          // Check for context length error and attempt emergency compaction if enabled
          // Note: Only attempt this ONCE to avoid infinite loops
          if (
            options.contextManager?.policy.enableErrorFallback &&
            !effectiveGenOptions._skipCompaction &&
            retryState.retryAttempt === 0 && // Only on first error, not on retry
            isContextLengthError(normalizedError)
          ) {
            // Emergency compaction - try to recover
            // We'll compact and save to checkpoint, then retry
            try {
              // Get current messages from checkpoint if available, or use the messages from the current call
              let messagesToCompact: ModelMessage[] = [];
              if (effectiveGenOptions.threadId && options.checkpointer) {
                const checkpoint = await options.checkpointer.load(effectiveGenOptions.threadId);
                if (checkpoint && checkpoint.messages.length > 0) {
                  messagesToCompact = checkpoint.messages;
                }
              }
              // Fall back to messages from the current call if checkpoint is empty
              if (messagesToCompact.length === 0 && lastBuiltMessages.length > 0) {
                messagesToCompact = lastBuiltMessages;
              }

              // If we have messages to compact, do emergency compaction
              if (messagesToCompact.length > 0) {
                const compactionResult = await options.contextManager.compact(
                  messagesToCompact,
                  agent,
                  "error_fallback",
                );

                // Save compacted state to checkpoint and clear original messages
                // to prevent duplication on retry
                if (effectiveGenOptions.threadId && options.checkpointer) {
                  const existingCheckpoint = await options.checkpointer.load(
                    effectiveGenOptions.threadId,
                  );
                  if (existingCheckpoint) {
                    const updatedCheckpoint = updateCheckpoint(existingCheckpoint, {
                      messages: compactionResult.newMessages,
                    });
                    await checkpoints.commit(effectiveGenOptions.threadId, updatedCheckpoint);
                  } else {
                    // Create a new checkpoint with compacted messages
                    const newCheckpoint = createCheckpoint({
                      threadId: effectiveGenOptions.threadId,
                      messages: compactionResult.newMessages,
                      step: 0,
                      state: {
                        todos: [...state.todos],
                        files: { ...state.files },
                      },
                    });
                    await checkpoints.commit(effectiveGenOptions.threadId, newCheckpoint);
                  }
                  // Clear messages from effectiveGenOptions to prevent duplication
                  // The retry will use checkpoint messages only
                  effectiveGenOptions = {
                    ...effectiveGenOptions,
                    messages: undefined,
                  };
                }

                retryState.retryAttempt++;
                // Retry immediately with compacted context
                continue;
              }
            } catch (_compactionError) {
              // If compaction itself fails, don't retry - fall through to normal error handling
            }
          }

          // Handle error with PostGenerateFailure hooks and fallback logic
          const postGenerateFailureHooks = effectiveHooks?.PostGenerateFailure ?? [];
          const retryDecisionHooks = effectiveHooks?.GenerationRetryDecision ?? [];
          const errorDecision = await handleGenerationError({
            error: normalizedError,
            failureHooks: postGenerateFailureHooks,
            decisionHooks: retryDecisionHooks,
            genOptions: effectiveGenOptions,
            agent,
            state: retryState,
            fallbackModel: options.fallbackModel,
            retryPolicy: options.generationRetryPolicy,
          });

          if (errorDecision.shouldRetry) {
            if (errorDecision.updatedOptions) {
              effectiveGenOptions = {
                ...errorDecision.updatedOptions,
                _runId: errorDecision.updatedOptions._runId ?? effectiveGenOptions._runId,
              };
            }
            // Update retry state
            Object.assign(retryState, updateRetryLoopState(retryState, errorDecision));
            // Wait for the specified delay before retrying
            await waitForRetryDelay(errorDecision.retryDelayMs);
            // Continue to next iteration of retry loop
            continue;
          }

          // No retry requested or max retries exceeded - throw the normalized error
          throw normalizedError;
        }
      }

      // This should never be reached, but TypeScript needs it for type safety
      throw new Error("Unexpected: retry loop exited without return or throw");
    },

    async *stream(genOptions: GenerateOptions): AsyncGenerator<StreamPart> {
      const runId = await checkpoints.resolveRunId(genOptions);

      // Invoke unified PreGenerate hooks
      const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
      const preGenResult = await invokePreGenerateHooks<GenerateResult>(
        preGenerateHooks,
        { ...genOptions, _runId: runId },
        agent,
      );

      // Check for cache short-circuit via respondWith
      // For streaming, we convert the cached GenerateResult into StreamParts
      if (preGenResult.cachedResult !== undefined) {
        const cachedResult = await invokeCachedPostGenerateHooks(
          preGenResult.cachedResult,
          { ...preGenResult.effectiveOptions, _runId: runId },
          options.model,
        );
        // Only process complete results (interrupted results can't be cached)
        if (cachedResult.status === "complete") {
          const cachedSteps = cachedResult.steps ?? [];

          if (cachedSteps.length === 0) {
            yield { type: "turn-start" };
            if (cachedResult.text) {
              yield { type: "text-delta", text: cachedResult.text };
            }
            yield {
              type: "turn-end",
              finishReason: cachedResult.finishReason,
              usage: cachedResult.usage,
            };
          }

          for (const [index, step] of cachedSteps.entries()) {
            yield { type: "turn-start" };

            const stepText = (index === 0 ? cachedResult.text : undefined) || step.text;
            if (stepText) {
              yield { type: "text-delta", text: stepText };
            }

            for (const toolCall of step.toolCalls ?? []) {
              yield {
                type: "tool-call",
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolCall.input,
              };
            }
            for (const toolResult of step.toolResults ?? []) {
              yield {
                type: "tool-result",
                toolCallId: toolResult.toolCallId,
                toolName: toolResult.toolName,
                output: toolResult.output,
              };
            }

            yield {
              type: "turn-end",
              finishReason: step.finishReason,
              usage: step.usage,
            };
          }

          // Finally yield finish (overall stream terminator)
          yield {
            type: "finish",
            finishReason: cachedResult.finishReason,
            usage: cachedResult.usage,
          };
        }
        return;
      }

      let effectiveGenOptions = { ...preGenResult.effectiveOptions, _runId: runId };

      // Initialize retry loop state
      const retryState = createRetryLoopState(
        options.model,
        options.generationRetryPolicy?.maxRetries,
      );

      while (retryState.retryAttempt <= retryState.maxRetries) {
        try {
          const { messages, checkpoint, forkedSessionId } =
            await buildMessages(effectiveGenOptions);
          const maxSteps = options.maxSteps ?? 10;
          const startStep = checkpoint?.step ?? 0;
          const checkpointThreadId = forkedSessionId ?? effectiveGenOptions.threadId;
          const executionBaseTelemetry = buildExecutionTelemetryFromIds({
            runId: effectiveGenOptions._runId ?? createRunId(),
            threadId: checkpointThreadId,
            requestedModel: retryState.currentModel,
          });

          // Signal state for cooperative signal catching in streaming mode
          const signalState: GenerateSignalState = {};

          const activeTools = toolPipeline.buildTools({
            threadId: effectiveGenOptions.threadId,
            telemetry: executionBaseTelemetry,
            signalState,
          });

          // Build prompt context and generate system prompt
          const promptContext = buildPromptContext(
            effectiveGenOptions,
            messages,
            effectiveGenOptions.threadId,
          );
          const systemPrompt = getSystemPrompt(promptContext);

          const initialParams = {
            system: systemPrompt,
            messages,
            tools: activeTools,
            maxTokens: effectiveGenOptions.maxTokens,
            temperature: effectiveGenOptions.temperature,
            stopSequences: effectiveGenOptions.stopSequences,
            abortSignal: effectiveGenOptions.signal,
            providerOptions: effectiveGenOptions.providerOptions,
            headers: effectiveGenOptions.headers,
            telemetry: effectiveGenOptions.telemetry ?? effectiveGenOptions.experimental_telemetry,
          };

          const generationStartTime = Date.now();
          let firstTextDeltaAt: number | undefined;
          const toolExecutionContext = createToolExecutionContext(options, retryState.currentModel);
          const streamingCompaction = createStreamingCompactionState(
            initialParams.messages,
            effectiveGenOptions,
            checkpointThreadId,
          );

          // Execute stream
          const response = streamText({
            model: retryState.currentModel,
            ...repairToolCallOptions,
            system: initialParams.system,
            messages: projectMessagesForModel(
              initialParams.messages,
              toolExecutionContext.agentSdk.modelCapabilities,
            ),
            tools: wrapToolsWithExecutionContext(
              initialParams.tools as ToolSet,
              toolExecutionContext,
            ),
            prepareStep: streamingCompaction.prepareStep,
            onStepFinish: (stepResult) => {
              streamingCompaction.appendStep(stepResult);
            },
            maxOutputTokens: initialParams.maxTokens,
            temperature: initialParams.temperature,
            stopSequences: initialParams.stopSequences,
            abortSignal: initialParams.abortSignal,
            stopWhen: buildStopConditions(signalState, effectiveGenOptions, maxSteps),
            // Passthrough AI SDK options
            output: genOptions.output,
            // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
            providerOptions: initialParams.providerOptions as any,
            headers: initialParams.headers,
            telemetry: initialParams.telemetry,
            // Preserve AI SDK 6 behavior: allow system-role messages within the
            // message history (AI SDK 7 rejects them by default).
            allowSystemInMessages: true,
          });

          // AI SDK only carries the response id on `finish-step`, not on
          // `start-step`, so `turn-start` is emitted without a messageId and
          // consumers correlate via the matching `turn-end`.
          const activeToolInputToolNames = new Map<string, string>();
          for await (const part of response.fullStream) {
            if (part.type === "start-step") {
              // A new assistant message is beginning.
              yield { type: "turn-start" };
            } else if (part.type === "finish-step") {
              // The current assistant turn completed. Surface the response id
              // (from AI SDK's LanguageModelResponseMetadata) plus per-turn
              // finish reason and usage so consumers can record per-turn
              // telemetry without polling the awaited promises.
              const stepResponse = part.response as { id?: unknown } | undefined;
              const messageId = typeof stepResponse?.id === "string" ? stepResponse.id : undefined;
              yield {
                type: "turn-end",
                messageId,
                finishReason: part.finishReason as StreamPart extends {
                  type: "finish";
                }
                  ? StreamPart["finishReason"]
                  : never,
                usage: part.usage,
              };
            } else if (part.type === "text-delta") {
              firstTextDeltaAt ??= Date.now();
              yield { type: "text-delta", text: part.text };
            } else if (part.type === "reasoning-start") {
              yield {
                type: "reasoning-start",
                id: typeof part.id === "string" ? part.id : undefined,
              };
            } else if (part.type === "reasoning-delta") {
              // Normalize across SDK/provider variants (`text` vs `delta`).
              const rawPart = part as unknown as { id?: unknown; text?: unknown; delta?: unknown };
              yield {
                type: "reasoning-delta",
                id: typeof rawPart.id === "string" ? rawPart.id : undefined,
                text:
                  typeof rawPart.text === "string"
                    ? rawPart.text
                    : typeof rawPart.delta === "string"
                      ? rawPart.delta
                      : "",
              };
            } else if (part.type === "reasoning-end") {
              yield {
                type: "reasoning-end",
                id: typeof part.id === "string" ? part.id : undefined,
              };
            } else if (part.type === "tool-input-start") {
              const rawPart = part as unknown as {
                id?: unknown;
                toolCallId?: unknown;
                toolName?: unknown;
              };
              const toolCallId =
                typeof rawPart.toolCallId === "string"
                  ? rawPart.toolCallId
                  : typeof rawPart.id === "string"
                    ? rawPart.id
                    : undefined;
              const toolName = typeof rawPart.toolName === "string" ? rawPart.toolName : undefined;
              if (toolCallId !== undefined) {
                if (toolName !== undefined) {
                  activeToolInputToolNames.set(toolCallId, toolName);
                }
                yield {
                  type: "tool-input-start",
                  toolCallId,
                  toolName,
                };
              }
            } else if (
              part.type === "tool-input-delta" ||
              (part as { type: string }).type === "tool-call-delta"
            ) {
              const rawPart = part as unknown as {
                id?: unknown;
                toolCallId?: unknown;
                toolName?: unknown;
                inputTextDelta?: unknown;
                argsTextDelta?: unknown;
                textDelta?: unknown;
                delta?: unknown;
              };
              const toolCallId =
                typeof rawPart.toolCallId === "string"
                  ? rawPart.toolCallId
                  : typeof rawPart.id === "string"
                    ? rawPart.id
                    : undefined;
              if (toolCallId !== undefined) {
                const inputTextDelta =
                  typeof rawPart.inputTextDelta === "string"
                    ? rawPart.inputTextDelta
                    : typeof rawPart.argsTextDelta === "string"
                      ? rawPart.argsTextDelta
                      : typeof rawPart.textDelta === "string"
                        ? rawPart.textDelta
                        : typeof rawPart.delta === "string"
                          ? rawPart.delta
                          : undefined;
                if (inputTextDelta !== undefined) {
                  yield {
                    type: "tool-input-delta",
                    toolCallId,
                    toolName:
                      typeof rawPart.toolName === "string"
                        ? rawPart.toolName
                        : activeToolInputToolNames.get(toolCallId),
                    inputTextDelta,
                  };
                }
              }
            } else if (part.type === "tool-input-end") {
              const rawPart = part as unknown as {
                id?: unknown;
                toolCallId?: unknown;
                toolName?: unknown;
              };
              const toolCallId =
                typeof rawPart.toolCallId === "string"
                  ? rawPart.toolCallId
                  : typeof rawPart.id === "string"
                    ? rawPart.id
                    : undefined;
              if (toolCallId !== undefined) {
                yield {
                  type: "tool-input-end",
                  toolCallId,
                  toolName:
                    typeof rawPart.toolName === "string"
                      ? rawPart.toolName
                      : activeToolInputToolNames.get(toolCallId),
                };
                activeToolInputToolNames.delete(toolCallId);
              }
            } else if (part.type === "tool-call") {
              yield {
                type: "tool-call",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              };
            } else if (part.type === "tool-result") {
              yield {
                type: "tool-result",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: part.output,
              };
            } else if (part.type === "tool-output-denied") {
              yield {
                type: "tool-output-denied",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
              };
            } else if (part.type === "tool-error") {
              // Forward tool failures instead of dropping them. The AI SDK emits
              // `tool-error` both for invalid tool calls (unknown tool name /
              // malformed input) and for tool execute() rejections. Swallowing
              // them left those tool calls permanently unresolved for stream
              // consumers, which then had to synthesise misleading terminal
              // errors at end of stream.
              yield {
                type: "tool-error",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
                error: part.error,
              };
            } else if (part.type === "finish") {
              yield {
                type: "finish",
                finishReason: part.finishReason as StreamPart extends {
                  type: "finish";
                }
                  ? StreamPart["finishReason"]
                  : never,
                usage: part.totalUsage,
              };
            } else if (part.type === "error") {
              yield { type: "error", error: part.error as Error };
            }
          }

          // Get final result for hooks - need to await all properties
          const [text, usage, finishReason, steps, responseMeta] = await Promise.all([
            response.text,
            response.usage,
            response.finishReason,
            response.steps,
            response.response ?? Promise.resolve(undefined),
          ]);

          // Only access output if an output schema was provided
          let output: GenerateResultComplete["output"];
          if (genOptions.output) {
            try {
              output = await response.output;
            } catch {
              // No structured output was generated
            }
          }

          const telemetry = buildExecutionTelemetry({
            runId: executionBaseTelemetry.runId,
            threadId: checkpointThreadId,
            requestedModel: retryState.currentModel,
            responseModelId: responseMeta?.modelId,
            usage,
            durationMs: Date.now() - generationStartTime,
            timeToFirstTokenMs:
              firstTextDeltaAt !== undefined ? firstTextDeltaAt - generationStartTime : undefined,
          });

          const result: GenerateResultComplete = {
            status: "complete",
            telemetry,
            text,
            usage,
            finishReason: finishReason as GenerateResultComplete["finishReason"],
            output,
            steps: mapSteps(steps),
          };

          // Save checkpoint if threadId is provided. The streaming compaction
          // state is authoritative because prepareStep may have discarded
          // earlier history mid-run.
          if (checkpointThreadId && options.checkpointer) {
            await saveCheckpoint(
              checkpointThreadId,
              streamingCompaction.finalize(steps, text),
              startStep + steps.length,
              telemetry.runId,
            );
          }

          // Save pending interrupt to checkpoint (mirrors generate() pattern)
          if (signalState.interrupt && checkpointThreadId && options.checkpointer) {
            const interrupt = signalState.interrupt.interrupt;
            await checkpoints.markPendingInterrupt(checkpointThreadId, interrupt, telemetry.runId);

            // Emit InterruptRequested hook
            const interruptRequestedHooks = effectiveHooks?.InterruptRequested ?? [];
            if (interruptRequestedHooks.length > 0) {
              const hookInput: InterruptRequestedInput = {
                hook_event_name: "InterruptRequested",
                session_id: effectiveGenOptions.threadId ?? "default",
                cwd: process.cwd(),
                telemetry,
                interrupt_id: interrupt.id,
                interrupt_type: interrupt.type,
                tool_call_id: interrupt.toolCallId,
                tool_name: interrupt.toolName,
                request: interrupt.request,
              };
              await invokeHooksWithTimeout(interruptRequestedHooks, hookInput, null, agent);
            }
          }

          // Invoke unified PostGenerate hooks
          const postGenerateHooks = effectiveHooks?.PostGenerate ?? [];
          if (postGenerateHooks.length > 0) {
            const postGenerateInput: PostGenerateInput = {
              hook_event_name: "PostGenerate",
              session_id: effectiveGenOptions.threadId ?? "default",
              cwd: process.cwd(),
              telemetry,
              options: effectiveGenOptions,
              result,
            };
            await invokeHooksWithTimeout(postGenerateHooks, postGenerateInput, null, agent);
            // Note: updatedResult is not applied for streaming since the stream has already been sent
          }

          // --- Background task completion loop ---
          if (!waitForBackgroundTasks || signalState.interrupt || signalState.stop) {
            return;
          }

          const hasCheckpointing = !!(effectiveGenOptions.threadId && options.checkpointer);
          let currentMessages: ModelMessage[] = hasCheckpointing
            ? []
            : streamingCompaction.finalize(steps, text);

          let followUpPrompt = await getNextTaskPrompt();
          while (followUpPrompt !== null) {
            const followUpOptions: GenerateOptions = {
              ...effectiveGenOptions,
              requestClass: "background",
              prompt: followUpPrompt,
              messages: hasCheckpointing ? undefined : currentMessages,
            };

            let followUpText = "";
            try {
              const followUpGen = agent.stream(followUpOptions);
              for await (const part of followUpGen) {
                yield part;
                if (part.type === "text-delta") followUpText += part.text;
              }
            } catch (error) {
              throw new NestedBackgroundGenerationError(
                normalizeError(
                  error,
                  "Background follow-up generation failed",
                  followUpOptions.threadId,
                ),
              );
            }

            if (!hasCheckpointing) {
              currentMessages = [
                ...currentMessages,
                { role: "user" as const, content: followUpPrompt },
                ...(followUpText ? [{ role: "assistant" as const, content: followUpText }] : []),
              ];
            }

            followUpPrompt = await getNextTaskPrompt();
          }

          return;
        } catch (error) {
          if (error instanceof NestedBackgroundGenerationError) {
            throw error.originalError;
          }

          // Normalize error to AgentError
          const normalizedError = normalizeError(
            error,
            "Stream generation failed",
            effectiveGenOptions.threadId,
          );

          // Handle error with PostGenerateFailure hooks and fallback logic
          const postGenerateFailureHooks = effectiveHooks?.PostGenerateFailure ?? [];
          const retryDecisionHooks = effectiveHooks?.GenerationRetryDecision ?? [];
          const errorDecision = await handleGenerationError({
            error: normalizedError,
            failureHooks: postGenerateFailureHooks,
            decisionHooks: retryDecisionHooks,
            genOptions: effectiveGenOptions,
            agent,
            state: retryState,
            fallbackModel: options.fallbackModel,
            retryPolicy: options.generationRetryPolicy,
          });

          if (errorDecision.shouldRetry) {
            if (errorDecision.updatedOptions) {
              effectiveGenOptions = {
                ...errorDecision.updatedOptions,
                _runId: errorDecision.updatedOptions._runId ?? effectiveGenOptions._runId,
              };
            }
            // Update retry state
            Object.assign(retryState, updateRetryLoopState(retryState, errorDecision));
            // Wait for the specified delay before retrying
            await waitForRetryDelay(errorDecision.retryDelayMs);
            // Continue to next iteration of retry loop
            continue;
          }

          // No retry requested or max retries exceeded - throw the normalized error
          throw normalizedError;
        }
      }

      // This should never be reached, but TypeScript needs it for type safety
      throw new Error("Unexpected: retry loop exited without return or throw");
    },

    async streamResponse(genOptions: GenerateOptions): Promise<Response> {
      const runId = await checkpoints.resolveRunId(genOptions);

      // Invoke unified PreGenerate hooks
      const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
      const preGenResult = await invokePreGenerateHooks<GenerateResult>(
        preGenerateHooks,
        { ...genOptions, _runId: runId },
        agent,
      );

      // Check for cache short-circuit via respondWith
      // For streaming response, create a simple text response from the cached result
      if (preGenResult.cachedResult !== undefined) {
        const cachedResult = await invokeCachedPostGenerateHooks(
          preGenResult.cachedResult,
          { ...preGenResult.effectiveOptions, _runId: runId },
          options.model,
        );
        // For cached results, return a simple Response with the cached text
        // This is compatible with useChat and provides immediate delivery
        // Only complete results can be cached
        const text = cachedResult.status === "complete" ? cachedResult.text : "";
        return new Response(text, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      }

      let effectiveGenOptions = { ...preGenResult.effectiveOptions, _runId: runId };

      // Initialize retry loop state
      const retryState = createRetryLoopState(
        options.model,
        options.generationRetryPolicy?.maxRetries,
      );

      while (retryState.retryAttempt <= retryState.maxRetries) {
        try {
          const { messages, checkpoint } = await buildMessages(effectiveGenOptions);
          const maxSteps = options.maxSteps ?? 10;
          const startStep = checkpoint?.step ?? 0;
          const executionBaseTelemetry = buildExecutionTelemetryFromIds({
            runId: effectiveGenOptions._runId ?? createRunId(),
            threadId: effectiveGenOptions.threadId,
            requestedModel: retryState.currentModel,
          });

          // Signal state for cooperative signal catching in streaming mode
          const signalState: GenerateSignalState = {};

          const activeTools = toolPipeline.buildTools({
            threadId: effectiveGenOptions.threadId,
            telemetry: executionBaseTelemetry,
            signalState,
          });

          // Build prompt context and generate system prompt
          const promptContext = buildPromptContext(
            effectiveGenOptions,
            messages,
            effectiveGenOptions.threadId,
          );
          const systemPrompt = getSystemPrompt(promptContext);

          const initialParams = {
            system: systemPrompt,
            messages,
            tools: activeTools,
            maxTokens: effectiveGenOptions.maxTokens,
            temperature: effectiveGenOptions.temperature,
            stopSequences: effectiveGenOptions.stopSequences,
            abortSignal: effectiveGenOptions.signal,
            providerOptions: effectiveGenOptions.providerOptions,
            headers: effectiveGenOptions.headers,
            telemetry: effectiveGenOptions.telemetry ?? effectiveGenOptions.experimental_telemetry,
          };

          // Capture currentModel for use in the callback closure
          const modelToUse = retryState.currentModel;
          const toolExecutionContext = createToolExecutionContext(options, modelToUse);

          const generationStartTime = Date.now();

          // Track step count and the durable message base for checkpointing.
          let currentStepCount = 0;
          const streamingCompaction = createStreamingCompactionState(
            initialParams.messages,
            effectiveGenOptions,
            effectiveGenOptions.threadId,
          );

          // Execute streamText OUTSIDE createUIMessageStream so errors propagate
          // to the retry loop (if streamText throws synchronously on creation,
          // e.g. rate limit, the catch block handles retry/fallback).
          const result = streamText({
            model: modelToUse,
            ...repairToolCallOptions,
            system: initialParams.system,
            messages: projectMessagesForModel(
              initialParams.messages,
              toolExecutionContext.agentSdk.modelCapabilities,
            ),
            tools: wrapToolsWithExecutionContext(
              initialParams.tools as ToolSet,
              toolExecutionContext,
            ),
            prepareStep: streamingCompaction.prepareStep,
            maxOutputTokens: initialParams.maxTokens,
            temperature: initialParams.temperature,
            stopSequences: initialParams.stopSequences,
            abortSignal: initialParams.abortSignal,
            stopWhen: buildStopConditions(signalState, effectiveGenOptions, maxSteps),
            // Passthrough AI SDK options
            output: effectiveGenOptions.output,
            // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
            providerOptions: initialParams.providerOptions as any,
            headers: initialParams.headers,
            telemetry: initialParams.telemetry,
            // Preserve AI SDK 6 behavior: allow system-role messages within the
            // message history (AI SDK 7 rejects them by default).
            allowSystemInMessages: true,
            // Keep the message base current for final persistence, and save
            // intermediate tool steps when requested.
            onStepFinish: async (stepResult) => {
              currentStepCount++;
              const currentMessages = streamingCompaction.appendStep(stepResult);
              if (
                effectiveGenOptions.checkpointAfterToolCall &&
                effectiveGenOptions.threadId &&
                options.checkpointer
              ) {
                await saveCheckpoint(
                  effectiveGenOptions.threadId,
                  currentMessages,
                  startStep + currentStepCount,
                  effectiveGenOptions._runId,
                );
              }
            },
            // Save checkpoint and emit PostGenerate hook after completion
            onFinish: async (finishResult) => {
              // Update context manager with actual usage if available
              if (options.contextManager?.updateUsage && finishResult.usage) {
                options.contextManager.updateUsage({
                  inputTokens: finishResult.usage.inputTokens,
                  outputTokens: finishResult.usage.outputTokens,
                  totalTokens: finishResult.usage.totalTokens,
                });
              }

              // The streaming state is authoritative: prepareStep may have
              // discarded earlier history mid-run.
              if (effectiveGenOptions.threadId && options.checkpointer) {
                await saveCheckpoint(
                  effectiveGenOptions.threadId,
                  streamingCompaction.finalize(finishResult.steps, finishResult.text),
                  startStep + finishResult.steps.length,
                  effectiveGenOptions._runId,
                );
              }

              // Invoke unified PostGenerate hooks
              const telemetry = buildExecutionTelemetry({
                runId: executionBaseTelemetry.runId,
                threadId: effectiveGenOptions.threadId,
                requestedModel: modelToUse,
                responseModelId: finishResult.response?.modelId,
                usage: finishResult.usage,
                durationMs: Date.now() - generationStartTime,
              });
              const hookResult: GenerateResultComplete = {
                status: "complete",
                telemetry,
                text: finishResult.text,
                usage: finishResult.usage,
                finishReason: finishResult.finishReason as GenerateResultComplete["finishReason"],
                output: undefined,
                steps: mapSteps(finishResult.steps),
              };
              const postGenerateHooks = effectiveHooks?.PostGenerate ?? [];
              if (postGenerateHooks.length > 0) {
                const postGenerateInput: PostGenerateInput = {
                  hook_event_name: "PostGenerate",
                  session_id: effectiveGenOptions.threadId ?? "default",
                  cwd: process.cwd(),
                  telemetry,
                  options: effectiveGenOptions,
                  result: hookResult,
                };
                await invokeHooksWithTimeout(postGenerateHooks, postGenerateInput, null, agent);
                // Note: updatedResult is not applied for streaming since the stream has already been sent
              }
            },
          });

          // Use createUIMessageStream to control stream lifecycle for background task follow-ups
          const stream = createUIMessageStream({
            execute: async ({ writer }) => {
              // Merge initial generation into the stream
              writer.merge(result.toUIMessageStream());

              // Wait for initial generation to complete
              await result.text;

              // --- Background task completion loop ---
              if (waitForBackgroundTasks && !signalState.stop) {
                // Track accumulated steps for checkpoint saves
                const initialSteps = await result.steps;
                let accumulatedStepCount = initialSteps.length;
                let followUpBaseOptions = effectiveGenOptions;

                let currentMessages: ModelMessage[] = streamingCompaction.finalize(
                  initialSteps,
                  await result.text,
                );

                let followUpPrompt = await getNextTaskPrompt();
                while (followUpPrompt !== null) {
                  const followUpRequestOptions: GenerateOptions = {
                    ...followUpBaseOptions,
                    requestClass: "background",
                    prompt: followUpPrompt,
                    messages: [
                      ...currentMessages,
                      { role: "user" as const, content: followUpPrompt },
                    ],
                  };
                  let followUpStreamingCompaction:
                    | ReturnType<typeof createStreamingCompactionState>
                    | undefined;
                  const {
                    result: followUpResult,
                    effectiveOptions: followUpEffectiveOptions,
                    currentModel: followUpModel,
                  } = await startRetriedStreamText(
                    followUpRequestOptions,
                    (requestOptions, currentModel) => {
                      const followUpMessages = requestOptions.messages ?? [];
                      // Follow-ups build their own message list without going
                      // through buildMessages, so compact before the first step.
                      const compaction = createStreamingCompactionState(
                        followUpMessages,
                        requestOptions,
                        requestOptions.threadId,
                        true,
                      );
                      followUpStreamingCompaction = compaction;
                      const followUpTelemetry = buildExecutionTelemetryFromIds({
                        runId: requestOptions._runId ?? executionBaseTelemetry.runId,
                        threadId: requestOptions.threadId,
                        requestedModel: currentModel,
                      });
                      const activeFollowUpTools = toolPipeline.buildTools({
                        threadId: requestOptions.threadId,
                        telemetry: followUpTelemetry,
                        signalState,
                      });
                      const followUpPromptContext = buildPromptContext(
                        requestOptions,
                        followUpMessages,
                        requestOptions.threadId,
                      );
                      const toolExecutionContext = createToolExecutionContext(
                        options,
                        currentModel,
                      );

                      return streamText({
                        model: currentModel,
                        ...repairToolCallOptions,
                        system: getSystemPrompt(followUpPromptContext),
                        messages: projectMessagesForModel(
                          followUpMessages,
                          toolExecutionContext.agentSdk.modelCapabilities,
                        ),
                        tools: wrapToolsWithExecutionContext(
                          activeFollowUpTools as ToolSet,
                          toolExecutionContext,
                        ),
                        prepareStep: compaction.prepareStep,
                        onStepFinish: (stepResult) => {
                          compaction.appendStep(stepResult);
                        },
                        maxOutputTokens: requestOptions.maxTokens,
                        temperature: requestOptions.temperature,
                        stopSequences: requestOptions.stopSequences,
                        abortSignal: requestOptions.signal,
                        stopWhen: buildStopConditions(signalState, effectiveGenOptions, maxSteps),
                        output: requestOptions.output,
                        // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
                        providerOptions: requestOptions.providerOptions as any,
                        headers: requestOptions.headers,
                        telemetry:
                          requestOptions.telemetry ?? requestOptions.experimental_telemetry,
                        allowSystemInMessages: true,
                      });
                    },
                  );
                  const followUpStartTime = Date.now();
                  followUpBaseOptions = {
                    ...followUpEffectiveOptions,
                    _runId: followUpEffectiveOptions._runId ?? followUpBaseOptions._runId,
                  };

                  writer.merge(followUpResult.toUIMessageStream());
                  const followUpText = await followUpResult.text;
                  const followUpResponse = await (followUpResult.response ??
                    Promise.resolve(undefined));

                  // The follow-up's compaction state is authoritative for the
                  // transcript (it may have compacted mid-run).
                  // --- Post-completion bookkeeping for follow-ups ---
                  const followUpSteps = await followUpResult.steps;

                  // The follow-up's compaction state is authoritative for the
                  // transcript (it may have compacted mid-run).
                  currentMessages = followUpStreamingCompaction
                    ? followUpStreamingCompaction.finalize(followUpSteps, followUpText)
                    : [
                        ...currentMessages,
                        { role: "user" as const, content: followUpPrompt },
                        ...(followUpText
                          ? [{ role: "assistant" as const, content: followUpText }]
                          : []),
                      ];
                  accumulatedStepCount += followUpSteps.length;

                  // Checkpoint save
                  if (followUpEffectiveOptions.threadId && options.checkpointer) {
                    await saveCheckpoint(
                      followUpEffectiveOptions.threadId,
                      currentMessages,
                      startStep + accumulatedStepCount,
                      followUpEffectiveOptions._runId,
                    );
                  }

                  // Context manager update
                  const followUpUsage = await followUpResult.usage;
                  if (options.contextManager?.updateUsage && followUpUsage) {
                    options.contextManager.updateUsage({
                      inputTokens: followUpUsage.inputTokens,
                      outputTokens: followUpUsage.outputTokens,
                      totalTokens: followUpUsage.totalTokens,
                    });
                  }

                  // PostGenerate hooks
                  const followUpPostGenerateHooks = effectiveHooks?.PostGenerate ?? [];
                  if (followUpPostGenerateHooks.length > 0) {
                    const followUpFinishReason = await followUpResult.finishReason;
                    const followUpTelemetry = buildExecutionTelemetry({
                      runId: followUpEffectiveOptions._runId ?? executionBaseTelemetry.runId,
                      threadId: followUpEffectiveOptions.threadId,
                      requestedModel: followUpModel,
                      responseModelId: followUpResponse?.modelId,
                      usage: followUpUsage,
                      durationMs: Date.now() - followUpStartTime,
                    });
                    const followUpHookResult: GenerateResultComplete = {
                      status: "complete",
                      telemetry: followUpTelemetry,
                      text: followUpText,
                      usage: followUpUsage,
                      finishReason: followUpFinishReason as GenerateResultComplete["finishReason"],
                      output: undefined,
                      steps: mapSteps(followUpSteps),
                    };
                    const followUpPostGenerateInput: PostGenerateInput = {
                      hook_event_name: "PostGenerate",
                      session_id: followUpEffectiveOptions.threadId ?? "default",
                      cwd: process.cwd(),
                      telemetry: followUpTelemetry,
                      options: followUpEffectiveOptions,
                      result: followUpHookResult,
                    };
                    await invokeHooksWithTimeout(
                      followUpPostGenerateHooks,
                      followUpPostGenerateInput,
                      null,
                      agent,
                    );
                  }

                  followUpPrompt = await getNextTaskPrompt();
                }
              }
            },
          });

          // Convert the stream to a Response
          return createUIMessageStreamResponse({ stream });
        } catch (error) {
          // Normalize error to AgentError
          const normalizedError = normalizeError(
            error,
            "Stream generation failed",
            effectiveGenOptions.threadId,
          );

          // Handle error with PostGenerateFailure hooks and fallback logic
          const postGenerateFailureHooks = effectiveHooks?.PostGenerateFailure ?? [];
          const retryDecisionHooks = effectiveHooks?.GenerationRetryDecision ?? [];
          const errorDecision = await handleGenerationError({
            error: normalizedError,
            failureHooks: postGenerateFailureHooks,
            decisionHooks: retryDecisionHooks,
            genOptions: effectiveGenOptions,
            agent,
            state: retryState,
            fallbackModel: options.fallbackModel,
            retryPolicy: options.generationRetryPolicy,
          });

          if (errorDecision.shouldRetry) {
            if (errorDecision.updatedOptions) {
              effectiveGenOptions = {
                ...errorDecision.updatedOptions,
                _runId: errorDecision.updatedOptions._runId ?? effectiveGenOptions._runId,
              };
            }
            // Update retry state
            Object.assign(retryState, updateRetryLoopState(retryState, errorDecision));
            // Wait for the specified delay before retrying
            await waitForRetryDelay(errorDecision.retryDelayMs);
            // Continue to next iteration of retry loop
            continue;
          }

          // No retry requested or max retries exceeded - throw the normalized error
          throw normalizedError;
        }
      }

      // This should never be reached, but TypeScript needs it for type safety
      throw new Error("Unexpected: retry loop exited without return or throw");
    },

    async streamRaw(genOptions: GenerateOptions) {
      const runId = await checkpoints.resolveRunId(genOptions);

      // Invoke unified PreGenerate hooks
      // Note: respondWith cache short-circuit is NOT supported for streamRaw()
      // because it returns the raw AI SDK streamText result which cannot be mocked.
      // Use stream(), streamResponse(), or streamDataResponse() for caching support.
      const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
      const preGenResult = await invokePreGenerateHooks<GenerateResult>(
        preGenerateHooks,
        { ...genOptions, _runId: runId },
        agent,
      );

      // Input transformation is applied even though respondWith is not supported
      let effectiveGenOptions = { ...preGenResult.effectiveOptions, _runId: runId };

      // Initialize retry loop state
      const retryState = createRetryLoopState(
        options.model,
        options.generationRetryPolicy?.maxRetries,
      );

      while (retryState.retryAttempt <= retryState.maxRetries) {
        try {
          const { messages, checkpoint } = await buildMessages(effectiveGenOptions);
          const maxSteps = options.maxSteps ?? 10;
          const startStep = checkpoint?.step ?? 0;
          const executionBaseTelemetry = buildExecutionTelemetryFromIds({
            runId: effectiveGenOptions._runId ?? createRunId(),
            threadId: effectiveGenOptions.threadId,
            requestedModel: retryState.currentModel,
          });

          // Signal state for cooperative signal catching in streaming mode
          const signalState: GenerateSignalState = {};

          const activeTools = toolPipeline.buildTools({
            threadId: effectiveGenOptions.threadId,
            telemetry: executionBaseTelemetry,
            signalState,
          });

          // Build prompt context and generate system prompt
          const promptContext = buildPromptContext(
            effectiveGenOptions,
            messages,
            effectiveGenOptions.threadId,
          );
          const systemPrompt = getSystemPrompt(promptContext);

          const initialParams = {
            system: systemPrompt,
            messages,
            tools: activeTools,
            maxTokens: effectiveGenOptions.maxTokens,
            temperature: effectiveGenOptions.temperature,
            stopSequences: effectiveGenOptions.stopSequences,
            abortSignal: effectiveGenOptions.signal,
            providerOptions: effectiveGenOptions.providerOptions,
            headers: effectiveGenOptions.headers,
            telemetry: effectiveGenOptions.telemetry ?? effectiveGenOptions.experimental_telemetry,
          };

          // Track step count and the durable message base for checkpointing.
          let currentStepCount = 0;
          const streamingCompaction = createStreamingCompactionState(
            initialParams.messages,
            effectiveGenOptions,
            effectiveGenOptions.threadId,
          );

          const generationStartTime = Date.now();
          const toolExecutionContext = createToolExecutionContext(options, retryState.currentModel);

          // Execute stream
          const result = streamText({
            model: retryState.currentModel,
            ...repairToolCallOptions,
            system: initialParams.system,
            messages: projectMessagesForModel(
              initialParams.messages,
              toolExecutionContext.agentSdk.modelCapabilities,
            ),
            tools: wrapToolsWithExecutionContext(
              initialParams.tools as ToolSet,
              toolExecutionContext,
            ),
            prepareStep: streamingCompaction.prepareStep,
            maxOutputTokens: initialParams.maxTokens,
            temperature: initialParams.temperature,
            stopSequences: initialParams.stopSequences,
            abortSignal: initialParams.abortSignal,
            stopWhen: buildStopConditions(signalState, effectiveGenOptions, maxSteps),
            // Passthrough AI SDK options
            output: effectiveGenOptions.output,
            // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
            providerOptions: initialParams.providerOptions as any,
            headers: initialParams.headers,
            telemetry: initialParams.telemetry,
            // Preserve AI SDK 6 behavior: allow system-role messages within the
            // message history (AI SDK 7 rejects them by default).
            allowSystemInMessages: true,
            // Keep the message base current for final persistence, and save
            // intermediate tool steps when requested.
            onStepFinish: async (stepResult) => {
              currentStepCount++;
              const currentMessages = streamingCompaction.appendStep(stepResult);
              if (
                effectiveGenOptions.checkpointAfterToolCall &&
                effectiveGenOptions.threadId &&
                options.checkpointer
              ) {
                await saveCheckpoint(
                  effectiveGenOptions.threadId,
                  currentMessages,
                  startStep + currentStepCount,
                  effectiveGenOptions._runId,
                );
              }
            },
            // Save checkpoint and invoke unified PostGenerate hook after completion
            onFinish: async (finishResult) => {
              // Update context manager with actual usage if available
              if (options.contextManager?.updateUsage && finishResult.usage) {
                options.contextManager.updateUsage({
                  inputTokens: finishResult.usage.inputTokens,
                  outputTokens: finishResult.usage.outputTokens,
                  totalTokens: finishResult.usage.totalTokens,
                });
              }

              // The streaming state is authoritative: prepareStep may have
              // discarded earlier history mid-run.
              if (effectiveGenOptions.threadId && options.checkpointer) {
                await saveCheckpoint(
                  effectiveGenOptions.threadId,
                  streamingCompaction.finalize(finishResult.steps, finishResult.text),
                  startStep + finishResult.steps.length,
                  effectiveGenOptions._runId,
                );
              }

              // Invoke unified PostGenerate hooks
              const telemetry = buildExecutionTelemetry({
                runId: executionBaseTelemetry.runId,
                threadId: effectiveGenOptions.threadId,
                requestedModel: retryState.currentModel,
                responseModelId: finishResult.response?.modelId,
                usage: finishResult.usage,
                durationMs: Date.now() - generationStartTime,
              });
              const hookResult: GenerateResultComplete = {
                status: "complete",
                telemetry,
                text: finishResult.text,
                usage: finishResult.usage,
                finishReason: finishResult.finishReason as GenerateResultComplete["finishReason"],
                output: undefined,
                steps: mapSteps(finishResult.steps),
              };
              const postGenerateHooks = effectiveHooks?.PostGenerate ?? [];
              if (postGenerateHooks.length > 0) {
                const postGenerateInput: PostGenerateInput = {
                  hook_event_name: "PostGenerate",
                  session_id: effectiveGenOptions.threadId ?? "default",
                  cwd: process.cwd(),
                  telemetry,
                  options: effectiveGenOptions,
                  result: hookResult,
                };
                await invokeHooksWithTimeout(postGenerateHooks, postGenerateInput, null, agent);
                // Note: updatedResult is not applied for streaming since the stream has already been sent
              }
            },
          });

          return result;
        } catch (error) {
          // Normalize error to AgentError
          const normalizedError = normalizeError(
            error,
            "Stream generation failed",
            effectiveGenOptions.threadId,
          );

          // Handle error with PostGenerateFailure hooks and fallback logic
          const postGenerateFailureHooks = effectiveHooks?.PostGenerateFailure ?? [];
          const retryDecisionHooks = effectiveHooks?.GenerationRetryDecision ?? [];
          const errorDecision = await handleGenerationError({
            error: normalizedError,
            failureHooks: postGenerateFailureHooks,
            decisionHooks: retryDecisionHooks,
            genOptions: effectiveGenOptions,
            agent,
            state: retryState,
            fallbackModel: options.fallbackModel,
            retryPolicy: options.generationRetryPolicy,
          });

          if (errorDecision.shouldRetry) {
            if (errorDecision.updatedOptions) {
              effectiveGenOptions = {
                ...errorDecision.updatedOptions,
                _runId: errorDecision.updatedOptions._runId ?? effectiveGenOptions._runId,
              };
            }
            // Update retry state
            Object.assign(retryState, updateRetryLoopState(retryState, errorDecision));
            // Wait for the specified delay before retrying
            await waitForRetryDelay(errorDecision.retryDelayMs);
            // Continue to next iteration of retry loop
            continue;
          }

          // No retry requested or max retries exceeded - throw the normalized error
          throw normalizedError;
        }
      }

      // This should never be reached, but TypeScript needs it for type safety
      throw new Error("Unexpected: retry loop exited without return or throw");
    },

    async streamDataResponse(genOptions: GenerateOptions): Promise<Response> {
      const runId = await checkpoints.resolveRunId(genOptions);

      // Invoke unified PreGenerate hooks
      const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
      const preGenResult = await invokePreGenerateHooks<GenerateResult>(
        preGenerateHooks,
        { ...genOptions, _runId: runId },
        agent,
      );

      // Check for cache short-circuit via respondWith
      // For data stream response, create a simple text response from the cached result
      if (preGenResult.cachedResult !== undefined) {
        const cachedResult = await invokeCachedPostGenerateHooks(
          preGenResult.cachedResult,
          { ...preGenResult.effectiveOptions, _runId: runId },
          options.model,
        );
        // For cached results, return a simple Response with the cached text
        // This is compatible with useChat and provides immediate delivery
        // Only complete results can be cached
        const text = cachedResult.status === "complete" ? cachedResult.text : "";
        return new Response(text, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      }

      let effectiveGenOptions = { ...preGenResult.effectiveOptions, _runId: runId };

      // Initialize retry loop state
      const retryState = createRetryLoopState(
        options.model,
        options.generationRetryPolicy?.maxRetries,
      );

      while (retryState.retryAttempt <= retryState.maxRetries) {
        try {
          const { messages, checkpoint } = await buildMessages(effectiveGenOptions);
          const maxSteps = options.maxSteps ?? 10;
          const startStep = checkpoint?.step ?? 0;
          const executionBaseTelemetry = buildExecutionTelemetryFromIds({
            runId: effectiveGenOptions._runId ?? createRunId(),
            threadId: effectiveGenOptions.threadId,
            requestedModel: retryState.currentModel,
          });

          // Capture currentModel for use in the callback closure
          const modelToUse = retryState.currentModel;

          // Create a UI message stream that tools can write to
          const stream = createUIMessageStream({
            execute: async ({ writer }) => {
              // Notify caller that writer is ready (for log streaming setup)
              if (effectiveGenOptions.onStreamWriterReady) {
                effectiveGenOptions.onStreamWriterReady(writer);
              }

              // Create streaming context for tools
              const streamingContext: StreamingContext = { writer };

              // Signal state for cooperative signal catching in streaming mode
              const signalState: GenerateSignalState = {};

              const streamingTools = toolPipeline.buildTools({
                threadId: effectiveGenOptions.threadId,
                telemetry: executionBaseTelemetry,
                signalState,
                streamingContext,
              });

              // Build prompt context and generate system prompt
              const promptContext = buildPromptContext(
                effectiveGenOptions,
                messages,
                effectiveGenOptions.threadId,
              );
              const systemPrompt = getSystemPrompt(promptContext);

              // Build initial params with streaming-aware tools
              const initialParams = {
                system: systemPrompt,
                messages,
                tools: streamingTools,
                maxTokens: effectiveGenOptions.maxTokens,
                temperature: effectiveGenOptions.temperature,
                stopSequences: effectiveGenOptions.stopSequences,
                abortSignal: effectiveGenOptions.signal,
                providerOptions: effectiveGenOptions.providerOptions,
                headers: effectiveGenOptions.headers,
                telemetry:
                  effectiveGenOptions.telemetry ?? effectiveGenOptions.experimental_telemetry,
              };

              // Track step count and the durable message base for checkpointing.
              let currentStepCount = 0;
              const streamingCompaction = createStreamingCompactionState(
                initialParams.messages,
                effectiveGenOptions,
                effectiveGenOptions.threadId,
              );

              const generationStartTime = Date.now();
              const toolExecutionContext = createToolExecutionContext(options, modelToUse);

              // Execute stream
              const result = streamText({
                model: modelToUse,
                ...repairToolCallOptions,
                system: initialParams.system,
                messages: projectMessagesForModel(
                  initialParams.messages,
                  toolExecutionContext.agentSdk.modelCapabilities,
                ),
                tools: wrapToolsWithExecutionContext(
                  initialParams.tools as ToolSet,
                  toolExecutionContext,
                ),
                prepareStep: streamingCompaction.prepareStep,
                maxOutputTokens: initialParams.maxTokens,
                temperature: initialParams.temperature,
                stopSequences: initialParams.stopSequences,
                abortSignal: initialParams.abortSignal,
                stopWhen: buildStopConditions(signalState, effectiveGenOptions, maxSteps),
                // Passthrough AI SDK options
                output: effectiveGenOptions.output,
                // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
                providerOptions: initialParams.providerOptions as any,
                headers: initialParams.headers,
                telemetry: initialParams.telemetry,
                // Preserve AI SDK 6 behavior: allow system-role messages within the
                // message history (AI SDK 7 rejects them by default).
                allowSystemInMessages: true,
                // Keep the message base current for final persistence, and save
                // intermediate tool steps when requested.
                onStepFinish: async (stepResult) => {
                  currentStepCount++;
                  const currentMessages = streamingCompaction.appendStep(stepResult);
                  if (
                    effectiveGenOptions.checkpointAfterToolCall &&
                    effectiveGenOptions.threadId &&
                    options.checkpointer
                  ) {
                    await saveCheckpoint(
                      effectiveGenOptions.threadId,
                      currentMessages,
                      startStep + currentStepCount,
                      effectiveGenOptions._runId,
                    );
                  }
                },
                // Save checkpoint and invoke unified PostGenerate hook after completion
                onFinish: async (finishResult) => {
                  // Update context manager with actual usage if available
                  if (options.contextManager?.updateUsage && finishResult.usage) {
                    options.contextManager.updateUsage({
                      inputTokens: finishResult.usage.inputTokens,
                      outputTokens: finishResult.usage.outputTokens,
                      totalTokens: finishResult.usage.totalTokens,
                    });
                  }

                  // The streaming state is authoritative: prepareStep may have
                  // discarded earlier history mid-run.
                  if (effectiveGenOptions.threadId && options.checkpointer) {
                    await saveCheckpoint(
                      effectiveGenOptions.threadId,
                      streamingCompaction.finalize(finishResult.steps, finishResult.text),
                      startStep + finishResult.steps.length,
                      effectiveGenOptions._runId,
                    );
                  }

                  // Invoke unified PostGenerate hooks
                  const telemetry = buildExecutionTelemetry({
                    runId: executionBaseTelemetry.runId,
                    threadId: effectiveGenOptions.threadId,
                    requestedModel: modelToUse,
                    responseModelId: finishResult.response?.modelId,
                    usage: finishResult.usage,
                    durationMs: Date.now() - generationStartTime,
                  });
                  const hookResult: GenerateResultComplete = {
                    status: "complete",
                    telemetry,
                    text: finishResult.text,
                    usage: finishResult.usage,
                    finishReason:
                      finishResult.finishReason as GenerateResultComplete["finishReason"],
                    output: undefined,
                    steps: mapSteps(finishResult.steps),
                  };
                  const postGenerateHooks = effectiveHooks?.PostGenerate ?? [];
                  if (postGenerateHooks.length > 0) {
                    const postGenerateInput: PostGenerateInput = {
                      hook_event_name: "PostGenerate",
                      session_id: effectiveGenOptions.threadId ?? "default",
                      cwd: process.cwd(),
                      telemetry,
                      options: effectiveGenOptions,
                      result: hookResult,
                    };
                    await invokeHooksWithTimeout(postGenerateHooks, postGenerateInput, null, agent);
                    // Note: updatedResult is not applied for streaming since the stream has already been sent
                  }
                },
              });

              // Merge the streamText output into the UI message stream
              writer.merge(result.toUIMessageStream());

              // Wait for initial generation to complete
              await result.text;

              // Save pending interrupt to checkpoint (mirrors stream() pattern)
              if (signalState.interrupt && effectiveGenOptions.threadId && options.checkpointer) {
                const interrupt = signalState.interrupt.interrupt;
                await checkpoints.markPendingInterrupt(
                  effectiveGenOptions.threadId,
                  interrupt,
                  executionBaseTelemetry.runId,
                );

                // Emit InterruptRequested hook
                const interruptRequestedHooks = effectiveHooks?.InterruptRequested ?? [];
                if (interruptRequestedHooks.length > 0) {
                  const hookInput: InterruptRequestedInput = {
                    hook_event_name: "InterruptRequested",
                    session_id: effectiveGenOptions.threadId ?? "default",
                    cwd: process.cwd(),
                    telemetry: executionBaseTelemetry,
                    interrupt_id: interrupt.id,
                    interrupt_type: interrupt.type,
                    tool_call_id: interrupt.toolCallId,
                    tool_name: interrupt.toolName,
                    request: interrupt.request,
                  };
                  await invokeHooksWithTimeout(interruptRequestedHooks, hookInput, null, agent);
                }
              }

              // --- Background task completion loop (streamDataResponse) ---
              if (waitForBackgroundTasks && !signalState.interrupt && !signalState.stop) {
                // Track accumulated steps for checkpoint saves
                const initialSteps = await result.steps;
                let accumulatedStepCount = initialSteps.length;
                let followUpBaseOptions = effectiveGenOptions;

                let currentMessages: ModelMessage[] = streamingCompaction.finalize(
                  initialSteps,
                  await result.text,
                );

                let followUpPrompt = await getNextTaskPrompt();
                while (followUpPrompt !== null) {
                  const followUpRequestOptions: GenerateOptions = {
                    ...followUpBaseOptions,
                    requestClass: "background",
                    prompt: followUpPrompt,
                    messages: [
                      ...currentMessages,
                      { role: "user" as const, content: followUpPrompt },
                    ],
                  };
                  let followUpStreamingCompaction:
                    | ReturnType<typeof createStreamingCompactionState>
                    | undefined;
                  const {
                    result: followUpResult,
                    effectiveOptions: followUpEffectiveOptions,
                    currentModel: followUpModel,
                  } = await startRetriedStreamText(
                    followUpRequestOptions,
                    (requestOptions, currentModel) => {
                      const followUpMessages = requestOptions.messages ?? [];
                      // Follow-ups build their own message list without going
                      // through buildMessages, so compact before the first step.
                      const compaction = createStreamingCompactionState(
                        followUpMessages,
                        requestOptions,
                        requestOptions.threadId,
                        true,
                      );
                      followUpStreamingCompaction = compaction;
                      const followUpTelemetry = buildExecutionTelemetryFromIds({
                        runId: requestOptions._runId ?? executionBaseTelemetry.runId,
                        threadId: requestOptions.threadId,
                        requestedModel: currentModel,
                      });
                      const activeFollowUpTools = toolPipeline.buildTools({
                        threadId: requestOptions.threadId,
                        telemetry: followUpTelemetry,
                        signalState,
                        streamingContext,
                      });
                      const followUpPromptContext = buildPromptContext(
                        requestOptions,
                        followUpMessages,
                        requestOptions.threadId,
                      );
                      const toolExecutionContext = createToolExecutionContext(
                        options,
                        currentModel,
                      );

                      return streamText({
                        model: currentModel,
                        ...repairToolCallOptions,
                        system: getSystemPrompt(followUpPromptContext),
                        messages: projectMessagesForModel(
                          followUpMessages,
                          toolExecutionContext.agentSdk.modelCapabilities,
                        ),
                        tools: wrapToolsWithExecutionContext(
                          activeFollowUpTools as ToolSet,
                          toolExecutionContext,
                        ),
                        prepareStep: compaction.prepareStep,
                        onStepFinish: (stepResult) => {
                          compaction.appendStep(stepResult);
                        },
                        maxOutputTokens: requestOptions.maxTokens,
                        temperature: requestOptions.temperature,
                        stopSequences: requestOptions.stopSequences,
                        abortSignal: requestOptions.signal,
                        stopWhen: buildStopConditions(signalState, effectiveGenOptions, maxSteps),
                        output: requestOptions.output,
                        // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
                        providerOptions: requestOptions.providerOptions as any,
                        headers: requestOptions.headers,
                        telemetry:
                          requestOptions.telemetry ?? requestOptions.experimental_telemetry,
                        allowSystemInMessages: true,
                      });
                    },
                  );
                  const followUpStartTime = Date.now();
                  followUpBaseOptions = {
                    ...followUpEffectiveOptions,
                    _runId: followUpEffectiveOptions._runId ?? followUpBaseOptions._runId,
                  };

                  writer.merge(followUpResult.toUIMessageStream());
                  const followUpText = await followUpResult.text;
                  const followUpResponse = await (followUpResult.response ??
                    Promise.resolve(undefined));

                  // The follow-up's compaction state is authoritative for the
                  // transcript (it may have compacted mid-run).
                  // --- Post-completion bookkeeping for follow-ups ---
                  const followUpSteps = await followUpResult.steps;

                  // The follow-up's compaction state is authoritative for the
                  // transcript (it may have compacted mid-run).
                  currentMessages = followUpStreamingCompaction
                    ? followUpStreamingCompaction.finalize(followUpSteps, followUpText)
                    : [
                        ...currentMessages,
                        { role: "user" as const, content: followUpPrompt },
                        ...(followUpText
                          ? [{ role: "assistant" as const, content: followUpText }]
                          : []),
                      ];
                  accumulatedStepCount += followUpSteps.length;

                  // Checkpoint save
                  if (followUpEffectiveOptions.threadId && options.checkpointer) {
                    await saveCheckpoint(
                      followUpEffectiveOptions.threadId,
                      currentMessages,
                      startStep + accumulatedStepCount,
                      followUpEffectiveOptions._runId,
                    );
                  }

                  // Context manager update
                  const followUpUsage = await followUpResult.usage;
                  if (options.contextManager?.updateUsage && followUpUsage) {
                    options.contextManager.updateUsage({
                      inputTokens: followUpUsage.inputTokens,
                      outputTokens: followUpUsage.outputTokens,
                      totalTokens: followUpUsage.totalTokens,
                    });
                  }

                  // PostGenerate hooks
                  const followUpPostGenerateHooks = effectiveHooks?.PostGenerate ?? [];
                  if (followUpPostGenerateHooks.length > 0) {
                    const followUpFinishReason = await followUpResult.finishReason;
                    const followUpTelemetry = buildExecutionTelemetry({
                      runId: followUpEffectiveOptions._runId ?? executionBaseTelemetry.runId,
                      threadId: followUpEffectiveOptions.threadId,
                      requestedModel: followUpModel,
                      responseModelId: followUpResponse?.modelId,
                      usage: followUpUsage,
                      durationMs: Date.now() - followUpStartTime,
                    });
                    const followUpHookResult: GenerateResultComplete = {
                      status: "complete",
                      telemetry: followUpTelemetry,
                      text: followUpText,
                      usage: followUpUsage,
                      finishReason: followUpFinishReason as GenerateResultComplete["finishReason"],
                      output: undefined,
                      steps: mapSteps(followUpSteps),
                    };
                    const followUpPostGenerateInput: PostGenerateInput = {
                      hook_event_name: "PostGenerate",
                      session_id: followUpEffectiveOptions.threadId ?? "default",
                      cwd: process.cwd(),
                      telemetry: followUpTelemetry,
                      options: followUpEffectiveOptions,
                      result: followUpHookResult,
                    };
                    await invokeHooksWithTimeout(
                      followUpPostGenerateHooks,
                      followUpPostGenerateInput,
                      null,
                      agent,
                    );
                  }

                  followUpPrompt = await getNextTaskPrompt();
                }
              }
            },
          });

          // Convert the stream to a Response
          return createUIMessageStreamResponse({ stream });
        } catch (error) {
          // Normalize error to AgentError
          const normalizedError = normalizeError(
            error,
            "Stream generation failed",
            effectiveGenOptions.threadId,
          );

          // Handle error with PostGenerateFailure hooks and fallback logic
          const postGenerateFailureHooks = effectiveHooks?.PostGenerateFailure ?? [];
          const retryDecisionHooks = effectiveHooks?.GenerationRetryDecision ?? [];
          const errorDecision = await handleGenerationError({
            error: normalizedError,
            failureHooks: postGenerateFailureHooks,
            decisionHooks: retryDecisionHooks,
            genOptions: effectiveGenOptions,
            agent,
            state: retryState,
            fallbackModel: options.fallbackModel,
            retryPolicy: options.generationRetryPolicy,
          });

          if (errorDecision.shouldRetry) {
            if (errorDecision.updatedOptions) {
              effectiveGenOptions = {
                ...errorDecision.updatedOptions,
                _runId: errorDecision.updatedOptions._runId ?? effectiveGenOptions._runId,
              };
            }
            // Update retry state
            Object.assign(retryState, updateRetryLoopState(retryState, errorDecision));
            // Wait for the specified delay before retrying
            await waitForRetryDelay(errorDecision.retryDelayMs);
            // Continue to next iteration of retry loop
            continue;
          }

          // No retry requested or max retries exceeded - throw the normalized error
          throw normalizedError;
        }
      }

      // This should never be reached, but TypeScript needs it for type safety
      throw new Error("Unexpected: retry loop exited without return or throw");
    },

    getActiveTools() {
      return toolPipeline.getPermissionWrappedTools();
    },

    addRuntimeTools(tools: ToolSet) {
      Object.assign(runtimeTools, tools);
    },

    removeRuntimeTools(toolNames: string[]) {
      for (const name of toolNames) {
        delete runtimeTools[name];
      }
    },

    setPermissionMode(mode) {
      permissionMode = mode;
    },

    async getInterrupt(threadId: string): Promise<Interrupt | undefined> {
      if (!options.checkpointer) {
        return undefined;
      }

      const checkpoint = await options.checkpointer.load(threadId);
      return checkpoint?.pendingInterrupt;
    },

    async resume(
      threadId: string,
      interruptId: string,
      response: unknown,
      genOptions?: Partial<GenerateOptions>,
    ): Promise<GenerateResult> {
      const outcome = await executeResumeCore(threadId, interruptId, response, genOptions);

      if (outcome.type === "re-interrupted") {
        return {
          status: "interrupted",
          telemetry: buildExecutionTelemetryFromIds({
            runId: getCheckpointRunId(outcome.checkpoint) ?? createRunId(),
            threadId,
            requestedModel: options.model,
          }),
          interrupt: outcome.interrupt,
          partial: undefined,
        } as GenerateResultInterrupted;
      }

      return agent.generate({
        threadId: outcome.threadId,
        ...outcome.genOptions,
        prompt: undefined,
      });
    },

    async resumeDataResponse(
      threadId: string,
      interruptId: string,
      response: unknown,
      genOptions?: Partial<GenerateOptions>,
    ): Promise<Response> {
      const outcome = await executeResumeCore(threadId, interruptId, response, genOptions);

      if (outcome.type === "re-interrupted") {
        // Return an empty response — the client already has the interrupt widget.
        // The new interrupt is persisted to the checkpoint and retrievable
        // via getInterrupt().
        return new Response(null, { status: 204 });
      }

      return agent.streamDataResponse({
        threadId: outcome.threadId,
        ...outcome.genOptions,
        prompt: undefined,
      });
    },

    async dispose(): Promise<void> {
      // Kill all running background tasks
      await taskManager.killAllTasks();

      // Close MCP connections
      await mcpManager.disconnect();
    },

    // Initialize the ready promise
    ready: Promise.resolve(),
  };

  // Initialize plugins and middleware asynchronously (including MCP server connections)
  const initPromise = (async () => {
    // Setup middleware first
    await setupMiddleware(middleware);

    for (const plugin of options.plugins ?? []) {
      // Connect to MCP server if configured
      if (plugin.mcpServer) {
        try {
          await mcpManager.connectServer(plugin.name, plugin.mcpServer);
        } catch (error) {
          // Log error with full details - MCP connection failures are common
          // issues that are hard to debug when silently swallowed
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.warn(
            `[Agent SDK] MCP server connection failed for plugin '${plugin.name}':\n` +
              `  Error: ${errorMessage}\n` +
              `  Server: ${JSON.stringify(plugin.mcpServer)}\n` +
              `  The agent will continue without this plugin's MCP tools.`,
          );
        }
      }

      // Run plugin setup
      if (plugin.setup) {
        await plugin.setup(agent);
      }
    }
  })();

  // Replace the ready promise with the actual initialization
  (agent as { ready: Promise<void> }).ready = initPromise;

  return agent;
}
