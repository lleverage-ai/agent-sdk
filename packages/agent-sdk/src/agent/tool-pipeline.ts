/**
 * Tool execution pipeline.
 *
 * Every generation mode (`generate()`, `stream()`, `streamResponse()`,
 * `streamRaw()`, `streamDataResponse()`) and every background-task follow-up
 * turn hands the AI SDK a tool set built here. The wrappers compose in a fixed
 * order, and the order matters: each layer sees only what the layer beneath it
 * returns or throws.
 *
 * ```text
 *   AI SDK calls tool.execute(input, options)
 *     │
 *     ▼
 *   [6] wrapToolsWithExecutionContext   injects `experimental_context`
 *     │                                 (per-call: current model + capabilities)
 *     ▼
 *   [5] wrapToolsWithSignalCatching     catches InterruptSignal → placeholder
 *     │                                 result + signalState; injects
 *     │                                 `options.stop()`; applies
 *     │                                 `transformToolError` to other rejections
 *     ▼
 *   [4] wrapToolsWithStreamingContext   (streamDataResponse only) injects the
 *     │                                 request-local `streamingContext`
 *     ▼
 *   [G] optional workflow gate         host authorisation before protected work
 *     │                                 (dispatcher and resolved proxy target)
 *     ▼
 *   [3] wrapToolsWithHooks              PreToolUse / PostToolUse /
 *     │                                 PostToolUseFailure; may deny, rewrite
 *     │                                 input, short-circuit via respondWith,
 *     │                                 or rewrite output
 *     ▼
 *   [2] wrapToolsWithTaskManager        injects `taskManager` + telemetry
 *     │
 *     ▼
 *   [1] wrapToolsWithPermissionMode     permission mode / canUseTool /
 *     │                                 approval state; injects
 *     │                                 `options.interrupt()`
 *     ▼
 *   the tool's own execute()
 * ```
 *
 * Layers [1]–[3] and optional [G] are applied by {@link ToolPipeline.buildTools}; [4] only when
 * a `streamingContext` is passed; [5] is the outermost layer that must run
 * before the AI SDK can observe a thrown `InterruptSignal`. Layer [6] is
 * applied separately at the AI SDK call site, because the execution context
 * depends on the model chosen by the retry loop for that specific attempt.
 *
 * Consequences of the order:
 *
 * - The AI SDK calls needsApproval outside this execute stack. [G] separately
 *   gates that callback before it can invoke canUseTool or custom approval code.
 * - When configured, [G] must allow the request before [1]–[3] run. Hooks
 *   re-authorise transformed input before respondWith or tool execution.
 * - Hooks ([3]) run *outside* permission checks ([1]), so a `PreToolUse` hook
 *   sees every call, including ones permission mode will deny, and a
 *   `PostToolUseFailure` hook sees the resulting `ToolExecutionError`.
 * - Hooks do **not** see `InterruptSignal` as a failure: [3] re-throws it
 *   untouched and [5] converts it into a placeholder result.
 * - The `task` / `task_output` tools are added *before* [2]–[3], so they are
 *   hooked and receive the task manager like any other tool. They are not
 *   permission-wrapped: {@link ToolPipeline.buildTools} adds them after [1].
 * - `transformToolError` ([5]) sees errors thrown by [1]–[4], including
 *   hook denials, permission denials and gate failures.
 *
 * @packageDocumentation
 * @internal
 */

import type { Tool, ToolExecutionOptions, ToolSet } from "ai";
import { stepCountIs } from "ai";
import type { BaseCheckpointSaver, Interrupt } from "../checkpointer/types.js";
import { createInterrupt } from "../checkpointer/types.js";
import { ToolExecutionError, ToolPermissionDeniedError } from "../errors/index.js";
import {
  aggregatePermissionDecisions,
  extractRespondWith,
  extractUpdatedInput,
  extractUpdatedResult,
  invokeMatchingHooks,
} from "../hooks.js";
import type { MCPManager } from "../mcp/manager.js";
import type { TaskManager } from "../task-manager.js";
import { createCallToolTool } from "../tools/call-tool.js";
import { createTaskOutputTool, createTaskTool } from "../tools/factory.js";
import type {
  Agent,
  AgentOptions,
  ExecutionTelemetry,
  GenerateOptions,
  HookRegistration,
  PermissionDecision,
  PermissionMode,
  PostToolUseFailureInput,
  PostToolUseInput,
  PreToolUseInput,
  StreamingContext,
  SubagentDefinition,
  ToolErrorTransform,
} from "../types.js";
import {
  authorizeWorkflowToolCall,
  type ResolvedWorkflowExecutionGate,
  resolveWorkflowExecutionGate,
  throwIfWorkflowCallCancelled,
  WorkflowExecutionGateError,
} from "../workflow-execution-gate.js";

