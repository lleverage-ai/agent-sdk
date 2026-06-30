/**
 * Core type definitions for agent-threads (ledger layer).
 *
 * Canonical transcript primitives are owned by `@lleverage-ai/agent-sdk` and
 * re-exported here for source compatibility with consumers that historically
 * imported them from `@lleverage-ai/agent-threads/ledger`. Keep this file the
 * single re-export point so the two packages cannot drift silently — if a new
 * canonical shape lands in `agent-sdk`, surface it here once and consumers
 * pick it up automatically.
 *
 * Types that are specific to the ledger layer (runs, thread trees,
 * reconciliation) are declared locally below.
 *
 * @module
 */

import type { BranchSelections, CanonicalMessage } from "../../canonical.js";

// ---------------------------------------------------------------------------
// Re-exports: canonical transcript primitives (owned by the canonical module)
// ---------------------------------------------------------------------------

export type {
  BranchSelections,
  CanonicalMessage,
  CanonicalMessageMetadata,
  CanonicalPart,
  CompactionSummaryPart,
  CompactionSummaryStructured,
  CompactionTrigger,
  FilePart,
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ReasoningPart,
  TextPart,
  ToolCallPart,
  ToolPartMetadata,
  ToolResultPart,
} from "../../canonical.js";
export {
  CANONICAL_MESSAGE_SCHEMA_VERSION,
  isCompactionCarrierMessage,
  isCompactionSummaryPart,
} from "../../canonical.js";

// ---------------------------------------------------------------------------
// Re-exports: context builder types (owned by the summary-context builder)
// ---------------------------------------------------------------------------

export type {
  BuiltContext,
  ContextBuilderOptions,
  ProvenanceMetadata,
} from "../../summary-context-builder.js";

// ---------------------------------------------------------------------------
// RunRecord
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a run.
 *
 * - `created` — Run registered but not yet streaming
 * - `streaming` — Actively receiving events
 * - `committed` — Successfully finalized with messages
 * - `failed` — Finalized due to an error
 * - `cancelled` — Finalized due to user cancellation
 * - `superseded` — Replaced by a newer run at the same fork point
 *
 * @category Types
 */
export type RunStatus =
  | "created"
  | "streaming"
  | "committed"
  | "failed"
  | "cancelled"
  | "superseded";

/**
 * Non-terminal run statuses.
 *
 * @category Types
 */
export type ActiveRunStatus = "created" | "streaming";

/**
 * Terminal run statuses.
 *
 * @category Types
 */
export type TerminalRunStatus = "committed" | "failed" | "cancelled" | "superseded";

/**
 * Run statuses that indicate a run is still active.
 *
 * @category Types
 */
export const ACTIVE_RUN_STATUSES = ["created", "streaming"] as const;

/**
 * Run statuses that indicate a run has reached a terminal state.
 *
 * @category Types
 */
export const TERMINAL_RUN_STATUSES = ["committed", "failed", "cancelled", "superseded"] as const;

/**
 * Type guard for active run statuses.
 *
 * @category Types
 */
export function isActiveRunStatus(status: RunStatus): status is ActiveRunStatus {
  return status === "created" || status === "streaming";
}

/**
 * Type guard for terminal run statuses.
 *
 * @category Types
 */
export function isTerminalRunStatus(status: RunStatus): status is TerminalRunStatus {
  return !isActiveRunStatus(status);
}

/**
 * A record of a single generation run within a thread.
 *
 * Invariants:
 * - `finishedAt` is `null` when `status` is an {@link ActiveRunStatus}
 * - `finishedAt` is a non-null ISO 8601 string when `status` is a {@link TerminalRunStatus}
 * - `messageCount` is 0 while active; set on finalization
 *
 * @category Types
 */
export interface RunRecord {
  /** ULID — unique run identifier */
  readonly runId: string;
  /** Thread this run belongs to */
  readonly threadId: string;
  /** Stream ID in the underlying IEventStore (format: "run:{runId}") */
  readonly streamId: string;
  /** If this run is a regeneration, the message it forks from */
  readonly forkFromMessageId: string | null;
  /** Current lifecycle status */
  readonly status: RunStatus;
  /** ISO 8601 creation timestamp */
  readonly createdAt: string;
  /** ISO 8601 finalization timestamp, or null if still active */
  readonly finishedAt: string | null;
  /** Number of canonical messages committed for this run (0 while active) */
  readonly messageCount: number;
}

