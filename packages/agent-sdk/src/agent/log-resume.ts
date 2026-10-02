/**
 * Log-mode resume.
 *
 * A pending interrupt is control state (the checkpoint's `pendingInterrupt`),
 * and the interrupted tool call is already on the log (see
 * `./log-interrupts.ts`). Resuming it appends to the log and then continues
 * like any other log-mode generation:
 *
 * ```
 *   read the head once → locate the interrupted call on its path
 *   approve / answer:  commit the resolution → run the tool through the
 *                      tool pipeline → commit its result
 *   reject:            commit the resolution and the denial result together
 *   clear the pending interrupt → an ordinary log-mode generation projects
 *   the path (no separate prompt derivation)
 * ```
 *
 * Both entries are outputs of the interrupted call, committed through the
 * commit boundary's output path, so the PreGenerate hooks screen them before
 * commit. The resolution is committed before the tool runs: a resume that
 * finds a resolution without a result knows an earlier attempt may have run
 * the tool, and does not run it again unless the host's tool ledger makes
 * that safe (`contextLog.inDoubtResume: "reexecute"`).
 *
 * @packageDocumentation
 * @internal
 */

import type { Tool, ToolExecutionOptions } from "ai";
import type { Checkpoint, Interrupt } from "../checkpointer/types.js";
import { isApprovalInterrupt, updateCheckpoint } from "../checkpointer/types.js";
import { ContextLogConflictError } from "../context-log/errors.js";
import { invokeLogModePreGenerateHooks } from "../context-log/hooks.js";
import type { ToolResultContextEntryInput } from "../context-log/types.js";
import { ValidationError } from "../errors/index.js";
import { invokeHooksWithTimeout } from "../hooks.js";
import {
  buildExecutionTelemetryFromIds,
  createRunId,
} from "../observability/execution-metadata.js";
import type {
  Agent,
  AgentOptions,
  ExecutionTelemetry,
  GenerateOptions,
  HookRegistration,
  InterruptResolvedInput,
} from "../types.js";
import type { CheckpointRuntime } from "./checkpoint-runtime.js";
import { getCheckpointRunId } from "./checkpoint-runtime.js";
import { createToolExecutionContext, createToolModelOutput } from "./generation-runner.js";
import type { LogContextRuntime, LogInputScreen, LogInterruptSite } from "./log-context.js";
import { RESUME_IN_DOUBT_REASON } from "./log-interrupts.js";
import {
  type GenerateSignalState,
  type ToolPipeline,
  wrapToolsWithExecutionContext,
} from "./tool-pipeline.js";

/**
 * What the caller of a resume does next.
 *
 * - `continue` - The interrupt is resolved; run a generation on the thread
 * - `re-interrupted` - The tool interrupted again; the new interrupt is the
 *   thread's pending interrupt
 *
 * @internal
 */
export type ResumeOutcome =
  | { type: "continue"; threadId: string; genOptions?: Partial<GenerateOptions> }
  | { type: "re-interrupted"; interrupt: Interrupt; checkpoint: Checkpoint };

/**
 * Dependencies of {@link createLogResume}.
 *
 * @internal
 */
export interface LogResumeDeps {
  options: AgentOptions;
  logContext: LogContextRuntime;
  toolPipeline: ToolPipeline;
  checkpoints: CheckpointRuntime;
  hooks: HookRegistration | undefined;
  getAgent: () => Agent;
  /** Responses the tool pipeline's `interrupt()` returns, keyed by interrupt id. */
  pendingResponses: Map<string, unknown>;
  /** Approval decisions the permission layer consults, keyed by tool call id. */
  approvalDecisions: Map<string, boolean>;
}

/** A validated approval response. */
interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

function parseApprovalResponse(response: unknown): ApprovalDecision {
  const candidate = response as { approved?: unknown; reason?: unknown } | null;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof candidate.approved !== "boolean" ||
    (candidate.reason !== undefined && typeof candidate.reason !== "string")
  ) {
    throw new ValidationError(
      "An approval interrupt is resumed with { approved: boolean, reason?: string }",
      { fieldErrors: { response: ["expected { approved: boolean, reason?: string }"] } },
    );
  }
  return {
    approved: candidate.approved,
    ...(candidate.reason !== undefined && { reason: candidate.reason }),
  };
}

