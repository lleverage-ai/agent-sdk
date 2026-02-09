/**
 * Middleware context implementation.
 *
 * Creates a context that collects hook registrations from middleware.
 *
 * @packageDocumentation
 */

import type { HookCallback, HookMatcher, HookRegistration } from "../types.js";
import type { MiddlewareContext, MiddlewareContextResult } from "./types.js";

/**
 * Creates a middleware context that collects hook registrations.
 *
 * The context provides methods for middleware to register hooks for various
 * lifecycle events. Hooks are collected and can be retrieved as a
 * HookRegistration object.
 *
 * @returns The context and a function to get the collected hooks
 *
 * @example
 * ```typescript
 * const { context, getHooks } = createMiddlewareContext();
 *
 * // Middleware registers hooks through the context
 * middleware.register(context);
 *
 * // Get the collected hooks as HookRegistration
 * const hooks = getHooks();
 * ```
 *
 * @category Middleware
 * @internal
 */
export function createMiddlewareContext(): MiddlewareContextResult {
  // Storage for collected hooks
  const preGenerate: HookCallback[] = [];
  const postGenerate: HookCallback[] = [];
  const postGenerateFailure: HookCallback[] = [];
  const preToolUse: HookMatcher[] = [];
  const postToolUse: HookMatcher[] = [];
  const postToolUseFailure: HookMatcher[] = [];
  const preCompact: HookCallback[] = [];
  const postCompact: HookCallback[] = [];
  const sessionStart: HookCallback[] = [];
  const sessionEnd: HookCallback[] = [];
  const subagentStart: HookCallback[] = [];
  const subagentStop: HookCallback[] = [];
  const mcpConnectionFailed: HookCallback[] = [];
  const mcpConnectionRestored: HookCallback[] = [];
  const interruptRequested: HookCallback[] = [];
  const interruptResolved: HookCallback[] = [];
  const customHooks: Record<string, HookCallback[]> = {};

  /**
   * Helper to add a tool hook with optional matcher.
   */
  function addToolHook(storage: HookMatcher[], callback: HookCallback, matcher?: string): void {
    // Find existing matcher or create new one
    const existingMatcher = storage.find((m) => m.matcher === matcher);
    if (existingMatcher) {
      existingMatcher.hooks.push(callback);
    } else {
      storage.push({
        matcher,
        hooks: [callback],
      });
    }
  }

  const context: MiddlewareContext = {
    onPreGenerate(callback: HookCallback): void {
      preGenerate.push(callback);
    },

    onPostGenerate(callback: HookCallback): void {
      postGenerate.push(callback);
    },

    onPostGenerateFailure(callback: HookCallback): void {
      postGenerateFailure.push(callback);
    },

    onPreToolUse(callback: HookCallback, matcher?: string): void {
      addToolHook(preToolUse, callback, matcher);
    },

    onPostToolUse(callback: HookCallback, matcher?: string): void {
      addToolHook(postToolUse, callback, matcher);
    },

    onPostToolUseFailure(callback: HookCallback, matcher?: string): void {
      addToolHook(postToolUseFailure, callback, matcher);
    },

    onPreCompact(callback: HookCallback): void {
      preCompact.push(callback);
    },

    onPostCompact(callback: HookCallback): void {
      postCompact.push(callback);
    },

    onSessionStart(callback: HookCallback): void {
      sessionStart.push(callback);
    },

    onSessionEnd(callback: HookCallback): void {
      sessionEnd.push(callback);
    },

    onSubagentStart(callback: HookCallback): void {
      subagentStart.push(callback);
    },

    onSubagentStop(callback: HookCallback): void {
      subagentStop.push(callback);
    },

    onMCPConnectionFailed(callback: HookCallback): void {
      mcpConnectionFailed.push(callback);
    },

    onMCPConnectionRestored(callback: HookCallback): void {
      mcpConnectionRestored.push(callback);
    },

    onInterruptRequested(callback: HookCallback): void {
      interruptRequested.push(callback);
    },

    onInterruptResolved(callback: HookCallback): void {
      interruptResolved.push(callback);
    },

    onCustom(eventName: string, callback: HookCallback): void {
      if (!customHooks[eventName]) {
        customHooks[eventName] = [];
      }
      customHooks[eventName].push(callback);
    },
  };

  function getHooks(): HookRegistration {
    const hooks: HookRegistration = {};

    // Add generation hooks if any were registered
    if (preGenerate.length > 0) {
      hooks.PreGenerate = preGenerate;
    }
    if (postGenerate.length > 0) {
      hooks.PostGenerate = postGenerate;
    }
    if (postGenerateFailure.length > 0) {
      hooks.PostGenerateFailure = postGenerateFailure;
    }

    // Add tool hooks if any were registered
    if (preToolUse.length > 0) {
      hooks.PreToolUse = preToolUse;
    }
    if (postToolUse.length > 0) {
      hooks.PostToolUse = postToolUse;
    }
    if (postToolUseFailure.length > 0) {
      hooks.PostToolUseFailure = postToolUseFailure;
    }

    // Add compaction hooks if any were registered
    if (preCompact.length > 0) {
      hooks.PreCompact = preCompact;
    }
    if (postCompact.length > 0) {
      hooks.PostCompact = postCompact;
    }

    // Add session hooks if any were registered
    if (sessionStart.length > 0) {
      hooks.SessionStart = sessionStart;
    }
    if (sessionEnd.length > 0) {
      hooks.SessionEnd = sessionEnd;
    }

    // Add subagent hooks if any were registered
    if (subagentStart.length > 0) {
      hooks.SubagentStart = subagentStart;
    }
    if (subagentStop.length > 0) {
      hooks.SubagentStop = subagentStop;
    }

    // Add MCP hooks if any were registered
    if (mcpConnectionFailed.length > 0) {
      hooks.MCPConnectionFailed = mcpConnectionFailed;
    }
    if (mcpConnectionRestored.length > 0) {
      hooks.MCPConnectionRestored = mcpConnectionRestored;
    }

    // Add interrupt hooks if any were registered
    if (interruptRequested.length > 0) {
      hooks.InterruptRequested = interruptRequested;
    }
    if (interruptResolved.length > 0) {
      hooks.InterruptResolved = interruptResolved;
    }

    // Add custom hooks if any were registered
    if (Object.keys(customHooks).length > 0) {
      hooks.Custom = { ...customHooks };
    }

    return hooks;
  }

  return { context, getHooks };
}
