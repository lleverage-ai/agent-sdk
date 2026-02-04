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
import type {
  Agent,
  GenerateOptions,
  GenerateResult,
  HookCallback,
  PostGenerateFailureInput,
  PreGenerateInput,
} from "./types.js";

/**
 * Default maximum number of retry attempts for generation methods.
 * @internal
 */
export const DEFAULT_MAX_RETRIES = 10;

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
 * Decision from error handling (PostGenerateFailure hooks + fallback logic).
 * @internal
 */
export interface ErrorHandlingDecision {
  /** Whether to retry the operation */
  shouldRetry: boolean;
  /** Delay in ms before retrying (0 if no delay) */
  retryDelayMs: number;
  /** Updated model to use (if switched to fallback) */
  updatedModel?: LanguageModel;
  /** Whether fallback was just activated */
  activatedFallback?: boolean;
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
    options: genOptions,
  };

  const hookOutputs = await invokeHooksWithTimeout(hooks, preGenerateInput, null, agent);

  // Check for permission denial (e.g., guardrails blocking input)
  const permissionDecision = aggregatePermissionDecisions(hookOutputs);
  if (permissionDecision === "deny") {
    // Find the reason and blocked message IDs from hook outputs
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

  // Check for cache short-circuit via respondWith
  const cachedResult = extractRespondWith<T>(hookOutputs);
  if (cachedResult !== undefined) {
    return { effectiveOptions: genOptions, cachedResult };
  }

  // Apply input transformation via updatedInput
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

/**
 * Handles errors during generation by invoking PostGenerateFailure hooks
 * and checking for fallback model usage.
 *
 * @param error - The normalized error
 * @param hooks - PostGenerateFailure hook callbacks
 * @param genOptions - The generation options
 * @param agent - The agent instance
 * @param state - Current retry loop state
 * @param fallbackModel - Optional fallback model
 * @param shouldUseFallback - Function to check if fallback should be used
 * @returns Decision on whether to retry and how
 *
 * @internal
 */
export async function handleGenerationError(
  error: AgentError,
  hooks: HookCallback[],
  genOptions: GenerateOptions,
  agent: Agent,
  state: RetryLoopState,
  fallbackModel?: LanguageModel,
  shouldUseFallback?: (error: AgentError) => boolean,
): Promise<ErrorHandlingDecision> {
  // Invoke PostGenerateFailure hooks to check for retry
  if (hooks.length > 0) {
    const failureInput: PostGenerateFailureInput = {
      hook_event_name: "PostGenerateFailure",
      session_id: genOptions.threadId ?? "default",
      cwd: process.cwd(),
      options: genOptions,
      error,
    };

    const hookOutputs = await invokeHooksWithTimeout(
      hooks,
      failureInput,
      null,
      agent,
      60000,
      state.retryAttempt,
    );

    // Check if hooks request a retry
    const retryDecision = extractRetryDecision(hookOutputs);
    if (retryDecision && state.retryAttempt < state.maxRetries) {
      return {
        shouldRetry: true,
        retryDelayMs: retryDecision.retryDelayMs,
      };
    }
  }

  // Check if we should fallback to alternative model
  if (
    fallbackModel &&
    !state.usedFallback &&
    shouldUseFallback?.(error) &&
    state.retryAttempt < state.maxRetries
  ) {
    return {
      shouldRetry: true,
      retryDelayMs: 0,
      updatedModel: fallbackModel,
      activatedFallback: true,
    };
  }

  // No retry requested or max retries exceeded
  return {
    shouldRetry: false,
    retryDelayMs: 0,
  };
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
  return {
    ...state,
    retryAttempt: state.retryAttempt + 1,
    currentModel: decision.updatedModel ?? state.currentModel,
    usedFallback: state.usedFallback || decision.activatedFallback === true,
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
