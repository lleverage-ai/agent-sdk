/**
 * Shared helpers for generation methods (generate, stream, streamResponse, etc.)
 *
 * These helpers extract common retry/hook handling patterns to ensure consistent
 * behavior across all generation methods and reduce code duplication.
 *
 * @packageDocumentation
 * @internal
 */

import type { LanguageModel } from "ai";
import { AgentError, GeneratePermissionDeniedError, wrapError } from "./errors/index.js";
import {
  aggregatePermissionDecisions,
  extractRespondWith,
  extractRetryDecision,
  extractUpdatedInput,
  invokeHooksWithTimeout,
} from "./hooks.js";
import { buildExecutionTelemetryFromIds } from "./observability/execution-metadata.js";
import type {
  Agent,
  GenerateOptions,
  GenerateResult,
  GenerationFailureClassification,
  GenerationRecoveryContext,
  GenerationRecoveryResult,
  GenerationRequestClass,
  GenerationRetryDecisionInput,
  GenerationRetryPolicy,
  HookCallback,
  PostGenerateFailureInput,
  PreGenerateInput,
} from "./types.js";

/**
 * Default maximum number of retry attempts for generation methods.
 * @internal
 */
export const DEFAULT_MAX_RETRIES = 10;

const DEFAULT_REQUEST_CLASS = "foreground" satisfies GenerationRequestClass;

const DEFAULT_FAILURE_CLASSIFICATION: GenerationFailureClassification = {
  type: "unknown",
  subtype: "unknown",
  retryable: false,
};

function isRetryableFailureType(type: GenerationFailureClassification["type"]): boolean {
  return type === "overload" || type === "transport" || type === "context_overflow";
}

/**
 * State for the retry loop used by generation methods.
 * @internal
 */
export interface RetryLoopState {
  /** Current retry attempt (0 = first attempt) */
  retryAttempt: number;
  /** Maximum number of retries allowed */
  maxRetries: number;
  /** Current model being used (may change to fallback) */
  currentModel: LanguageModel;
  /** Whether fallback model has been used */
  usedFallback: boolean;
  /** Consecutive overload failures observed so far */
  consecutiveOverloadCount: number;
  /** Number of context-overflow retries already attempted */
  contextOverflowRetryCount: number;
}

/**
 * Result of invoking PreGenerate hooks.
 * @internal
 */
export interface PreGenerateHookResult<T = GenerateResult> {
  /** Effective options after hook transformations */
  effectiveOptions: GenerateOptions;
  /** Cached result from respondWith (if provided by a hook) */
  cachedResult?: T;
}

/**
 * Decision from error handling (PostGenerateFailure hooks + retry policy).
 * @internal
 */
export interface ErrorHandlingDecision {
  /** Whether to retry the operation */
  shouldRetry: boolean;
  /** Delay in ms before retrying (0 if no delay) */
  retryDelayMs: number;
  /** Updated model to use (if switched to fallback) */
  updatedModel?: LanguageModel;
  /** Updated generation options to use on the next attempt */
  updatedOptions?: GenerateOptions;
  /** Whether fallback was just activated */
  activatedFallback?: boolean;
  /** Request class used for the decision */
  requestClass: GenerationRequestClass;
  /** Failure classification used for the decision */
  classification: GenerationFailureClassification;
  /** Final retry outcome */
  outcome: "retry" | "fallback" | "fail";
  /** Source that produced the decision */
  source: "hooks" | "policy" | "none";
}

/**
 * Parameters for generation error handling.
 * @internal
 */
export interface HandleGenerationErrorParams {
  error: AgentError;
  failureHooks: HookCallback[];
  decisionHooks?: HookCallback[];
  genOptions: GenerateOptions;
  agent: Agent;
  state: RetryLoopState;
  fallbackModel?: LanguageModel;
  retryPolicy?: GenerationRetryPolicy;
}

/**
 * Creates initial state for the retry loop.
 *
 * @param model - The primary model to use
 * @param maxRetries - Maximum retry attempts (default: 10)
 * @returns Initial retry loop state
 *
 * @internal
 */
export function createRetryLoopState(
  model: LanguageModel,
  maxRetries: number = DEFAULT_MAX_RETRIES,
): RetryLoopState {
  return {
    retryAttempt: 0,
    maxRetries,
    currentModel: model,
    usedFallback: false,
    consecutiveOverloadCount: 0,
    contextOverflowRetryCount: 0,
  };
}

