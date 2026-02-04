/**
 * Hook system for observing agent lifecycle events.
 *
 * @packageDocumentation
 */

import type { Agent, HookCallback, HookInput, HookMatcher, HookOutput } from "./types.js";

// =============================================================================
// Unified Hook System with Matchers
// =============================================================================

/**
 * Checks if a tool name matches a HookMatcher pattern.
 *
 * @param toolName - The tool name to test
 * @param matcher - The matcher pattern (undefined matches all)
 * @returns true if the tool name matches the pattern
 *
 * @internal
 */
export function matchesToolName(toolName: string, matcher: string | undefined): boolean {
  if (matcher === undefined) {
    return true; // No matcher = match all tools
  }

  try {
    const regex = new RegExp(matcher);
    return regex.test(toolName);
  } catch (_error) {
    // Invalid regex - treat as literal string match
    return toolName === matcher;
  }
}

/**
 * Error thrown when a hook times out.
 *
 * @category Hooks
 */
export class HookTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Hook execution timed out after ${timeout}ms`);
    this.name = "HookTimeoutError";
  }
}

/**
 * Invokes hook callbacks with timeout support.
 *
 * This function enforces a hard timeout using `Promise.race`. If a hook does not complete
 * within the specified timeout, it will be treated as returning an empty result `{}`.
 * The abort signal is also set when the timeout is reached, allowing cooperative hooks
 * to clean up resources.
 *
 * @param hooks - Array of hook callbacks to invoke
 * @param input - The hook input data
 * @param toolUseId - The tool use ID (null for non-tool hooks)
 * @param agent - The agent instance
 * @param timeout - Timeout in milliseconds (default: 60000). Each hook must complete within this time.
 * @param retryAttempt - Current retry attempt number (default: 0)
 * @returns Array of hook outputs. Timed out hooks return empty objects `{}`.
 *
 * @example
 * ```typescript
 * // Hook that respects the abort signal for cooperative cancellation
 * const cooperativeHook: HookCallback = async (input, toolUseId, ctx) => {
 *   for (const item of items) {
 *     if (ctx.signal.aborted) {
 *       return {}; // Early exit on abort
 *     }
 *     await processItem(item);
 *   }
 *   return { hookSpecificOutput: { ... } };
 * };
 *
 * // Even if a hook doesn't check the signal, it will be timed out
 * const results = await invokeHooksWithTimeout(
 *   [cooperativeHook, slowHook],
 *   input,
 *   toolUseId,
 *   agent,
 *   5000 // 5 second timeout
 * );
 * ```
 *
 * @internal
 */
export async function invokeHooksWithTimeout(
  hooks: HookCallback[],
  input: HookInput,
  toolUseId: string | null,
  agent: Agent,
  timeout = 60000,
  retryAttempt = 0,
): Promise<HookOutput[]> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeout);

  try {
    const context = {
      signal: abortController.signal,
      agent,
      retryAttempt,
    };

    const results = await Promise.all(
      hooks.map(async (hook) => {
        try {
          // Create a timeout promise that rejects after the specified time
          const timeoutPromise = new Promise<HookOutput>((_, reject) => {
            const hookTimeoutId = setTimeout(() => {
              reject(new HookTimeoutError(timeout));
            }, timeout);
            // Clean up timeout if signal is aborted (parent timeout reached)
            abortController.signal.addEventListener("abort", () => {
              clearTimeout(hookTimeoutId);
              reject(new HookTimeoutError(timeout));
            });
          });

          // Race between hook execution and timeout
          const result = await Promise.race([hook(input, toolUseId, context), timeoutPromise]);
          return result;
        } catch (error) {
          // If hook throws or times out, treat as allowing with no modifications
          if (error instanceof HookTimeoutError) {
            console.error(`Hook timed out after ${timeout}ms`);
          } else {
            console.error("Hook execution error:", error);
          }
          return {};
        }
      }),
    );

    return results;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Filters and invokes matching hooks for a tool use event.
 *
 * @param matchers - Array of HookMatcher configurations
 * @param toolName - The name of the tool being used
 * @param input - The hook input data
 * @param toolUseId - The tool use ID
 * @param agent - The agent instance
 * @returns Array of hook outputs from all matching hooks
 *
 * @example
 * ```typescript
 * const matchers: HookMatcher[] = [
 *   { matcher: 'Write|Edit', hooks: [protectFiles], timeout: 30000 },
 *   { hooks: [auditLogger] }  // Matches all tools
 * ];
 *
 * const outputs = await invokeMatchingHooks(
 *   matchers,
 *   'Write',
 *   input,
 *   toolUseId,
 *   agent
 * );
 * ```
 *
 * @category Hooks
 */
export async function invokeMatchingHooks(
  matchers: HookMatcher[],
  toolName: string,
  input: HookInput,
  toolUseId: string,
  agent: Agent,
): Promise<HookOutput[]> {
  const allOutputs: HookOutput[] = [];

  for (const matcher of matchers) {
    if (matchesToolName(toolName, matcher.matcher)) {
      const timeout = matcher.timeout ?? 60000;
      const outputs = await invokeHooksWithTimeout(matcher.hooks, input, toolUseId, agent, timeout);
      allOutputs.push(...outputs);
    }
  }

  return allOutputs;
}

/**
 * Aggregates permission decisions from multiple hook outputs.
 *
 * Follows the hierarchy: deny > ask > allow > default
 *
 * @param hookOutputs - Array of hook outputs to aggregate
 * @param defaultDecision - Default decision if no hooks provide one (default: 'allow')
 * @returns The aggregated permission decision
 *
 * @example
 * ```typescript
 * const outputs: HookOutput[] = [
 *   { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } },
 *   { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } },
 * ];
 *
 * const decision = aggregatePermissionDecisions(outputs);
 * // Returns 'deny' because deny wins over allow
 * ```
 *
 * @category Hooks
 */
export function aggregatePermissionDecisions(
  hookOutputs: HookOutput[],
  defaultDecision: "allow" | "deny" | "ask" = "allow",
): "allow" | "deny" | "ask" {
  let hasDeny = false;
  let hasAsk = false;
  let hasAllow = false;

  for (const output of hookOutputs) {
    const decision = output.hookSpecificOutput?.permissionDecision;

    if (decision === "deny") {
      hasDeny = true;
    } else if (decision === "ask") {
      hasAsk = true;
    } else if (decision === "allow") {
      hasAllow = true;
    }
  }

  // Priority: deny > ask > allow > default
  if (hasDeny) return "deny";
  if (hasAsk) return "ask";
  if (hasAllow) return "allow";
  return defaultDecision;
}

/**
 * Extracts a cached/mock result from hook outputs for short-circuit execution.
 *
 * Returns the first non-undefined `respondWith` value found in the hook outputs.
 * This enables cache hooks to return cached results without executing the actual operation.
 *
 * @param hookOutputs - Array of hook outputs to scan
 * @returns The cached result if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const outputs: HookOutput[] = [
 *   { hookSpecificOutput: { hookEventName: 'PreGenerate' } },
 *   { hookSpecificOutput: { hookEventName: 'PreGenerate', respondWith: cachedResult } },
 * ];
 *
 * const result = extractRespondWith(outputs);
 * // Returns cachedResult
 * ```
 *
 * @category Hooks
 */
