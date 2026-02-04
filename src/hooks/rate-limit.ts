/**
 * Rate limiting hook utilities.
 *
 * Provides rate limiting hooks that track token usage and enforce limits
 * using the unified hook system.
 *
 * @packageDocumentation
 */

import type { HookCallback, PostGenerateInput } from "../types.js";

/**
 * Server-provided rate limit information from response headers.
 *
 * @category Hooks
 */
export interface ServerRateLimitInfo {
  /**
   * Maximum requests allowed in the current window.
   * Typically from `x-ratelimit-limit` or `ratelimit-limit` header.
   */
  limit?: number;

  /**
   * Number of requests remaining in the current window.
   * Typically from `x-ratelimit-remaining` or `ratelimit-remaining` header.
   */
  remaining?: number;

  /**
   * Timestamp when the rate limit window resets (Unix seconds).
   * Typically from `x-ratelimit-reset` or `ratelimit-reset` header.
   */
  reset?: number;

  /**
   * Number of seconds until the rate limit window resets.
   * Typically from `retry-after` header when rate limited.
   */
  retryAfter?: number;
}

/**
 * Options for creating rate limit hooks.
 *
 * @category Hooks
 */
export interface RateLimitHooksOptions {
  /**
   * Maximum tokens per time window.
   * @defaultValue 100000
   */
  maxTokensPerWindow?: number;

  /**
   * Time window in milliseconds for token counting.
   * @defaultValue 60000 (1 minute)
   */
  windowMs?: number;

  /**
   * Message to show when rate limit is exceeded.
   * @defaultValue "Rate limit exceeded. Please try again later."
   */
  limitMessage?: string;

  /**
   * Custom function to determine if a request should be rate limited.
   * Return true to allow, false to deny.
   * @defaultValue Check token count against limit
   */
  shouldAllow?: (tokensUsed: number, maxTokens: number) => boolean;

  /**
   * Enable server rate limit integration.
   * When enabled, hooks will attempt to extract rate limit information
   * from model response headers (e.g., x-ratelimit-* headers) and use
   * server-provided limits in addition to client-side tracking.
   *
   * @defaultValue false
   */
  enableServerLimits?: boolean;

  /**
   * Custom function to extract server rate limit info from response metadata.
   * Use this if your provider uses non-standard header names or formats.
   *
   * @param result - The generation result which may contain response metadata
   * @returns Server rate limit information, or undefined if not available
   *
   * @example
   * ```typescript
   * extractServerLimits: (result) => {
   *   const headers = result.rawResponse?.headers;
   *   if (!headers) return undefined;
   *   return {
   *     limit: parseInt(headers['x-custom-limit'] || '0'),
   *     remaining: parseInt(headers['x-custom-remaining'] || '0'),
   *     reset: parseInt(headers['x-custom-reset'] || '0'),
   *   };
   * }
   * ```
   */
  extractServerLimits?: (result: PostGenerateInput) => ServerRateLimitInfo | undefined;

  /**
   * Enable per-tool quota tracking.
   * When enabled, tracks token usage separately for each tool,
   * allowing different tools to have independent rate limits.
   *
   * **Note**: This feature is designed for future tool-based rate limiting hooks
   * (PreToolUse/PostToolUse). The current generation-based hooks (PreGenerate/PostGenerate)
   * track overall token usage, not per-tool usage.
   *
   * @defaultValue false
   * @experimental
   */
  perToolQuota?: boolean;

  /**
   * Per-tool token limits when perToolQuota is enabled.
   * Maps tool names to their maximum tokens per window.
   *
   * **Note**: This feature is designed for future tool-based rate limiting hooks.
   * Current generation-based hooks do not use this configuration.
   *
   * @example
   * ```typescript
   * {
   *   'Write': 10000,    // Write tool limited to 10k tokens per window
   *   'Bash': 5000,      // Bash tool limited to 5k tokens per window
   *   'Read': 20000,     // Read tool limited to 20k tokens per window
   * }
   * ```
   * @experimental
   */
  toolLimits?: Record<string, number>;
}

/**
 * Token bucket rate limiter implementation.
 *
 * Tracks token usage in a sliding window with automatic cleanup of old entries.
 * Supports per-tool quota tracking and server-provided rate limit integration.
 *
 * @category Hooks
 */
