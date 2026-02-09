/**
 * Middleware application utilities.
 *
 * Applies middleware to collect hooks and manages middleware lifecycle.
 *
 * @packageDocumentation
 */

import type { HookMatcher, HookRegistration } from "../types.js";
import { createMiddlewareContext } from "./context.js";
import type { AgentMiddleware } from "./types.js";

/**
 * Applies an array of middleware and returns the combined HookRegistration.
 *
 * Processes middleware in order, preserving hook registration order.
 * Each middleware's hooks are added to the combined registration in the
 * order the middleware appears in the array.
 *
 * @param middleware - Array of middleware to apply
 * @returns Combined HookRegistration from all middleware
 *
 * @example
 * ```typescript
 * const middleware = [
 *   createLoggingMiddleware({ transport: consoleTransport }),
 *   createMetricsMiddleware({ registry }),
 * ];
 *
 * const hooks = applyMiddleware(middleware);
 * // hooks contains all hooks from both middleware
 * ```
 *
 * @category Middleware
 */
export function applyMiddleware(middleware: AgentMiddleware[]): HookRegistration {
  if (middleware.length === 0) {
    return {};
  }

  // Create a shared context that all middleware will register into
  const { context, getHooks } = createMiddlewareContext();

  // Let each middleware register its hooks
  for (const mw of middleware) {
    try {
      mw.register(context);
    } catch (error) {
      console.error(`Error registering middleware "${mw.name}":`, error);
      // Continue with other middleware even if one fails
    }
  }

  return getHooks();
}

/**
 * Calls setup on all middleware that have a setup method.
 *
 * @param middleware - Array of middleware to setup
 * @returns Promise that resolves when all setup is complete
 *
 * @category Middleware
 */
export async function setupMiddleware(middleware: AgentMiddleware[]): Promise<void> {
  const setupPromises = middleware
    .filter((mw) => mw.setup !== undefined)
    .map(async (mw) => {
      try {
        await mw.setup!();
      } catch (error) {
        console.error(`Error in middleware "${mw.name}" setup:`, error);
      }
    });

  await Promise.all(setupPromises);
}

/**
 * Calls teardown on all middleware that have a teardown method.
 *
 * @param middleware - Array of middleware to teardown
 * @returns Promise that resolves when all teardown is complete
 *
 * @category Middleware
 */
export async function teardownMiddleware(middleware: AgentMiddleware[]): Promise<void> {
  const teardownPromises = middleware
    .filter((mw) => mw.teardown !== undefined)
    .map(async (mw) => {
      try {
        await mw.teardown!();
      } catch (error) {
        console.error(`Error in middleware "${mw.name}" teardown:`, error);
      }
    });

  await Promise.all(teardownPromises);
}

/**
 * Merges multiple HookRegistration objects into one.
 *
 * Hooks are concatenated in order for each event type. This allows
 * combining hooks from middleware with explicitly provided hooks.
 *
 * @param registrations - HookRegistration objects to merge
 * @returns Merged HookRegistration
 *
 * @example
 * ```typescript
 * const middlewareHooks = applyMiddleware(middleware);
 * const explicitHooks = { PreToolUse: [{ matcher: "bash", hooks: [requireApproval] }] };
 *
 * const merged = mergeHooks(middlewareHooks, explicitHooks);
 * // merged contains hooks from both, with middleware hooks first
 * ```
 *
 * @category Middleware
 */
