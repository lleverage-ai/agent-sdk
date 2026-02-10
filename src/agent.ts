/**
 * Core agent implementation.
 *
 * @packageDocumentation
 */

import type { ModelMessage, Tool, ToolExecutionOptions, ToolSet } from "ai";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  stepCountIs,
  streamText,
} from "ai";
import type { BackendProtocol, ExecutableBackend } from "./backend.js";
import { hasExecuteCapability } from "./backend.js";
import { CommandBlockedError } from "./backends/filesystem.js";
import type { AgentState } from "./backends/state.js";
import { createAgentState, StateBackend } from "./backends/state.js";
import type { BaseCheckpointSaver, Checkpoint, Interrupt } from "./checkpointer/types.js";
import {
  createCheckpoint,
  createInterrupt,
  isApprovalInterrupt,
  updateCheckpoint,
} from "./checkpointer/types.js";
import {
  type AgentError,
  CheckpointError,
  ToolExecutionError,
  ToolPermissionDeniedError,
} from "./errors/index.js";
import {
  createRetryLoopState,
  handleGenerationError,
  invokePreGenerateHooks,
  normalizeError,
  updateRetryLoopState,
  waitForRetryDelay,
} from "./generation-helpers.js";
import {
  aggregatePermissionDecisions,
  extractUpdatedInput,
  extractUpdatedResult,
  invokeHooksWithTimeout,
  invokeMatchingHooks,
} from "./hooks.js";
import { MCPManager } from "./mcp/manager.js";
import { applyMiddleware, mergeHooks, setupMiddleware } from "./middleware/index.js";
import { createDefaultPromptBuilder } from "./prompt-builder/components.js";
import type { PromptContext } from "./prompt-builder/index.js";
import { ACCEPT_EDITS_BLOCKED_PATTERNS } from "./security/index.js";
import { TaskManager } from "./task-manager.js";
import {
  coreToolsToToolSet,
  createCoreTools,
  createSearchToolsTool,
  createTaskOutputTool,
  createTaskTool,
} from "./tools/factory.js";
import type { SkillDefinition } from "./tools/skills.js";
import { createUseToolsTool, ToolRegistry } from "./tools/tool-registry.js";
import type {
  Agent,
  AgentOptions,
  BackendFactory,
  GenerateOptions,
  GenerateResult,
  GenerateResultComplete,
  GenerateResultInterrupted,
  GenerateStep,
  HookRegistration,
  InterruptRequestedInput,
  InterruptResolvedInput,
  MCPConnectionFailedInput,
  MCPConnectionRestoredInput,
  PermissionDecision,
  PermissionMode,
  PostGenerateInput,
  PostToolUseFailureInput,
  PostToolUseInput,
  PreToolUseInput,
  StreamingContext,
  StreamingToolsFactory,
  StreamPart,
  ToolCallResult,
  ToolLoadErrorInput,
  ToolRegisteredInput,
  ToolResultPart,
} from "./types.js";

let agentIdCounter = 0;

/**
 * Internal signal for interrupt flow control.
 *
 * This is thrown when a tool requires user approval or an interrupt is requested.
 * It's caught by the generate() function and converted to an interrupted result.
 *
 * @internal
 */
class InterruptSignal extends Error {
  readonly interrupt: Interrupt;

  constructor(interrupt: Interrupt) {
    super(`Interrupt: ${interrupt.type}`);
    this.name = "InterruptSignal";
    this.interrupt = interrupt;
  }
}

/**
 * Check if an error is an InterruptSignal.
 * @internal
 */
function isInterruptSignal(error: unknown): error is InterruptSignal {
  return error instanceof InterruptSignal;
}

/**
 * Shared state for intercepting flow-control signals thrown by tools.
 *
 * AI SDK v6's `generateText` catches all errors from tool execution and converts
 * them to tool-result messages. To work around this, our outermost tool wrapper
 * (`wrapToolsWithSignalCatching`) intercepts InterruptSignal before the AI SDK
 * sees them, stores them here, and returns a placeholder result. A custom
 * `stopWhen` condition then stops generation after the current step.
 *
 * @internal
 */
interface GenerateSignalState {
  interrupt?: InterruptSignal;
}

/**
 * Outermost tool wrapper that intercepts flow-control signals.
 *
 * When a tool throws `InterruptSignal`, this wrapper catches it before the AI
 * SDK can, stores it in the shared `signalState`, and returns a placeholder
 * string. Combined with a custom `stopWhen` condition, this cleanly stops
 * generation and allows `generate()` to inspect `signalState` in the normal
 * return path (not the catch block).
 *
 * @internal
 */
function wrapToolsWithSignalCatching(tools: ToolSet, signalState: GenerateSignalState): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, toolDef] of Object.entries(tools)) {
    if (!toolDef.execute) {
      wrapped[name] = toolDef;
      continue;
    }

    const originalExecute = toolDef.execute;

    wrapped[name] = {
      ...toolDef,
      execute: async (input: unknown, options: ToolExecutionOptions) => {
        try {
          return await originalExecute.call(toolDef, input, options);
        } catch (error) {
          if (isInterruptSignal(error)) {
            if (signalState.interrupt) {
              throw error; // Already have a signal — let AI SDK handle this one
            }
            signalState.interrupt = error;
            return "[Interrupt requested]";
          }
          throw error;
        }
      },
    } as Tool;
  }

  return wrapped;
}

/**
 * File edit tool names that get auto-approved in acceptEdits mode.
 * @internal
 */
const FILE_EDIT_TOOLS = new Set([
  "write",
  "edit",
  // Bash commands that perform file operations (if we ever add them)
  // For now, bash is not auto-approved even in acceptEdits mode
]);

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
 * Determines if an error should trigger fallback to an alternative model.
 * @internal
 */
