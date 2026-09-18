/**
 * Message assembly.
 *
 * Everything between "what the caller passed to `generate()`" and "what the
 * AI SDK is handed as `messages`", plus the reverse direction: rebuilding the
 * durable transcript from step results after a run.
 *
 * - {@link appendResponseMessages} / {@link buildMessagesFromStepResponses}:
 *   transcript reconstruction. The AI SDK's top-level `response.messages`
 *   only holds the final step, so multi-step runs are rebuilt from per-step
 *   responses.
 * - {@link createMessageRuntime}: the agent-scoped half. `buildMessages()`
 *   loads or forks the thread checkpoint, appends history and prompt, and
 *   compacts at the run boundary. `createStreamingCompactionState()` tracks
 *   the durable transcript through a streaming tool loop and compacts between
 *   steps. Both go through `compactMessagesIfNeeded()`, which owns the
 *   PreCompact / PostCompact hooks.
 *
 * Model-capability projection (`projectMessagesForModel`) is deliberately not
 * here: it is applied per attempt at the AI SDK call site because it depends
 * on which model the retry loop selected.
 *
 * @packageDocumentation
 * @internal
 */

import type { ModelMessage } from "ai";
import type { Checkpoint } from "../checkpointer/types.js";
import type { ContextManager } from "../context-manager.js";
import { invokeHooksWithTimeout } from "../hooks.js";
import {
  buildExecutionTelemetryFromIds,
  createRunId,
} from "../observability/execution-metadata.js";
import type {
  Agent,
  AgentOptions,
  GenerateOptions,
  HookRegistration,
  PostCompactInput,
  PreCompactInput,
} from "../types.js";
import type { CheckpointRuntime } from "./checkpoint-runtime.js";

// =============================================================================
// Transcript reconstruction
// =============================================================================

/** @internal */
const responseMessagesToModelMessages = (messages: unknown[] | undefined): ModelMessage[] =>
  Array.isArray(messages) ? (messages as ModelMessage[]) : [];

/**
 * Append a step's response messages to a transcript, or the assistant text
 * when the provider returned no response messages.
 *
 * @internal
 */
export function appendResponseMessages(
  baseMessages: ModelMessage[],
  responseMessages: unknown[] | undefined,
  fallbackAssistantText?: string,
): ModelMessage[] {
  const normalized = responseMessagesToModelMessages(responseMessages);
  if (normalized.length > 0) {
    return [...baseMessages, ...normalized];
  }

  return fallbackAssistantText
    ? [...baseMessages, { role: "assistant" as const, content: fallbackAssistantText }]
    : baseMessages;
}

/**
 * Build the full transcript for persistence from a multi-step result.
 *
 * The AI SDK's top-level `response.messages` only holds the FINAL step's
 * messages, so a run that called tools in earlier steps would lose those
 * tool calls/results if we used it directly. Prefer the per-step response
 * messages; fall back to `fallbackResponseMessages` (the top-level
 * `response.messages`) and finally to the assistant text.
 *
 * @internal
 */
export function buildMessagesFromStepResponses(
  baseMessages: ModelMessage[],
  steps: Array<{ text?: string; response?: { messages?: unknown[] } }>,
  fallbackAssistantText?: string,
  fallbackResponseMessages?: unknown[],
): ModelMessage[] {
  const stepResponseMessages = steps.flatMap((step) =>
    responseMessagesToModelMessages(step.response?.messages),
  );
  if (stepResponseMessages.length > 0) {
    return [...baseMessages, ...stepResponseMessages];
  }

  const lastText = steps.at(-1)?.text || fallbackAssistantText;
  return appendResponseMessages(baseMessages, fallbackResponseMessages, lastText);
}

// =============================================================================
// Agent-scoped runtime
// =============================================================================

/**
 * Dependencies for {@link createMessageRuntime}.
 *
 * @internal
 */
export interface MessageRuntimeDeps {
  /** Context manager driving compaction, or `undefined` to disable it. */
  contextManager: ContextManager | undefined;
  /** The agent's configured model, recorded in compaction telemetry. */
  model: AgentOptions["model"];
  hooks: HookRegistration | undefined;
  /** The agent instance, passed to compaction hooks and the context manager. */
  getAgent: () => Agent;
  checkpoints: CheckpointRuntime;
}

/**
 * Result of a run-boundary compaction check.
 *
 * @internal
 */
export interface CompactionOutcome {
  compacted: boolean;
  messages: ModelMessage[];
}

/**
 * Tracks the durable transcript through a streaming tool loop.
 *
 * @internal
 */
