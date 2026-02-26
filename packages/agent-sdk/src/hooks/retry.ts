/**
 * Retry hook utilities.
 *
 * Provides retry hooks with exponential backoff that replace the retry
 * middleware functionality using the unified hook system.
 *
 * @packageDocumentation
 */

import type { HookCallback, HookCallbackContext, PostGenerateFailureInput } from "../types.js";

/**
 * Options for creating retry hooks.
 *
 * @category Hooks
 */
export interface RetryHooksOptions {
  /**
   * Maximum number of retry attempts.
   * @defaultValue 3
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds for the first retry.
   * @defaultValue 1000 (1 second)
   */
  baseDelay?: number;

  /**
   * Maximum delay in milliseconds between retries.
   * @defaultValue 30000 (30 seconds)
   */
  maxDelay?: number;

  /**
   * Backoff multiplier for exponential backoff.
   * @defaultValue 2 (doubles each retry)
   */
  backoffMultiplier?: number;

  /**
   * Whether to add random jitter to retry delays (0-50% of delay).
   * Helps avoid thundering herd problem.
   * @defaultValue true
   */
  jitter?: boolean;

  /**
   * Custom function to determine if an error should trigger a retry.
   * @defaultValue Retries rate limits, server errors, network errors, timeouts
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;

  /**
   * Custom delay calculator.
   * @defaultValue Exponential backoff with jitter
   */
  calculateDelay?: (attempt: number) => number;
}

/**
 * Default function to determine if an error should trigger a retry.
 *
 * Retries on:
 * - Rate limit errors (429, "rate limit")
 * - Server errors (5xx)
 * - Network errors (ECONNRESET, ECONNREFUSED, ETIMEDOUT)
 * - Timeout errors
 */
function defaultShouldRetry(error: Error, _attempt: number): boolean {
  const message = error.message.toLowerCase();

  // Rate limit
  if (message.includes("rate limit") || message.includes("429")) {
    return true;
  }

  // Server errors
  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  ) {
    return true;
  }

  // Network errors
  if (
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout")
  ) {
    return true;
  }

  // Timeout errors
  if (message.includes("timeout")) {
    return true;
  }

  return false;
}

/**
 * Creates a retry hook for PostGenerateFailure events.
 *
 * The hook implements exponential backoff with optional jitter for handling
 * transient failures. When a retryable error occurs, the hook signals the
 * agent to retry with an appropriate delay.
 *
 * This replaces the retry middleware with hook-based retry that works
 * correctly with the unified hook system.
 *
 * @param options - Configuration options
 * @returns A PostGenerateFailure hook that handles retries
 *
 * @example
 * ```typescript
 * const retryHook = createRetryHooks({
 *   maxRetries: 3,
 *   baseDelay: 1000,
 *   backoffMultiplier: 2,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PostGenerateFailure: [{ hooks: [retryHook] }],
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Custom retry logic for specific errors
 * const retryHook = createRetryHooks({
 *   shouldRetry: (error, attempt) => {
 *     // Only retry rate limits, and only up to 5 times
 *     return error.message.includes('rate limit') && attempt < 5;
 *   },
 *   baseDelay: 2000,
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Custom delay calculation (linear backoff)
 * const retryHook = createRetryHooks({
 *   calculateDelay: (attempt) => attempt * 1000, // 1s, 2s, 3s, ...
 * });
 * ```
 *
 * @category Hooks
 */
export function createRetryHooks(options: RetryHooksOptions = {}): HookCallback {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    jitter = true,
    shouldRetry = defaultShouldRetry,
    calculateDelay: customCalculateDelay,
  } = options;

  /**
   * Calculate delay for next retry with exponential backoff and optional jitter.
   */
  function calculateDelay(attempt: number): number {
    // Exponential backoff: baseDelay * multiplier^(attempt-1)
    let delay = baseDelay * backoffMultiplier ** (attempt - 1);

    // Cap at maxDelay
    delay = Math.min(delay, maxDelay);

    // Add jitter (0-50% of delay)
    if (jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    return Math.round(delay);
  }

  const delayCalculator = customCalculateDelay || calculateDelay;

  const retryHook: HookCallback = async (input, _toolUseId, context: HookCallbackContext) => {
    if (input.hook_event_name !== "PostGenerateFailure") return {};

    const failureInput = input as PostGenerateFailureInput;
    const attempt = context.retryAttempt ?? 0;

    // Check if we should retry
    if (attempt < maxRetries && shouldRetry(failureInput.error, attempt + 1)) {
      const delay = delayCalculator(attempt + 1);

      return {
        hookSpecificOutput: {
          hookEventName: "PostGenerateFailure",
          retry: true,
          retryDelayMs: delay,
        },
      };
    }

    // Max retries reached or error not retryable - let error propagate
    return {};
  };

  return retryHook;
}

/**
 * Creates a retry hook with custom statistics tracking.
 *
 * Returns the hook along with a function to get retry statistics.
 *
 * @param options - Configuration options
 * @returns Object with hook and statistics getter
 *
 * @example
 * ```typescript
 * const { hook: retryHook, getStats } = createManagedRetryHooks({
 *   maxRetries: 5,
 *   baseDelay: 1000,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PostGenerateFailure: [{ hooks: [retryHook] }],
 *   },
 * });
 *
 * // Later, check statistics
 * const stats = getStats();
 * console.log(`Retry rate: ${stats.retries / stats.failures}`);
 * console.log(`Average retries per failure: ${stats.retries / Math.max(1, stats.retriedFailures)}`);
 * ```
 *
 * @category Hooks
 */
export function createManagedRetryHooks(options: RetryHooksOptions = {}): {
  hook: HookCallback;
  getStats: () => {
    failures: number;
    retries: number;
    retriedFailures: number;
    successAfterRetry: number;
  };
} {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    jitter = true,
    shouldRetry = defaultShouldRetry,
    calculateDelay: customCalculateDelay,
  } = options;

  let totalFailures = 0;
  let totalRetries = 0;
  let retriedFailures = 0;
  const successAfterRetry = 0;

  function calculateDelay(attempt: number): number {
    let delay = baseDelay * backoffMultiplier ** (attempt - 1);
    delay = Math.min(delay, maxDelay);
    if (jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    return Math.round(delay);
  }

  const delayCalculator = customCalculateDelay || calculateDelay;

  const retryHook: HookCallback = async (input, _toolUseId, context: HookCallbackContext) => {
    if (input.hook_event_name !== "PostGenerateFailure") return {};

    const failureInput = input as PostGenerateFailureInput;
    const attempt = context.retryAttempt ?? 0;

    totalFailures++;

    if (attempt < maxRetries && shouldRetry(failureInput.error, attempt + 1)) {
      if (attempt === 0) {
        retriedFailures++;
      }
      totalRetries++;

      const delay = delayCalculator(attempt + 1);

      return {
        hookSpecificOutput: {
          hookEventName: "PostGenerateFailure",
          retry: true,
          retryDelayMs: delay,
        },
      };
    }

    return {};
  };

  return {
    hook: retryHook,
    getStats: () => ({
      failures: totalFailures,
      retries: totalRetries,
      retriedFailures,
      successAfterRetry,
    }),
  };
}
