/**
 * Generation lifecycle shared by the five response modes.
 *
 * `generate()`, `stream()`, `streamResponse()`, `streamRaw()` and
 * `streamDataResponse()` each own a retry loop and an output shape, but the
 * work between "caller options" and "AI SDK request" is the same in all of
 * them. This module owns that shared work so a fix lands in one place:
 *
 * ```
 *   beginRun            resolve run id → PreGenerate hooks → cache short-circuit
 *     │
 *   createRetryState
 *     │  ┌───────────────────────── per attempt ─────────────────────────┐
 *   beginAttempt        buildMessages → step/thread bookkeeping → telemetry
 *   prepareRequest      signal state → tool pipeline → system prompt → params
 *   buildModelCallParams  model-capability projection → execution context →
 *                       stop conditions → AI SDK call options
 *     │  (mode-specific: generateText / streamText / UI stream)
 *   updateContextUsage · emitInterruptRequested · invokePostGenerate
 *   createStreamLifecycleCallbacks   onStepFinish / onFinish for the three
 *                       Response-shaped modes
 *   runUIStreamFollowUps   background-task follow-up turns merged into a
 *                       UI message stream
 *     │
 *   retryOrThrow        PostGenerateFailure / GenerationRetryDecision hooks,
 *                       fallback model, backoff
 *     └────────────────────────────────────────────────────────────────┘
 * ```
 *
 * The modes still differ in places (fork handling, pending-interrupt
 * persistence, follow-up strategy, …). Those differences are deliberate
 * inputs to this module rather than hidden inside it; see
 * `docs/architecture/generation-modes.md` for the table.
 *
 * Module-scope helpers ({@link projectMessagesForModel},
 * {@link createToolExecutionContext}, {@link mapSteps}, …) are pure and
 * applied per attempt with that attempt's model.
 *
 * @packageDocumentation
 * @internal
 */

import type {
  LanguageModel,
  ModelMessage,
  Tool,
  ToolCallRepairFunction,
  ToolSet,
  UIMessageStreamWriter,
} from "ai";
import { streamText } from "ai";
import type { Checkpoint, Interrupt } from "../checkpointer/types.js";
import type { AgentError } from "../errors/index.js";
import {
  createRetryLoopState,
  handleGenerationError,
  invokePreGenerateHooks,
  normalizeError,
  type RetryLoopState,
  updateRetryLoopState,
  waitForRetryDelay,
} from "../generation-helpers.js";
import { extractUpdatedResult, invokeHooksWithTimeout } from "../hooks.js";
import {
  buildExecutionTelemetry,
  buildExecutionTelemetryFromIds,
  createRunId,
} from "../observability/execution-metadata.js";
import type { PromptContext } from "../prompt-builder/index.js";
import type {
  Agent,
  AgentOptions,
  ExecutionTelemetry,
  GenerateOptions,
  GenerateResult,
  GenerateResultComplete,
  GenerateStep,
  HookRegistration,
  InterruptRequestedInput,
  ModelInputCapabilities,
  PostGenerateInput,
  StreamingContext,
  ToolCallResult,
  ToolResultPart,
} from "../types.js";
import type { CheckpointRuntime } from "./checkpoint-runtime.js";
import type { MessageRuntime, StreamingCompactionState } from "./messages.js";
import {
  buildStopConditions,
  type GenerateSignalState,
  type ToolPipeline,
  wrapToolsWithExecutionContext,
} from "./tool-pipeline.js";

// =============================================================================
// Model-capability projection
// =============================================================================

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

/**
 * Per-call execution context injected into tools via
 * `wrapToolsWithExecutionContext`.
 *
 * @internal
 */
export interface ToolExecutionContext {
  agentSdk: { currentModel: AgentOptions["model"]; modelCapabilities?: ModelInputCapabilities };
}

/** @internal */
export function createToolExecutionContext(
  options: AgentOptions,
  model: AgentOptions["model"],
): ToolExecutionContext {
  const modelCapabilities = resolveModelInputCapabilities(options, model);

  return {
    agentSdk: {
      currentModel: model,
      ...(modelCapabilities ? { modelCapabilities } : {}),
    },
  };
}