// =============================================================================
// Flow-control signals
// =============================================================================

/**
 * Internal signal for interrupt flow control.
 *
 * This is thrown when a tool requires user approval or an interrupt is requested.
 * It's caught by the generate() function and converted to an interrupted result.
 *
 * @internal
 */
export class InterruptSignal extends Error {
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
export function isInterruptSignal(error: unknown): error is InterruptSignal {
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
export interface GenerateSignalState {
  interrupt?: InterruptSignal;
  /**
   * Set when a tool called `options.stop()`. Ends the generation after the
   * current step and skips the background-task follow-up loop, without
   * creating resumable interrupt state.
   */
  stop?: boolean;
}

/**
 * Build the `stopWhen` conditions shared by every generation mode.
 *
 * Stops when a flow-control signal (interrupt or stop) was caught, when the
 * caller's cooperative `shouldStopAfterStep` pause hook returns true, or when
 * the step count reaches `maxSteps` — whichever comes first.
 *
 * @internal
 */
export function buildStopConditions(
  signalState: GenerateSignalState,
  genOptions: GenerateOptions,
  maxSteps: number,
) {
  return [
    () => signalState.interrupt != null || signalState.stop === true,
    () => genOptions.shouldStopAfterStep?.() === true,
    stepCountIs(maxSteps),
  ];
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
 * It also injects `options.stop()` so a tool can end the turn after its step,
 * and applies the optional `transformToolError` boundary to any other
 * rejection before the AI SDK converts it into a tool-error result.
 *
 * @internal
 */
export function wrapToolsWithSignalCatching(
  tools: ToolSet,
  signalState: GenerateSignalState,
  transformToolError?: ToolErrorTransform,
): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, toolDef] of Object.entries(tools)) {
    if (!toolDef.execute) {
      wrapped[name] = toolDef;
      continue;
    }

    const originalExecute = toolDef.execute;

    wrapped[name] = {
      ...toolDef,
      execute: async (input: unknown, options: ToolExecutionOptions<unknown>) => {
        try {
          return await originalExecute.call(toolDef, input, {
            ...options,
            stop: () => {
              signalState.stop = true;
            },
          });
        } catch (error) {
          if (isInterruptSignal(error)) {
            if (signalState.interrupt) {
              throw error; // Already have a signal — let AI SDK handle this one
            }
            signalState.interrupt = error;
            return "[Interrupt requested]";
          }
          if (transformToolError) {
            throw transformToolError(error, { toolName: name });
          }
          throw error;
        }
      },
    } as Tool;
  }

  return wrapped;
}

// =============================================================================
// [1] Permission mode
// =============================================================================

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
 * Check if a tool should be allowed based on permission mode.
 * Returns "allow" or "deny" for definitive decisions, or undefined to defer to canUseTool callback.
 * @internal
 */
export function checkPermissionMode(
  toolName: string,
  mode: PermissionMode,
): "allow" | "deny" | undefined {
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
export function wrapToolsWithPermissionMode(
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
  workflowGate?: ResolvedWorkflowExecutionGate,
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
      execute: async (input: unknown, options?: import("ai").ToolExecutionOptions<unknown>) => {
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
          if (workflowGate) throwIfWorkflowCallCancelled(workflowGate, options?.abortSignal);

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

// =============================================================================
// [2] Task manager, [6] execution context, [3] hooks
// =============================================================================

/**
 * Wraps tools to inject TaskManager into execution options.
 *
 * @param tools - The tools to wrap
 * @param taskManager - The TaskManager instance to inject
 * @returns Wrapped tools with TaskManager in execution context
 *
 * @internal
 */
export function wrapToolsWithTaskManager(
  tools: ToolSet,
  taskManager: TaskManager,
  telemetry?: ExecutionTelemetry,
): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      wrapped[name] = tool;
      continue;
    }

    const originalExecute = tool.execute;

    wrapped[name] = {
      ...tool,
      execute: async (input: unknown, options?: ToolExecutionOptions<unknown>) => {
        // Inject taskManager into execution options
        const extendedOptions = {
          ...options,
          taskManager,
          executionTelemetry: telemetry,
        } as ToolExecutionOptions<unknown>;
        return originalExecute(input, extendedOptions);
      },
    };
  }

  return wrapped;
}

