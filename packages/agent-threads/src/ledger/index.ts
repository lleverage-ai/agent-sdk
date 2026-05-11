/**
 * Ledger-layer exports for @lleverage-ai/agent-threads.
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
  CompactionSummaryPart,
  CompactionSummaryStructured,
  CompactionTrigger,
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
  BranchSelections,
  GetTranscriptOptions,
  ThreadTreeNode,
  ForkPoint,
  ThreadTree,
  StaleRunInfo,
  RecoverRunOptions,
  RecoverResult,
  ContextBuilderOptions,
  ProvenanceMetadata,
  BuiltContext,
} from "./types.js";
export {
  ACTIVE_RUN_STATUSES,
  CANONICAL_MESSAGE_SCHEMA_VERSION,
  TERMINAL_RUN_STATUSES,
  isActiveRunStatus,
  isTerminalRunStatus,
} from "./types.js";

// ULID utilities
export { ulid, createCounterIdGenerator } from "./ulid.js";
export type { IdGenerator } from "./ulid.js";

// Accumulator
export {
  createAccumulatorProjectorConfig,
  createAccumulatorProjector,
  accumulateEvents,
} from "./accumulator.js";
export type { AccumulatorState } from "./accumulator.js";

// Run orchestration
export { RunManager } from "./run-manager.js";

// Reconciliation
export { DEFAULT_STALE_THRESHOLD_MS, listStaleRuns, recoverAllStaleRuns } from "./reconciliation.js";
export type { ListStaleRunsOptions, RecoverAllResult } from "./reconciliation.js";

// Context building
export { createLedgerCompactionStore } from "./compaction-store.js";
export type { CompactionStore } from "./compaction-store.js";
// Builder primitives are owned by agent-sdk; re-exported here for convenience.
export { FullContextBuilder, SummaryAwareContextBuilder } from "@lleverage-ai/agent-sdk";
export type { IContextBuilder } from "@lleverage-ai/agent-sdk";

// Stores
export type { ILedgerStore } from "./stores/ledger-store.js";
export { InMemoryLedgerStore } from "./stores/memory.js";
export { SQLiteLedgerStore } from "./stores/sqlite.js";
