/**
 * Experimental context log mode: contracts, errors, the in-memory store and
 * the default projection adapter.
 *
 * The conformance suite is exported from `@lleverage-ai/agent-sdk/testing`.
 *
 * @packageDocumentation
 */

export {
  type ContextLogConflictReason,
  ContextLogConflictError,
  ContextLogError,
  type ContextLogErrorKind,
  ContextLogInvalidError,
  ContextLogNotFoundError,
  ContextLogRefusedError,
  type ContextLogResource,
  ContextLogUnavailableError,
  isContextLogError,
} from "./errors.js";
export { assertContextJson, canonicalContextJson } from "./json.js";
export { MemoryContextLogStore } from "./memory-store.js";
export { createMessageProjectionAdapter } from "./projection.js";
export { activeContextEntries } from "./supersession.js";
export * from "./types.js";
