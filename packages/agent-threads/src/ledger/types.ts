/**
 * Core type definitions for agent-threads (ledger layer).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Canonical Parts
// ---------------------------------------------------------------------------

/**
 * A text segment within a canonical message.
 *
 * @category Types
 */
export interface TextPart {
  readonly type: "text";
  readonly text: string;
}

/**
 * A reasoning/thinking segment within a canonical message.
 *
 * @category Types
 */
export interface ReasoningPart {
  readonly type: "reasoning";
  readonly text: string;
}

/**
 * A tool invocation recorded within a canonical message.
 *
 * @category Types
 */
export interface ToolCallPart {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}

/**
 * A tool result recorded as part of a tool-role message.
 *
 * @category Types
 */
export interface ToolResultPart {
  readonly type: "tool-result";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: unknown;
  readonly isError: boolean;
}

/**
 * A file attachment within a canonical message.
 *
 * @category Types
 */
export interface FilePart {
  readonly type: "file";
  readonly mimeType: string;
  readonly url: string;
  readonly name?: string;
}

/**
 * Discriminated union of all canonical message parts.
 *
 * @category Types
 */
export type CanonicalPart = TextPart | ReasoningPart | ToolCallPart | ToolResultPart | FilePart;

/**
 * Metadata attached to a canonical message.
 *
 * @category Types
 */
export interface CanonicalMessageMetadata {
  /** Schema version for canonical message serialization format */
  readonly schemaVersion: number;
  /** Additional extensible metadata fields */
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// CanonicalMessage
// ---------------------------------------------------------------------------

/**
 * A normalized message in a conversation transcript.
 *
 * Messages are immutable once committed. The `id` is a ULID that
 * provides both uniqueness and temporal ordering.
 *
 * @category Types
 */
export interface CanonicalMessage {
  /** ULID — unique within the thread */
  readonly id: string;
  /** Parent message ID, or null for root messages */
  readonly parentMessageId: string | null;
  /** The role of the message author */
  readonly role: "user" | "assistant" | "system" | "tool";
  /** Ordered content parts */
  readonly parts: readonly CanonicalPart[];
  /** ISO 8601 timestamp of when the message was created */
  readonly createdAt: string;
  /** Extensible metadata (always includes `schemaVersion`) */
  readonly metadata: CanonicalMessageMetadata;
}

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
 * Options for retrieving a transcript.
 *
 * @category Types
 */
export type BranchSelections = Record<string, string>;

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
  readonly children: readonly string[];
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

// ---------------------------------------------------------------------------
// Context Builder Types (experimental)
// ---------------------------------------------------------------------------

/**
 * Options for building context from a transcript.
 *
 * @experimental
 * @category Types
 */
export interface ContextBuilderOptions {
  /** Thread to build context from */
  threadId: string;
  /** Maximum number of messages to include */
  maxMessages?: number;
  /** Whether to include tool results */
  includeToolResults?: boolean;
  /** Whether to include reasoning parts */
  includeReasoning?: boolean;
}

/**
 * Provenance metadata tracking where context was sourced from.
 *
 * @experimental
 * @category Types
 */
export interface ProvenanceMetadata {
  /** Thread the context was built from */
  threadId: string;
  /** Number of messages included */
  messageCount: number;
  /** ID of the earliest message included */
  firstMessageId: string | null;
  /** ID of the latest message included */
  lastMessageId: string | null;
}

/**
 * The result of building context from a transcript.
 *
 * @experimental
 * @category Types
 */
export interface BuiltContext {
  /** Messages formatted for consumption */
  messages: CanonicalMessage[];
  /** Provenance tracking */
  provenance: ProvenanceMetadata;
}