/**
 * Wraps tools to inject the SDK's per-call execution context into tool
 * execution options.
 *
 * AI SDK 7 removed the call-level `experimental_context` passthrough that
 * previously forwarded an opaque object to every tool's execution options.
 * The SDK now injects that context here, preserving the `experimental_context`
 * field that inline tools (e.g. the read tool) read for model-capability
 * awareness.
 *
 * @param tools - The tools to wrap
 * @param executionContext - The per-call execution context to inject
 * @returns Wrapped tools that receive the execution context in their options
 *
 * @internal
 */
export function wrapToolsWithExecutionContext(tools: ToolSet, executionContext: unknown): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      wrapped[name] = tool;
      continue;
    }

    const originalExecute = tool.execute;

    wrapped[name] = {
      ...tool,
      execute: async (input: unknown, options?: ToolExecutionOptions<unknown>) => {
        const extendedOptions = {
          ...options,
          experimental_context: executionContext,
        } as ToolExecutionOptions<unknown>;
        return originalExecute(input, extendedOptions);
      },
    };
  }

  return wrapped;
}

/** Recheck both dispatcher and target, including after hook input replacement. */
async function authorizeWorkflowToolAndTarget(
  gate: ResolvedWorkflowExecutionGate,
  request: Parameters<typeof authorizeWorkflowToolCall>[1],
): Promise<void> {
  await authorizeWorkflowToolCall(gate, request);
  const input = request.toolInput;
  if (
    request.toolName === "call_tool" &&
    typeof input === "object" &&
    input !== null &&
    "tool_name" in input &&
    typeof input.tool_name === "string"
  ) {
    await authorizeWorkflowToolCall(gate, {
      ...request,
      toolName: input.tool_name,
      toolInput: "arguments" in input ? (input.arguments ?? {}) : {},
      stage: "proxy-target",
    });
  }
  throwIfWorkflowCallCancelled(gate, request.signal);
}