export function extractRespondWith<T = unknown>(hookOutputs: HookOutput[]): T | undefined {
  for (const output of hookOutputs) {
    const respondWith = output.hookSpecificOutput?.respondWith;
    if (respondWith !== undefined) {
      return respondWith as T;
    }
  }
  return undefined;
}

/**
 * Extracts transformed input from hook outputs.
 *
 * Returns the first non-undefined `updatedInput` value found in the hook outputs.
 * This enables hooks to modify inputs before they are used (e.g., redirect file paths,
 * add rate limit headers, sanitize user input).
 *
 * @param hookOutputs - Array of hook outputs to scan
 * @returns The transformed input if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const outputs: HookOutput[] = [
 *   { hookSpecificOutput: { hookEventName: 'PreToolUse' } },
 *   { hookSpecificOutput: {
 *       hookEventName: 'PreToolUse',
 *       updatedInput: { file_path: '/sandbox/file.txt' }
 *     }
 *   },
 * ];
 *
 * const transformed = extractUpdatedInput(outputs);
 * // Returns { file_path: '/sandbox/file.txt' }
 * ```
 *
 * @category Hooks
 */
export function extractUpdatedInput<T = unknown>(hookOutputs: HookOutput[]): T | undefined {
  for (const output of hookOutputs) {
    const updatedInput = output.hookSpecificOutput?.updatedInput;
    if (updatedInput !== undefined) {
      return updatedInput as T;
    }
  }
  return undefined;
}

/**
 * Extracts transformed result from hook outputs.
 *
 * Returns the first non-undefined `updatedResult` value found in the hook outputs.
 * This enables hooks to modify outputs after execution (e.g., filter sensitive data,
 * add metadata, transform format, apply post-processing).
 *
 * @param hookOutputs - Array of hook outputs to scan
 * @returns The transformed result if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const outputs: HookOutput[] = [
 *   { hookSpecificOutput: { hookEventName: 'PostGenerate' } },
 *   { hookSpecificOutput: {
 *       hookEventName: 'PostGenerate',
 *       updatedResult: { ...originalResult, filtered: true }
 *     }
 *   },
 * ];
 *
 * const transformed = extractUpdatedResult(outputs);
 * // Returns { ...originalResult, filtered: true }
 * ```
 *
 * @category Hooks
 */
export function extractUpdatedResult<T = unknown>(hookOutputs: HookOutput[]): T | undefined {
  for (const output of hookOutputs) {
    const updatedResult = output.hookSpecificOutput?.updatedResult;
    if (updatedResult !== undefined) {
      return updatedResult as T;
    }
  }
  return undefined;
}

/**
 * Extracts retry decision from PostGenerateFailure or PostToolUseFailure hook outputs.
 *
 * Returns the first retry decision found in the hook outputs. If any hook requests a retry,
 * the operation will be retried after the specified delay (or 0ms if no delay specified).
 *
 * @param hookOutputs - Array of hook outputs to scan
 * @returns Object with retry flag and delay, or undefined if no retry requested
 *
 * @example
 * ```typescript
 * const outputs: HookOutput[] = [
 *   { hookSpecificOutput: { hookEventName: 'PostGenerateFailure' } },
 *   { hookSpecificOutput: {
 *       hookEventName: 'PostGenerateFailure',
 *       retry: true,
 *       retryDelayMs: 1000  // Wait 1s before retrying
 *     }
 *   },
 * ];
 *
 * const retryDecision = extractRetryDecision(outputs);
 * // Returns { retry: true, retryDelayMs: 1000 }
 * ```
 *
 * @category Hooks
 */
export function extractRetryDecision(
  hookOutputs: HookOutput[],
): { retry: boolean; retryDelayMs: number } | undefined {
  for (const output of hookOutputs) {
    const retry = output.hookSpecificOutput?.retry;
    if (retry === true) {
      const retryDelayMs = output.hookSpecificOutput?.retryDelayMs ?? 0;
      return { retry: true, retryDelayMs };
    }
  }
  return undefined;
}
