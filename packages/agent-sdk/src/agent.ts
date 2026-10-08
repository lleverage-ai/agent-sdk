/**
 * Core agent implementation.
 *
 * @packageDocumentation
 */

import type {
  ModelMessage,
  ProviderMetadata,
  ToolCallRepairFunction,
  ToolExecutionOptions,
  ToolSet,
} from "ai";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  NoSuchToolError,
  streamText,
} from "ai";
import { createCheckpointRuntime, getCheckpointRunId } from "./agent/checkpoint-runtime.js";
import {
  cachedTextResponse,
  createGenerationRunner,
  createToolExecutionContext,
  createToolModelOutput,
  mapSteps,
} from "./agent/generation-runner.js";
import type { LogCallBoundary } from "./agent/log-boundary.js";
import { createLogCompactor, type LogCompactor } from "./agent/log-compaction.js";
import {
  createLogContextRuntime,
  isLogModeEnabled,
  validateLogModeOptions,
} from "./agent/log-context.js";
import { createLogResume, type ResumeOutcome } from "./agent/log-resume.js";
import { buildMessagesFromStepResponses, createMessageRuntime } from "./agent/messages.js";
import {
  createToolPipeline,
  filterToolsByAllowed,
  InterruptSignal,
  isInterruptSignal,
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
import type { Interrupt } from "./checkpointer/types.js";
import {
  createCheckpoint,
  createInterrupt,
  isApprovalInterrupt,
  updateCheckpoint,
} from "./checkpointer/types.js";
import { type AgentError, ConfigurationError, ValidationError } from "./errors/index.js";
import { normalizeError } from "./generation-helpers.js";
import { invokeHooksWithTimeout } from "./hooks.js";
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
import { createSubagent, subagentContextLogOptions } from "./subagents.js";
import { TaskManager } from "./task-manager.js";
import type { BackgroundTask } from "./task-store/types.js";
import { formatPluginToolName, resolveStaticToolDescription } from "./tool-names.js";
import { createCallToolTool, formatToolNameList, suggestNearMissTools } from "./tools/call-tool.js";
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
  InterruptResolvedInput,
  MCPConnectionFailedInput,
  MCPConnectionRestoredInput,
  PostCheckpointLoadInput,
  PrepareCompactionOptions,
  StreamingContext,
  StreamPart,
  SubagentDefinition,
} from "./types.js";

