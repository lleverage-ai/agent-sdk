/**
 * Core type definitions for agent-threads (ledger layer).
 *
 * @module
 */

/** Current canonical message schema version. */
export const CANONICAL_MESSAGE_SCHEMA_VERSION = 2;

/** JSON primitive values. */
export type JsonPrimitive = string | number | boolean | null;

/** A JSON-serializable value. */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** A JSON-serializable object. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** A JSON-serializable array. */
export type JsonArray = readonly JsonValue[];

/** A text segment within a canonical message. */
export interface TextPart {
  readonly type: "text";
  readonly text: string;
}

/** A reasoning/thinking segment within a canonical message. */
export interface ReasoningPart {
  readonly type: "reasoning";
  readonly text: string;
}

/** Additional JSON-compatible metadata preserved on tool call and tool result parts. */
export interface ToolPartMetadata {
  readonly [key: string]: JsonValue;
}

/** A tool invocation recorded within a canonical message. */
export interface ToolCallPart {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly metadata?: ToolPartMetadata;
}

/** A tool result recorded as part of a tool-role message. */
export interface ToolResultPart {
  readonly type: "tool-result";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: unknown;
  readonly isError: boolean;
  readonly metadata?: ToolPartMetadata;
}

/** A file attachment within a canonical message. */
export interface FilePart {
  readonly type: "file";
  readonly mimeType: string;
  readonly url: string;
  readonly name?: string;
}

/** Reason a transcript compaction summary was created. */
export type CompactionTrigger =
  | "token_threshold"
  | "hard_cap"
  | "growth_rate"
  | "error_fallback"
  | "manual";

/** Structured anchor for a compaction summary. */
export interface CompactionSummaryStructured {
  readonly goal?: string;
  readonly constraints?: readonly string[];
  readonly progress?: {
    readonly done?: readonly string[];
    readonly inProgress?: readonly string[];
    readonly blocked?: readonly string[];
  };
  readonly decisions?: readonly string[];
  readonly nextSteps?: readonly string[];
  readonly criticalContext?: readonly string[];
  readonly relevantFiles?: readonly { readonly path: string; readonly note?: string }[];
  readonly extensions?: JsonObject;
}

/** Persistent summary substituting for a covered canonical message range. */
export interface CompactionSummaryPart {
  readonly type: "compaction-summary";
  readonly summaryId: string;
  readonly coveredRange: {
    readonly startMessageId: string;
    readonly endMessageId: string;
  };
  readonly coveredMessageIds: readonly [string, ...string[]];
  readonly text: string;
  readonly structured?: CompactionSummaryStructured;
  readonly provenance: {
    readonly runId: string;
    readonly model: string;
    readonly trigger: CompactionTrigger;
    readonly tokens: {
      readonly input: number;
      readonly output: number;
      readonly cachedInput?: number;
    };
    readonly durationMs: number;
    readonly tokensBefore: number;
    readonly tokensAfter: number;
    readonly createdAt: string;
  };
  readonly tier: number;
  readonly absorbedSummaryIds?: readonly string[];
  readonly schemaVersion: 1;
}

/** Discriminated union of all canonical message parts. */
export type CanonicalPart =
  | TextPart
  | ReasoningPart
  | ToolCallPart
  | ToolResultPart
  | FilePart
  | CompactionSummaryPart;

/** Metadata attached to a canonical message. */
export interface CanonicalMessageMetadata {
  readonly schemaVersion: number;
  readonly [key: string]: unknown;
}

/** A normalized immutable message in a conversation transcript. */
export interface CanonicalMessage {
  readonly id: string;
  readonly parentMessageId: string | null;
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly parts: readonly CanonicalPart[];
  readonly createdAt: string;
  readonly metadata: CanonicalMessageMetadata;
}

/** Explicit branch selections keyed by parent message ID. */
export interface BranchSelections {
  readonly [parentMessageId: string]: string;
}

/** Returns true when a canonical part is a compaction summary. */
export function isCompactionSummaryPart(part: CanonicalPart): part is CompactionSummaryPart {
  return part.type === "compaction-summary";
}

/** Returns true when a canonical message carries a compaction-summary annotation. */
export function isCompactionCarrierMessage(message: CanonicalMessage): boolean {
  return message.metadata.isCompactionCarrier === true;
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

// ---------------------------------------------------------------------------
// Context Builder Types
// ---------------------------------------------------------------------------

/** Options for building context from a transcript. */
export interface ContextBuilderOptions {
  readonly threadId: string;
  readonly branch?: "active" | "all" | { selections: BranchSelections };
  readonly maxMessages?: number;
  readonly includeToolResults?: boolean;
  readonly includeReasoning?: boolean;
}

/** Provenance metadata for built context. */
export interface ProvenanceMetadata {
  readonly threadId: string;
  readonly messageCount: number;
  readonly firstMessageId: string | null;
  readonly lastMessageId: string | null;
  readonly summariesHonoured?: readonly string[];
}

/** Built transcript context. */
export interface BuiltContext {
  readonly messages: CanonicalMessage[];
  readonly provenance: ProvenanceMetadata;
}