export class TokenBucketRateLimiter {
  private usage: Array<{ timestamp: number; tokens: number; tool?: string }> = [];
  private maxTokens: number;
  private windowMs: number;
  private serverLimitInfo?: ServerRateLimitInfo;
  private perToolQuota: boolean;
  private toolLimits: Record<string, number>;

  constructor(
    maxTokensPerWindow: number,
    windowMs: number,
    perToolQuota = false,
    toolLimits: Record<string, number> = {},
  ) {
    this.maxTokens = maxTokensPerWindow;
    this.windowMs = windowMs;
    this.perToolQuota = perToolQuota;
    this.toolLimits = toolLimits;
  }

  /**
   * Try to acquire tokens. Returns true if allowed, false if would exceed limit.
   * If tool is provided and per-tool quotas are enabled, checks against tool-specific limit.
   */
  tryAcquire(tool?: string): boolean {
    this.cleanup();

    // Check server limits first if available
    if (this.serverLimitInfo?.remaining !== undefined) {
      if (this.serverLimitInfo.remaining <= 0) {
        return false;
      }
    }

    // Check client-side limits
    const currentUsage = this.getCurrentUsage(tool);
    const limit = this.getEffectiveLimit(tool);
    return currentUsage < limit;
  }

  /**
   * Record token usage for a tool.
   */
  recordUsage(tokens: number, tool?: string): void {
    this.cleanup();
    this.usage.push({
      timestamp: Date.now(),
      tokens,
      tool,
    });
  }

  /**
   * Get current token usage in the window.
   * If tool is provided and per-tool quotas are enabled, returns usage for that tool only.
   */
  getCurrentUsage(tool?: string): number {
    this.cleanup();

    if (this.perToolQuota && tool) {
      return this.usage
        .filter((entry) => entry.tool === tool)
        .reduce((sum, entry) => sum + entry.tokens, 0);
    }

    return this.usage.reduce((sum, entry) => sum + entry.tokens, 0);
  }

  /**
   * Get remaining tokens in current window.
   * Uses server limits if available, otherwise falls back to client-side tracking.
   */
  getRemainingTokens(tool?: string): number {
    // Prefer server-provided remaining count if available
    if (this.serverLimitInfo?.remaining !== undefined) {
      return Math.max(0, this.serverLimitInfo.remaining);
    }

    const current = this.getCurrentUsage(tool);
    const limit = this.getEffectiveLimit(tool);
    return Math.max(0, limit - current);
  }

  /**
   * Update with server-provided rate limit information.
   * This information takes precedence over client-side tracking.
   */
  updateServerLimits(info: ServerRateLimitInfo): void {
    this.serverLimitInfo = info;
  }

  /**
   * Get current server limit information if available.
   */
  getServerLimits(): ServerRateLimitInfo | undefined {
    return this.serverLimitInfo;
  }

  /**
   * Get the effective limit for a tool (tool-specific or global).
   */
  private getEffectiveLimit(tool?: string): number {
    if (this.perToolQuota && tool && this.toolLimits[tool]) {
      return this.toolLimits[tool];
    }
    return this.maxTokens;
  }

  /**
   * Remove entries outside the current window.
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    this.usage = this.usage.filter((entry) => entry.timestamp > cutoff);
  }

  /**
   * Reset all usage data and server limit info.
   */
  reset(): void {
    this.usage = [];
    this.serverLimitInfo = undefined;
  }
}

/**
 * Default server rate limit extractor.
 *
 * Attempts to extract rate limit information from common response header patterns:
 * - `x-ratelimit-*` (OpenAI, Anthropic, etc.)
 * - `ratelimit-*` (standard format)
 * - `retry-after` (when rate limited)
 *
 * @param result - PostGenerate hook input containing the generation result
 * @returns Server rate limit info if headers are present, undefined otherwise
 *
 * @category Hooks
 */