export interface StreamingCompactionState {
  /** `prepareStep` callback for the AI SDK: compacts before a model call. */
  prepareStep(step: {
    messages: ModelMessage[];
    stepNumber: number;
  }): Promise<{ messages: ModelMessage[] } | undefined>;
  /** Append a finished step's response messages; returns the new transcript. */
  appendStep(stepResult: {
    text?: string;
    response?: { messages?: unknown[] };
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  }): ModelMessage[];
  /** Final transcript for persistence. */
  finalize(
    steps: Array<{ text?: string; response?: { messages?: unknown[] } }>,
    fallbackAssistantText?: string,
  ): ModelMessage[];
  /** A copy of the current transcript. */
  readonly messages: ModelMessage[];
}

/**
 * Message runtime for one agent.
 *
 * @internal
 */
export interface MessageRuntime {
  /**
   * Build the messages array for the AI SDK from GenerateOptions. Loads (or
   * forks) the thread checkpoint, appends history and prompt, and compacts at
   * the run boundary when a context manager is configured.
   */
  buildMessages(genOptions: GenerateOptions): Promise<{
    messages: ModelMessage[];
    checkpoint?: Checkpoint;
    forkedSessionId?: string;
  }>;

  /** Compact `messages` if the context policy requires it, emitting hooks. */
  compactMessagesIfNeeded(
    messages: ModelMessage[],
    genOptions: GenerateOptions,
    threadId: string | undefined,
  ): Promise<CompactionOutcome>;

  /**
   * Track a streaming tool loop's transcript. `buildMessages` already
   * compacts before step 0, so the first step is skipped unless
   * `compactFirstStep` is set (background follow-up turns build their own
   * message list and pass `true`).
   */
  createStreamingCompactionState(
    initialMessages: ModelMessage[],
    genOptions: GenerateOptions,
    threadId: string | undefined,
    compactFirstStep?: boolean,
  ): StreamingCompactionState;
}

/**
 * Create the message runtime for an agent.
 *
 * @internal
 */
export function createMessageRuntime(deps: MessageRuntimeDeps): MessageRuntime {
  const { contextManager, model, hooks, getAgent, checkpoints } = deps;

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
    if (!contextManager || genOptions._skipCompaction) {
      return { compacted: false, messages };
    }

    const { trigger, reason } = contextManager.shouldCompact(messages);
    if (!trigger || !reason) {
      return { compacted: false, messages };
    }

    const compactionTelemetry = buildExecutionTelemetryFromIds({
      runId: genOptions._runId ?? createRunId(),
      threadId,
      requestedModel: model,
    });
    // Calculate token count before compaction
    const tokensBefore = contextManager.tokenCounter.countMessages(messages);
    const messagesBefore = messages.length;

    // Emit PreCompact hook
    const preCompactHooks = hooks?.PreCompact ?? [];
    if (preCompactHooks.length > 0) {
      const preCompactInput: PreCompactInput = {
        hook_event_name: "PreCompact",
        session_id: genOptions.threadId ?? "default",
        cwd: process.cwd(),
        telemetry: compactionTelemetry,
        message_count: messagesBefore,
        tokens_before: tokensBefore,
      };
      await invokeHooksWithTimeout(preCompactHooks, preCompactInput, null, getAgent());
    }

    // Perform compaction
    const compactionResult = await contextManager.compact(messages, getAgent(), reason);

    // Emit PostCompact hook with metrics
    const postCompactHooks = hooks?.PostCompact ?? [];
    if (postCompactHooks.length > 0) {
      const postCompactInput: PostCompactInput = {
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
      await invokeHooksWithTimeout(postCompactHooks, postCompactInput, null, getAgent());
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
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      }): ModelMessage[] {
        // Measure the consumed input before output is appended. Missing usage
        // still records a boundary so an older anchor cannot live indefinitely.
        if (!genOptions._skipCompaction) {
          contextManager?.updateUsage?.(
            {
              inputTokens: stepResult.usage?.inputTokens,
              outputTokens: stepResult.usage?.outputTokens,
              totalTokens: stepResult.usage?.totalTokens,
            },
            { messages: currentMessages },
          );
        }
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
      checkpoint = await checkpoints.fork(genOptions.threadId, forkedSessionId);
      if (checkpoint) {
        // Prepend forked checkpoint messages
        messages.push(...checkpoint.messages);
      }
    } else if (genOptions.threadId) {
      // Normal checkpoint loading
      checkpoint = await checkpoints.load(genOptions.threadId);
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

  return { buildMessages, compactMessagesIfNeeded, createStreamingCompactionState };
}