export function mergeHooks(...registrations: (HookRegistration | undefined)[]): HookRegistration {
  const result: HookRegistration = {};

  for (const reg of registrations) {
    if (!reg) continue;

    // Merge generation hooks (arrays of HookCallback)
    if (reg.PreGenerate) {
      result.PreGenerate = [...(result.PreGenerate ?? []), ...reg.PreGenerate];
    }
    if (reg.PostGenerate) {
      result.PostGenerate = [...(result.PostGenerate ?? []), ...reg.PostGenerate];
    }
    if (reg.PostGenerateFailure) {
      result.PostGenerateFailure = [
        ...(result.PostGenerateFailure ?? []),
        ...reg.PostGenerateFailure,
      ];
    }

    // Merge tool hooks (arrays of HookMatcher)
    if (reg.PreToolUse) {
      result.PreToolUse = mergeToolHooks(result.PreToolUse, reg.PreToolUse);
    }
    if (reg.PostToolUse) {
      result.PostToolUse = mergeToolHooks(result.PostToolUse, reg.PostToolUse);
    }
    if (reg.PostToolUseFailure) {
      result.PostToolUseFailure = mergeToolHooks(result.PostToolUseFailure, reg.PostToolUseFailure);
    }

    // Merge compaction hooks
    if (reg.PreCompact) {
      result.PreCompact = [...(result.PreCompact ?? []), ...reg.PreCompact];
    }
    if (reg.PostCompact) {
      result.PostCompact = [...(result.PostCompact ?? []), ...reg.PostCompact];
    }

    // Merge session hooks
    if (reg.SessionStart) {
      result.SessionStart = [...(result.SessionStart ?? []), ...reg.SessionStart];
    }
    if (reg.SessionEnd) {
      result.SessionEnd = [...(result.SessionEnd ?? []), ...reg.SessionEnd];
    }

    // Merge subagent hooks
    if (reg.SubagentStart) {
      result.SubagentStart = [...(result.SubagentStart ?? []), ...reg.SubagentStart];
    }
    if (reg.SubagentStop) {
      result.SubagentStop = [...(result.SubagentStop ?? []), ...reg.SubagentStop];
    }

    // Merge MCP hooks
    if (reg.MCPConnectionFailed) {
      result.MCPConnectionFailed = [
        ...(result.MCPConnectionFailed ?? []),
        ...reg.MCPConnectionFailed,
      ];
    }
    if (reg.MCPConnectionRestored) {
      result.MCPConnectionRestored = [
        ...(result.MCPConnectionRestored ?? []),
        ...reg.MCPConnectionRestored,
      ];
    }

    // Merge tool registry hooks
    if (reg.ToolRegistered) {
      result.ToolRegistered = [...(result.ToolRegistered ?? []), ...reg.ToolRegistered];
    }
    if (reg.ToolLoadError) {
      result.ToolLoadError = [...(result.ToolLoadError ?? []), ...reg.ToolLoadError];
    }

    // Merge interrupt hooks
    if (reg.InterruptRequested) {
      result.InterruptRequested = [
        ...(result.InterruptRequested ?? []),
        ...reg.InterruptRequested,
      ];
    }
    if (reg.InterruptResolved) {
      result.InterruptResolved = [
        ...(result.InterruptResolved ?? []),
        ...reg.InterruptResolved,
      ];
    }

    // Merge team lifecycle hooks
    if (reg.TeamMessageReceived) {
      result.TeamMessageReceived = [
        ...(result.TeamMessageReceived ?? []),
        ...reg.TeamMessageReceived,
      ];
    }
    if (reg.TeamTaskAssigned) {
      result.TeamTaskAssigned = [...(result.TeamTaskAssigned ?? []), ...reg.TeamTaskAssigned];
    }
    if (reg.TeamTaskCompleted) {
      result.TeamTaskCompleted = [...(result.TeamTaskCompleted ?? []), ...reg.TeamTaskCompleted];
    }
    if (reg.TeamTaskCreated) {
      result.TeamTaskCreated = [...(result.TeamTaskCreated ?? []), ...reg.TeamTaskCreated];
    }
    if (reg.TeamTaskFailed) {
      result.TeamTaskFailed = [...(result.TeamTaskFailed ?? []), ...reg.TeamTaskFailed];
    }
    if (reg.TeamTeammateSpawned) {
      result.TeamTeammateSpawned = [
        ...(result.TeamTeammateSpawned ?? []),
        ...reg.TeamTeammateSpawned,
      ];
    }
    if (reg.TeamTeammateCrashed) {
      result.TeamTeammateCrashed = [
        ...(result.TeamTeammateCrashed ?? []),
        ...reg.TeamTeammateCrashed,
      ];
    }
    if (reg.TeamShutdownRequested) {
      result.TeamShutdownRequested = [
        ...(result.TeamShutdownRequested ?? []),
        ...reg.TeamShutdownRequested,
      ];
    }
    if (reg.TeamShutdownComplete) {
      result.TeamShutdownComplete = [
        ...(result.TeamShutdownComplete ?? []),
        ...reg.TeamShutdownComplete,
      ];
    }
    if (reg.TeamPlanSubmitted) {
      result.TeamPlanSubmitted = [...(result.TeamPlanSubmitted ?? []), ...reg.TeamPlanSubmitted];
    }
    if (reg.TeamPlanApproved) {
      result.TeamPlanApproved = [...(result.TeamPlanApproved ?? []), ...reg.TeamPlanApproved];
    }
    if (reg.TeamPlanRejected) {
      result.TeamPlanRejected = [...(result.TeamPlanRejected ?? []), ...reg.TeamPlanRejected];
    }
  }

  return result;
}

/**
 * Merges tool hook matchers.
 *
 * Tool hooks use HookMatcher arrays which need special handling.
 * Matchers with the same pattern have their hooks combined.
 *
 * @param existing - Existing tool hook matchers
 * @param incoming - Incoming tool hook matchers
 * @returns Merged tool hook matchers
 *
 * @internal
 */
function mergeToolHooks(
  existing: HookMatcher[] | undefined,
  incoming: HookMatcher[],
): HookMatcher[] {
  if (!existing) {
    return [...incoming];
  }

  const result = [...existing];

  for (const incomingMatcher of incoming) {
    // Look for existing matcher with same pattern
    const existingIndex = result.findIndex((m) => m.matcher === incomingMatcher.matcher);

    if (existingIndex >= 0) {
      // Merge hooks into existing matcher
      const existingMatcher = result[existingIndex]!;
      result[existingIndex] = {
        ...existingMatcher,
        hooks: [...existingMatcher.hooks, ...incomingMatcher.hooks],
      };
    } else {
      // Add new matcher
      result.push(incomingMatcher);
    }
  }

  return result;
}
