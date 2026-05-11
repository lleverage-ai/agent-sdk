/**
 * Core type definitions for agent-threads (ledger layer).
 *
 * @module
 */

/**
 * Current canonical message schema version. Bump when {@link CanonicalMessage}
 * or any of its nested part shapes change in a way persisted carriers must
 * detect.
 *
 * @category Canonical
 */
export const CANONICAL_MESSAGE_SCHEMA_VERSION = 2;

/**
 * JSON primitive values.
 *
 * @category Canonical
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * A JSON-serializable value (primitive, object, or array).
 *
 * @category Canonical
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * A JSON-serializable object whose keys are strings and values are
 * {@link JsonValue}.
 *
 * @category Canonical
 */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * A JSON-serializable array of {@link JsonValue}.
 *
 * @category Canonical
 */
export type JsonArray = readonly JsonValue[];

/**
 * A text segment within a canonical message.
 *
 * @category Canonical
 */
export interface TextPart {
  /** Discriminator for {@link CanonicalPart}. */
  readonly type: "text";
  /** Raw text content of the segment. */
  readonly text: string;
}

/**
 * A reasoning/thinking segment within a canonical message.
 *
 * @category Canonical
 */
export interface ReasoningPart {
  /** Discriminator for {@link CanonicalPart}. */
  readonly type: "reasoning";
  /** Raw reasoning content emitted by the model. */
  readonly text: string;
}

/**
 * Additional JSON-compatible metadata preserved on tool call and tool result parts.
 *
 * @category Canonical
 */
export interface ToolPartMetadata {
  readonly [key: string]: JsonValue;
}

/**
 * A tool invocation recorded within a canonical message.
 *
 * @category Canonical
 */
export interface ToolCallPart {
  /** Discriminator for {@link CanonicalPart}. */
  readonly type: "tool-call";
  /** Stable identifier the matching {@link ToolResultPart} references. */
  readonly toolCallId: string;
  /** Name of the tool being invoked. */
  readonly toolName: string;
  /** Arguments passed to the tool. Shape is tool-specific. */
  readonly input: unknown;
  /** Optional provider/runtime-specific metadata. */
  readonly metadata?: ToolPartMetadata;
}

/**
 * A tool result recorded as part of a tool-role message.
 *
 * @category Canonical
 */
export interface ToolResultPart {
  /** Discriminator for {@link CanonicalPart}. */
  readonly type: "tool-result";
  /** Identifier of the originating {@link ToolCallPart}. */
  readonly toolCallId: string;
  /** Name of the tool that produced the result. */
  readonly toolName: string;
  /** Result payload. Shape is tool-specific. */
  readonly output: unknown;
  /** Whether the tool reported an error rather than a successful result. */
  readonly isError: boolean;
  /** Optional provider/runtime-specific metadata. */
  readonly metadata?: ToolPartMetadata;
}

/**
 * A file attachment within a canonical message.
 *
 * @category Canonical
 */
export interface FilePart {
  /** Discriminator for {@link CanonicalPart}. */
  readonly type: "file";
  /** IANA media type of the referenced file. */
  readonly mimeType: string;
  /** URL or URI where the file content lives. */
  readonly url: string;
  /** Optional display name for the file. */
  readonly name?: string;
}

/**
 * Reason a transcript compaction summary was created.
 *
 * @category Canonical
 */
export type CompactionTrigger =
  | "token_threshold"
  | "hard_cap"
  | "growth_rate"
  | "error_fallback"
  | "manual";

/**
 * Structured anchor for a compaction summary. All fields are optional so
 * producers can populate only what they have signal for.
 *
 * @category Canonical
 */
export interface CompactionSummaryStructured {
  /** Top-line goal the conversation is pursuing. */
  readonly goal?: string;
  /** Constraints the user or system has imposed on the work. */
  readonly constraints?: readonly string[];
  /** Progress breakdown by lifecycle bucket. */
  readonly progress?: {
    /** Items already completed. */
    readonly done?: readonly string[];
    /** Items currently in flight. */
    readonly inProgress?: readonly string[];
    /** Items blocked on external action. */
    readonly blocked?: readonly string[];
  };
  /** Decisions made so far that should be preserved across compaction. */
  readonly decisions?: readonly string[];
  /** Planned next steps. */
  readonly nextSteps?: readonly string[];
  /** Critical context that must not be dropped (IDs, file paths, secrets refs). */
  readonly criticalContext?: readonly string[];
  /** Files referenced during the compacted range. */
  readonly relevantFiles?: readonly { readonly path: string; readonly note?: string }[];
  /** Producer-specific extensions, opaque to the canonical schema. */
  readonly extensions?: JsonObject;
}

/**
 * Persistent summary substituting for a contiguous range of canonical messages
 * when honoured by a summary-aware context builder.
 *
 * @category Canonical
 */
