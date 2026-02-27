/**
 * Public API exports for @lleverage-ai/agent-ledger.
 *
 * @module
 */

// Types
export type {
  TextPart,
  ReasoningPart,
  ToolCallPart,
  ToolResultPart,
  FilePart,
  CanonicalPart,
  CanonicalMessageMetadata,
  CanonicalMessage,
  RunStatus,
  ActiveRunStatus,
  TerminalRunStatus,
  RunRecord,
  BeginRunOptions,
  FinalizeCommittedRunOptions,
  FinalizeNonCommittedRunOptions,
  FinalizeRunOptions,
  FinalizeResult,
  GetTranscriptOptions,
  StaleRunInfo,
  RecoverRunOptions,
  RecoverResult,
  ContextBuilderOptions,
  ProvenanceMetadata,
  BuiltContext,
} from "./types.js";
export {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  isActiveRunStatus,
  isTerminalRunStatus,
} from "./types.js";

// ULID utilities
export { ulid, createCounterIdGenerator } from "./ulid.js";
export type { IdGenerator } from "./ulid.js";

// Accumulator
export { createAccumulatorProjectorConfig, createAccumulatorProjector, accumulateEvents } from "./accumulator.js";
export type { AccumulatorState } from "./accumulator.js";

// Run orchestration
export { RunManager } from "./run-manager.js";

// Reconciliation
export { DEFAULT_STALE_THRESHOLD_MS, listStaleRuns, recoverAllStaleRuns } from "./reconciliation.js";
export type { ListStaleRunsOptions } from "./reconciliation.js";

// Re-export Logger from agent-stream for convenience
export type { Logger } from "@lleverage-ai/agent-stream";

// Context building
export { FullContextBuilder } from "./context-builder.js";
export type { IContextBuilder } from "./context-builder.js";

// Stores
export type { ILedgerStore } from "./stores/ledger-store.js";
export { InMemoryLedgerStore } from "./stores/memory.js";
export { SQLiteLedgerStore } from "./stores/sqlite.js";