export function extractStandardRateLimitHeaders(
  result: PostGenerateInput,
): ServerRateLimitInfo | undefined {
  // AI SDK v6 may expose response metadata via result.response or result.rawResponse
  // This is a best-effort extraction that handles common patterns
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK internal structure varies by version
  const headers = (result as any).response?.headers || (result as any).rawResponse?.headers;

  if (!headers) return undefined;

  // Normalize headers to lowercase for case-insensitive matching
  const normalizedHeaders: Record<string, string> = {};
  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === "string") {
        normalizedHeaders[key.toLowerCase()] = value;
      }
    }
  }

  // Try common header patterns
  const limitStr = normalizedHeaders["x-ratelimit-limit"] || normalizedHeaders["ratelimit-limit"];
  const remainingStr =
    normalizedHeaders["x-ratelimit-remaining"] || normalizedHeaders["ratelimit-remaining"];
  const resetStr = normalizedHeaders["x-ratelimit-reset"] || normalizedHeaders["ratelimit-reset"];
  const retryAfterStr = normalizedHeaders["retry-after"];

  // Parse values
  const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined;
  const remaining = remainingStr ? Number.parseInt(remainingStr, 10) : undefined;
  const reset = resetStr ? Number.parseInt(resetStr, 10) : undefined;
  const retryAfter = retryAfterStr ? Number.parseInt(retryAfterStr, 10) : undefined;

  // Return undefined if no rate limit headers found
  if (
    limit === undefined &&
    remaining === undefined &&
    reset === undefined &&
    retryAfter === undefined
  ) {
    return undefined;
  }

  return {
    limit: !Number.isNaN(limit!) ? limit : undefined,
    remaining: !Number.isNaN(remaining!) ? remaining : undefined,
    reset: !Number.isNaN(reset!) ? reset : undefined,
    retryAfter: !Number.isNaN(retryAfter!) ? retryAfter : undefined,
  };
}

/**
 * Creates rate limiting hooks for PreGenerate and PostGenerate events.
 *
 * The PreGenerate hook checks if the rate limit would be exceeded and denies
 * the request if so. The PostGenerate hook records actual token usage.
 *
 * This replaces rate limiting middleware with hook-based rate limiting that
 * works correctly with the unified hook system.
 *
 * @param options - Configuration options
 * @returns Array of two hooks: [PreGenerate rate check, PostGenerate usage tracking]
 *
 * @example
 * ```typescript
 * const [rateCheck, usageTracker] = createRateLimitHooks({
 *   maxTokensPerWindow: 50000,  // 50k tokens
 *   windowMs: 60000,             // per minute
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreGenerate: [{ hooks: [rateCheck] }],
 *     PostGenerate: [{ hooks: [usageTracker] }],
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Custom rate limit logic
 * const hooks = createRateLimitHooks({
 *   shouldAllow: (tokensUsed, maxTokens) => {
 *     // Allow if under 80% of limit
 *     return tokensUsed < maxTokens * 0.8;
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With server rate limit integration
 * const hooks = createRateLimitHooks({
 *   maxTokensPerWindow: 100000,
 *   enableServerLimits: true,  // Parse x-ratelimit-* headers
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Custom server limit extraction for non-standard headers
 * const hooks = createRateLimitHooks({
 *   enableServerLimits: true,
 *   extractServerLimits: (result) => {
 *     const headers = result.response?.headers;
 *     return {
 *       remaining: parseInt(headers?.['x-custom-remaining'] || '0'),
 *       reset: parseInt(headers?.['x-custom-reset'] || '0'),
 *     };
 *   },
 * });
 * ```
 *
 * @category Hooks
 */
export function createRateLimitHooks(
  options: RateLimitHooksOptions = {},
): [HookCallback, HookCallback] {
  const {
    maxTokensPerWindow = 100000,
    windowMs = 60000, // 1 minute
    limitMessage = "Rate limit exceeded. Please try again later.",
    shouldAllow = (tokensUsed, maxTokens) => tokensUsed < maxTokens,
    enableServerLimits = false,
    extractServerLimits = extractStandardRateLimitHeaders,
    perToolQuota = false,
    toolLimits = {},
  } = options;

  const rateLimiter = new TokenBucketRateLimiter(
    maxTokensPerWindow,
    windowMs,
    perToolQuota,
    toolLimits,
  );

  // PreGenerate: Check rate limit
  const rateCheck: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreGenerate") return {};

    const currentUsage = rateLimiter.getCurrentUsage();

    if (!shouldAllow(currentUsage, maxTokensPerWindow)) {
      // Check if we have server reset time for better error message
      const serverLimits = rateLimiter.getServerLimits();
      let reason = limitMessage;

      if (serverLimits?.reset) {
        const resetDate = new Date(serverLimits.reset * 1000);
        reason = `${limitMessage} Rate limit resets at ${resetDate.toISOString()}.`;
      } else if (serverLimits?.retryAfter) {
        reason = `${limitMessage} Retry after ${serverLimits.retryAfter} seconds.`;
      }

      return {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      };
    }

    return {};
  };

  // PostGenerate: Record usage and update server limits
  const usageTracker: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostGenerate") return {};

    const postGenInput = input as PostGenerateInput;
    const tokens = postGenInput.result.usage?.totalTokens ?? 0;

    // Record client-side usage
    rateLimiter.recordUsage(tokens);

    // Update with server-provided limits if enabled
    if (enableServerLimits) {
      const serverLimits = extractServerLimits(postGenInput);
      if (serverLimits) {
        rateLimiter.updateServerLimits(serverLimits);
      }
    }

    return {};
  };

  return [rateCheck, usageTracker];
}