/**
 * Invokes PreGenerate hooks and returns the effective options.
 *
 * This handles:
 * - Cache short-circuit via respondWith
 * - Input transformation via updatedInput
 *
 * @param hooks - PreGenerate hook callbacks
 * @param genOptions - Original generation options
 * @param agent - The agent instance
 * @returns Result containing effective options and optional cached result
 *
 * @internal
 */
export async function invokePreGenerateHooks<T = GenerateResult>(
  hooks: HookCallback[],
  genOptions: GenerateOptions,
  agent: Agent,
): Promise<PreGenerateHookResult<T>> {
  if (hooks.length === 0) {
    return { effectiveOptions: genOptions };
  }

  const preGenerateInput: PreGenerateInput = {
    hook_event_name: "PreGenerate",
    session_id: genOptions.threadId ?? "default",
    cwd: process.cwd(),
    telemetry: buildExecutionTelemetryFromIds({
      runId: genOptions._runId ?? "run_unknown",
      threadId: genOptions.threadId,
      requestedModel: agent.options.model,
    }),
    options: genOptions,
  };

  const hookOutputs = await invokeHooksWithTimeout(hooks, preGenerateInput, null, agent);

  // Check for permission denial (e.g., guardrails blocking input)
  const permissionDecision = aggregatePermissionDecisions(hookOutputs);
  if (permissionDecision === "deny") {
    const denyingOutput = hookOutputs.find(
      (o) => o.hookSpecificOutput?.permissionDecision === "deny",
    )?.hookSpecificOutput;

    const reason = denyingOutput?.permissionDecisionReason;
    const blockedMessageIds = denyingOutput?.blockedMessageIds;

    throw new GeneratePermissionDeniedError("Generation denied by hook", {
      reason,
      blockedMessageIds,
    });
  }

  const cachedResult = extractRespondWith<T>(hookOutputs);
  if (cachedResult !== undefined) {
    return { effectiveOptions: genOptions, cachedResult };
  }

  const updatedOptions = extractUpdatedInput<GenerateOptions>(hookOutputs);
  const effectiveOptions = updatedOptions !== undefined ? updatedOptions : genOptions;

  return { effectiveOptions };
}

/**
 * Normalizes an error to an AgentError.
 *
 * @param error - The error to normalize
 * @param defaultMessage - Default message if error doesn't have one
 * @param threadId - Optional thread ID for metadata
 * @returns Normalized AgentError
 *
 * @internal
 */
export function normalizeError(
  error: unknown,
  defaultMessage: string,
  threadId?: string,
): AgentError {
  if (AgentError.is(error)) {
    return error;
  }

  return wrapError(error, error instanceof Error ? error.message : defaultMessage, {
    metadata: threadId ? { threadId } : undefined,
  });
}

function getMessageVariants(error: Error): string[] {
  const messages = [error.message];
  if ("cause" in error && error.cause instanceof Error) {
    messages.push(error.cause.message);
  }
  return messages.map((value) => value.toLowerCase());
}

function includesAny(values: string[], patterns: string[]): boolean {
  return values.some((value) => patterns.some((pattern) => value.includes(pattern)));
}

