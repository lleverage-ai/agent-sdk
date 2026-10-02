/**
 * Generation lifecycle shared by the four response modes.
 *
 * `generate()`, `stream()`, `streamRaw()` and `streamDataResponse()` each own a retry loop and an output shape, but the
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
 *   createStreamLifecycleCallbacks   onStepFinish / onFinish for streamRaw()
 *                       and streamDataResponse()
 *   runUIStreamFollowUps   background-task follow-up turns merged into a
 *                       UI message stream
 *     │
 *   retryOrThrow        PostGenerateFailure / GenerationRetryDecision hooks,
 *                       fallback model, backoff
 *     └────────────────────────────────────────────────────────────────┘
 * ```
 *
 * The modes still differ in places (pending-interrupt persistence,
 * follow-up strategy, …). Those differences are deliberate
 * inputs to this module rather than hidden inside it; see
 * `docs/architecture/generation-modes.md` for the table.
 *
 * Module-scope helpers ({@link createToolExecutionContext}, {@link mapSteps},
 * …) and the capability projection in `./model-capabilities.ts` are pure and
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
import { isContextLogError } from "../context-log/errors.js";
import { createLogModeRetryGuard, invokeLogModePreGenerateHooks } from "../context-log/hooks.js";
import {
  type AgentError,
  ConfigurationError,
  GeneratePermissionDeniedError,
} from "../errors/index.js";
import {
  createRetryLoopState,
  invokePreGenerateHooks,
  normalizeError,
  type RetryLoopState,
  handleGenerationError as sdkHandleGenerationError,
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
import type { LogCallBoundary, LogModePrepareStep } from "./log-boundary.js";
import {
  createLogRunState,
  type LogCallPlan,
  type LogContextRuntime,
  type LogInputScreen,
} from "./log-context.js";
import type { MessageRuntime, StreamingCompactionState } from "./messages.js";
import { projectMessagesForModel, resolveModelInputCapabilities } from "./model-capabilities.js";
import {
  buildStopConditions,
  type GenerateSignalState,
  type ToolPipeline,
  wrapToolsWithExecutionContext,
} from "./tool-pipeline.js";

export { projectMessagesForModel };

// =============================================================================
// Tool execution context
// =============================================================================

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
 * Plain-text `Response` for a cached (`respondWith`) result, used by the
 * `streamDataResponse()` mode. Only complete results carry text.
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
  /**
   * Set when the agent runs in context log mode: requests are projected from
   * the log instead of assembled from checkpoint messages and caller history.
   */
  logContext?: LogContextRuntime;
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
  /**
   * Log mode only: the projected request. `messages` is its projection, which
   * already includes the frozen core and the capability projection.
   */
  logPlan?: LogCallPlan;
  /**
   * Log mode only: the attempt's commit boundary. Every provider call goes
   * through its model; the mode commits the last step with `complete` and
   * calls `abandon` when the attempt fails.
   */
  logCall?: LogCallBoundary;
  /** Thread used for checkpoint persistence and telemetry (the request `threadId`). */
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
  ): Promise<AttemptContext>;
  /**
   * Compose tools, prompt and AI SDK params for an attempt. `request.streamingContext`
   * overrides the caller's `GenerateOptions.streamingContext`; it is how
   * `streamDataResponse()` supplies its own writer.
   */
  prepareRequest(
    attempt: AttemptContext,
    request?: { streamingContext?: StreamingContext },
  ): PreparedRequest;
  /** {@link beginAttempt} followed by {@link prepareRequest}. */
  prepareAttempt(
    effectiveGenOptions: GenerateOptions,
    currentModel: LanguageModel,
  ): Promise<PreparedAttempt>;
  /**
   * The call options shared by `generateText()` and `streamText()`. Callers
   * spread this and add mode-specific callbacks.
   */
  buildModelCallParams(attempt: PreparedAttempt): ModelCallParams;
  /**
   * The `prepareStep` for a streaming attempt: the log-mode step projection
   * in log mode, otherwise the streaming compaction's own `prepareStep`.
   */
  prepareStepFor(
    attempt: PreparedAttempt,
    compactionPrepareStep: StreamingCompactionState["prepareStep"],
  ): StreamingCompactionState["prepareStep"] | LogModePrepareStep;
  /** Forward per-request usage, excluding isolated summarisation calls. */
  updateContextUsage(
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
    genOptions?: Pick<GenerateOptions, "_skipCompaction">,
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
   * `onStepFinish` / `onFinish` for `streamRaw()` and `streamDataResponse()`:
   * keep the durable transcript current, and on finish update usage, save the
   * checkpoint once and run PostGenerate hooks.
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
    attempt?: { logCall?: LogCallBoundary },
  ): Promise<GenerateOptions>;
}