/**
 * Creates managed rate limit hooks with programmatic control.
 *
 * Returns hooks along with functions to get current usage, reset limits,
 * and check remaining capacity.
 *
 * @param options - Configuration options
 * @returns Object with hooks and rate limit control functions
 *
 * @example
 * ```typescript
 * const { hooks, getCurrentUsage, getRemainingTokens, reset } = createManagedRateLimitHooks({
 *   maxTokensPerWindow: 100000,
 *   windowMs: 60000,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreGenerate: [{ hooks: [hooks[0]] }],
 *     PostGenerate: [{ hooks: [hooks[1]] }],
 *   },
 * });
 *
 * // Check current usage
 * const used = getCurrentUsage();
 * const remaining = getRemainingTokens();
 * console.log(`Token usage: ${used} / ${maxTokensPerWindow} (${remaining} remaining)`);
 *
 * // Reset limits (e.g., for testing or manual override)
 * reset();
 * ```
 *
 * @category Hooks
 */
export function createManagedRateLimitHooks(options: RateLimitHooksOptions = {}): {
  hooks: [HookCallback, HookCallback];
  getCurrentUsage: () => number;
  getRemainingTokens: () => number;
  getServerLimits: () => ServerRateLimitInfo | undefined;
  reset: () => void;
} {
  const {
    maxTokensPerWindow = 100000,
    windowMs = 60000,
    limitMessage = "Rate limit exceeded. Please try again later.",
    shouldAllow = (tokensUsed, maxTokens) => tokensUsed < maxTokens,
    enableServerLimits = false,
    extractServerLimits = extractStandardRateLimitHeaders,
    perToolQuota = false,
    toolLimits = {},
  } = options;

  const rateLimiter = new TokenBucketRateLimiter(
    maxTokensPerWindow,
    windowMs,
    perToolQuota,
    toolLimits,
  );

  const rateCheck: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreGenerate") return {};

    const currentUsage = rateLimiter.getCurrentUsage();

    if (!shouldAllow(currentUsage, maxTokensPerWindow)) {
      const serverLimits = rateLimiter.getServerLimits();
      let reason = limitMessage;

      if (serverLimits?.reset) {
        const resetDate = new Date(serverLimits.reset * 1000);
        reason = `${limitMessage} Rate limit resets at ${resetDate.toISOString()}.`;
      } else if (serverLimits?.retryAfter) {
        reason = `${limitMessage} Retry after ${serverLimits.retryAfter} seconds.`;
      }

      return {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      };
    }

    return {};
  };

  const usageTracker: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostGenerate") return {};

    const postGenInput = input as PostGenerateInput;
    const tokens = postGenInput.result.usage?.totalTokens ?? 0;

    rateLimiter.recordUsage(tokens);

    if (enableServerLimits) {
      const serverLimits = extractServerLimits(postGenInput);
      if (serverLimits) {
        rateLimiter.updateServerLimits(serverLimits);
      }
    }

    return {};
  };

  return {
    hooks: [rateCheck, usageTracker],
    getCurrentUsage: () => rateLimiter.getCurrentUsage(),
    getRemainingTokens: () => rateLimiter.getRemainingTokens(),
    getServerLimits: () => rateLimiter.getServerLimits(),
    reset: () => rateLimiter.reset(),
  };
}