function classifyGenerationFailure(
  error: AgentError,
  retryPolicy?: GenerationRetryPolicy,
): GenerationFailureClassification {
  const override = retryPolicy?.classifyFailure?.(error);
  if (override) {
    if (typeof override === "string") {
      return {
        type: override,
        subtype: "unknown",
        retryable: isRetryableFailureType(override),
      };
    }
    return override;
  }

  const messages = getMessageVariants(error);

  if (
    includesAny(messages, [
      "context length",
      "context_length",
      "token limit",
      "maximum context",
      "max tokens",
      "context size",
      "context window",
      "prompt too long",
      "input too long",
      "request too large",
    ])
  ) {
    return {
      type: "context_overflow",
      subtype: "context_length",
      retryable: true,
    };
  }

  const looksLikeAuthorization = includesAny(messages, [
    "403",
    "forbidden",
    "permission denied",
    "authorization",
    "authorisation",
    "authz",
  ]);

  if (
    (error.code === "AUTHENTICATION_ERROR" && !looksLikeAuthorization) ||
    includesAny(messages, [
      "401",
      "unauthorized",
      "invalid api key",
      "invalid auth",
      "authentication",
    ])
  ) {
    return {
      type: "authentication",
      subtype: "invalid_auth",
      retryable: false,
    };
  }

  if (error.code === "AUTHORIZATION_ERROR" || looksLikeAuthorization) {
    return {
      type: "authorization",
      subtype: "forbidden",
      retryable: false,
    };
  }

  if (
    error.code === "RATE_LIMIT_ERROR" ||
    includesAny(messages, ["rate limit", "429", "overloaded", "overload"])
  ) {
    return {
      type: "overload",
      subtype: "rate_limit",
      retryable: true,
    };
  }

  if (error.code === "TIMEOUT_ERROR" || includesAny(messages, ["timeout", "timed out"])) {
    return {
      type: "overload",
      subtype: "timeout",
      retryable: true,
    };
  }

  if (
    includesAny(messages, [
      "503",
      "502",
      "504",
      "service unavailable",
      "model unavailable",
      "temporarily unavailable",
      "unavailable",
    ])
  ) {
    return {
      type: "overload",
      subtype: "model_unavailable",
      retryable: true,
    };
  }

  if (
    error.code === "NETWORK_ERROR" ||
    includesAny(messages, [
      "econnreset",
      "epipe",
      "socket hang up",
      "broken pipe",
      "connection reset",
      "connection closed",
      "stale socket",
      "stale connection",
      "network",
      "fetch failed",
      "econnrefused",
      "etimedout",
    ])
  ) {
    const staleTransport = includesAny(messages, [
      "econnreset",
      "epipe",
      "socket hang up",
      "broken pipe",
      "connection reset",
      "connection closed",
      "stale socket",
      "stale connection",
    ]);

    return {
      type: "transport",
      subtype: staleTransport ? "stale_socket" : "network",
      retryable: true,
    };
  }

  return DEFAULT_FAILURE_CLASSIFICATION;
}

function resolveRequestClass(
  genOptions: GenerateOptions,
  retryPolicy?: GenerationRetryPolicy,
): GenerationRequestClass {
  return genOptions.requestClass ?? retryPolicy?.defaultRequestClass ?? DEFAULT_REQUEST_CLASS;
}

function normalizeRecoveryResult(
  value: boolean | undefined | GenerationRecoveryResult,
): GenerationRecoveryResult | undefined {
  if (value === true) {
    return { retry: true };
  }
  if (value && typeof value === "object") {
    return value;
  }
  return undefined;
}

async function runRecoveryHandler(
  handler:
    | GenerationRetryPolicy["onAuthenticationFailure"]
    | GenerationRetryPolicy["onTransportFailure"],
  context: GenerationRecoveryContext,
): Promise<GenerationRecoveryResult | undefined> {
  if (!handler) {
    return undefined;
  }

  return normalizeRecoveryResult(await handler(context));
}

function resolveContextOverflowOptions(
  genOptions: GenerateOptions,
  retryPolicy: GenerationRetryPolicy,
  state: RetryLoopState,
): GenerateOptions | undefined {
  const contextPolicy = retryPolicy.contextOverflow;
  if (!contextPolicy) {
    return undefined;
  }

  const maxAttempts = Math.max(0, contextPolicy.maxAttempts ?? 1);
  if (state.contextOverflowRetryCount >= maxAttempts) {
    return undefined;
  }

  const reductionFactor = contextPolicy.reductionFactor ?? 0.5;
  const minMaxTokens = contextPolicy.minMaxTokens ?? 256;
  const currentMaxTokens = genOptions.maxTokens ?? contextPolicy.fallbackMaxTokens;

  if (currentMaxTokens === undefined) {
    return undefined;
  }

  const reducedMaxTokens = Math.max(minMaxTokens, Math.floor(currentMaxTokens * reductionFactor));

  if (reducedMaxTokens >= currentMaxTokens) {
    return undefined;
  }

  return {
    ...genOptions,
    maxTokens: reducedMaxTokens,
  };
}

