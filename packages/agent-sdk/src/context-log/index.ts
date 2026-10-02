/**
 * Experimental context log mode: contracts, errors and the in-memory store.
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
export {
  CONTEXT_UNAVAILABLE,
  type ContextSlotValue,
  type ContextUnavailablePayload,
  createSlotContextProducer,
  type SlotContextProducerOptions,
} from "./producers.js";
export { activeContextEntries } from "./supersession.js";
export * from "./types.js";