function shouldUseFallback(error: AgentError): boolean {
  // Check error code for known fallback-triggering conditions
  if (error.code === "RATE_LIMIT_ERROR" || error.code === "TIMEOUT_ERROR") {
    return true;
  }

  // Check for model unavailability or service errors
  const message = error.message.toLowerCase();
  const causeMessage = error.cause?.message?.toLowerCase() ?? "";

  if (
    error.code === "MODEL_ERROR" ||
    error.code === "UNKNOWN_ERROR" ||
    error.code === "AGENT_ERROR"
  ) {
    // Check both the AgentError message and the original error message
    if (
      message.includes("unavailable") ||
      message.includes("503") ||
      message.includes("service unavailable") ||
      causeMessage.includes("unavailable") ||
      causeMessage.includes("503") ||
      causeMessage.includes("service unavailable")
    ) {
      return true;
    }
  }

  return false;
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
 * Check if a tool should be allowed based on permission mode.
 * Returns "allow" or "deny" for definitive decisions, or undefined to defer to canUseTool callback.
 * @internal
 */
function checkPermissionMode(toolName: string, mode: PermissionMode): "allow" | "deny" | undefined {
  switch (mode) {
    case "plan":
      // Block all tool execution in plan mode
      return "deny";
    case "bypassPermissions":
      // Allow all tools (dangerous - use only for testing/demos)
      return "allow";
    case "acceptEdits":
      // Auto-approve file edit operations
      return FILE_EDIT_TOOLS.has(toolName) ? "allow" : undefined;
    default:
      // Defer to canUseTool callback
      return undefined;
  }
}

/**
 * Wrap tools with permission mode checking and canUseTool callback.
 * @internal
 */
function wrapToolsWithPermissionMode(
  tools: ToolSet,
  getPermissionMode: () => PermissionMode,
  canUseTool?: (
    toolName: string,
    input: unknown,
  ) => Promise<PermissionDecision> | PermissionDecision,
  approvalState?: {
    approvalDecisions: Map<string, boolean>;
    pendingResponses: Map<string, unknown>;
    checkpointSaver?: BaseCheckpointSaver;
    threadId?: string;
    step?: number;
  },
): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, tool] of Object.entries(tools)) {
    const originalExecute = tool.execute;
    if (!originalExecute) {
      // Skip tools without execute function
      wrapped[name] = tool;
      continue;
    }

    // Create needsApproval function that bridges canUseTool to AI SDK's approval flow
    // This allows the AI SDK to handle approval UI natively when canUseTool returns "ask"
    const needsApproval = canUseTool
      ? async (input: unknown): Promise<boolean> => {
          const mode = getPermissionMode();
          const modeDecision = checkPermissionMode(name, mode);

          // If permission mode denies, don't show approval UI (execute will throw)
          if (modeDecision === "deny") {
            return false;
          }

          // If permission mode allows, no approval needed
          if (modeDecision === "allow") {
            return false;
          }

          // Defer to canUseTool callback
          const decision = await canUseTool(name, input);
          return decision === "ask";
        }
      : tool.needsApproval; // Preserve original needsApproval if no canUseTool

    wrapped[name] = {
      ...tool,
      needsApproval,
      execute: async (input: unknown, options?: import("ai").ToolExecutionOptions) => {
        const mode = getPermissionMode();
        const modeDecision = checkPermissionMode(name, mode);

        // Create the interrupt function for tool execution
        const toolCallId =
          options?.toolCallId ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const threadId = approvalState?.threadId ?? "unknown";
        const step = approvalState?.step ?? 0;

        const interrupt = async <TRequest = unknown, TResponse = unknown>(
          request: TRequest,
          interruptOptions?: { type?: string },
        ): Promise<TResponse> => {
          const interruptType = interruptOptions?.type ?? "custom";
          const interruptId = `int_${toolCallId}`;

          // Check if we have a pending response for this interrupt
          if (approvalState?.pendingResponses.has(interruptId)) {
            const response = approvalState.pendingResponses.get(interruptId);
            // Clear the response after use
            approvalState.pendingResponses.delete(interruptId);
            return response as TResponse;
          }

          // No response yet - create and throw an interrupt
          if (!approvalState?.checkpointSaver) {
            throw new ToolExecutionError(
              `Tool "${name}" called interrupt() but no checkpointer is configured`,
              {
                toolName: name,
                toolInput: input,
                metadata: { interruptType, request },
              },
            );
          }

          const interruptData = createInterrupt({
            id: interruptId,
            threadId,
            type: interruptType,
            toolCallId,
            toolName: name,
            request,
            step,
          });

          throw new InterruptSignal(interruptData);
        };

        // Create extended options with the interrupt function
        const extendedOptions = {
          ...options,
          interrupt,
        };

        // If permission mode gives a definitive answer, use it
        if (modeDecision === "allow") {
          // Execute the original tool
          // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
          return originalExecute.call(tool, input, extendedOptions as any);
        }

        if (modeDecision === "deny") {
          // Denied by permission mode
          const errorMessage =
            mode === "plan"
              ? `Tool "${name}" is blocked in plan mode (planning/analysis only)`
              : `Tool "${name}" requires permission approval`;
          throw new ToolExecutionError(errorMessage, {
            toolName: name,
            toolInput: input,
            metadata: { permissionMode: mode },
          });
        }

        // Permission mode deferred to canUseTool callback
        if (canUseTool) {
          const callbackDecision = await canUseTool(name, input);

          if (callbackDecision === "allow") {
            // Execute the original tool
            // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
            return originalExecute.call(tool, input, extendedOptions as any);
          }

          if (callbackDecision === "deny") {
            throw new ToolExecutionError(`Tool "${name}" was denied by canUseTool callback`, {
              toolName: name,
              toolInput: input,
              metadata: { permissionMode: mode, decision: callbackDecision },
            });
          }

          if (callbackDecision === "ask") {
            // When canUseTool returns "ask", we need to determine the execution path:
            // 1. AI SDK streaming: needsApproval (set above) triggers approval UI,
            //    and execute() is only called after user approves
            // 2. Direct tool execution: execute() is called directly without AI SDK,
            //    so we need to throw an error to require approval
            const toolUseId = options?.toolCallId;

            if (toolUseId && approvalState) {
              // Check for explicit denial in pending responses
              const pendingResponse = approvalState.pendingResponses.get(toolUseId);
              if (pendingResponse !== undefined) {
                const response = pendingResponse as { approved?: boolean; reason?: string };
                if (response.approved === false) {
                  throw new ToolExecutionError(
                    `Tool "${name}" was denied by user${response.reason ? `: ${response.reason}` : ""}`,
                    {
                      toolName: name,
                      toolInput: input,
                      metadata: {
                        permissionMode: mode,
                        decision: "deny",
                        toolUseId,
                        reason: response.reason,
                      },
                    },
                  );
                }
                // Has approval response - user approved, continue to execution
                if (response.approved === true) {
                  // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
                  return originalExecute.call(tool, input, extendedOptions as any);
                }
              }

              // Check legacy approval system
              const decision = approvalState.approvalDecisions.get(toolUseId);
              if (decision === false) {
                throw new ToolExecutionError(`Tool "${name}" was denied by user`, {
                  toolName: name,
                  toolInput: input,
                  metadata: {
                    permissionMode: mode,
                    decision: "deny",
                    toolUseId,
                  },
                });
              }
              if (decision === true) {
                // Explicitly approved via legacy system
                // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
                return originalExecute.call(tool, input, extendedOptions as any);
              }
            }

            // No approval decision exists yet.
            // For AI SDK streaming, this path shouldn't be reached because
            // needsApproval returned true and AI SDK won't call execute.
            // For direct calls without AI SDK, we throw an error.
            throw new ToolExecutionError(
              `Tool "${name}" requires user approval but no checkpointer is configured`,
              {
                toolName: name,
                toolInput: input,
                metadata: {
                  permissionMode: mode,
                  decision: "ask",
                  reason:
                    "Direct tool call requires approval - use AI SDK streaming for approval UI",
                },
              },
            );
          }
        }

        // No canUseTool callback - default to allow in default mode
        // This preserves backward compatibility where tools work by default
        // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
        return originalExecute.call(tool, input, extendedOptions as any);
      },
    };
  }

  return wrapped;
}

/**
 * Wraps tools to inject TaskManager into execution options.
 *
 * @param tools - The tools to wrap
 * @param taskManager - The TaskManager instance to inject
 * @returns Wrapped tools with TaskManager in execution context
 *
 * @internal
 */
function wrapToolsWithTaskManager(tools: ToolSet, taskManager: TaskManager): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      wrapped[name] = tool;
      continue;
    }

    const originalExecute = tool.execute;

    wrapped[name] = {
      ...tool,
      execute: async (input: unknown, options?: ToolExecutionOptions) => {
        // Inject taskManager into execution options
        const extendedOptions = {
          ...options,
          taskManager,
        } as ToolExecutionOptions;
        return originalExecute(input, extendedOptions);
      },
    };
  }

  return wrapped;
}

/**
 * Wraps tools to emit PreToolUse/PostToolUse/PostToolUseFailure hooks.
 *
 * This enables observability hooks (logging, metrics, tracing) and guardrails
 * (rate-limiting, audit, permission checks) to fire during tool execution.
 *
 * @param tools - The tools to wrap
 * @param hookRegistration - The hook registration containing tool hook matchers
 * @param agent - The agent instance
 * @param sessionId - The session ID for hook input
 * @returns Wrapped tools that emit hooks
 *
 * @internal
 */