let agentIdCounter = 0;

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
 *   return agent.streamDataResponse({ messages });
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

  // Context log mode is opt-in. Reject options it cannot honour before
  // anything else is built; legacy agents skip every check.
  validateLogModeOptions(options);
  const logContext =
    options.contextLog && isLogModeEnabled(options)
      ? createLogContextRuntime(
          { ...options, contextLog: options.contextLog },
          // Built below from the message runtime; read only once a call runs.
          {
            compactor: () => logCompactor,
            prepareCompactor: () => createPrepareCompactor?.(),
          },
        )
      : undefined;

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
  if (options.ownedTaskPolicy)
    taskManager.configureOwnedTasks(options.ownedTaskPolicy, options.ownedTaskCallbacks);

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
            contextLog: subagentContextLogOptions(agent, _ctx),
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
   *
   * An unknown tool name is enriched with the closest discoverable tools so a
   * near-miss costs one corrected call rather than a `search_tools` round trip.
   * It stays a `NoSuchToolError`: hosts classify that as invalid input and keep
   * its message, where a plain `Error` would be replaced by generic text.
   */
  const repairToolCall: ToolCallRepairFunction<ToolSet> = async (params) => {
    const repaired = await repairDiscoveredToolCall(params);
    if (repaired) {
      return repaired;
    }
    let error: unknown = params.error;
    if (NoSuchToolError.isInstance(error)) {
      const toolName = params.toolCall.toolName;
      const suggestions = suggestNearMissTools(mcpManager, toolName);
      if (suggestions.length > 0) {
        error = new NoSuchToolError({
          toolName,
          availableTools: suggestions,
          message: `Tool "${toolName}" does not exist. Closest available tools: ${formatToolNameList(suggestions)}. Call one of them by its exact name through call_tool.`,
        });
      }
    }
    if (options.transformToolError) {
      throw options.transformToolError(error, { toolName: params.toolCall.toolName });
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
  const checkpoints = createCheckpointRuntime({
    checkpointer: options.checkpointer,
    state,
    onLoaded: async (checkpoint, threadId) => {
      const loadedHooks = effectiveHooks?.PostCheckpointLoad ?? [];
      if (loadedHooks.length === 0) return;
      const input: PostCheckpointLoadInput = {
        hook_event_name: "PostCheckpointLoad",
        session_id: threadId,
        cwd: process.cwd(),
        telemetry: buildExecutionTelemetryFromIds({
          runId: getCheckpointRunId(checkpoint) ?? createRunId(),
          threadId,
          requestedModel: options.model,
        }),
        thread_id: threadId,
        step: checkpoint.step,
        messages: checkpoint.messages,
        ...(checkpoint.metadata ? { metadata: checkpoint.metadata } : {}),
        has_pending_interrupt: checkpoint.pendingInterrupt !== undefined,
      };
      await invokeHooksWithTimeout(loadedHooks, input, null, agent);
    },
    ...(logContext && { logCursor: logContext.cursor }),
  });
  const { save: saveCheckpoint } = checkpoints;

  /**
   * Message assembly and compaction; see `./agent/messages.ts`.
   */
  const messageRuntime = createMessageRuntime({
    contextManager: options.contextManager,
    model: options.model,
    hooks: effectiveHooks,
    getAgent: () => agent,
    checkpoints,
  });
  const { createStreamingCompactionState } = messageRuntime;
  // Log mode records compaction as a transition in the log, through the
  // same context policy and compaction hooks.
  const compactionManager = options.contextManager;
  const logCompactor: LogCompactor | undefined =
    logContext && compactionManager
      ? createLogCompactor(
          messageRuntime.compactMessagesIfNeeded,
          (view, budgetMessages) =>
            compactionManager.shouldCompact(view, { budgetMessages, estimateOnly: true }).trigger,
        )
      : undefined;
  // LLE-14017: plans the next compaction to generate its summary ahead of
  // time. It calls the context manager directly: no compaction hooks run,
  // because nothing is compacted, and the plan is never committed.
  const createPrepareCompactor:
    | (() => {
        compactor: LogCompactor;
        summarised: () => boolean;
        kept: (message: ModelMessage) => boolean;
        retains: (pendingMessages: number) => boolean;
      })
    | undefined =
    logContext && compactionManager
      ? () => {
          let summarised = false;
          let kept = new Set<ModelMessage>();
          const compactor = createLogCompactor(
            async (messages, _genOptions, _threadId, compactOptions, budgetMessages) => {
              const { trigger, reason } = compactionManager.shouldCompact(
                messages,
                budgetMessages ? { budgetMessages } : undefined,
              );
              if (!trigger || !reason) return { compacted: false, messages };
              // `prepare`: the summary is generated, nothing is applied to
              // the live manager (usage, callbacks, failure circuit).
              const result = await compactionManager.compact(messages, agent, reason, {
                ...compactOptions,
                prepare: true,
              });
              summarised = result.summary !== "";
              kept = new Set(result.newMessages);
              return { compacted: true, messages: result.newMessages };
            },
            (view, budgetMessages) =>
              compactionManager.shouldCompact(view, { budgetMessages, estimateOnly: true }).trigger,
          );
          return {
            compactor,
            summarised: () => summarised,
            kept: (message) => kept.has(message),
            // The built-in retention keeps the last `keepMessageCount`
            // conversation messages; placeholders beyond it would be
            // summarised, so the next call's request could never match.
            retains: (pendingMessages) => {
              const keep = compactionManager.summarizationConfig.keepMessageCount;
              return typeof keep !== "number" || pendingMessages <= keep;
            },
          };
        }
      : undefined;

  /**
   * Shared generation lifecycle (PreGenerate → attempt setup → AI SDK params →
   * PostGenerate → retry); see `./agent/generation-runner.ts`.
   */
  const runner = createGenerationRunner({
    options,
    hooks: effectiveHooks,
    getAgent: () => agent,
    toolPipeline,
    checkpoints,
    messageRuntime,
    buildPromptContext,
    getSystemPrompt,
    repairToolCallOptions,
    getNextTaskPrompt,
    ...(logContext && { logContext }),
  });

  /**
   * Get the next actionable task prompt from the background task queue.
   *
   * Waits for a task to reach terminal state, skips already-consumed and killed
   * tasks, formats the result as a prompt, removes the task, and returns it.
   * Returns null when no more tasks need processing.
   */
  async function getNextTaskPrompt(): Promise<string | null> {
    while (taskManager.hasBackgroundTasks()) {
      const candidate = await taskManager.waitForNextCompletion();
      // One synchronous consume decision shared with task_output.
      const completedTask = taskManager.consumeTask(candidate.id);
      if (!completedTask) continue;

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

    // Consuming a killed card does not prove its request has stopped.
    await taskManager.settleOwnedTasks("Background drain complete", true);
    return null;
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
   * Log-mode resume: appends the resolution and the tool's result to the log
   * and leaves the continuation to an ordinary log-mode generation; see
   * `./agent/log-resume.ts`.
   */
  const logResume =
    logContext &&
    createLogResume({
      options,
      logContext,
      toolPipeline,
      checkpoints,
      hooks: effectiveHooks,
      getAgent: () => agent,
      pendingResponses,
      approvalDecisions,
      state,
    });

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
    // Resume invokes InterruptResolved hooks (and, in legacy mode, raw tools)
    // outside a generation. Never imply the workflow gate protects it.
    if (options.workflowExecutionGate) {
      throw new ConfigurationError(
        "Workflow-gated agents cannot use resume(), resumeDataResponse() or resumeStream(); supply resolved tool results through generate() or stream() instead",
        { configKey: "workflowExecutionGate" },
      );
    }
    // Log mode never reads or writes checkpoint history: the resolution and
    // the tool's result are appended to the log instead.
    if (logResume) {
      return logResume(threadId, interruptId, response, genOptions);
    }
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
          const toolExecutionContext = createToolExecutionContext(
            options,
            options.model,
            genOptions,
          );
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
      const toolExecutionContext = createToolExecutionContext(options, options.model, genOptions);
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
      const run = await runner.beginRun(genOptions);

      // Check for cache short-circuit via respondWith
      if (run.cachedResult !== undefined) {
        return await runner.resolveCachedResult(run.cachedResult, run.effectiveGenOptions);
      }

      let effectiveGenOptions = run.effectiveGenOptions;

      // Initialize retry loop state
      const retryState = runner.createRetryState();
      // Track messages for emergency compaction (accessible in catch block)
      let lastBuiltMessages: ModelMessage[] = [];

      while (retryState.retryAttempt <= retryState.maxRetries) {
        // Log mode: the attempt's commit boundary, closed if the attempt fails.
        let logCall: LogCallBoundary | undefined;
        // The attempt's options, after any log-mode PreGenerate hook changed
        // operational ones (for example the signal).
        let attemptOptions: GenerateOptions = effectiveGenOptions;
        try {
          const attempt = await runner.prepareAttempt(effectiveGenOptions, retryState.currentModel);
          logCall = attempt.logCall;
          attemptOptions = attempt.effectiveGenOptions;
          const { messages, checkpointThreadId, startStep, executionBaseTelemetry, signalState } =
            attempt;
          // Store for potential emergency compaction in catch block
          lastBuiltMessages = messages;

          const generationStartTime = Date.now();

          // Execute generation
          const response = await generateText(runner.buildModelCallParams(attempt));

          // Log mode: commit the last step's outputs before anything uses
          // them. A late result after cancellation is never committed.
          if (logCall) {
            attempt.effectiveGenOptions.signal?.throwIfAborted();
            await logCall.complete(response.steps);
          }

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
                attempt.pendingInput?.byStep,
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

            await runner.emitInterruptRequested(
              effectiveGenOptions.threadId,
              interruptTelemetry,
              interrupt,
            );

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
          };

          // Across supported AI SDK versions, run-level usage may aggregate
          // multiple requests. Context occupancy needs the final request only.
          runner.updateContextUsage(
            response.steps.at(-1)?.usage ?? response.usage,
            effectiveGenOptions,
          );

          // Abort-ignoring providers must not publish a late result/checkpoint.
          attempt.effectiveGenOptions.signal?.throwIfAborted();
          // Save checkpoint.
          // `response.response.messages` only holds the FINAL step's messages;
          // build from every step so intermediate tool calls/results survive.
          if (checkpointThreadId && options.checkpointer) {
            const finalMessages = buildMessagesFromStepResponses(
              messages,
              response.steps,
              response.text,
              response.response?.messages,
              attempt.pendingInput?.byStep,
            );
            await saveCheckpoint(
              checkpointThreadId,
              finalMessages,
              startStep + response.steps.length,
              executionBaseTelemetry.runId,
            );
          }

          // Invoke unified PostGenerate hooks and apply output transformation
          // via updatedResult (generate() is the only mode that can, since the
          // result has not been sent yet).
          const updatedResult = await runner.invokePostGenerate(
            effectiveGenOptions,
            telemetry,
            result,
          );
          const finalResult = updatedResult !== undefined ? updatedResult : result;

          // --- Background task completion loop ---
          if (!waitForBackgroundTasks || signalState.stop) {
            return finalResult;
          }

          // When checkpointing is active, the checkpoint already contains the
          // full conversation history (saved above). Passing explicit messages
          // would cause buildMessages() to load checkpoint messages AND append
          // the same messages again, causing duplication. In log mode the log
          // is the history and caller messages are rejected.
          const hasCheckpointing =
            !!logContext || !!(effectiveGenOptions.threadId && options.checkpointer);
          let lastResult: GenerateResult = finalResult;
          let runningMessages: ModelMessage[] = hasCheckpointing
            ? []
            : buildMessagesFromStepResponses(
                messages,
                response.steps,
                finalResult.text,
                response.response?.messages,
                attempt.pendingInput?.byStep,
              );

          let followUpPrompt = await getNextTaskPrompt();
          while (followUpPrompt !== null) {
            const followUpOptions: GenerateOptions = {
              ...effectiveGenOptions,
              requestClass: "background",
              prompt: followUpPrompt,
              messages: hasCheckpointing ? undefined : runningMessages,
              // A follow-up is a new run on the log the original run already
              // extended: the host's history applied to that run only, and
              // compaction may since have removed it from the path.
              contextHistory: undefined,
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
          await logCall?.abandon(attemptOptions.signal?.aborted);
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

            await runner.emitInterruptRequested(
              effectiveGenOptions.threadId,
              interruptTelemetry,
              interrupt,
            );

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

          // Emergency compaction is also a replay boundary.
          await taskManager.settleOwnedTasks("SDK generation failed", true);
          // Check for context length error and attempt emergency compaction if enabled
          // Note: Only attempt this ONCE to avoid infinite loops
          if (
            options.contextManager?.policy.enableErrorFallback &&
            // Log mode never rewrites checkpoint history: it compacts by a
            // declared transition before a call, not after a failure.
            !logContext &&
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
                  // The retry will use checkpoint messages only, so it must
                  // load the compacted checkpoint rather than the run's snapshot
                  effectiveGenOptions = {
                    ...effectiveGenOptions,
                    messages: undefined,
                    _checkpointSnapshot: undefined,
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

          effectiveGenOptions = await runner.retryOrThrow(
            normalizedError,
            effectiveGenOptions,
            retryState,
            { logCall },
          );
        }
      }

      // This should never be reached, but TypeScript needs it for type safety
      throw new Error("Unexpected: retry loop exited without return or throw");
    },

    async *stream(genOptions: GenerateOptions): AsyncGenerator<StreamPart> {
      const run = await runner.beginRun(genOptions);

      // Check for cache short-circuit via respondWith
      // For streaming, we convert the cached GenerateResult into StreamParts
      if (run.cachedResult !== undefined) {
        const cachedResult = await runner.resolveCachedResult(
          run.cachedResult,
          run.effectiveGenOptions,
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

      let effectiveGenOptions = run.effectiveGenOptions;

      // Initialize retry loop state
      const retryState = runner.createRetryState();

      while (retryState.retryAttempt <= retryState.maxRetries) {
        // Log mode: the attempt's commit boundary, closed if the attempt fails.
        let logCall: LogCallBoundary | undefined;
        // The attempt's options, after any log-mode PreGenerate hook changed
        // operational ones (for example the signal).
        let attemptOptions: GenerateOptions = effectiveGenOptions;
        try {
          const attempt = await runner.prepareAttempt(effectiveGenOptions, retryState.currentModel);
          logCall = attempt.logCall;
          attemptOptions = attempt.effectiveGenOptions;
          const { checkpointThreadId, startStep, executionBaseTelemetry, signalState } = attempt;

          const generationStartTime = Date.now();
          let firstTextDeltaAt: number | undefined;
          const streamingCompaction = createStreamingCompactionState(
            attempt.initialParams.messages,
            effectiveGenOptions,
            checkpointThreadId,
          );

          // Execute stream
          const response = streamText({
            ...runner.buildModelCallParams(attempt),
            prepareStep: runner.prepareStepFor(attempt, streamingCompaction),
            onStepFinish: (stepResult) => {
              // Log mode: the boundary keeps finished steps, so a received
              // reply is still committed if the consumer stops early.
              logCall?.onStepFinish(stepResult);
              streamingCompaction.appendStep(stepResult);
            },
            // stream() reads `output` from the caller's options rather than
            // the PreGenerate-transformed ones; see
            // docs/architecture/generation-modes.md.
            output: genOptions.output,
          });

          // AI SDK only carries the response id on `finish-step`, not on
          // `start-step`, so `turn-start` is emitted without a messageId and
          // consumers correlate via the matching `turn-end`.
          const activeToolInputToolNames = new Map<string, string>();
          // AI SDK 7 emits an invalid `tool-call` (unparsable input / unknown
          // tool) carrying the structured cause, immediately followed by a
          // `tool-error` whose `error` has been flattened to a string. Retain
          // the cause for that adjacent, identity-matched pair only; the
          // receipt is cleared on every chunk and error text is never trusted.
          let pendingInvalidToolCall:
            | { toolCallId: string; toolName: string; input: unknown; error: unknown }
            | undefined;
          // AI SDK carries provider metadata only on `finish-step`; the last
          // step's is forwarded on `finish` too, so a consumer reading only the
          // terminal part still sees, for example, a refusal's stop details.
          let lastStepProviderMetadata: ProviderMetadata | undefined;
          for await (const part of response.fullStream) {
            const precedingInvalidToolCall = pendingInvalidToolCall;
            pendingInvalidToolCall = undefined;
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
              lastStepProviderMetadata = part.providerMetadata ?? undefined;
              yield {
                type: "turn-end",
                messageId,
                finishReason: part.finishReason as StreamPart extends {
                  type: "finish";
                }
                  ? StreamPart["finishReason"]
                  : never,
                usage: part.usage,
                ...(lastStepProviderMetadata ? { providerMetadata: lastStepProviderMetadata } : {}),
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
              if (part.invalid === true && part.error !== undefined) {
                pendingInvalidToolCall = {
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  input: part.input,
                  error: part.error,
                };
              }
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
                error:
                  typeof part.error === "string" &&
                  precedingInvalidToolCall !== undefined &&
                  precedingInvalidToolCall.toolCallId === part.toolCallId &&
                  precedingInvalidToolCall.toolName === part.toolName &&
                  precedingInvalidToolCall.input === part.input
                    ? precedingInvalidToolCall.error
                    : part.error,
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
                ...(lastStepProviderMetadata ? { providerMetadata: lastStepProviderMetadata } : {}),
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

          attempt.effectiveGenOptions.signal?.throwIfAborted();
          // Log mode: commit the last step's outputs before anything uses them.
          await logCall?.complete(steps);
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
            await runner.emitInterruptRequested(effectiveGenOptions.threadId, telemetry, interrupt);
          }

          // Invoke unified PostGenerate hooks
          // Note: updatedResult is not applied for streaming since the stream has already been sent
          await runner.invokePostGenerate(effectiveGenOptions, telemetry, result);

          // --- Background task completion loop ---
          if (!waitForBackgroundTasks || signalState.interrupt || signalState.stop) {
            return;
          }

          // In log mode the log is the history and caller messages are rejected.
          const hasCheckpointing =
            !!logContext || !!(effectiveGenOptions.threadId && options.checkpointer);
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
              // A follow-up is a new run on the log the original run already
              // extended: the host's history applied to that run only, and
              // compaction may since have removed it from the path.
              contextHistory: undefined,
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
          await logCall?.abandon(attemptOptions.signal?.aborted);
          if (error instanceof NestedBackgroundGenerationError) {
            throw error.originalError;
          }

          // Normalize error to AgentError
          const normalizedError = normalizeError(
            error,
            "Stream generation failed",
            effectiveGenOptions.threadId,
          );

          effectiveGenOptions = await runner.retryOrThrow(
            normalizedError,
            effectiveGenOptions,
            retryState,
            { logCall },
          );
        } finally {
          // A consumer that stops iterating early skips `catch`. Closing is a
          // no-op once the call completed or was already closed.
          await logCall?.abandon(attemptOptions.signal?.aborted);
        }
      }

      // This should never be reached, but TypeScript needs it for type safety
      throw new Error("Unexpected: retry loop exited without return or throw");
    },

    async streamRaw(genOptions: GenerateOptions) {
      // Note: respondWith cache short-circuit is NOT supported for streamRaw()
      // because it returns the raw AI SDK streamText result which cannot be mocked.
      // Use stream() or streamDataResponse() for caching support.
      // Input transformation is applied even though respondWith is not supported.
      const run = await runner.beginRun(genOptions);

      let effectiveGenOptions = run.effectiveGenOptions;

      // Initialize retry loop state
      const retryState = runner.createRetryState();

      while (retryState.retryAttempt <= retryState.maxRetries) {
        // Log mode: the attempt's commit boundary. Its last step is committed
        // by the stream's onFinish.
        let logCall: LogCallBoundary | undefined;
        // The attempt's options, after any log-mode PreGenerate hook changed
        // operational ones (for example the signal).
        let attemptOptions: GenerateOptions = effectiveGenOptions;
        try {
          const attempt = await runner.prepareAttempt(effectiveGenOptions, retryState.currentModel);
          logCall = attempt.logCall;
          attemptOptions = attempt.effectiveGenOptions;

          // Track the durable message base for checkpointing.
          const streamingCompaction = createStreamingCompactionState(
            attempt.initialParams.messages,
            effectiveGenOptions,
            effectiveGenOptions.threadId,
          );

          // Execute stream
          const result = streamText({
            ...runner.buildModelCallParams(attempt),
            prepareStep: runner.prepareStepFor(attempt, streamingCompaction),
            ...runner.createStreamLifecycleCallbacks(attempt, streamingCompaction),
          });

          return result;
        } catch (error) {
          await logCall?.abandon(attemptOptions.signal?.aborted);
          // Normalize error to AgentError
          const normalizedError = normalizeError(
            error,
            "Stream generation failed",
            effectiveGenOptions.threadId,
          );

          effectiveGenOptions = await runner.retryOrThrow(
            normalizedError,
            effectiveGenOptions,
            retryState,
            { logCall },
          );
        }
      }

      // This should never be reached, but TypeScript needs it for type safety
      throw new Error("Unexpected: retry loop exited without return or throw");
    },

    async streamDataResponse(genOptions: GenerateOptions): Promise<Response> {
      if (genOptions.streamingContext !== undefined) {
        throw new ConfigurationError(
          "streamDataResponse() creates its own stream writer and cannot take a caller-supplied streamingContext; use stream(), streamRaw() or generate() to supply one",
          { configKey: "streamingContext" },
        );
      }
      const run = await runner.beginRun(genOptions);

      // Check for cache short-circuit via respondWith
      // For data stream response, create a simple text response from the cached result
      if (run.cachedResult !== undefined) {
        const cachedResult = await runner.resolveCachedResult(
          run.cachedResult,
          run.effectiveGenOptions,
        );
        return cachedTextResponse(cachedResult);
      }

      let effectiveGenOptions = run.effectiveGenOptions;

      // Initialize retry loop state
      const retryState = runner.createRetryState();

      while (retryState.retryAttempt <= retryState.maxRetries) {
        // Log mode: the attempt's commit boundary, closed if starting fails.
        let logCall: LogCallBoundary | undefined;
        // The attempt's options, after any log-mode PreGenerate hook changed
        // operational ones (for example the signal).
        let attemptOptions: GenerateOptions = effectiveGenOptions;
        try {
          const attemptContext = await runner.beginAttempt(
            effectiveGenOptions,
            retryState.currentModel,
          );
          logCall = attemptContext.logCall;
          attemptOptions = attemptContext.effectiveGenOptions;
          const { executionBaseTelemetry } = attemptContext;

          // Create a UI message stream that tools can write to
          const stream = createUIMessageStream({
            execute: async ({ writer }) => {
              // Notify caller that writer is ready (for log streaming setup)
              if (attemptContext.effectiveGenOptions.onStreamWriterReady) {
                attemptContext.effectiveGenOptions.onStreamWriterReady(writer);
              }

              // Create streaming context for tools
              const streamingContext: StreamingContext = { writer };

              // Tools are built inside `execute` so they can stream through
              // the writer.
              const attempt = {
                ...attemptContext,
                ...runner.prepareRequest(attemptContext, { streamingContext }),
              };
              const { signalState } = attempt;

              // Track the durable message base for checkpointing.
              const streamingCompaction = createStreamingCompactionState(
                attempt.initialParams.messages,
                effectiveGenOptions,
                effectiveGenOptions.threadId,
              );

              // Execute stream
              const result = streamText({
                ...runner.buildModelCallParams(attempt),
                prepareStep: runner.prepareStepFor(attempt, streamingCompaction),
                ...runner.createStreamLifecycleCallbacks(attempt, streamingCompaction),
              });

              // Merge the streamText output into the UI message stream
              writer.merge(result.toUIMessageStream());

              // Wait for initial generation to complete
              await result.text;

              // Log mode: commit the last step's outputs before anything uses
              // them (onFinish commits too; the commit runs once). Failing
              // here surfaces through the UI stream's error handling.
              if (attempt.logCall) {
                try {
                  attempt.effectiveGenOptions.signal?.throwIfAborted();
                  await attempt.logCall.complete(await result.steps);
                } catch (error) {
                  await attempt.logCall.abandon(attempt.effectiveGenOptions.signal?.aborted);
                  throw error;
                }
              }

              // Save pending interrupt to checkpoint (mirrors stream() pattern)
              if (signalState.interrupt && effectiveGenOptions.threadId && options.checkpointer) {
                const interrupt = signalState.interrupt.interrupt;
                await checkpoints.markPendingInterrupt(
                  effectiveGenOptions.threadId,
                  interrupt,
                  executionBaseTelemetry.runId,
                );
                await runner.emitInterruptRequested(
                  effectiveGenOptions.threadId,
                  executionBaseTelemetry,
                  interrupt,
                );
              }

              // --- Background task completion loop (streamDataResponse) ---
              if (waitForBackgroundTasks && !signalState.interrupt && !signalState.stop) {
                await runner.runUIStreamFollowUps({
                  writer,
                  attempt,
                  result,
                  streamingCompaction,
                  signalState,
                  streamingContext,
                });
              }
            },
          });

          // Convert the stream to a Response
          return createUIMessageStreamResponse({ stream });
        } catch (error) {
          await logCall?.abandon(attemptOptions.signal?.aborted);
          // Normalize error to AgentError
          const normalizedError = normalizeError(
            error,
            "Stream generation failed",
            effectiveGenOptions.threadId,
          );

          effectiveGenOptions = await runner.retryOrThrow(
            normalizedError,
            effectiveGenOptions,
            retryState,
            { logCall },
          );
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

    invalidateCheckpoint(threadId: string): void {
      checkpoints.invalidate(threadId);
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

      // A resume continues the interrupted run: it never takes new input.
      const { input: _input, ...resumeOptions } = outcome.genOptions ?? {};
      return agent.generate({
        threadId: outcome.threadId,
        ...resumeOptions,
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

      // A resume continues the interrupted run: it never takes new input.
      const { input: _input, ...resumeOptions } = outcome.genOptions ?? {};
      return agent.streamDataResponse({
        threadId: outcome.threadId,
        ...resumeOptions,
        prompt: undefined,
      });
    },

    async prepareCompaction(prepareOptions: PrepareCompactionOptions) {
      if (!logContext) {
        throw new ConfigurationError("prepareCompaction() is available in context log mode only", {
          configKey: "contextLog",
        });
      }
      const pendingMessages = prepareOptions.pendingMessages ?? 1;
      if (!Number.isInteger(pendingMessages) || pendingMessages < 0) {
        throw new ValidationError("pendingMessages must be a non-negative integer", {
          fieldErrors: { pendingMessages: ["must be a non-negative integer"] },
        });
      }
      return logContext.prepareCompaction(
        {
          threadId: prepareOptions.threadId,
          ...(prepareOptions.contextStream && { contextStream: prepareOptions.contextStream }),
          ...(prepareOptions.signal && { signal: prepareOptions.signal }),
        },
        options.model,
        pendingMessages,
      );
    },

    async *resumeStream(
      threadId: string,
      interruptId: string,
      response: unknown,
      genOptions?: Partial<GenerateOptions>,
    ): AsyncGenerator<StreamPart> {
      const outcome = await executeResumeCore(threadId, interruptId, response, genOptions);

      // The tool interrupted again: like stream() after an interrupt, the
      // generator ends and the new interrupt is the pending interrupt.
      if (outcome.type === "re-interrupted") return;

      // A resume continues the interrupted run: it never takes new input.
      const { input: _input, ...resumeOptions } = outcome.genOptions ?? {};
      yield* agent.stream({
        threadId: outcome.threadId,
        ...resumeOptions,
        prompt: undefined,
      });
    },

    async dispose(): Promise<void> {
      // Kill all running background tasks
      await taskManager.killAllTasks();

      try {
        // A failed kill-all must not become successful disposal.
        await taskManager.settleOwnedTasks("Agent disposal");
      } finally {
        taskManager.releaseOwnedTaskResults();
        await mcpManager.disconnect();
      }
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