/** Host authorisation must precede hooks, permission callbacks and dispatch. */
function wrapToolsWithWorkflowExecutionGate(
  tools: ToolSet,
  gate: ResolvedWorkflowExecutionGate | undefined,
  sessionId: string,
  requestSignal?: AbortSignal,
): ToolSet {
  if (!gate) return tools;
  const wrapped: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      throw new WorkflowExecutionGateError(
        `Workflow tool '${name}' has no host execution boundary`,
        {
          toolName: name,
          gateCode: "invalid",
        },
      );
    }
    // These callbacks run while input is still arriving, before a complete
    // authorisation request exists. Reject rather than leave an I/O bypass.
    if (
      [tool.onInputStart, tool.onInputDelta, tool.onInputAvailable].some((hook) => hook != null)
    ) {
      throw new WorkflowExecutionGateError(
        `Workflow tool '${name}' cannot use input lifecycle callbacks before authorisation`,
        { toolName: name, gateCode: "invalid" },
      );
    }
    const originalExecute = tool.execute;
    const originalNeedsApproval = tool.needsApproval;
    wrapped[name] = {
      ...tool,
      // AI SDK invokes this before execute, outside the execution wrapper stack.
      // Check it independently; never reuse an approval-phase grant at execution.
      needsApproval:
        typeof originalNeedsApproval === "function" || originalNeedsApproval === true
          ? async (
              input: unknown,
              approvalOptions: Parameters<Exclude<Tool["needsApproval"], boolean | undefined>>[1],
            ) => {
              await authorizeWorkflowToolAndTarget(gate, {
                toolName: name,
                toolInput: input,
                toolCallId: approvalOptions.toolCallId,
                sessionId,
                stage: "pre-hook",
                signal: requestSignal,
              });
              const result =
                typeof originalNeedsApproval === "function"
                  ? await originalNeedsApproval.call(tool, input, approvalOptions)
                  : originalNeedsApproval;
              throwIfWorkflowCallCancelled(gate, requestSignal);
              return result;
            }
          : originalNeedsApproval,
      execute: async (input: unknown, options: ToolExecutionOptions<unknown>) => {
        const toolCallId = options?.toolCallId ?? `tool-${Date.now()}`;
        const signal = options?.abortSignal ?? requestSignal;
        await authorizeWorkflowToolAndTarget(gate, {
          toolName: name,
          toolInput: input,
          toolCallId,
          sessionId,
          stage: "pre-hook",
          signal,
        });
        return originalExecute.call(tool, input, options);
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
export function wrapToolsWithHooks(
  tools: ToolSet,
  hookRegistration: HookRegistration | undefined,
  agent: Agent,
  sessionId: string,
  telemetry?: ExecutionTelemetry,
  workflowGate?: ResolvedWorkflowExecutionGate,
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
      execute: async (input: unknown, options?: ToolExecutionOptions<unknown>) => {
        const toolUseId = options?.toolCallId ?? `tool-${Date.now()}`;

        // Create PreToolUse input
        const preToolUseInput: PreToolUseInput = {
          hook_event_name: "PreToolUse",
          session_id: sessionId,
          cwd: process.cwd(),
          telemetry,
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
                telemetry,
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
            if (workflowGate) {
              await authorizeWorkflowToolAndTarget(workflowGate, {
                toolName: name,
                toolInput: updatedInput,
                toolCallId: toolUseId,
                sessionId,
                stage: "transformed-input",
                signal: options?.abortSignal,
              });
            }
            input = updatedInput;
          }
          if (workflowGate) throwIfWorkflowCallCancelled(workflowGate, options?.abortSignal);

          // Check for short-circuit via respondWith (skips tool execution)
          const respondWithValue = extractRespondWith(preHookOutputs);
          if (respondWithValue !== undefined) {
            if (hookRegistration?.PostToolUse?.length) {
              const syntheticPostInput: PostToolUseInput = {
                hook_event_name: "PostToolUse",
                session_id: sessionId,
                cwd: process.cwd(),
                telemetry,
                tool_name: name,
                tool_input: input as Record<string, unknown>,
                tool_response: respondWithValue,
                tool_result_synthetic: true,
              };

              const postHookOutputs = await invokeMatchingHooks(
                hookRegistration.PostToolUse,
                name,
                syntheticPostInput,
                toolUseId,
                agent,
              );

              const updatedResult = extractUpdatedResult(postHookOutputs);
              if (updatedResult !== undefined) {
                return updatedResult;
              }
            }

            return respondWithValue;
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
              telemetry,
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
                telemetry,
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

// =============================================================================
// [4] Streaming context
// =============================================================================

/**
 * Injects request-local streaming context into tool execution options.
 *
 * This keeps deferred streaming tools isolated per request instead of
 * relying on mutable MCPManager state shared across concurrent generations.
 *
 * @internal
 */
export function wrapToolsWithStreamingContext(
  tools: ToolSet,
  streamingContext: StreamingContext,
): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      wrapped[name] = tool;
      continue;
    }

    const originalExecute = tool.execute;
    wrapped[name] = {
      ...tool,
      execute: async (input: unknown, toolOptions?: ToolExecutionOptions<unknown>) => {
        const extendedOptions = {
          ...toolOptions,
          streamingContext,
        } as ToolExecutionOptions<unknown>;
        return originalExecute(input, extendedOptions);
      },
    };
  }

  return wrapped;
}

// =============================================================================
// Composition
// =============================================================================

/**
 * Filter a tool set by `allowedTools` / `disallowedTools`.
 *
 * `disallowedTools` takes precedence: a tool in both lists is blocked. With
 * neither set, the input is returned unchanged.
 *
 * @internal
 */
export function filterToolsByAllowed(
  toolSet: ToolSet,
  allowed: readonly string[] | undefined,
  disallowed: readonly string[] | undefined,
): ToolSet {
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
}

/**
 * Agent-scoped dependencies the pipeline reads on every build.
 *
 * Everything here is either immutable for the agent's lifetime or read
 * through a getter, so the pipeline observes runtime changes (permission
 * mode, runtime tools) without being rebuilt.
 *
 * @internal
 */
export interface ToolPipelineDeps {
  options: AgentOptions;
  /** The agent instance, passed to hooks and the task tool. */
  getAgent: () => Agent;
  /** Base tools built at agent creation (core + eager plugin tools). */
  coreTools: ToolSet;
  /** Tools added/removed at runtime via `addRuntimeTools()`. */
  runtimeTools: ToolSet;
  mcpManager: MCPManager;
  taskManager: TaskManager;
  hooks: HookRegistration | undefined;
  getPermissionMode: () => PermissionMode;
  approvalDecisions: Map<string, boolean>;
  pendingResponses: Map<string, unknown>;
  /** Subagents offered by the task tool (user-supplied + auto-discovered). */
  subagents: SubagentDefinition[];
}

/**
 * Per-request inputs for {@link ToolPipeline.buildTools}.
 *
 * @internal
 */
export interface BuildToolsOptions {
  threadId?: string;
  /** Request signal for AI SDK approval callbacks, which receive no abort signal. */
  signal?: AbortSignal;
  /** Execution telemetry forwarded to hooks and the task manager. */
  telemetry?: ExecutionTelemetry;
  /**
   * Flow-control state shared with `buildStopConditions()`. The
   * signal-catching layer writes to it.
   */
  signalState: GenerateSignalState;
  /**
   * Request-local streaming context. When set, `call_tool` and MCP tools are
   * rebuilt to stream through it, the task tool can spawn streaming subagents,
   * and the streaming-context layer is applied.
   */
  streamingContext?: StreamingContext;
}

/**
 * The composed tool pipeline for one agent.
 *
 * @internal
 */
export interface ToolPipeline {
  /**
   * The fully wrapped tool set for one AI SDK request: layers [1]–[5] in the
   * module-level diagram. Callers still apply
   * {@link wrapToolsWithExecutionContext} ([6]) at the call site.
   */
  buildTools(request: BuildToolsOptions): ToolSet;

  /**
   * Base tools with permission wrapping ([1]) only — no task tool, hooks, or
   * signal catching. This is what `agent.getActiveTools()` exposes.
   */
  getPermissionWrappedTools(threadId?: string): ToolSet;
}

/**
 * Create the tool pipeline for an agent.
 *
 * @internal
 */
export function createToolPipeline(deps: ToolPipelineDeps): ToolPipeline {
  const {
    options,
    getAgent,
    coreTools,
    runtimeTools,
    mcpManager,
    taskManager,
    hooks,
    getPermissionMode,
    approvalDecisions,
    pendingResponses,
    subagents,
  } = deps;
  // Validate once, before the agent's ready/setup work or any model invocation.
  const workflowGate = resolveWorkflowExecutionGate(options.workflowExecutionGate);

  /** Core + runtime + MCP tools, filtered, with permission wrapping ([1]). */
  const getPermissionWrappedTools = (
    threadId?: string,
    streamingContext?: StreamingContext,
  ): ToolSet => {
    // Start with core tools
    const allTools: ToolSet = { ...coreTools };

    // With a streaming context, call_tool is rebuilt so deferred tools can
    // stream through this request's writer.
    if (streamingContext && allTools.call_tool) {
      allTools.call_tool = createCallToolTool({
        mcpManager,
        streamingContext,
      });
    }

    // Add runtime tools (added by plugins at runtime)
    Object.assign(allTools, runtimeTools);

    // Add MCP tools from plugin registrations
    Object.assign(allTools, mcpManager.getToolSet(undefined, streamingContext));

    // Apply allowedTools filtering
    const filtered = filterToolsByAllowed(allTools, options.allowedTools, options.disallowedTools);

    // Apply permission mode wrapping with canUseTool callback and approval state
    return wrapToolsWithPermissionMode(
      filtered,
      getPermissionMode,
      options.canUseTool,
      {
        approvalDecisions,
        pendingResponses,
        checkpointSaver: options.checkpointer,
        threadId,
      },
      workflowGate,
    );
  };

  const addTaskTools = (tools: ToolSet, streamingContext?: StreamingContext): ToolSet => {
    // Respect disabledCoreTools setting for task tool
    if (options.disabledCoreTools?.includes("task")) {
      return tools;
    }

    const result: ToolSet = {
      ...tools,
      task: createTaskTool({
        subagents,
        defaultModel: options.model,
        parentAgent: getAgent(),
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

  const applyHooks = (
    tools: ToolSet,
    threadId?: string,
    telemetry?: ExecutionTelemetry,
    signal?: AbortSignal,
  ): ToolSet => {
    // [2] inject TaskManager into execution context
    const withTaskManager = wrapToolsWithTaskManager(tools, taskManager, telemetry);
    // [3] hooks for observability
    const withHooks = wrapToolsWithHooks(
      withTaskManager,
      hooks,
      getAgent(),
      threadId ?? "default",
      telemetry,
      workflowGate,
    );
    // [G] runs outside every hook, including hooks that perform protected I/O.
    return wrapToolsWithWorkflowExecutionGate(
      withHooks,
      workflowGate,
      threadId ?? "default",
      signal,
    );
  };

  const buildTools = ({
    threadId,
    signal,
    telemetry,
    signalState,
    streamingContext,
  }: BuildToolsOptions): ToolSet => {
    // [1] permission wrapping, then the task tools so they are hooked too
    const withTask = addTaskTools(
      getPermissionWrappedTools(threadId, streamingContext),
      streamingContext,
    );
    // [2] + [3]
    const hooked = applyHooks(withTask, threadId, telemetry, signal);
    // [4] only for streaming data responses
    const scoped = streamingContext
      ? wrapToolsWithStreamingContext(hooked, streamingContext)
      : hooked;
    // [5] outermost: intercept InterruptSignal before the AI SDK does
    return wrapToolsWithSignalCatching(scoped, signalState, options.transformToolError);
  };

  return {
    buildTools,
    getPermissionWrappedTools: (threadId) => getPermissionWrappedTools(threadId),
  };
}
