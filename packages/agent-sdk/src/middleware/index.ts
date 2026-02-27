/**
 * Middleware system for agent cross-cutting concerns.
 *
 * Middleware provides a clean API for adding features like logging, metrics,
 * caching, and rate limiting to agents. Middleware wraps the underlying hook
 * system with a more ergonomic interface.
 *
 * @example
 * ```typescript
 * import {
 *   createAgent,
 *   createLoggingMiddleware,
 *   createConsoleTransport,
 * } from "@lleverage-ai/agent-sdk";
 *
 * const agent = createAgent({
 *   model,
 *   middleware: [
 *     createLoggingMiddleware({ transport: createConsoleTransport() }),
 *   ],
 * });
 * ```
 *
 * @packageDocumentation
 */

// Application utilities
export {
  applyMiddleware,
  mergeHooks,
  setupMiddleware,
  teardownMiddleware,
} from "./apply.js";

// Context creation (internal)
export { createMiddlewareContext } from "./context.js";
export type { LoggingMiddlewareOptions } from "./logging.js";

// Built-in middleware
export { createLoggingMiddleware } from "./logging.js";
// Types
export type {
  AgentMiddleware,
  MiddlewareContext,
  MiddlewareContextResult,
} from "./types.js";