// ---------------------------------------------------------------------------
// Operation Types
// ---------------------------------------------------------------------------

/**
 * Options for beginning a new run.
 *
 * @category Types
 */
export interface BeginRunOptions {
  /** Thread to create the run in */
  threadId: string;
  /** Optional fork point for regeneration */
  forkFromMessageId?: string;
}

/**
 * Options for finalizing a committed run.
 *
 * @category Types
 */
export interface FinalizeCommittedRunOptions {
  /** The run to finalize */
  runId: string;
  /** Terminal status */
  status: "committed";
  /** Messages produced by the accumulator */
  messages: CanonicalMessage[];
}

/**
 * Options for finalizing a non-committed run.
 *
 * @category Types
 */
export interface FinalizeNonCommittedRunOptions {
  /** The run to finalize */
  runId: string;
  /** Terminal status */
  status: Extract<TerminalRunStatus, "failed" | "cancelled">;
}

/**
 * Options for finalizing a run.
 *
 * @category Types
 */
export type FinalizeRunOptions = FinalizeCommittedRunOptions | FinalizeNonCommittedRunOptions;

/**
 * Result of finalizing a run.
 *
 * @category Types
 */
export interface FinalizeResult {
  /** Whether the finalization succeeded */
  committed: boolean;
  /** Run IDs that were superseded as a result of this finalization */
  supersededRunIds: string[];
}

/**
 * Branch selector modes for transcript retrieval:
 *
 * - `"active"` - Resolve a single active branch path through each fork (default)
 * - `"all"` - Return all messages in insertion order across all branches
 * - `{ selections }` - Force specific child selections at fork points, with
 *   active-mode fallback when a selection key is missing
 *
 * @category Types
 */
export interface GetTranscriptOptions {
  /** Thread to retrieve from */
  threadId: string;
  /** Branch resolution strategy */
  branch?: "active" | "all" | { selections: BranchSelections };
}

/**
 * Lightweight message node metadata for thread tree navigation.
 *
 * @category Types
 */
export interface ThreadTreeNode {
  /** Message identifier */
  readonly messageId: string;
  /** Parent message identifier (or null for roots) */
  readonly parentMessageId: string | null;
  /** Author role */
  readonly role: CanonicalMessage["role"];
  /** Run that produced this message */
  readonly runId: string;
  /** Current lifecycle status of the producing run */
  readonly runStatus: RunStatus;
}

/**
 * Metadata describing a branch fork point.
 *
 * @category Types
 */
export interface ForkPoint {
  /** Message ID where the fork occurs (parent of diverging children) */
  readonly forkMessageId: string;
  /** Child message IDs at this fork, ordered by insertion order (`messages.ordinal`) */
  readonly children: readonly [string, string, ...string[]];
  /** Child currently considered active for this fork point */
  readonly activeChildId: string;
}

/**
 * Thread tree metadata for branch navigation UIs.
 *
 * @category Types
 */
export interface ThreadTree {
  /** All message nodes in the thread */
  readonly nodes: readonly ThreadTreeNode[];
  /** Fork points with active branch selection */
  readonly forkPoints: readonly ForkPoint[];
}

// ---------------------------------------------------------------------------
// Reconciliation Types
// ---------------------------------------------------------------------------

/**
 * Information about a stale (potentially abandoned) run.
 *
 * @category Types
 */
export interface StaleRunInfo {
  /** The stale run record */
  run: RunRecord;
  /** How long the run has been stale (ms) */
  staleDurationMs: number;
}

/**
 * Options for recovering a stale run.
 *
 * @category Types
 */
export interface RecoverRunOptions {
  /** The run to recover */
  runId: string;
  /** Recovery action to take */
  action: "fail" | "cancel";
}

/**
 * Result of recovering a stale run.
 *
 * @category Types
 */
export interface RecoverResult {
  /** The run ID that was recovered */
  runId: string;
  /** The previous status before recovery */
  previousStatus: ActiveRunStatus;
  /** The new status after recovery */
  newStatus: Extract<TerminalRunStatus, "failed" | "cancelled">;
}