function wrapToolsWithHooks(
  tools: ToolSet,
  hookRegistration: HookRegistration | undefined,
  agent: Agent,
  sessionId: string,
): ToolSet {
  // If no tool hooks are registered, return tools unchanged
  if (
    !hookRegistration?.PreToolUse?.length &&
    !hookRegistration?.PostToolUse?.length &&
    !hookRegistration?.PostToolUseFailure?.length
  ) {
    return tools;
  }

  const wrapped: ToolSet = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      // Tool has no execute function (e.g., client-side only tool)
      wrapped[name] = tool;
      continue;
    }

    const originalExecute = tool.execute;

    wrapped[name] = {
      ...tool,
      execute: async (input: unknown, options?: ToolExecutionOptions) => {
        const toolUseId = options?.toolCallId ?? `tool-${Date.now()}`;

        // Create PreToolUse input
        const preToolUseInput: PreToolUseInput = {
          hook_event_name: "PreToolUse",
          session_id: sessionId,
          cwd: process.cwd(),
          tool_name: name,
          tool_input: input as Record<string, unknown>,
        };

        // Invoke PreToolUse hooks
        if (hookRegistration?.PreToolUse?.length) {
          const preHookOutputs = await invokeMatchingHooks(
            hookRegistration.PreToolUse,
            name,
            preToolUseInput,
            toolUseId,
            agent,
          );

          // Check permission decisions
          const permissionDecision = aggregatePermissionDecisions(preHookOutputs);

          if (permissionDecision === "deny") {
            // Find the reason from hook outputs
            const reason = preHookOutputs.find(
              (o) => o.hookSpecificOutput?.permissionDecisionReason,
            )?.hookSpecificOutput?.permissionDecisionReason;

            const error = new ToolPermissionDeniedError(`Tool '${name}' execution denied by hook`, {
              toolName: name,
              toolInput: input,
              reason,
            });

            // Emit PostToolUseFailure for denied tools
            if (hookRegistration?.PostToolUseFailure?.length) {
              const failureInput: PostToolUseFailureInput = {
                hook_event_name: "PostToolUseFailure",
                session_id: sessionId,
                cwd: process.cwd(),
                tool_name: name,
                tool_input: input as Record<string, unknown>,
                error,
              };

              await invokeMatchingHooks(
                hookRegistration.PostToolUseFailure,
                name,
                failureInput,
                toolUseId,
                agent,
              );
            }

            throw error;
          }

          // Check for input transformation
          const updatedInput = extractUpdatedInput(preHookOutputs);
          if (updatedInput !== undefined) {
            input = updatedInput;
          }
        }

        try {
          // Execute the original tool with (potentially modified) input
          // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
          const output = await originalExecute.call(tool, input, options as any);

          // Invoke PostToolUse hooks
          if (hookRegistration?.PostToolUse?.length) {
            const postToolUseInput: PostToolUseInput = {
              hook_event_name: "PostToolUse",
              session_id: sessionId,
              cwd: process.cwd(),
              tool_name: name,
              tool_input: input as Record<string, unknown>,
              tool_response: output,
            };

            const postHookOutputs = await invokeMatchingHooks(
              hookRegistration.PostToolUse,
              name,
              postToolUseInput,
              toolUseId,
              agent,
            );

            // Check for output transformation
            const updatedResult = extractUpdatedResult(postHookOutputs);
            if (updatedResult !== undefined) {
              return updatedResult;
            }
          }

          return output;
        } catch (error) {
          // Skip PostToolUseFailure for flow-control signals — these are not
          // actual failures but intentional control flow (interrupt).
          if (!isInterruptSignal(error)) {
            // Invoke PostToolUseFailure hooks
            if (hookRegistration?.PostToolUseFailure?.length) {
              const failureInput: PostToolUseFailureInput = {
                hook_event_name: "PostToolUseFailure",
                session_id: sessionId,
                cwd: process.cwd(),
                tool_name: name,
                tool_input: input as Record<string, unknown>,
                error: error instanceof Error ? error : new Error(String(error)),
              };

              await invokeMatchingHooks(
                hookRegistration.PostToolUseFailure,
                name,
                failureInput,
                toolUseId,
                agent,
              );
            }
          }

          throw error;
        }
      },
    } as Tool;
  }

  return wrapped;
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

  // Determine plugin loading mode
  // Track whether it was explicitly set to distinguish from default
  const explicitPluginLoading = options.pluginLoading !== undefined;
  const pluginLoadingMode = options.pluginLoading ?? "eager";
  const preloadPlugins = new Set(options.preloadPlugins ?? []);

  // Initialize tool registry for lazy/explicit loading modes
  const toolRegistry =
    pluginLoadingMode !== "eager"
      ? new ToolRegistry({
          onToolRegistered: async (input) => {
            const hooks = effectiveHooks?.ToolRegistered ?? [];
            if (hooks.length === 0) return;

            const hookInput: ToolRegisteredInput = {
              hook_event_name: "ToolRegistered",
              session_id: "default",
              cwd: process.cwd(),
              tool_name: input.tool_name,
              description: input.description,
              source: input.source,
            };

            await invokeHooksWithTimeout(hooks, hookInput, null, agent);
          },
          onToolLoadError: async (input) => {
            const hooks = effectiveHooks?.ToolLoadError ?? [];
            if (hooks.length === 0) return;

            const hookInput: ToolLoadErrorInput = {
              hook_event_name: "ToolLoadError",
              session_id: "default",
              cwd: process.cwd(),
              tool_name: input.tool_name,
              error: input.error,
              source: input.source,
            };

            await invokeHooksWithTimeout(hooks, hookInput, null, agent);
          },
        })
      : undefined;

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

  // Count total plugin tools for threshold calculation and collect plugin skills.
  // Note: Function-based (streaming) tools are not counted since we don't know
  // their count until they're invoked with a streaming context.
  // IMPORTANT: Plugin skills must be collected BEFORE createCoreTools() is called
  // so the skill tool includes them in progressive disclosure.
  let totalPluginToolCount = 0;
  for (const plugin of options.plugins ?? []) {
    if (plugin.tools && typeof plugin.tools !== "function") {
      totalPluginToolCount += Object.keys(plugin.tools).length;
    }
    // Collect plugin skills early so they're available for skill tool creation
    if (plugin.skills) {
      skills.push(...plugin.skills);
    }
  }

  // Determine if we should use deferred loading based on tool search settings
  // Note: Only activate deferred loading if explicitly requested, not based on auto threshold
  // The auto threshold should only affect whether search_tools is created, not loading behavior
  if (toolSearchEnabled === "always") {
    deferredLoadingActive = true;
  }
  // Removed: auto threshold no longer forces deferred loading
  // The default eager loading should be respected

  // Auto-create core tools (unless user provides explicit tools)
  // Note: search_tools is created separately below based on loading mode
  const { tools: autoCreatedCoreTools } = createCoreTools({
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

  // Process plugins based on loading mode and deferred loading
  // Note: Plugin skills are collected earlier (before createCoreTools) so
  // the skill tool can include them in progressive disclosure.
  for (const plugin of options.plugins ?? []) {
    // Handle tools via MCP manager for unified interface
    // Note: Function-based (streaming) tools are handled separately in
    // getActiveToolSetWithStreaming() and are not registered here
    if (plugin.tools && typeof plugin.tools !== "function") {
      const shouldPreload = preloadPlugins.has(plugin.name);

      // Priority order:
      // 1. Explicit mode - don't register
      // 2. Preload - always load immediately
      // 3. Explicit eager - always load immediately
      // 4. Lazy mode - register with tool registry
      // 5. Deferred loading - register but don't load
      // 6. Default eager - load immediately
      if (pluginLoadingMode === "explicit") {
        // Explicit mode: don't auto-register, user must do it manually
        // Skip registration entirely
      } else if (shouldPreload) {
        // Preloaded plugins: always load immediately, regardless of other settings
        mcpManager.registerPluginTools(plugin.name, plugin.tools, {
          autoLoad: true,
        });
      } else if (explicitPluginLoading && pluginLoadingMode === "eager") {
        // Explicit eager mode: always load immediately, regardless of toolSearch settings
        mcpManager.registerPluginTools(plugin.name, plugin.tools, {
          autoLoad: true,
        });
      } else if (pluginLoadingMode === "lazy" && toolRegistry) {
        // Lazy mode: register with registry for on-demand loading
        toolRegistry.registerPlugin(plugin.name, plugin.tools);
      } else if (deferredLoadingActive) {
        // Deferred loading (auto threshold or always enabled): register tools but don't load them initially
        mcpManager.registerPluginTools(plugin.name, plugin.tools, {
          autoLoad: false,
        });
      } else {
        // Default eager mode: load immediately
        mcpManager.registerPluginTools(plugin.name, plugin.tools, {
          autoLoad: true,
        });
      }
    }
  }

  // Create search_tools for MCP tool discovery and/or plugin loading
  // New behavior:
  // - Create when auto threshold is exceeded (for lazy discovery)
  // - Create when deferred loading is active (explicitly requested)
  // - Create when external MCP servers exist (for MCP tool search)
  // - Always auto-load tools when found (no manual load step)
  const shouldCreateSearchToolsForAutoThreshold =
    toolSearchEnabled === "auto" && totalPluginToolCount > toolSearchThreshold;

  const shouldCreateSearchTools =
    !options.disabledCoreTools?.includes("search_tools") &&
    (deferredLoadingActive ||
      shouldCreateSearchToolsForAutoThreshold ||
      (mcpManager.hasExternalServers() && toolSearchEnabled !== "never"));

  if (shouldCreateSearchTools) {
    coreTools.search_tools = createSearchToolsTool({
      manager: mcpManager,
      maxResults: toolSearchMaxResults,
      enableLoad: true, // Always enable auto-loading
      autoLoad: true, // NEW: Auto-load tools after searching
      onToolsLoaded: (toolNames) => {
        // Tools are now loaded in MCPManager and will be included in getActiveToolSet()
        // This callback can be used for logging/notifications
      },
    });
  }

  // Add use_tools meta-tool in lazy mode
  if (pluginLoadingMode === "lazy" && toolRegistry) {
    coreTools.use_tools = createUseToolsTool({ registry: toolRegistry });
  }

  /**
   * Filter a tool set by the allowedTools and disallowedTools restrictions.
   * If neither is set, returns all tools.
   *
   * Priority: disallowedTools takes precedence over allowedTools.
   * If a tool is in both lists, it is blocked.
   */
  const filterToolsByAllowed = (toolSet: ToolSet): ToolSet => {
    const allowed = options.allowedTools;
    const disallowed = options.disallowedTools;

    // If neither restriction is set, return all tools
    if ((!allowed || allowed.length === 0) && (!disallowed || disallowed.length === 0)) {
      return toolSet;
    }

    const allowedSet = allowed ? new Set(allowed) : null;
    const disallowedSet = disallowed ? new Set(disallowed) : null;
    const filtered: ToolSet = {};

    for (const [name, tool] of Object.entries(toolSet)) {
      // If disallowedTools is set and tool is in it, skip
      if (disallowedSet?.has(name)) {
        continue;
      }

      // If allowedTools is set, only include if in the list
      if (allowedSet) {
        if (allowedSet.has(name)) {
          filtered[name] = tool;
        }
      } else {
        // No allowedTools restriction, include if not disallowed
        filtered[name] = tool;
      }
    }

    return filtered;
  };

  // Helper to build prompt context from current agent state
  const buildPromptContext = (messages?: ModelMessage[], threadId?: string): PromptContext => {
    // Get filtered tools (respecting allowedTools/disallowedTools) so the prompt
    // only advertises tools the agent will actually expose
    const filteredTools = filterToolsByAllowed(
      (() => {
        const allTools: ToolSet = { ...coreTools };
        Object.assign(allTools, runtimeTools);
        Object.assign(allTools, mcpManager.getToolSet());
        if (toolRegistry) {
          Object.assign(allTools, toolRegistry.getLoadedTools());
        }
        return allTools;
      })(),
    );

    // Extract tool metadata for context
    const toolsMetadata = Object.entries(filteredTools).map(([name, tool]) => ({
      name,
      description: tool.description ?? "",
    }));

    // Extract skills metadata from the skills array
    const skillsMetadata = skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
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

    return {
      tools: toolsMetadata.length > 0 ? toolsMetadata : undefined,
      skills: skillsMetadata.length > 0 ? skillsMetadata : undefined,
      plugins: pluginsMetadata.length > 0 ? pluginsMetadata : undefined,
      backend: backendInfo,
      state,
      // Model ID extraction is not reliable across all LanguageModel types
      // Users can access the full model via their custom context if needed
      model: undefined,
      maxSteps: options.maxSteps,
      permissionMode,
      currentMessages: messages,
      threadId,
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

  // Helper to get current active tools (core + runtime + MCP + dynamically loaded from registry)
  const getActiveToolSet = (threadId?: string): ToolSet => {
    // Start with core tools
    const allTools: ToolSet = { ...coreTools };

    // Add runtime tools (added by plugins at runtime)
    Object.assign(allTools, runtimeTools);

    // Add MCP tools from plugin registrations
    const mcpTools = mcpManager.getToolSet();
    Object.assign(allTools, mcpTools);

    // Add dynamically loaded tools from registry (lazy mode)
    if (toolRegistry) {
      Object.assign(allTools, toolRegistry.getLoadedTools());
    }

    // Apply allowedTools filtering
    const filtered = filterToolsByAllowed(allTools);

    // Apply permission mode wrapping with canUseTool callback and approval state
    const withPermissions = wrapToolsWithPermissionMode(
      filtered,
      () => permissionMode,
      options.canUseTool,
      {
        approvalDecisions,
        pendingResponses,
        checkpointSaver: options.checkpointer,
        threadId,
      },
    );

    // Note: Tool hooks are NOT applied here - they are applied at usage sites
    // AFTER the task tool is added via addTaskToolIfConfigured. This ensures
    // the task tool is also wrapped with hooks for logging/metrics.
    return withPermissions;
  };

  /**
   * Rebuild tools with streaming context for plugins with function-based tools.
   * This enables tools to stream custom data to the client via ctx.writer.write().
   */
  const getActiveToolSetWithStreaming = (
    streamingContext: StreamingContext,
    threadId?: string,
    step?: number,
  ): ToolSet => {
    // Start with core tools
    const allTools: ToolSet = { ...coreTools };

    // Add runtime tools (added by plugins at runtime)
    Object.assign(allTools, runtimeTools);

    // Process plugins - invoke function-based tools with streaming context
    for (const plugin of options.plugins ?? []) {
      if (plugin.tools) {
        if (typeof plugin.tools === "function") {
          // Streaming-aware tools: invoke factory with context
          const streamingTools = (plugin.tools as StreamingToolsFactory)(streamingContext);
          Object.assign(allTools, streamingTools);
        } else {
          // Static tools: use as-is
          Object.assign(allTools, plugin.tools);
        }
      }
    }

    // Add MCP tools from plugin registrations
    const mcpTools = mcpManager.getToolSet();
    Object.assign(allTools, mcpTools);

    // Add dynamically loaded tools from registry (lazy mode)
    if (toolRegistry) {
      Object.assign(allTools, toolRegistry.getLoadedTools());
    }

    // Apply allowedTools filtering
    const filtered = filterToolsByAllowed(allTools);

    // Apply permission mode wrapping with canUseTool callback and approval state
    const withPermissions = wrapToolsWithPermissionMode(
      filtered,
      () => permissionMode,
      options.canUseTool,
      {
        approvalDecisions,
        pendingResponses,
        checkpointSaver: options.checkpointer,
        threadId,
        step,
      },
    );

    // Note: Tool hooks are NOT applied here - they are applied at usage sites
    // AFTER the task tool is added via addTaskToolIfConfigured. This ensures
    // the task tool is also wrapped with hooks for logging/metrics.
    return withPermissions;
  };

  /**
   * Wraps all tools with TaskManager injection and hooks.
   * Call this AFTER addTaskToolIfConfigured to ensure task tool is also wrapped.
   *
   * This applies two layers of wrapping:
   * 1. TaskManager injection - makes taskManager available in execution options
   * 2. Hook wrapping - enables PreToolUse/PostToolUse hooks for observability
   */
  const applyToolHooks = (tools: ToolSet, threadId?: string): ToolSet => {
    // First inject TaskManager into execution context
    const withTaskManager = wrapToolsWithTaskManager(tools, taskManager);
    // Then apply hooks for observability
    return wrapToolsWithHooks(withTaskManager, effectiveHooks, agent, threadId ?? "default");
  };

  /**
   * Adds the task and task_output tools to a toolset.
   *
   * This enables the agent to delegate work to specialized subagents via the
   * task tool, and retrieve results via the task_output tool. A general-purpose
   * subagent is always included by default, allowing any agent to spawn
   * subagents for parallel or delegated work.
   *
   * The streaming context is only passed when using streamDataResponse(),
   * allowing streaming subagents to write to the parent's data stream.
   *
   * @param tools - The base toolset to augment
   * @param streamingContext - Optional streaming context for streaming subagents
   * @returns The toolset with task and task_output tools added
   */
  const addTaskToolIfConfigured = (
    tools: ToolSet,
    streamingContext?: StreamingContext,
  ): ToolSet => {
    // Respect disabledCoreTools setting for task tool
    if (options.disabledCoreTools?.includes("task")) {
      return tools;
    }

    const result: ToolSet = {
      ...tools,
      task: createTaskTool({
        subagents: options.subagents ?? [],
        defaultModel: options.model,
        parentAgent: agent,
        // Always include general-purpose subagent so agents can delegate tasks
        includeGeneralPurpose: true,
        // Only pass streaming context when provided (streamDataResponse)
        streamingContext,
        taskManager,
      }),
    };

    // Add task_output tool unless disabled
    if (!options.disabledCoreTools?.includes("task_output")) {
      result.task_output = createTaskOutputTool({ taskManager });
    }

    return result;
  };

  // Track current checkpoint state per thread
  const threadCheckpoints = new Map<string, Checkpoint>();

  /**
   * Load checkpoint for a thread if checkpointer is configured.
   * Returns the loaded checkpoint or undefined.
   */
  async function loadCheckpoint(threadId: string): Promise<Checkpoint | undefined> {
    if (!options.checkpointer) {
      return undefined;
    }

    // Check if we already have it cached
    const cached = threadCheckpoints.get(threadId);
    if (cached) {
      return cached;
    }

    try {
      // Load from checkpointer
      const checkpoint = await options.checkpointer.load(threadId);
      if (checkpoint) {
        threadCheckpoints.set(threadId, checkpoint);

        // Restore agent state from checkpoint
        state.todos = [...checkpoint.state.todos];
        state.files = { ...checkpoint.state.files };
      }

      return checkpoint;
    } catch (error) {
      // Wrap checkpoint load errors with CheckpointError
      throw new CheckpointError(`Failed to load checkpoint for thread ${threadId}`, {
        operation: "load",
        threadId,
        cause: error instanceof Error ? error : undefined,
        metadata: { threadId },
      });
    }
  }

  /**
   * Save checkpoint for a thread if checkpointer is configured.
   */
  async function saveCheckpoint(
    threadId: string,
    messages: ModelMessage[],
    step: number,
  ): Promise<Checkpoint | undefined> {
    if (!options.checkpointer) {
      return undefined;
    }

    const existingCheckpoint = threadCheckpoints.get(threadId);
    let checkpoint: Checkpoint;

    if (existingCheckpoint) {
      // Update existing checkpoint
      checkpoint = updateCheckpoint(existingCheckpoint, {
        messages,
        step,
        state: {
          todos: [...state.todos],
          files: { ...state.files },
        },
      });
    } else {
      // Create new checkpoint
      checkpoint = createCheckpoint({
        threadId,
        messages,
        step,
        state: {
          todos: [...state.todos],
          files: { ...state.files },
        },
      });
    }

    try {
      // Save to checkpointer
      await options.checkpointer.save(checkpoint);
      threadCheckpoints.set(threadId, checkpoint);

      return checkpoint;
    } catch (error) {
      // Wrap checkpoint save errors with CheckpointError
      throw new CheckpointError(`Failed to save checkpoint for thread ${threadId}`, {
        operation: "save",
        threadId,
        cause: error instanceof Error ? error : undefined,
        metadata: { threadId, step },
      });
    }
  }

  /**
   * Fork an existing checkpoint to a new thread ID.
   * Copies all checkpoint data including messages and state.
   */
  async function forkCheckpoint(
    sourceThreadId: string,
    targetThreadId: string,
  ): Promise<Checkpoint | undefined> {
    if (!options.checkpointer) {
      return undefined;
    }

    // Load the source checkpoint
    const sourceCheckpoint = await loadCheckpoint(sourceThreadId);
    if (!sourceCheckpoint) {
      return undefined;
    }

    // Create a new checkpoint with the target threadId
    const forkedCheckpoint = createCheckpoint({
      threadId: targetThreadId,
      messages: [...sourceCheckpoint.messages],
      step: sourceCheckpoint.step,
      state: {
        todos: [...sourceCheckpoint.state.todos],
        files: { ...sourceCheckpoint.state.files },
      },
    });

    try {
      // Save the forked checkpoint
      await options.checkpointer.save(forkedCheckpoint);
      threadCheckpoints.set(targetThreadId, forkedCheckpoint);

      return forkedCheckpoint;
    } catch (error) {
      throw new CheckpointError(
        `Failed to fork checkpoint from ${sourceThreadId} to ${targetThreadId}`,
        {
          operation: "fork",
          threadId: targetThreadId,
          cause: error instanceof Error ? error : undefined,
          metadata: { sourceThreadId, targetThreadId },
        },
      );
    }
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
    // Skip compaction if _skipCompaction flag is set (used during summary generation)
    if (options.contextManager && !genOptions._skipCompaction) {
      const contextManager = options.contextManager;

      // Check if compaction is needed
      const { trigger, reason } = contextManager.shouldCompact(messages);
      if (trigger && reason) {
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
            message_count: messagesBefore,
            tokens_before: tokensBefore,
          };
          await invokeHooksWithTimeout(preCompactHooks, preCompactInput, null, agent);
        }

        // Perform compaction
        const compactionResult = await contextManager.compact(messages, agent, reason);

        // Replace messages with compacted version
        messages.length = 0;
        messages.push(...compactionResult.newMessages);

        // Emit PostCompact hook with metrics
        const postCompactHooks = effectiveHooks?.PostCompact ?? [];
        if (postCompactHooks.length > 0) {
          const postCompactInput: import("./types.js").PostCompactInput = {
            hook_event_name: "PostCompact",
            session_id: genOptions.threadId ?? "default",
            cwd: process.cwd(),
            messages_before: compactionResult.messagesBefore,
            messages_after: compactionResult.messagesAfter,
            tokens_before: compactionResult.tokensBefore,
            tokens_after: compactionResult.tokensAfter,
            tokens_saved: compactionResult.tokensBefore - compactionResult.tokensAfter,
          };
          await invokeHooksWithTimeout(postCompactHooks, postCompactInput, null, agent);
        }
      }
    }

    return { messages, checkpoint, forkedSessionId };
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
      // Invoke unified PreGenerate hooks
      const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
      const preGenResult = await invokePreGenerateHooks<GenerateResult>(
        preGenerateHooks,
        genOptions,
        agent,
      );

      // Check for cache short-circuit via respondWith
      if (preGenResult.cachedResult !== undefined) {
        return preGenResult.cachedResult;
      }

      let effectiveGenOptions = preGenResult.effectiveOptions;

      // Initialize retry loop state
      const retryState = createRetryLoopState(options.model);
      // Track messages for emergency compaction (accessible in catch block)
      let lastBuiltMessages: ModelMessage[] = [];

      while (retryState.retryAttempt <= retryState.maxRetries) {
        try {
          const { messages, checkpoint, forkedSessionId } =
            await buildMessages(effectiveGenOptions);
          // Store for potential emergency compaction in catch block
          lastBuiltMessages = messages;
          const maxSteps = options.maxSteps ?? 10;
          const startStep = checkpoint?.step ?? 0;

          // Shared signal state: flow-control signals (interrupt) thrown by tools
          // are caught by the outermost wrapper and stored here. A custom
          // stopWhen condition stops generation after the current step completes.
          const signalState: GenerateSignalState = {};

          // Build initial params - use active tools (core + dynamically loaded + task)
          // Apply hooks AFTER adding task tool so task tool is also wrapped.
          // Then wrap with signal catching as the outermost layer so that
          // InterruptSignal is intercepted before the AI SDK can catch it and
          // convert it to a tool-error result.
          const hookedTools = applyToolHooks(
            addTaskToolIfConfigured(getActiveToolSet(effectiveGenOptions.threadId)),
            effectiveGenOptions.threadId,
          );
          const activeTools = wrapToolsWithSignalCatching(hookedTools, signalState);

          // Build prompt context and generate system prompt
          const promptContext = buildPromptContext(messages, effectiveGenOptions.threadId);
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
          };

          // Stop condition: stop when an interrupt signal was caught, OR when
          // the step count reaches maxSteps (whichever comes first).
          const signalStopCondition = () => signalState.interrupt != null;

          // Execute generation
          const response = await generateText({
            model: retryState.currentModel,
            system: initialParams.system,
            messages: initialParams.messages,
            tools: initialParams.tools as ToolSet,
            maxOutputTokens: initialParams.maxTokens,
            temperature: initialParams.temperature,
            stopSequences: initialParams.stopSequences,
            abortSignal: initialParams.abortSignal,
            stopWhen: [signalStopCondition, stepCountIs(maxSteps)],
            // Passthrough AI SDK options
            output: effectiveGenOptions.output,
            // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
            providerOptions: initialParams.providerOptions as any,
            headers: initialParams.headers,
          });

          // Check for intercepted interrupt signal (cooperative path)
          if (signalState.interrupt) {
            const interrupt = signalState.interrupt.interrupt;

            // Save the interrupt to checkpoint
            if (effectiveGenOptions.threadId && options.checkpointer) {
              const checkpoint = await options.checkpointer.load(effectiveGenOptions.threadId);
              if (checkpoint) {
                const updatedCheckpoint = updateCheckpoint(checkpoint, {
                  pendingInterrupt: interrupt,
                });
                await options.checkpointer.save(updatedCheckpoint);
              }
            }

            // Emit InterruptRequested hook
            const interruptRequestedHooks = effectiveHooks?.InterruptRequested ?? [];
            if (interruptRequestedHooks.length > 0) {
              const hookInput: InterruptRequestedInput = {
                hook_event_name: "InterruptRequested",
                session_id: effectiveGenOptions.threadId ?? "default",
                cwd: process.cwd(),
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

          const result: GenerateResultComplete = {
            status: "complete",
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

          // Save checkpoint - use forked session ID if forking, otherwise use original threadId
          const checkpointThreadId = forkedSessionId ?? effectiveGenOptions.threadId;
          if (checkpointThreadId && options.checkpointer) {
            // Build final messages including the assistant response
            const finalMessages: ModelMessage[] = [
              ...messages,
              { role: "assistant" as const, content: response.text },
            ];
            await saveCheckpoint(
              checkpointThreadId,
              finalMessages,
              startStep + response.steps.length,
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

          return finalResult;
        } catch (error) {
          // Check if this is an InterruptSignal (new interrupt system)
          if (isInterruptSignal(error)) {
            const interrupt = error.interrupt;

            // Save the interrupt to checkpoint
            if (effectiveGenOptions.threadId && options.checkpointer) {
              const checkpoint = await options.checkpointer.load(effectiveGenOptions.threadId);
              if (checkpoint) {
                const updatedCheckpoint = updateCheckpoint(checkpoint, {
                  pendingInterrupt: interrupt,
                });
                await options.checkpointer.save(updatedCheckpoint);
              }
            }

            // Emit InterruptRequested hook
            const interruptRequestedHooks = effectiveHooks?.InterruptRequested ?? [];
            if (interruptRequestedHooks.length > 0) {
              const hookInput: InterruptRequestedInput = {
                hook_event_name: "InterruptRequested",
                session_id: effectiveGenOptions.threadId ?? "default",
                cwd: process.cwd(),
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
                    await options.checkpointer.save(updatedCheckpoint);
                    // Update cache
                    threadCheckpoints.set(effectiveGenOptions.threadId, updatedCheckpoint);
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
                    await options.checkpointer.save(newCheckpoint);
                    threadCheckpoints.set(effectiveGenOptions.threadId, newCheckpoint);
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
          const errorDecision = await handleGenerationError(
            normalizedError,
            postGenerateFailureHooks,
            effectiveGenOptions,
            agent,
            retryState,
            options.fallbackModel,
            shouldUseFallback,
          );

          if (errorDecision.shouldRetry) {
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
      // Invoke unified PreGenerate hooks
      const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
      const preGenResult = await invokePreGenerateHooks<GenerateResult>(
        preGenerateHooks,
        genOptions,
        agent,
      );

      // Check for cache short-circuit via respondWith
      // For streaming, we convert the cached GenerateResult into StreamParts
      if (preGenResult.cachedResult !== undefined) {
        const cachedResult = preGenResult.cachedResult;
        // Only process complete results (interrupted results can't be cached)
        if (cachedResult.status === "complete") {
          // Yield cached result as stream parts
          // First, yield text as a single text-delta
          if (cachedResult.text) {
            yield { type: "text-delta", text: cachedResult.text };
          }
          // Yield tool calls and results from steps
          for (const step of cachedResult.steps ?? []) {
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
          }
          // Finally yield finish
          yield {
            type: "finish",
            finishReason: cachedResult.finishReason,
            usage: cachedResult.usage,
          };
        }
        return;
      }

      const effectiveGenOptions = preGenResult.effectiveOptions;

      // Initialize retry loop state
      const retryState = createRetryLoopState(options.model);

      while (retryState.retryAttempt <= retryState.maxRetries) {
        try {
          const { messages, checkpoint } = await buildMessages(effectiveGenOptions);
          const maxSteps = options.maxSteps ?? 10;
          const startStep = checkpoint?.step ?? 0;

          // Signal state for cooperative signal catching in streaming mode
          const signalState: GenerateSignalState = {};

          // Build initial params - use active tools (core + dynamically loaded + task)
          // Apply hooks AFTER adding task tool so task tool is also wrapped.
          // Then wrap with signal catching as the outermost layer.
          const hookedTools = applyToolHooks(
            addTaskToolIfConfigured(getActiveToolSet(effectiveGenOptions.threadId)),
            effectiveGenOptions.threadId,
          );
          const activeTools = wrapToolsWithSignalCatching(hookedTools, signalState);

          // Build prompt context and generate system prompt
          const promptContext = buildPromptContext(messages, effectiveGenOptions.threadId);
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
          };

          // Stop condition: stop when an interrupt signal was caught, OR when
          // the step count reaches maxSteps.
          const signalStopCondition = () => signalState.interrupt != null;

          // Execute stream
          const response = streamText({
            model: retryState.currentModel,
            system: initialParams.system,
            messages: initialParams.messages,
            tools: initialParams.tools as ToolSet,
            maxOutputTokens: initialParams.maxTokens,
            temperature: initialParams.temperature,
            stopSequences: initialParams.stopSequences,
            abortSignal: initialParams.abortSignal,
            stopWhen: [signalStopCondition, stepCountIs(maxSteps)],
            // Passthrough AI SDK options
            output: genOptions.output,
            // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
            providerOptions: initialParams.providerOptions as any,
            headers: initialParams.headers,
          });

          for await (const part of response.fullStream) {
            if (part.type === "text-delta") {
              yield { type: "text-delta", text: part.text };
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
          const [text, usage, finishReason, steps] = await Promise.all([
            response.text,
            response.usage,
            response.finishReason,
            response.steps,
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

          const result: GenerateResultComplete = {
            status: "complete",
            text,
            usage,
            finishReason: finishReason as GenerateResultComplete["finishReason"],
            output,
            steps: mapSteps(steps),
          };

          // Save checkpoint if threadId is provided
          if (effectiveGenOptions.threadId && options.checkpointer) {
            const finalMessages: ModelMessage[] = [
              ...messages,
              { role: "assistant" as const, content: text },
            ];
            await saveCheckpoint(
              effectiveGenOptions.threadId,
              finalMessages,
              startStep + steps.length,
            );
          }

          // Invoke unified PostGenerate hooks
          const postGenerateHooks = effectiveHooks?.PostGenerate ?? [];
          if (postGenerateHooks.length > 0) {
            const postGenerateInput: PostGenerateInput = {
              hook_event_name: "PostGenerate",
              session_id: effectiveGenOptions.threadId ?? "default",
              cwd: process.cwd(),
              options: effectiveGenOptions,
              result,
            };
            await invokeHooksWithTimeout(postGenerateHooks, postGenerateInput, null, agent);
            // Note: updatedResult is not applied for streaming since the stream has already been sent
          }

          // Success - break out of retry loop
          return;
        } catch (error) {
          // Normalize error to AgentError
          const normalizedError = normalizeError(
            error,
            "Stream generation failed",
            effectiveGenOptions.threadId,
          );

          // Handle error with PostGenerateFailure hooks and fallback logic
          const postGenerateFailureHooks = effectiveHooks?.PostGenerateFailure ?? [];
          const errorDecision = await handleGenerationError(
            normalizedError,
            postGenerateFailureHooks,
            effectiveGenOptions,
            agent,
            retryState,
            options.fallbackModel,
            shouldUseFallback,
          );

          if (errorDecision.shouldRetry) {
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
      // Invoke unified PreGenerate hooks
      const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
      const preGenResult = await invokePreGenerateHooks<GenerateResult>(
        preGenerateHooks,
        genOptions,
        agent,
      );

      // Check for cache short-circuit via respondWith
      // For streaming response, create a simple text response from the cached result
      if (preGenResult.cachedResult !== undefined) {
        const cachedResult = preGenResult.cachedResult;
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

      const effectiveGenOptions = preGenResult.effectiveOptions;

      // Initialize retry loop state
      const retryState = createRetryLoopState(options.model);

      while (retryState.retryAttempt <= retryState.maxRetries) {
        try {
          const { messages, checkpoint } = await buildMessages(effectiveGenOptions);
          const maxSteps = options.maxSteps ?? 10;
          const startStep = checkpoint?.step ?? 0;

          // Signal state for cooperative signal catching in streaming mode
          const signalState: GenerateSignalState = {};

          // Build initial params - use active tools (core + dynamically loaded + task)
          // Apply hooks AFTER adding task tool so task tool is also wrapped.
          // Then wrap with signal catching as the outermost layer.
          const hookedTools = applyToolHooks(
            addTaskToolIfConfigured(getActiveToolSet(effectiveGenOptions.threadId)),
            effectiveGenOptions.threadId,
          );
          const activeTools = wrapToolsWithSignalCatching(hookedTools, signalState);

          // Build prompt context and generate system prompt
          const promptContext = buildPromptContext(messages, effectiveGenOptions.threadId);
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
          };

          // Track step count for incremental checkpointing
          let currentStepCount = 0;

          // Stop condition: stop when an interrupt signal was caught, OR when
          // the step count reaches maxSteps.
          const signalStopCondition = () => signalState.interrupt != null;

          // Execute stream
          const result = streamText({
            model: retryState.currentModel,
            system: initialParams.system,
            messages: initialParams.messages,
            tools: initialParams.tools as ToolSet,
            maxOutputTokens: initialParams.maxTokens,
            temperature: initialParams.temperature,
            stopSequences: initialParams.stopSequences,
            abortSignal: initialParams.abortSignal,
            stopWhen: [signalStopCondition, stepCountIs(maxSteps)],
            // Passthrough AI SDK options
            output: effectiveGenOptions.output,
            // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
            providerOptions: initialParams.providerOptions as any,
            headers: initialParams.headers,
            // Incremental checkpointing: save after each step if enabled
            onStepFinish: effectiveGenOptions.checkpointAfterToolCall
              ? async (stepResult) => {
                  if (effectiveGenOptions.threadId && options.checkpointer) {
                    currentStepCount++;
                    // Build messages including this step's results
                    const stepMessages: ModelMessage[] = [
                      ...initialParams.messages,
                      {
                        role: "assistant" as const,
                        content: stepResult.text,
                      },
                    ];
                    await saveCheckpoint(
                      effectiveGenOptions.threadId!,
                      stepMessages,
                      startStep + currentStepCount,
                    );
                  }
                }
              : undefined,
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

              if (effectiveGenOptions.threadId && options.checkpointer) {
                const finalMessages: ModelMessage[] = [
                  ...initialParams.messages,
                  { role: "assistant" as const, content: finishResult.text },
                ];
                await saveCheckpoint(
                  effectiveGenOptions.threadId!,
                  finalMessages,
                  startStep + finishResult.steps.length,
                );
              }

              // Invoke unified PostGenerate hooks
              const hookResult: GenerateResultComplete = {
                status: "complete",
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
                  options: effectiveGenOptions,
                  result: hookResult,
                };
                await invokeHooksWithTimeout(postGenerateHooks, postGenerateInput, null, agent);
                // Note: updatedResult is not applied for streaming since the stream has already been sent
              }
            },
          });

          // Return AI SDK compatible response for use with useChat
          // Note: Not passing originalMessages since ModelMessage[] != UIMessage[]
          // The AI SDK will reconstruct messages from the stream
          return result.toUIMessageStreamResponse();
        } catch (error) {
          // Normalize error to AgentError
          const normalizedError = normalizeError(
            error,
            "Stream generation failed",
            effectiveGenOptions.threadId,
          );

          // Handle error with PostGenerateFailure hooks and fallback logic
          const postGenerateFailureHooks = effectiveHooks?.PostGenerateFailure ?? [];
          const errorDecision = await handleGenerationError(
            normalizedError,
            postGenerateFailureHooks,
            effectiveGenOptions,
            agent,
            retryState,
            options.fallbackModel,
            shouldUseFallback,
          );

          if (errorDecision.shouldRetry) {
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
      // Invoke unified PreGenerate hooks
      // Note: respondWith cache short-circuit is NOT supported for streamRaw()
      // because it returns the raw AI SDK streamText result which cannot be mocked.
      // Use stream(), streamResponse(), or streamDataResponse() for caching support.
      const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
      const preGenResult = await invokePreGenerateHooks<GenerateResult>(
        preGenerateHooks,
        genOptions,
        agent,
      );

      // Input transformation is applied even though respondWith is not supported
      const effectiveGenOptions = preGenResult.effectiveOptions;

      // Initialize retry loop state
      const retryState = createRetryLoopState(options.model);

      while (retryState.retryAttempt <= retryState.maxRetries) {
        try {
          const { messages, checkpoint } = await buildMessages(effectiveGenOptions);
          const maxSteps = options.maxSteps ?? 10;
          const startStep = checkpoint?.step ?? 0;

          // Signal state for cooperative signal catching in streaming mode
          const signalState: GenerateSignalState = {};

          // Build initial params - use active tools (core + dynamically loaded + task)
          // Apply hooks AFTER adding task tool so task tool is also wrapped.
          // Then wrap with signal catching as the outermost layer.
          const hookedTools = applyToolHooks(
            addTaskToolIfConfigured(getActiveToolSet(effectiveGenOptions.threadId)),
            effectiveGenOptions.threadId,
          );
          const activeTools = wrapToolsWithSignalCatching(hookedTools, signalState);

          // Build prompt context and generate system prompt
          const promptContext = buildPromptContext(messages, effectiveGenOptions.threadId);
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
          };

          // Track step count for incremental checkpointing
          let currentStepCount = 0;

          // Stop condition: stop when an interrupt signal was caught, OR when
          // the step count reaches maxSteps.
          const signalStopCondition = () => signalState.interrupt != null;

          // Execute stream
          const result = streamText({
            model: retryState.currentModel,
            system: initialParams.system,
            messages: initialParams.messages,
            tools: initialParams.tools as ToolSet,
            maxOutputTokens: initialParams.maxTokens,
            temperature: initialParams.temperature,
            stopSequences: initialParams.stopSequences,
            abortSignal: initialParams.abortSignal,
            stopWhen: [signalStopCondition, stepCountIs(maxSteps)],
            // Passthrough AI SDK options
            output: effectiveGenOptions.output,
            // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
            providerOptions: initialParams.providerOptions as any,
            headers: initialParams.headers,
            // Incremental checkpointing: save after each step if enabled
            onStepFinish: effectiveGenOptions.checkpointAfterToolCall
              ? async (stepResult) => {
                  if (effectiveGenOptions.threadId && options.checkpointer) {
                    currentStepCount++;
                    // Build messages including this step's results
                    const stepMessages: ModelMessage[] = [
                      ...initialParams.messages,
                      {
                        role: "assistant" as const,
                        content: stepResult.text,
                      },
                    ];
                    await saveCheckpoint(
                      effectiveGenOptions.threadId!,
                      stepMessages,
                      startStep + currentStepCount,
                    );
                  }
                }
              : undefined,
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

              if (effectiveGenOptions.threadId && options.checkpointer) {
                const finalMessages: ModelMessage[] = [
                  ...initialParams.messages,
                  { role: "assistant" as const, content: finishResult.text },
                ];
                await saveCheckpoint(
                  effectiveGenOptions.threadId!,
                  finalMessages,
                  startStep + finishResult.steps.length,
                );
              }

              // Invoke unified PostGenerate hooks
              const hookResult: GenerateResultComplete = {
                status: "complete",
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
          const errorDecision = await handleGenerationError(
            normalizedError,
            postGenerateFailureHooks,
            effectiveGenOptions,
            agent,
            retryState,
            options.fallbackModel,
            shouldUseFallback,
          );

          if (errorDecision.shouldRetry) {
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
      // Invoke unified PreGenerate hooks
      const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
      const preGenResult = await invokePreGenerateHooks<GenerateResult>(
        preGenerateHooks,
        genOptions,
        agent,
      );

      // Check for cache short-circuit via respondWith
      // For data stream response, create a simple text response from the cached result
      if (preGenResult.cachedResult !== undefined) {
        const cachedResult = preGenResult.cachedResult;
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

      const effectiveGenOptions = preGenResult.effectiveOptions;

      // Initialize retry loop state
      const retryState = createRetryLoopState(options.model);

      while (retryState.retryAttempt <= retryState.maxRetries) {
        try {
          const { messages, checkpoint } = await buildMessages(effectiveGenOptions);
          const maxSteps = options.maxSteps ?? 10;
          const startStep = checkpoint?.step ?? 0;

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

              // Build tools with streaming context and task tool
              // Apply hooks AFTER adding task tool so task tool is also wrapped.
              // Then wrap with signal catching as the outermost layer.
              const hookedStreamingTools = applyToolHooks(
                addTaskToolIfConfigured(
                  getActiveToolSetWithStreaming(streamingContext, effectiveGenOptions.threadId),
                  streamingContext, // Pass streaming context for streaming subagents
                ),
                effectiveGenOptions.threadId,
              );
              const streamingTools = wrapToolsWithSignalCatching(hookedStreamingTools, signalState);

              // Build prompt context and generate system prompt
              const promptContext = buildPromptContext(messages, effectiveGenOptions.threadId);
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
              };

              // Track step count for incremental checkpointing
              let currentStepCount = 0;

              // Stop condition: stop when a flow-control signal was caught, OR when
              // the step count reaches maxSteps.
              const signalStopCondition = () => signalState.interrupt != null;

              // Execute stream
              const result = streamText({
                model: modelToUse,
                system: initialParams.system,
                messages: initialParams.messages,
                tools: initialParams.tools as ToolSet,
                maxOutputTokens: initialParams.maxTokens,
                temperature: initialParams.temperature,
                stopSequences: initialParams.stopSequences,
                abortSignal: initialParams.abortSignal,
                stopWhen: [signalStopCondition, stepCountIs(maxSteps)],
                // Passthrough AI SDK options
                output: effectiveGenOptions.output,
                // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
                providerOptions: initialParams.providerOptions as any,
                headers: initialParams.headers,
                // Incremental checkpointing: save after each step if enabled
                onStepFinish: effectiveGenOptions.checkpointAfterToolCall
                  ? async (stepResult) => {
                      if (effectiveGenOptions.threadId && options.checkpointer) {
                        currentStepCount++;
                        // Build messages including this step's results
                        const stepMessages: ModelMessage[] = [
                          ...initialParams.messages,
                          {
                            role: "assistant" as const,
                            content: stepResult.text,
                          },
                        ];
                        await saveCheckpoint(
                          effectiveGenOptions.threadId!,
                          stepMessages,
                          startStep + currentStepCount,
                        );
                      }
                    }
                  : undefined,
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

                  if (effectiveGenOptions.threadId && options.checkpointer) {
                    const finalMessages: ModelMessage[] = [
                      ...initialParams.messages,
                      {
                        role: "assistant" as const,
                        content: finishResult.text,
                      },
                    ];
                    await saveCheckpoint(
                      effectiveGenOptions.threadId!,
                      finalMessages,
                      startStep + finishResult.steps.length,
                    );
                  }

                  // Invoke unified PostGenerate hooks
                  const hookResult: GenerateResultComplete = {
                    status: "complete",
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
          const errorDecision = await handleGenerationError(
            normalizedError,
            postGenerateFailureHooks,
            effectiveGenOptions,
            agent,
            retryState,
            options.fallbackModel,
            shouldUseFallback,
          );

          if (errorDecision.shouldRetry) {
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
      return getActiveToolSet();
    },

    addRuntimeTools(tools: ToolSet) {
      Object.assign(runtimeTools, tools);
    },

    removeRuntimeTools(toolNames: string[]) {
      for (const name of toolNames) {
        delete runtimeTools[name];
      }
    },

    loadTools(toolNames: string[]) {
      if (!toolRegistry) {
        // No registry in eager mode - all tools already loaded
        return { loaded: [], notFound: toolNames };
      }

      const result = toolRegistry.load(toolNames);
      return {
        loaded: result.loaded,
        notFound: result.notFound,
      };
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

      if (interrupt.id !== interruptId) {
        throw new Error(
          `Cannot resume: interrupt ID mismatch. Expected ${interrupt.id}, got ${interruptId}`,
        );
      }

      // Store the response for the tool wrapper to use
      const toolCallId = interrupt.toolCallId;
      if (toolCallId) {
        pendingResponses.set(toolCallId, response);
      }

      // Emit InterruptResolved hook
      const interruptResolvedHooks = effectiveHooks?.InterruptResolved ?? [];
      if (interruptResolvedHooks.length > 0) {
        const isApproval = isApprovalInterrupt(interrupt);
        const approvalResponse = isApproval ? (response as { approved: boolean }) : undefined;
        const hookInput: InterruptResolvedInput = {
          hook_event_name: "InterruptResolved",
          session_id: threadId,
          cwd: process.cwd(),
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
          const unwrappedTools: ToolSet = { ...coreTools };
          for (const plugin of options.plugins ?? []) {
            if (plugin.tools && typeof plugin.tools !== "function") {
              Object.assign(unwrappedTools, plugin.tools);
            }
          }
          const mcpTools = mcpManager.getToolSet();
          Object.assign(unwrappedTools, mcpTools);

          const tool = unwrappedTools[interrupt.toolName];
          if (!tool || !tool.execute) {
            throw new Error(
              `Cannot resume: tool "${interrupt.toolName}" not found or has no execute function`,
            );
          }

          try {
            toolResultOutput = await tool.execute(interrupt.request.args, {
              toolCallId: interrupt.toolCallId,
              messages: checkpoint.messages,
              abortSignal: genOptions?.signal,
            } as ToolExecutionOptions);
          } catch (error) {
            toolResultOutput = {
              error: true,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        } else {
          // Denied: Create a synthetic denial result
          toolResultOutput = {
            denied: true,
            message: `Tool "${interrupt.toolName}" was denied by user${
              approvalResponse.reason ? `: ${approvalResponse.reason}` : ""
            }`,
          };
        }

        // Build the tool result message
        const toolResultMessage = {
          role: "tool" as const,
          content: [
            {
              type: "tool-result" as const,
              toolCallId: interrupt.toolCallId,
              toolName: interrupt.toolName,
              output: toolResultOutput,
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
        await options.checkpointer.save(updatedCheckpoint);

        // Clean up the response from our maps
        pendingResponses.delete(interrupt.toolCallId);
        approvalDecisions.delete(interrupt.toolCallId);

        // Continue generation from the updated checkpoint
        return agent.generate({
          threadId,
          ...genOptions,
          prompt: undefined,
        });
      }

      // For custom interrupts, the tool's interrupt() call will receive the response
      // Store it and re-run generation - the tool will get the response

      // Clear the interrupt from checkpoint before continuing
      const updatedCheckpoint = updateCheckpoint(checkpoint, {
        pendingInterrupt: undefined,
      });
      await options.checkpointer.save(updatedCheckpoint);

      // Continue generation - the wrapped tool will pick up the response from pendingResponses
      return agent.generate({
        threadId,
        ...genOptions,
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