function buildOverloadDecision(
  error: AgentError,
  state: RetryLoopState,
  requestClass: GenerationRequestClass,
  classification: GenerationFailureClassification,
  fallbackModel: LanguageModel | undefined,
  retryPolicy: GenerationRetryPolicy | undefined,
  updatedOptions?: GenerateOptions,
): ErrorHandlingDecision {
  const requestClassPolicy =
    retryPolicy?.requestClasses?.[requestClass] ??
    retryPolicy?.requestClasses?.[DEFAULT_REQUEST_CLASS] ??
    undefined;
  const maxConsecutiveOverloadRetries = Math.max(
    0,
    requestClassPolicy?.maxConsecutiveOverloadRetries ?? 0,
  );
  const nextConsecutiveOverloadCount = state.consecutiveOverloadCount + 1;

  if (
    nextConsecutiveOverloadCount <= maxConsecutiveOverloadRetries &&
    state.retryAttempt < state.maxRetries
  ) {
    return {
      shouldRetry: true,
      retryDelayMs: requestClassPolicy?.retryDelayMs ?? error.retryAfterMs ?? 0,
      updatedOptions,
      requestClass,
      classification,
      outcome: "retry",
      source: "policy",
    };
  }

  if (
    fallbackModel &&
    !state.usedFallback &&
    requestClassPolicy?.fallbackOnOverloadExhaustion !== false &&
    state.retryAttempt < state.maxRetries
  ) {
    return {
      shouldRetry: true,
      retryDelayMs: 0,
      updatedModel: fallbackModel,
      updatedOptions,
      activatedFallback: true,
      requestClass,
      classification,
      outcome: "fallback",
      source: "policy",
    };
  }

  return {
    shouldRetry: false,
    retryDelayMs: 0,
    requestClass,
    classification,
    outcome: "fail",
    source: "none",
  };
}

async function emitRetryDecisionHooks(
  hooks: HookCallback[] | undefined,
  agent: Agent,
  genOptions: GenerateOptions,
  error: AgentError,
  state: RetryLoopState,
  decision: ErrorHandlingDecision,
): Promise<void> {
  if (!hooks || hooks.length === 0) {
    return;
  }

  const nextConsecutiveOverloadCount =
    decision.classification.type === "overload" ? state.consecutiveOverloadCount + 1 : 0;

  const input: GenerationRetryDecisionInput = {
    hook_event_name: "GenerationRetryDecision",
    session_id: genOptions.threadId ?? "default",
    cwd: process.cwd(),
    telemetry: buildExecutionTelemetryFromIds({
      runId: genOptions._runId ?? "run_unknown",
      threadId: genOptions.threadId,
      requestedModel: state.currentModel,
    }),
    options: genOptions,
    error,
    requestClass: decision.requestClass,
    failureClassification: decision.classification,
    retryAttempt: state.retryAttempt,
    consecutiveOverloadCount: nextConsecutiveOverloadCount,
    decision: decision.outcome,
    decisionSource: decision.source,
    retryDelayMs: decision.retryDelayMs,
  };

  await invokeHooksWithTimeout(hooks, input, null, agent, 60000, state.retryAttempt);
}

/**
 * Handles errors during generation by invoking PostGenerateFailure hooks,
 * applying request-class-aware retry policy, and emitting retry decisions.
 *
 * @internal
 */