/** The AI SDK's text for a tool error (`getErrorMessage`), so results match a normal step. */
function toolErrorText(error: unknown): string {
  if (error == null) return "unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.toString();
  return JSON.stringify(error);
}

/** Runs a tool's execute, taking the final value of a streaming tool. */
async function runExecute(
  tool: Tool,
  input: unknown,
  options: ToolExecutionOptions<unknown>,
): Promise<unknown> {
  const result: unknown = await tool.execute!(input as never, options as never);
  if (
    typeof result === "object" &&
    result !== null &&
    Symbol.asyncIterator in result &&
    typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
  ) {
    let last: unknown;
    for await (const part of result as AsyncIterable<unknown>) last = part;
    return last;
  }
  return result;
}

/**
 * Create the log-mode resume for an agent.
 *
 * @internal
 */
export function createLogResume(
  deps: LogResumeDeps,
): (
  threadId: string,
  interruptId: string,
  response: unknown,
  genOptions?: Partial<GenerateOptions>,
) => Promise<ResumeOutcome> {
  const { options, logContext, toolPipeline, checkpoints, hooks, getAgent } = deps;

  const screen: LogInputScreen = (screenOptions, pending) =>
    invokeLogModePreGenerateHooks({
      hooks: hooks?.PreGenerate ?? [],
      options: screenOptions,
      pending,
      agent: getAgent(),
    });

  async function emitInterruptResolved(
    threadId: string,
    telemetry: ExecutionTelemetry,
    interrupt: Interrupt,
    response: unknown,
    approval: ApprovalDecision | undefined,
  ): Promise<void> {
    const resolvedHooks = hooks?.InterruptResolved ?? [];
    if (resolvedHooks.length === 0) return;
    const input: InterruptResolvedInput = {
      hook_event_name: "InterruptResolved",
      session_id: threadId,
      cwd: process.cwd(),
      telemetry,
      interrupt_id: interrupt.id,
      interrupt_type: interrupt.type,
      tool_call_id: interrupt.toolCallId,
      tool_name: interrupt.toolName,
      response,
      approved: approval?.approved,
    };
    await invokeHooksWithTimeout(resolvedHooks, input, null, getAgent());
  }

  /**
   * Runs the interrupted call through the normal tool pipeline (permission
   * mode, hooks, the workflow gate, signal catching and the execution
   * context), with `response` as the answer to the tool's `interrupt()`.
   */
  async function executeCall(
    site: LogInterruptSite,
    tools: Record<string, Tool>,
    signalState: GenerateSignalState,
    interrupt: Interrupt,
    response: unknown,
    approval: ApprovalDecision | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ output: unknown } | { error: unknown }> {
    const { toolCallId, toolName, input } = site.call;
    const tool = tools[toolName]!;
    // The permission layer's interrupt() looks responses up by
    // `int_<toolCallId>`; the interrupt's own id is kept for tools that
    // raised it with that id.
    const responseKeys = [...new Set([interrupt.id, `int_${toolCallId}`])];
    for (const key of responseKeys) deps.pendingResponses.set(key, response);
    if (approval) deps.approvalDecisions.set(toolCallId, approval.approved);
    try {
      return {
        output: await runExecute(tool, input, {
          toolCallId,
          messages: site.messages,
          ...(signal && { abortSignal: signal }),
        } as ToolExecutionOptions<unknown>),
      };
    } catch (error) {
      return { error };
    } finally {
      for (const key of responseKeys) deps.pendingResponses.delete(key);
      if (approval) deps.approvalDecisions.delete(toolCallId);
    }
  }

  return async function resume(threadId, interruptId, response, genOptions = {}) {
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
    if (!interrupt.toolCallId || !interrupt.toolName) {
      throw new Error("Cannot resume: the interrupt was not raised by a tool call");
    }
    const approval = isApprovalInterrupt(interrupt) ? parseApprovalResponse(response) : undefined;
    const telemetry = buildExecutionTelemetryFromIds({
      runId: getCheckpointRunId(checkpoint) ?? createRunId(),
      threadId,
      requestedModel: options.model,
    });
    const callOptions: GenerateOptions = { ...genOptions, threadId, _runId: telemetry.runId };

    let site = await logContext.readInterrupt(callOptions, interrupt, options.model);
    if (site.state !== "resolved") {
      const { toolCallId, toolName } = site.call;
      const rejected = approval?.approved === false;
      const signalState: GenerateSignalState = {};
      const tools = rejected
        ? {}
        : wrapToolsWithExecutionContext(
            toolPipeline.buildTools({
              threadId,
              signal: genOptions.signal,
              telemetry,
              signalState,
            }),
            createToolExecutionContext(options, options.model),
          );
      if (!rejected && !tools[toolName]?.execute) {
        throw new Error(`Cannot resume: tool "${toolName}" not found or has no execute function`);
      }
      if (
        site.state === "resolving" &&
        (rejected || (options.contextLog?.inDoubtResume ?? "refuse") !== "reexecute")
      ) {
        throw new ContextLogConflictError(RESUME_IN_DOUBT_REASON, {
          head: site.head,
          message: `An earlier resume of interrupt ${interrupt.id} committed its resolution but not the result of tool call ${toolCallId}; the tool may already have run. Recover it from the host's tool ledger (contextLog.inDoubtResume: "reexecute")`,
        });
      }

      if (site.state === "pending") {
        // Never commit a resolution for a resume that was already cancelled.
        genOptions.signal?.throwIfAborted();
        await emitInterruptResolved(threadId, telemetry, interrupt, response, approval);
        const resolution: ToolResultContextEntryInput = {
          kind: "tool_result",
          key: site.keys.resolution,
          message: {
            role: "tool",
            content: [
              {
                type: "tool-approval-response",
                approvalId: interrupt.id,
                // A custom interrupt is answered: the call goes ahead.
                approved: approval?.approved ?? true,
                ...(approval?.reason !== undefined && { reason: approval.reason }),
              },
            ],
          },
        };
        const items = [resolution];
        if (rejected) {
          // Nothing runs, so the resolution and its result commit together.
          const denial = `Tool "${toolName}" was denied by user${
            approval?.reason ? `: ${approval.reason}` : ""
          }`;
          items.push(
            resultEntry(
              site,
              await createToolModelOutput({
                tool: undefined,
                toolCallId,
                input: site.call.input,
                output: denial,
              }),
            ),
          );
        }
        // Committed before the tool runs, so a later resume can tell that
        // this one may have started it.
        site = await logContext.commitInterruptOutputs(site, items, callOptions, screen);
      }

      if (site.state === "resolving") {
        const executed = await executeCall(
          site,
          tools,
          signalState,
          interrupt,
          response,
          approval,
          genOptions.signal,
        );
        // A late result after cancellation is never committed.
        genOptions.signal?.throwIfAborted();
        if (signalState.interrupt) {
          // The tool asked again (for example a multi-step form). This
          // round's resolution stays on the log; the call stays unresolved.
          // Each round keys its resume entries by its interrupt's creation
          // time, so a round raised within the same millisecond as the last
          // one is moved after it.
          const raised = signalState.interrupt.interrupt;
          const previous = Date.parse(interrupt.createdAt);
          const next =
            Date.parse(raised.createdAt) > previous
              ? raised
              : { ...raised, createdAt: new Date(previous + 1).toISOString() };
          const marked = await checkpoints.markPendingInterrupt(
            threadId,
            next,
            telemetry.runId,
            checkpoint,
          );
          return { type: "re-interrupted", interrupt: next, checkpoint: marked ?? checkpoint };
        }
        const output =
          "error" in executed
            ? { type: "error-text" as const, value: toolErrorText(executed.error) }
            : await createToolModelOutput({
                tool: tools[toolName],
                toolCallId,
                input: site.call.input,
                output: executed.output,
              });
        site = await logContext.commitInterruptOutputs(
          site,
          [resultEntry(site, output)],
          callOptions,
          screen,
        );
      }
    }

    // The interrupt is resolved on the log: clear the control state and let
    // an ordinary generation continue from the path.
    await checkpoints.commit(
      threadId,
      updateCheckpoint(checkpoint, { pendingInterrupt: undefined, step: checkpoint.step + 1 }),
    );
    return {
      type: "continue",
      threadId,
      genOptions: { ...genOptions, _runId: telemetry.runId },
    };
  };
}

/** The result entry of a resume, shaped like the AI SDK's own tool result. */
function resultEntry(site: LogInterruptSite, output: unknown): ToolResultContextEntryInput {
  const { toolCallId, toolName, providerOptions } = site.call;
  return {
    kind: "tool_result",
    key: site.keys.result,
    message: {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName,
          output: output as never,
          ...(providerOptions && { providerOptions }),
        },
      ],
    },
  };
}