export interface CompactionSummaryPart {
  /** Discriminator for {@link CanonicalPart}. */
  readonly type: "compaction-summary";
  /** Stable identifier for this summary (used as the carrier message id). */
  readonly summaryId: string;
  /** Inclusive range of message ids the summary substitutes for. */
  readonly coveredRange: {
    /** First message id covered by the summary. */
    readonly startMessageId: string;
    /** Last message id covered by the summary. */
    readonly endMessageId: string;
  };
  /** Non-empty ordered list of message ids the summary replaces. */
  readonly coveredMessageIds: readonly [string, ...string[]];
  /** Plain-text rendering of the summary, used as a fallback when no structured form is honoured. */
  readonly text: string;
  /** Optional structured rendering preferred when the consumer supports it. */
  readonly structured?: CompactionSummaryStructured;
  /** Provenance metadata describing how the summary was generated. */
  readonly provenance: {
    /** Run id that produced the summary. */
    readonly runId: string;
    /** Model identifier used to summarise. */
    readonly model: string;
    /** Trigger that caused compaction. */
    readonly trigger: CompactionTrigger;
    /** Token usage spent on the summarisation call. */
    readonly tokens: {
      /** Prompt tokens consumed. */
      readonly input: number;
      /** Completion tokens consumed. */
      readonly output: number;
      /** Cached prompt tokens consumed, if reported by the provider. */
      readonly cachedInput?: number;
    };
    /** Wall-clock duration of the summarisation call in milliseconds. */
    readonly durationMs: number;
    /** Estimated token count of the original messages before compaction. */
    readonly tokensBefore: number;
    /** Estimated token count after substituting the summary. */
    readonly tokensAfter: number;
    /** ISO 8601 timestamp when the summary was created. */
    readonly createdAt: string;
  };
  /** Layer index — higher tiers summarise lower tiers. */
  readonly tier: number;
  /** Summary ids this summary absorbed (for tiered/rollup chains). */
  readonly absorbedSummaryIds?: readonly string[];
  /** Schema version of the summary payload itself. */
  readonly schemaVersion: 1;
}

/**
 * Discriminated union of all canonical message parts.
 *
 * @category Canonical
 */
export type CanonicalPart =
  | TextPart
  | ReasoningPart
  | ToolCallPart
  | ToolResultPart
  | FilePart
  | CompactionSummaryPart;

/**
 * Metadata attached to a canonical message.
 *
 * Persistence layers may set additional well-known keys here — notably
 * `isCompactionCarrier: true` to mark messages that carry a
 * {@link CompactionSummaryPart} as a branch annotation rather than a
 * regular conversation node.
 *
 * @category Canonical
 */
export interface CanonicalMessageMetadata {
  /** Schema version this message was written under. */
  readonly schemaVersion: number;
  /** Additional opaque metadata keys. */
  readonly [key: string]: unknown;
}

/**
 * A normalized immutable message in a conversation transcript.
 *
 * @category Canonical
 */
export interface CanonicalMessage {
  /** Stable identifier for this message. */
  readonly id: string;
  /** Parent message id, or `null` for conversation roots. */
  readonly parentMessageId: string | null;
  /** Author role of the message. */
  readonly role: "user" | "assistant" | "system" | "tool";
  /** Ordered parts that make up the message body. */
  readonly parts: readonly CanonicalPart[];
  /** ISO 8601 timestamp when the message was committed. */
  readonly createdAt: string;
  /** Schema-versioned metadata. */
  readonly metadata: CanonicalMessageMetadata;
}

/**
 * Explicit branch selections keyed by parent message ID. The value is the
 * child id to follow at each fork.
 *
 * @category Canonical
 */
export interface BranchSelections {
  readonly [parentMessageId: string]: string;
}

/**
 * Returns true when a canonical part is a {@link CompactionSummaryPart}.
 *
 * @param part - Canonical part to inspect
 * @returns True if `part.type === "compaction-summary"`
 *
 * @category Canonical
 */
export function isCompactionSummaryPart(part: CanonicalPart): part is CompactionSummaryPart {
  return part.type === "compaction-summary";
}

/**
 * Returns true when a canonical message is a compaction-summary carrier — i.e.
 * its metadata declares `isCompactionCarrier: true`.
 *
 * @param message - Canonical message to inspect
 * @returns True if the message carries a compaction summary as an annotation
 *
 * @category Canonical
 */
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

/**
 * Options for building context from a transcript.
 *
 * @category ContextBuilder
 */
export interface ContextBuilderOptions {
  /** Thread to build context for. */
  readonly threadId: string;
  /** Branch resolution strategy; defaults to `"active"`. See {@link GetTranscriptOptions}. */
  readonly branch?: "active" | "all" | { selections: BranchSelections };
  /** Maximum number of messages to return; takes the most recent when truncating. */
  readonly maxMessages?: number;
  /** When false, strips {@link ToolResultPart} entries from message parts. */
  readonly includeToolResults?: boolean;
  /** When false, strips {@link ReasoningPart} entries from message parts. */
  readonly includeReasoning?: boolean;
}

/**
 * Provenance metadata returned alongside built context.
 *
 * @category ContextBuilder
 */
export interface ProvenanceMetadata {
  /** Thread the context was built from. */
  readonly threadId: string;
  /** Number of messages in the built context. */
  readonly messageCount: number;
  /** Id of the first message in the built context, or `null` when empty. */
  readonly firstMessageId: string | null;
  /** Id of the last message in the built context, or `null` when empty. */
  readonly lastMessageId: string | null;
  /** Summary ids honoured by the builder, if any. */
  readonly summariesHonoured?: readonly string[];
}

/**
 * Built transcript context, paired with provenance metadata.
 *
 * @category ContextBuilder
 */
export interface BuiltContext {
  /** Messages in the built context, ordered for replay. */
  readonly messages: CanonicalMessage[];
  /** Provenance metadata describing how the context was built. */
  readonly provenance: ProvenanceMetadata;
}