export async function handleGenerationError({
  error,
  failureHooks,
  decisionHooks = [],
  genOptions,
  agent,
  state,
  fallbackModel,
  retryPolicy,
}: HandleGenerationErrorParams): Promise<ErrorHandlingDecision> {
  let requestClass = resolveRequestClass(genOptions, retryPolicy);
  const classification = classifyGenerationFailure(error, retryPolicy);
  const currentConsecutiveOverloadCount =
    classification.type === "overload" ? state.consecutiveOverloadCount + 1 : 0;

  let updatedOptions = genOptions;
  let decision: ErrorHandlingDecision = {
    shouldRetry: false,
    retryDelayMs: 0,
    requestClass,
    classification,
    outcome: "fail",
    source: "none",
  };

  if (failureHooks.length > 0) {
    const failureInput: PostGenerateFailureInput = {
      hook_event_name: "PostGenerateFailure",
      session_id: genOptions.threadId ?? "default",
      cwd: process.cwd(),
      telemetry: buildExecutionTelemetryFromIds({
        runId: genOptions._runId ?? "run_unknown",
        threadId: genOptions.threadId,
        requestedModel: state.currentModel,
      }),
      options: genOptions,
      error,
      requestClass,
      failureClassification: classification,
      consecutiveOverloadCount: currentConsecutiveOverloadCount,
    };

    const hookOutputs = await invokeHooksWithTimeout(
      failureHooks,
      failureInput,
      null,
      agent,
      60000,
      state.retryAttempt,
    );

    updatedOptions = extractUpdatedInput<GenerateOptions>(hookOutputs) ?? genOptions;
    requestClass = resolveRequestClass(updatedOptions, retryPolicy);

    const retryDecision = extractRetryDecision(hookOutputs);
    if (retryDecision && state.retryAttempt < state.maxRetries) {
      decision = {
        shouldRetry: true,
        retryDelayMs: retryDecision.retryDelayMs,
        updatedOptions,
        requestClass,
        classification,
        outcome: "retry",
        source: "hooks",
      };
      await emitRetryDecisionHooks(
        decisionHooks,
        agent,
        decision.updatedOptions ?? genOptions,
        error,
        state,
        decision,
      );
      return decision;
    }
  }

  if (retryPolicy) {
    if (classification.type === "authentication") {
      const recovery = await runRecoveryHandler(retryPolicy.onAuthenticationFailure, {
        options: updatedOptions,
        error,
        requestClass,
        failureClassification: classification,
        retryAttempt: state.retryAttempt,
        consecutiveOverloadCount: currentConsecutiveOverloadCount,
      });
      if (recovery?.retry && state.retryAttempt < state.maxRetries) {
        const nextOptions = recovery.updatedOptions ?? updatedOptions;
        decision = {
          shouldRetry: true,
          retryDelayMs: recovery.retryDelayMs ?? 0,
          updatedOptions: nextOptions,
          requestClass: resolveRequestClass(nextOptions, retryPolicy),
          classification,
          outcome: "retry",
          source: "policy",
        };
      }
    } else if (classification.type === "transport") {
      const recovery = await runRecoveryHandler(retryPolicy.onTransportFailure, {
        options: updatedOptions,
        error,
        requestClass,
        failureClassification: classification,
        retryAttempt: state.retryAttempt,
        consecutiveOverloadCount: currentConsecutiveOverloadCount,
      });
      if (recovery?.retry && state.retryAttempt < state.maxRetries) {
        const nextOptions = recovery.updatedOptions ?? updatedOptions;
        decision = {
          shouldRetry: true,
          retryDelayMs: recovery.retryDelayMs ?? 0,
          updatedOptions: nextOptions,
          requestClass: resolveRequestClass(nextOptions, retryPolicy),
          classification,
          outcome: "retry",
          source: "policy",
        };
      }
    } else if (classification.type === "context_overflow") {
      const reducedOptions = resolveContextOverflowOptions(updatedOptions, retryPolicy, state);
      if (reducedOptions && state.retryAttempt < state.maxRetries) {
        decision = {
          shouldRetry: true,
          retryDelayMs: 0,
          updatedOptions: reducedOptions,
          requestClass,
          classification,
          outcome: "retry",
          source: "policy",
        };
      }
    } else if (classification.type === "overload") {
      decision = buildOverloadDecision(
        error,
        state,
        requestClass,
        classification,
        fallbackModel,
        retryPolicy,
        updatedOptions,
      );
    }
  } else if (classification.type === "overload") {
    decision = buildOverloadDecision(
      error,
      state,
      requestClass,
      classification,
      fallbackModel,
      undefined,
      updatedOptions,
    );
  }

  await emitRetryDecisionHooks(
    decisionHooks,
    agent,
    decision.updatedOptions ?? genOptions,
    error,
    state,
    decision,
  );
  return decision;
}

/**
 * Updates retry loop state based on error handling decision.
 *
 * @param state - Current retry loop state
 * @param decision - Error handling decision
 * @returns Updated retry loop state
 *
 * @internal
 */
export function updateRetryLoopState(
  state: RetryLoopState,
  decision: ErrorHandlingDecision,
): RetryLoopState {
  const switchedModel =
    decision.updatedModel !== undefined && decision.updatedModel !== state.currentModel;

  return {
    ...state,
    retryAttempt: state.retryAttempt + 1,
    currentModel: decision.updatedModel ?? state.currentModel,
    usedFallback: state.usedFallback || decision.activatedFallback === true,
    consecutiveOverloadCount: switchedModel
      ? 0
      : decision.classification.type === "overload"
        ? state.consecutiveOverloadCount + 1
        : 0,
    contextOverflowRetryCount:
      decision.classification.type === "context_overflow"
        ? state.contextOverflowRetryCount + 1
        : state.contextOverflowRetryCount,
  };
}

/**
 * Waits for the specified retry delay.
 *
 * @param delayMs - Delay in milliseconds
 *
 * @internal
 */
export async function waitForRetryDelay(delayMs: number): Promise<void> {
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