export type { LogModePrepareStep };

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
  /**
   * Log mode only: commits each step's outputs and projects tool-loop
   * continuations through the adapter.
   */
  prepareStep?: LogModePrepareStep;
  /** Log mode only: lets the boundary see each finished step. */
  onStepFinish?: (step: { response: { messages: ModelMessage[] } }) => void;
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
    logContext,
  } = deps;
  const { buildMessages, createStreamingCompactionState } = messageRuntime;
  const { save: saveCheckpoint } = checkpoints;

  /**
   * Turn `_historyUnlessCheckpointed` into ordinary input before PreGenerate.
   *
   * Uses the agent's effective (cached) checkpoint load, the one message
   * assembly uses. With a checkpoint the fallback is dropped, because the
   * checkpoint already holds that history; without one it is placed before
   * `messages`, so PreGenerate hooks (redaction, guardrails) see and can
   * transform or deny it like any other input.
   */
  async function resolveHistoryFallback(
    genOptions: GenerateOptions,
  ): Promise<{ options: GenerateOptions; loaded?: GenerateOptions["_checkpointSnapshot"] }> {
    const { _historyUnlessCheckpointed: history, ...rest } = genOptions;
    if (history === undefined) {
      return { options: genOptions };
    }
    const checkpoint = rest.threadId ? await checkpoints.load(rest.threadId) : undefined;
    const loaded = rest.threadId ? { threadId: rest.threadId, checkpoint } : undefined;
    if (checkpoint || history.length === 0) {
      return { options: rest, loaded };
    }
    return { options: { ...rest, messages: [...history, ...(rest.messages ?? [])] }, loaded };
  }

  /**
   * Log-mode {@link beginRun}. Caller history is rejected and the checkpoint
   * fallback does not apply. The PreGenerate hooks do not run here: each
   * attempt runs them on its own head snapshot, over the new user input and
   * the producers' output, before anything is committed (see `plan`).
   */
  async function beginLogModeRun(
    requestedOptions: GenerateOptions,
    log: LogContextRuntime,
  ): Promise<RunStart> {
    const genOptions = log.prepareRunInput(requestedOptions);
    const runId = await checkpoints.resolveRunId(genOptions);
    return {
      runId,
      effectiveGenOptions: {
        ...log.acceptRunInput(genOptions),
        _runId: runId,
        // Fresh for every run, including a follow-up that spreads the
        // previous run's options; shared by the run's retries.
        _logRun: createLogRunState(runId),
      },
    };
  }

  /**
   * Log mode: the PreGenerate hooks, run one after another over new entries
   * only (the run's user input, producer output, or a step's outputs). They
   * may redact them, change operational options or deny the call; anything
   * else is a `log_mode_hook_violation`.
   */
  const screenLogInput: LogInputScreen = (screenOptions, pending) =>
    invokeLogModePreGenerateHooks({
      hooks: effectiveHooks?.PreGenerate ?? [],
      options: screenOptions,
      pending,
      agent: getAgent(),
    });

  async function beginRun(requestedOptions: GenerateOptions): Promise<RunStart> {
    if (logContext) {
      return beginLogModeRun(requestedOptions, logContext);
    }
    if (requestedOptions.contextStream !== undefined) {
      throw new ConfigurationError(
        'contextStream only applies in context log mode; set contextLog: { mode: "log" } on the agent',
        { configKey: "contextStream" },
      );
    }
    // A snapshot belongs to one run. Follow-up generations spread the previous
    // run's options after its checkpoint was saved, so never reuse one.
    const { _checkpointSnapshot: _previousRunSnapshot, ...freshOptions } = requestedOptions;
    // One checkpoint load serves the fallback decision, the run id and (via
    // `_checkpointSnapshot`) message assembly, so they cannot disagree.
    const { options: genOptions, loaded } = await resolveHistoryFallback(freshOptions);
    const runId = await checkpoints.resolveRunId(genOptions, loaded);

    // Invoke unified PreGenerate hooks
    const preGenerateHooks = effectiveHooks?.PreGenerate ?? [];
    const preGenResult = await invokePreGenerateHooks<GenerateResult>(
      preGenerateHooks,
      { ...genOptions, _runId: runId },
      getAgent(),
    );

    return {
      runId,
      effectiveGenOptions: {
        ...preGenResult.effectiveOptions,
        _runId: runId,
        ...(loaded && { _checkpointSnapshot: loaded }),
      },
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

  async function handleGenerationError(input: Parameters<typeof sdkHandleGenerationError>[0]) {
    // No retry hook, fallback or replacement request may overlap abandoned children.
    await getAgent().taskManager.settleOwnedTasks("SDK generation failed", true);
    return sdkHandleGenerationError(input);
  }

  function createRetryState(): RetryLoopState {
    return createRetryLoopState(options.model, options.generationRetryPolicy?.maxRetries);
  }

  /** Log mode: control state from the checkpoint, the request from the log. */
  async function buildLogModeMessages(
    effectiveGenOptions: GenerateOptions,
    currentModel: LanguageModel,
    log: LogContextRuntime,
  ): Promise<{
    messages: ModelMessage[];
    checkpoint?: Checkpoint;
    logPlan: LogCallPlan;
    logCall: LogCallBoundary;
  }> {
    const checkpoint = effectiveGenOptions.threadId
      ? await checkpoints.load(effectiveGenOptions.threadId)
      : undefined;
    const logPlan = await log.plan(effectiveGenOptions, currentModel, screenLogInput);
    const logCall = log.createCall(logPlan, currentModel, screenLogInput);
    return { messages: logPlan.messages, checkpoint, logPlan, logCall };
  }

  async function beginAttempt(
    effectiveGenOptions: GenerateOptions,
    currentModel: LanguageModel,
  ): Promise<AttemptContext> {
    const { messages, checkpoint, logPlan, logCall } = logContext
      ? await buildLogModeMessages(effectiveGenOptions, currentModel, logContext)
      : { ...(await buildMessages(effectiveGenOptions)), logPlan: undefined, logCall: undefined };
    const maxSteps = options.maxSteps ?? 10;
    const startStep = checkpoint?.step ?? 0;
    const checkpointThreadId = effectiveGenOptions.threadId;
    // Log mode: the attempt runs with the options the PreGenerate hooks left
    // (operational changes only), and keeps the run's own shared state.
    const attemptOptions: GenerateOptions = logPlan
      ? {
          ...logPlan.options,
          ...(effectiveGenOptions._logRun && { _logRun: effectiveGenOptions._logRun }),
        }
      : effectiveGenOptions;
    const executionBaseTelemetry = buildExecutionTelemetryFromIds({
      runId: effectiveGenOptions._runId ?? createRunId(),
      threadId: checkpointThreadId,
      requestedModel: currentModel,
    });

    return {
      effectiveGenOptions: attemptOptions,
      currentModel,
      messages,
      checkpoint,
      ...(logPlan && { logPlan }),
      ...(logCall && { logCall }),
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

    // A mode that owns a writer (`streamDataResponse`) passes its context
    // explicitly; every other mode uses the caller's request-local one.
    const streamingContext = request?.streamingContext ?? effectiveGenOptions.streamingContext;
    const activeTools = toolPipeline.buildTools({
      threadId: effectiveGenOptions.threadId,
      signal: effectiveGenOptions.signal,
      telemetry: executionBaseTelemetry,
      signalState,
      streamingContext,
    });

    // Build prompt context and generate system prompt. In log mode the
    // projected messages already carry the version's frozen core.
    const systemPrompt = attempt.logPlan
      ? undefined
      : getSystemPrompt(
          buildPromptContext(effectiveGenOptions, messages, effectiveGenOptions.threadId),
        );

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
  ): Promise<PreparedAttempt> {
    const attempt = await beginAttempt(effectiveGenOptions, currentModel);
    return { ...attempt, ...prepareRequest(attempt) };
  }

  /**
   * Log mode: the first step sends the planned projection; before every later
   * step of the tool loop the boundary commits the previous step's outputs,
   * then projects the step from the plan's entries plus the committed
   * outputs, so no provider request bypasses the adapter, the version's
   * contract or the commit.
   */
  function prepareStepFor(
    attempt: PreparedAttempt,
    compactionPrepareStep: StreamingCompactionState["prepareStep"],
  ): StreamingCompactionState["prepareStep"] | LogModePrepareStep {
    return attempt.logCall ? attempt.logCall.prepareStep : compactionPrepareStep;
  }

  function buildModelCallParams(attempt: PreparedAttempt): ModelCallParams {
    const { effectiveGenOptions, currentModel, maxSteps, signalState, initialParams } = attempt;
    const { toolExecutionContext } = attempt;

    return {
      // Log mode: the boundary wraps the terminal model, so every provider
      // call (each step and each AI SDK retry) is committed before dispatch.
      model: attempt.logCall ? attempt.logCall.model : currentModel,
      ...repairToolCallOptions,
      system: initialParams.system,
      // Log mode: the projection adapter already applied the capability
      // projection recorded in the version's contract.
      messages: attempt.logPlan
        ? initialParams.messages
        : projectMessagesForModel(
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
      ...(attempt.logCall && {
        prepareStep: attempt.logCall.prepareStep,
        onStepFinish: attempt.logCall.onStepFinish,
      }),
    };
  }

  function updateContextUsage(
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
    genOptions?: Pick<GenerateOptions, "_skipCompaction">,
  ): void {
    // Summariser requests must not seed the active conversation's budget.
    if (options.contextManager?.updateUsage && usage && !genOptions?._skipCompaction) {
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

    return {
      // Keep the message base current for the save in `onFinish`. Like every
      // other generation mode, the stream saves the checkpoint once.
      onStepFinish: async (stepResult) => {
        attempt.logCall?.onStepFinish(stepResult);
        streamingCompaction.appendStep(stepResult);
      },
      // Save checkpoint and invoke unified PostGenerate hook after completion
      onFinish: async (finishResult) => {
        if (attempt.logCall) {
          // The AI SDK swallows errors thrown here, so close the call on
          // failure rather than leave it for the next prepare.
          try {
            effectiveGenOptions.signal?.throwIfAborted();
            await attempt.logCall.complete(finishResult.steps);
          } catch (error) {
            await attempt.logCall.abandon(effectiveGenOptions.signal?.aborted);
            throw error;
          }
        }
        effectiveGenOptions.signal?.throwIfAborted();
        updateContextUsage(
          finishResult.steps.at(-1)?.usage ?? finishResult.usage,
          effectiveGenOptions,
        );

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

  /**
   * Log mode: each background follow-up is a run of its own on the same
   * stream. Its prompt passes PreGenerate (redaction, guardrails) as new user
   * input, and its request is planned, projected and committed through a
   * boundary like any other attempt. Like legacy follow-ups, only failures
   * while starting the stream are retried.
   */
  async function runLogModeUIStreamFollowUps(params: UIStreamFollowUpParams): Promise<void> {
    const { writer, attempt: initialAttempt, result: initialResult, streamingContext } = params;
    // The initial turn's outputs are committed before any follow-up plans.
    await initialAttempt.logCall?.complete(await initialResult.steps);

    let followUpPrompt = await getNextTaskPrompt();
    while (followUpPrompt !== null) {
      const {
        messages: _previousInput,
        _logRun: _previousRun,
        ...base
      } = initialAttempt.effectiveGenOptions;
      const run = await beginRun({
        ...base,
        requestClass: "background",
        prompt: followUpPrompt,
      });

      let requestOptions = run.effectiveGenOptions;
      const retryState = createRetryState();
      let started:
        | {
            attempt: PreparedAttempt;
            result: ReturnType<typeof streamText>;
            /** Settles when the stream's onFinish (checkpoint save, PostGenerate) is done. */
            finished: Promise<void>;
          }
        | undefined;
      while (!started) {
        let logCall: LogCallBoundary | undefined;
        try {
          const attemptContext = await beginAttempt(requestOptions, retryState.currentModel);
          logCall = attemptContext.logCall;
          const attempt: PreparedAttempt = {
            ...attemptContext,
            ...prepareRequest(attemptContext, { streamingContext }),
          };
          const streamingCompaction = createStreamingCompactionState(
            attempt.initialParams.messages,
            requestOptions,
            requestOptions.threadId,
          );
          const lifecycle = createStreamLifecycleCallbacks(attempt, streamingCompaction);
          let settleFinished = () => {};
          const finished = new Promise<void>((resolve) => {
            settleFinished = resolve;
          });
          const result = streamText({
            ...buildModelCallParams(attempt),
            prepareStep: prepareStepFor(attempt, streamingCompaction.prepareStep),
            onStepFinish: lifecycle.onStepFinish,
            onFinish: async (finishResult) => {
              try {
                await lifecycle.onFinish(finishResult);
              } finally {
                settleFinished();
              }
            },
          });
          started = { attempt, result, finished };
        } catch (error) {
          await logCall?.abandon(requestOptions.signal?.aborted);
          requestOptions = await retryOrThrow(
            normalizeError(error, "Stream generation failed", requestOptions.threadId),
            requestOptions,
            retryState,
          );
        }
      }

      const { attempt, result, finished } = started;
      try {
        writer.merge(result.toUIMessageStream());
        await result.text;
        attempt.effectiveGenOptions.signal?.throwIfAborted();
        await attempt.logCall?.complete(await result.steps);
      } catch (error) {
        await attempt.logCall?.abandon(attempt.effectiveGenOptions.signal?.aborted);
        throw error;
      }
      // The stream's onFinish saves the checkpoint after the result resolves.
      // Wait for it, so neither an interrupt stamp nor the next follow-up can
      // race that save.
      await finished;

      // A follow-up's tool can raise an interrupt or stop the run, like the
      // initial turn's: persist and announce it, and run no further turns.
      const { signalState } = attempt;
      if (signalState.interrupt) {
        const threadId = attempt.effectiveGenOptions.threadId;
        const interrupt = signalState.interrupt.interrupt;
        if (threadId && options.checkpointer) {
          await checkpoints.markPendingInterrupt(
            threadId,
            interrupt,
            attempt.executionBaseTelemetry.runId,
          );
        }
        await emitInterruptRequested(threadId, attempt.executionBaseTelemetry, interrupt);
        return;
      }
      if (signalState.stop) {
        return;
      }

      followUpPrompt = await getNextTaskPrompt();
    }
  }

  async function runUIStreamFollowUps(params: UIStreamFollowUpParams): Promise<void> {
    if (logContext) {
      await runLogModeUIStreamFollowUps(params);
      return;
    }
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
          signal: requestOptions.signal,
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

      // Like the initial turn, a cancelled follow-up cannot publish a late save.
      followUpEffectiveOptions.signal?.throwIfAborted();
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
      updateContextUsage(followUpSteps.at(-1)?.usage ?? followUpUsage, followUpEffectiveOptions);

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

  /** Log-mode failures no retry can fix. */
  function isFinalLogModeFailure(error: AgentError): boolean {
    return (
      error instanceof GeneratePermissionDeniedError ||
      isContextLogError(error, "invalid") ||
      isContextLogError(error, "refused")
    );
  }

  async function retryOrThrow(
    normalizedError: AgentError,
    effectiveGenOptions: GenerateOptions,
    retryState: RetryLoopState,
    attempt?: { logCall?: LogCallBoundary },
  ): Promise<GenerateOptions> {
    // Handle error with PostGenerateFailure hooks and fallback logic
    const postGenerateFailureHooks = effectiveHooks?.PostGenerateFailure ?? [];
    const retryDecisionHooks = effectiveHooks?.GenerationRetryDecision ?? [];
    // Log mode: a retry resends the run's committed input, so retry hooks and
    // policies may only change operational options. The guard snapshots the
    // options before they run and hands them an isolated copy, so changes
    // made in place are caught as well as returned ones.
    const retryGuard = logContext ? createLogModeRetryGuard(effectiveGenOptions) : undefined;
    const errorDecision = await handleGenerationError({
      error: normalizedError,
      failureHooks: postGenerateFailureHooks,
      decisionHooks: retryDecisionHooks,
      genOptions: retryGuard?.options ?? effectiveGenOptions,
      agent: getAgent(),
      state: retryState,
      fallbackModel: options.fallbackModel,
      retryPolicy: options.generationRetryPolicy,
    });

    // Log mode: a denial, a hook violation or an admit refusal is not
    // transient. Retrying would only repeat it, and after a step's outputs
    // were blocked it would re-run the model and its tools. The hooks above
    // still observe the failure.
    // Nor is a failure after the attempt's call was committed (for example a
    // checkpoint save or a PostGenerate hook): a retry would run the model
    // and its tools again and append a second reply.
    if (
      errorDecision.shouldRetry &&
      logContext &&
      (isFinalLogModeFailure(normalizedError) || attempt?.logCall?.isCompleted())
    ) {
      throw normalizedError;
    }

    if (errorDecision.shouldRetry) {
      let nextOptions = effectiveGenOptions;
      const updatedOptions = retryGuard
        ? retryGuard.accept(errorDecision.updatedOptions)
        : errorDecision.updatedOptions;
      if (updatedOptions) {
        nextOptions = {
          ...updatedOptions,
          _runId: updatedOptions._runId ?? effectiveGenOptions._runId,
          _checkpointSnapshot:
            updatedOptions._checkpointSnapshot ?? effectiveGenOptions._checkpointSnapshot,
          // Log mode: the run's input keys and call numbering are the run's,
          // never a hook's (the retry guard hands hooks a copy).
          ...(effectiveGenOptions._logRun && { _logRun: effectiveGenOptions._logRun }),
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
    prepareStepFor,
    updateContextUsage,
    emitInterruptRequested,
    invokePostGenerate,
    createStreamLifecycleCallbacks,
    runUIStreamFollowUps,
    retryOrThrow,
  };
}
