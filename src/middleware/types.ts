/**
 * Middleware type definitions.
 *
 * Middleware provides a clean API for adding cross-cutting concerns like
 * logging, metrics, caching, and rate limiting to agents. Middleware wraps
 * the underlying hook system with a more ergonomic interface.
 *
 * @packageDocumentation
 */

import type { HookCallback, HookRegistration } from "../types.js";

/**
 * Context provided to middleware for registering hooks.
 *
 * Middleware uses this context to register event handlers during agent
 * creation. Hooks are registered in middleware order, preserving the
 * order in which middleware was added.
 *
 * @category Middleware
 */
export interface MiddlewareContext {
  /**
   * Register a PreGenerate hook.
   * Called before each generation request.
   */
  onPreGenerate(callback: HookCallback): void;

  /**
   * Register a PostGenerate hook.
   * Called after each successful generation.
   */
  onPostGenerate(callback: HookCallback): void;

  /**
   * Register a PostGenerateFailure hook.
   * Called when generation fails.
   */
  onPostGenerateFailure(callback: HookCallback): void;

  /**
   * Register a PreToolUse hook.
   * Called before each tool execution.
   *
   * @param callback - The hook callback to invoke
   * @param matcher - Optional regex pattern to match tool names (e.g., "Write|Edit")
   */
  onPreToolUse(callback: HookCallback, matcher?: string): void;

  /**
   * Register a PostToolUse hook.
   * Called after each successful tool execution.
   *
   * @param callback - The hook callback to invoke
   * @param matcher - Optional regex pattern to match tool names
   */
  onPostToolUse(callback: HookCallback, matcher?: string): void;

  /**
   * Register a PostToolUseFailure hook.
   * Called when tool execution fails.
   *
   * @param callback - The hook callback to invoke
   * @param matcher - Optional regex pattern to match tool names
   */
  onPostToolUseFailure(callback: HookCallback, matcher?: string): void;

  /**
   * Register a PreCompact hook.
   * Called before context compaction.
   */
  onPreCompact(callback: HookCallback): void;

  /**
   * Register a PostCompact hook.
   * Called after context compaction.
   */
  onPostCompact(callback: HookCallback): void;

  /**
   * Register a SessionStart hook.
   * Called when a session starts.
   */
  onSessionStart(callback: HookCallback): void;

  /**
   * Register a SessionEnd hook.
   * Called when a session ends.
   */
  onSessionEnd(callback: HookCallback): void;

  /**
   * Register a SubagentStart hook.
   * Called when a subagent starts.
   */
  onSubagentStart(callback: HookCallback): void;

  /**
   * Register a SubagentStop hook.
   * Called when a subagent stops.
   */
  onSubagentStop(callback: HookCallback): void;

  /**
   * Register an MCPConnectionFailed hook.
   * Called when an MCP connection fails.
   */
  onMCPConnectionFailed(callback: HookCallback): void;

  /**
   * Register an MCPConnectionRestored hook.
   * Called when an MCP connection is restored.
   */
  onMCPConnectionRestored(callback: HookCallback): void;

  /**
   * Register an InterruptRequested hook.
   * Called when an interrupt is requested (approval request, custom interrupt, etc.).
   */
  onInterruptRequested(callback: HookCallback): void;

  /**
   * Register an InterruptResolved hook.
   * Called when an interrupt is resolved (approved, denied, or custom response).
   */
  onInterruptResolved(callback: HookCallback): void;
}

/**
 * Agent middleware interface.
 *
 * Middleware registers hooks and can have lifecycle methods for setup and
 * teardown. Middleware provides a cleaner API than raw hooks for adding
 * cross-cutting concerns to agents.
 *
 * @example
 * ```typescript
 * const loggingMiddleware: AgentMiddleware = {
 *   name: "logging",
 *   register(ctx) {
 *     ctx.onPreGenerate(async (input) => {
 *       console.log("Generation starting");
 *       return {};
 *     });
 *     ctx.onPostGenerate(async (input) => {
 *       console.log("Generation complete");
 *       return {};
 *     });
 *   },
 * };
 * ```
 *
 * @category Middleware
 */
export interface AgentMiddleware {
  /**
   * Unique middleware name.
   * Used for debugging and error messages.
   */
  name: string;

  /**
   * Called during agent creation to register hooks.
   *
   * Use the context to register event handlers for various lifecycle events.
   * Hooks are executed in the order middleware was added to the agent.
   *
   * @param context - The middleware context for registering hooks
   */
  register(context: MiddlewareContext): void;

  /**
   * Optional setup called during agent creation.
   *
   * Use this for initialization that needs to happen before the agent
   * starts processing requests, such as establishing connections or
   * loading configuration.
   */
  setup?(): Promise<void> | void;

  /**
   * Optional teardown for cleanup.
   *
   * Use this to clean up resources when the agent is being disposed,
   * such as closing connections or flushing buffers.
   */
  teardown?(): Promise<void> | void;
}

/**
 * Result of creating a middleware context.
 *
 * Contains the context for registering hooks and a function to retrieve
 * the collected hook registrations.
 *
 * @category Middleware
 * @internal
 */
export interface MiddlewareContextResult {
  /** The context provided to middleware for registering hooks */
  context: MiddlewareContext;
  /** Get the collected hook registrations */
  getHooks(): HookRegistration;
}