/** @internal */
export async function createToolModelOutput({
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

/**
 * Replace tool-result media the active model cannot accept with text
 * placeholders. Returns the input array untouched when nothing needs
 * downgrading.
 *
 * @internal
 */
export function projectMessagesForModel(
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

// =============================================================================
// Result mapping
// =============================================================================

/** AI SDK step shape consumed by {@link mapSteps}. @internal */
export type AiSdkSteps = Awaited<ReturnType<typeof streamText>["steps"]>;

/**
 * Map AI SDK steps to our GenerateStep format.
 *
 * @internal
 */
export function mapSteps(steps: AiSdkSteps): GenerateStep[] {
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
 * Plain-text `Response` for a cached (`respondWith`) result, used by the two
 * UI-stream modes. Only complete results carry text.
 *
 * @internal
 */
export function cachedTextResponse(cachedResult: GenerateResult): Response {
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

// =============================================================================
// Runner
// =============================================================================

/**
 * Dependencies for {@link createGenerationRunner}.
 *
 * @internal
 */
export interface GenerationRunnerDeps {
  options: AgentOptions;
  hooks: HookRegistration | undefined;
  /** The agent instance, passed to hooks and nested follow-up turns. */
  getAgent: () => Agent;
  toolPipeline: ToolPipeline;
  checkpoints: CheckpointRuntime;
  messageRuntime: MessageRuntime;
  buildPromptContext: (
    genOptions: Pick<GenerateOptions, "instructionLayers" | "memory"> | undefined,
    messages?: ModelMessage[],
    threadId?: string,
  ) => PromptContext;
  getSystemPrompt: (context: PromptContext) => string | undefined;
  /** `repairToolCall` under both names the AI SDK accepts. */
  repairToolCallOptions: RepairToolCallOptions;
  /** Next background-task follow-up prompt, or `null` when the queue is drained. */
  getNextTaskPrompt: () => Promise<string | null>;
}

/**
 * `repairToolCall` under both names the AI SDK accepts.
 *
 * @internal
 */
export interface RepairToolCallOptions {
  repairToolCall: ToolCallRepairFunction<ToolSet>;
  experimental_repairToolCall: ToolCallRepairFunction<ToolSet>;
}

/**
 * Which thread a mode persists to and reports in telemetry.
 *
 * - `fork-aware`: `forkedSessionId ?? threadId` (`generate()`, `stream()`).
 * - `request`: `threadId` as passed (`streamResponse()`, `streamRaw()`,
 *   `streamDataResponse()` — these do not honour `forkSession` for
 *   persistence).
 *
 * @internal
 */
export type CheckpointThreadStrategy = "fork-aware" | "request";

/**
 * Output of {@link GenerationRunner.beginRun}.
 *
 * @internal
 */
export interface RunStart {
  runId: string;
  /** Options after PreGenerate `updatedInput`, with `_runId` set. */
  effectiveGenOptions: GenerateOptions;
  /** Raw `respondWith` value from a PreGenerate hook, if any. */
  cachedResult?: GenerateResult;
}

/**
 * Per-attempt state that does not depend on the streaming writer.
 *
 * @internal
 */
export interface AttemptContext {
  effectiveGenOptions: GenerateOptions;
  currentModel: LanguageModel;
  messages: ModelMessage[];
  checkpoint: Checkpoint | undefined;
  forkedSessionId: string | undefined;
  /** Thread used for checkpoint persistence and telemetry; see {@link CheckpointThreadStrategy}. */
  checkpointThreadId: string | undefined;
  startStep: number;
  maxSteps: number;
  executionBaseTelemetry: ExecutionTelemetry;
}

/**
 * Per-attempt request inputs: tools, prompt and AI SDK params.
 *
 * @internal
 */
export interface PreparedRequest {
  /**
   * Shared signal state: flow-control signals (interrupt) thrown by tools are
   * caught by the outermost wrapper and stored here. A custom stopWhen
   * condition stops generation after the current step completes.
   */
  signalState: GenerateSignalState;
  activeTools: ToolSet;
  systemPrompt: string | undefined;
  initialParams: {
    system: string | undefined;
    messages: ModelMessage[];
    tools: ToolSet;
    maxTokens: GenerateOptions["maxTokens"];
    temperature: GenerateOptions["temperature"];
    stopSequences: GenerateOptions["stopSequences"];
    abortSignal: GenerateOptions["signal"];
    providerOptions: GenerateOptions["providerOptions"];
    headers: GenerateOptions["headers"];
    telemetry: GenerateOptions["telemetry"];
  };
  toolExecutionContext: ToolExecutionContext;
}

/** @internal */
export type PreparedAttempt = AttemptContext & PreparedRequest;

/**
 * Inputs for {@link GenerationRunner.runUIStreamFollowUps}.
 *
 * @internal
 */
export interface UIStreamFollowUpParams {
  writer: UIMessageStreamWriter;
  attempt: AttemptContext;
  /** The initial generation; `text` must already be awaited by the caller. */
  result: ReturnType<typeof streamText>;
  streamingCompaction: StreamingCompactionState;
  signalState: GenerateSignalState;
  /** Set for `streamDataResponse()` so follow-up tools stream through the writer. */
  streamingContext?: StreamingContext;
}

/**
 * The shared generation lifecycle for one agent.
 *
 * @internal
 */
export interface GenerationRunner {
  /** Resolve the run id and apply PreGenerate hooks. */
  beginRun(genOptions: GenerateOptions): Promise<RunStart>;
  /** Attach telemetry to a cached result and run PostGenerate hooks over it. */
  resolveCachedResult(
    cachedResult: GenerateResult,
    effectiveGenOptions: GenerateOptions,
  ): Promise<GenerateResult>;
  /** Fresh retry state for one call, seeded from the agent's model and policy. */
  createRetryState(): RetryLoopState;
  /** Build messages and per-attempt bookkeeping. */
  beginAttempt(
    effectiveGenOptions: GenerateOptions,
    currentModel: LanguageModel,
    checkpointThread: CheckpointThreadStrategy,
  ): Promise<AttemptContext>;
  /** Compose tools, prompt and AI SDK params for an attempt. */
  prepareRequest(
    attempt: AttemptContext,
    request?: { streamingContext?: StreamingContext },
  ): PreparedRequest;
  /** {@link beginAttempt} followed by {@link prepareRequest}. */
  prepareAttempt(
    effectiveGenOptions: GenerateOptions,
    currentModel: LanguageModel,
    checkpointThread: CheckpointThreadStrategy,
  ): Promise<PreparedAttempt>;
  /**
   * The call options shared by `generateText()` and `streamText()`. Callers
   * spread this and add mode-specific callbacks.
   */
  buildModelCallParams(attempt: PreparedAttempt): ModelCallParams;
  /** Forward usage to the context manager, when it tracks usage. */
  updateContextUsage(
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
  ): void;
  /** Emit the `InterruptRequested` hook for a pending interrupt. */
  emitInterruptRequested(
    threadId: string | undefined,
    telemetry: ExecutionTelemetry,
    interrupt: Interrupt,
  ): Promise<void>;
  /**
   * Run PostGenerate hooks. Returns a hook-provided `updatedResult`, which
   * only `generate()` applies (streams have already been sent).
   */
  invokePostGenerate(
    effectiveGenOptions: GenerateOptions,
    telemetry: ExecutionTelemetry,
    result: GenerateResultComplete,
  ): Promise<GenerateResultComplete | undefined>;
  /**
   * `onStepFinish` / `onFinish` for the three Response-shaped modes: keep the
   * durable transcript current, save intermediate checkpoints when
   * `checkpointAfterToolCall` is set, and on finish update usage, persist and
   * run PostGenerate hooks.
   */
  createStreamLifecycleCallbacks(
    attempt: PreparedAttempt,
    streamingCompaction: StreamingCompactionState,
  ): StreamLifecycleCallbacks;
  /** Merge background-task follow-up turns into a UI message stream. */
  runUIStreamFollowUps(params: UIStreamFollowUpParams): Promise<void>;
  /**
   * Decide whether to retry a failed attempt. Resolves with the options for
   * the next attempt after the retry delay, or throws `normalizedError`.
   */
  retryOrThrow(
    normalizedError: AgentError,
    effectiveGenOptions: GenerateOptions,
    retryState: RetryLoopState,
  ): Promise<GenerateOptions>;
}

/**
 * AI SDK call options shared by `generateText()` and `streamText()`.
 *
 * @internal
 */
export interface ModelCallParams extends RepairToolCallOptions {
  model: LanguageModel;
  system: string | undefined;
  messages: ModelMessage[];
  tools: ToolSet;
  maxOutputTokens: GenerateOptions["maxTokens"];
  temperature: GenerateOptions["temperature"];
  stopSequences: GenerateOptions["stopSequences"];
  abortSignal: GenerateOptions["signal"];
  stopWhen: ReturnType<typeof buildStopConditions>;
  output: GenerateOptions["output"];
  // biome-ignore lint/suspicious/noExplicitAny: Type cast needed for AI SDK compatibility
  providerOptions: any;
  headers: GenerateOptions["headers"];
  telemetry: GenerateOptions["telemetry"];
  allowSystemInMessages: true;
}

/** @internal */
export interface StreamLifecycleCallbacks {
  onStepFinish: (stepResult: AiSdkSteps[number]) => Promise<void>;
  onFinish: (finishResult: {
    text: string;
    usage: AiSdkSteps[number]["usage"];
    finishReason: AiSdkSteps[number]["finishReason"];
    steps: AiSdkSteps;
    response?: { modelId?: string };
  }) => Promise<void>;
}

/**
 * Create the generation runner for an agent.
 *
 * @internal
 */
export function createGenerationRunner(deps: GenerationRunnerDeps): GenerationRunner {
  const {
    options,
    hooks: effectiveHooks,
    getAgent,
    toolPipeline,
    checkpoints,
    messageRuntime,
    buildPromptContext,
    getSystemPrompt,
    repairToolCallOptions,
    getNextTaskPrompt,
  } = deps;
  const { buildMessages, createStreamingCompactionState } = messageRuntime;
  const { save: saveCheckpoint } = checkpoints;

  async function beginRun(genOptions: GenerateOptions): Promise<RunStart> {
    const runId = await checkpoints.resolveRunId(genOptions);

    // Invoke unified PreGenerate hooks
    const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
    const preGenResult = await invokePreGenerateHooks<GenerateResult>(
      preGenerateHooks,
      { ...genOptions, _runId: runId },
      getAgent(),
    );

    return {
      runId,
      effectiveGenOptions: { ...preGenResult.effectiveOptions, _runId: runId },
      cachedResult: preGenResult.cachedResult,
    };
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
      getAgent(),
    );
    const updatedResult = extractUpdatedResult<GenerateResultComplete>(hookOutputs);
    return updatedResult
      ? { ...updatedResult, telemetry: updatedResult.telemetry ?? telemetry }
      : result;
  }

  function resolveCachedResult(
    cachedResult: GenerateResult,
    effectiveGenOptions: GenerateOptions,
  ): Promise<GenerateResult> {
    return invokeCachedPostGenerateHooks(cachedResult, effectiveGenOptions, options.model);
  }

  function createRetryState(): RetryLoopState {
    return createRetryLoopState(options.model, options.generationRetryPolicy?.maxRetries);
  }

  async function beginAttempt(
    effectiveGenOptions: GenerateOptions,
    currentModel: LanguageModel,
    checkpointThread: CheckpointThreadStrategy,
  ): Promise<AttemptContext> {
    const { messages, checkpoint, forkedSessionId } = await buildMessages(effectiveGenOptions);
    const maxSteps = options.maxSteps ?? 10;
    const startStep = checkpoint?.step ?? 0;
    const checkpointThreadId =
      checkpointThread === "fork-aware"
        ? (forkedSessionId ?? effectiveGenOptions.threadId)
        : effectiveGenOptions.threadId;
    const executionBaseTelemetry = buildExecutionTelemetryFromIds({
      runId: effectiveGenOptions._runId ?? createRunId(),
      threadId: checkpointThreadId,
      requestedModel: currentModel,
    });

    return {
      effectiveGenOptions,
      currentModel,
      messages,
      checkpoint,
      forkedSessionId,
      checkpointThreadId,
      startStep,
      maxSteps,
      executionBaseTelemetry,
    };
  }

  function prepareRequest(
    attempt: AttemptContext,
    request?: { streamingContext?: StreamingContext },
  ): PreparedRequest {
    const { effectiveGenOptions, currentModel, messages, executionBaseTelemetry } = attempt;

    const signalState: GenerateSignalState = {};

    const activeTools = toolPipeline.buildTools({
      threadId: effectiveGenOptions.threadId,
      telemetry: executionBaseTelemetry,
      signalState,
      streamingContext: request?.streamingContext,
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

    const toolExecutionContext = createToolExecutionContext(options, currentModel);

    return { signalState, activeTools, systemPrompt, initialParams, toolExecutionContext };
  }

  async function prepareAttempt(
    effectiveGenOptions: GenerateOptions,
    currentModel: LanguageModel,
    checkpointThread: CheckpointThreadStrategy,
  ): Promise<PreparedAttempt> {
    const attempt = await beginAttempt(effectiveGenOptions, currentModel, checkpointThread);
    return { ...attempt, ...prepareRequest(attempt) };
  }

  function buildModelCallParams(attempt: PreparedAttempt): ModelCallParams {
    const { effectiveGenOptions, currentModel, maxSteps, signalState, initialParams } = attempt;
    const { toolExecutionContext } = attempt;

    return {
      model: currentModel,
      ...repairToolCallOptions,
      system: initialParams.system,
      messages: projectMessagesForModel(
        initialParams.messages,
        toolExecutionContext.agentSdk.modelCapabilities,
      ),
      tools: wrapToolsWithExecutionContext(initialParams.tools as ToolSet, toolExecutionContext),
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
    };
  }

  function updateContextUsage(
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
  ): void {
    // Update context manager with actual usage if available
    if (options.contextManager?.updateUsage && usage) {
      options.contextManager.updateUsage({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      });
    }
  }

  async function emitInterruptRequested(
    threadId: string | undefined,
    telemetry: ExecutionTelemetry,
    interrupt: Interrupt,
  ): Promise<void> {
    const interruptRequestedHooks = effectiveHooks?.InterruptRequested ?? [];
    if (interruptRequestedHooks.length > 0) {
      const hookInput: InterruptRequestedInput = {
        hook_event_name: "InterruptRequested",
        session_id: threadId ?? "default",
        cwd: process.cwd(),
        telemetry,
        interrupt_id: interrupt.id,
        interrupt_type: interrupt.type,
        tool_call_id: interrupt.toolCallId,
        tool_name: interrupt.toolName,
        request: interrupt.request,
      };
      await invokeHooksWithTimeout(interruptRequestedHooks, hookInput, null, getAgent());
    }
  }

  async function invokePostGenerate(
    effectiveGenOptions: GenerateOptions,
    telemetry: ExecutionTelemetry,
    result: GenerateResultComplete,
  ): Promise<GenerateResultComplete | undefined> {
    const postGenerateHooks = effectiveHooks?.PostGenerate ?? [];
    if (postGenerateHooks.length === 0) {
      return undefined;
    }
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
      getAgent(),
    );
    // Note: hooks can only return complete results, not interrupted ones
    return extractUpdatedResult<GenerateResultComplete>(hookOutputs);
  }

  function createStreamLifecycleCallbacks(
    attempt: PreparedAttempt,
    streamingCompaction: StreamingCompactionState,
  ): StreamLifecycleCallbacks {
    const { effectiveGenOptions, currentModel, startStep, executionBaseTelemetry } = attempt;
    const generationStartTime = Date.now();

    // Track step count for incremental checkpointing.
    let currentStepCount = 0;

    return {
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
        updateContextUsage(finishResult.usage);

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
          requestedModel: currentModel,
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
        // Note: updatedResult is not applied for streaming since the stream has already been sent
        await invokePostGenerate(effectiveGenOptions, telemetry, hookResult);
      },
    };
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
    const retryState = createRetryState();

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
          agent: getAgent(),
          state: retryState,
          fallbackModel: options.fallbackModel,
          retryPolicy: options.generationRetryPolicy,
        });

        if (errorDecision.shouldRetry) {
          if (errorDecision.updatedOptions) {
            // Unlike `retryOrThrow`, the follow-up path does not carry the
            // previous `_runId` forward when a hook omits it.
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

  async function runUIStreamFollowUps(params: UIStreamFollowUpParams): Promise<void> {
    const { writer, attempt, result, streamingCompaction, signalState, streamingContext } = params;
    const { effectiveGenOptions, maxSteps, startStep, executionBaseTelemetry } = attempt;

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
        messages: [...currentMessages, { role: "user" as const, content: followUpPrompt }],
      };
      let followUpStreamingCompaction: StreamingCompactionState | undefined;
      const {
        result: followUpResult,
        effectiveOptions: followUpEffectiveOptions,
        currentModel: followUpModel,
      } = await startRetriedStreamText(followUpRequestOptions, (requestOptions, currentModel) => {
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
        const toolExecutionContext = createToolExecutionContext(options, currentModel);

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
          telemetry: requestOptions.telemetry ?? requestOptions.experimental_telemetry,
          allowSystemInMessages: true,
        });
      });
      const followUpStartTime = Date.now();
      followUpBaseOptions = {
        ...followUpEffectiveOptions,
        _runId: followUpEffectiveOptions._runId ?? followUpBaseOptions._runId,
      };

      writer.merge(followUpResult.toUIMessageStream());
      const followUpText = await followUpResult.text;
      const followUpResponse = await (followUpResult.response ?? Promise.resolve(undefined));

      // --- Post-completion bookkeeping for follow-ups ---
      const followUpSteps = await followUpResult.steps;

      // The follow-up's compaction state is authoritative for the
      // transcript (it may have compacted mid-run).
      currentMessages = followUpStreamingCompaction
        ? followUpStreamingCompaction.finalize(followUpSteps, followUpText)
        : [
            ...currentMessages,
            { role: "user" as const, content: followUpPrompt },
            ...(followUpText ? [{ role: "assistant" as const, content: followUpText }] : []),
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
      updateContextUsage(followUpUsage);

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
        await invokePostGenerate(followUpEffectiveOptions, followUpTelemetry, followUpHookResult);
      }

      followUpPrompt = await getNextTaskPrompt();
    }
  }

  async function retryOrThrow(
    normalizedError: AgentError,
    effectiveGenOptions: GenerateOptions,
    retryState: RetryLoopState,
  ): Promise<GenerateOptions> {
    // Handle error with PostGenerateFailure hooks and fallback logic
    const postGenerateFailureHooks = effectiveHooks?.PostGenerateFailure ?? [];
    const retryDecisionHooks = effectiveHooks?.GenerationRetryDecision ?? [];
    const errorDecision = await handleGenerationError({
      error: normalizedError,
      failureHooks: postGenerateFailureHooks,
      decisionHooks: retryDecisionHooks,
      genOptions: effectiveGenOptions,
      agent: getAgent(),
      state: retryState,
      fallbackModel: options.fallbackModel,
      retryPolicy: options.generationRetryPolicy,
    });

    if (errorDecision.shouldRetry) {
      let nextOptions = effectiveGenOptions;
      if (errorDecision.updatedOptions) {
        nextOptions = {
          ...errorDecision.updatedOptions,
          _runId: errorDecision.updatedOptions._runId ?? effectiveGenOptions._runId,
        };
      }
      // Update retry state
      Object.assign(retryState, updateRetryLoopState(retryState, errorDecision));
      // Wait for the specified delay before retrying
      await waitForRetryDelay(errorDecision.retryDelayMs);
      // Caller continues to the next iteration of its retry loop
      return nextOptions;
    }

    // No retry requested or max retries exceeded - throw the normalized error
    throw normalizedError;
  }

  return {
    beginRun,
    resolveCachedResult,
    createRetryState,
    beginAttempt,
    prepareRequest,
    prepareAttempt,
    buildModelCallParams,
    updateContextUsage,
    emitInterruptRequested,
    invokePostGenerate,
    createStreamLifecycleCallbacks,
    runUIStreamFollowUps,
    retryOrThrow,
  };
}
