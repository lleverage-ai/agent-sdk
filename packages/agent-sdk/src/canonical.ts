/**
 * Canonical transcript types shared by agent runtimes and persistence layers.
 *
 * @module
 */

/**
 * Current canonical message schema version.
 *
 * @category Types
 */
export const CANONICAL_MESSAGE_SCHEMA_VERSION = 2;

/**
 * JSON primitive values.
 *
 * @category Types
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * A JSON-serializable value.
 *
 * @category Types
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * A JSON-serializable object.
 *
 * @category Types
 */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * A JSON-serializable array.
 *
 * @category Types
 */
export type JsonArray = readonly JsonValue[];

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
 * Additional JSON-compatible metadata preserved on tool call and tool result parts.
 *
 * @category Types
 */
export interface ToolPartMetadata {
  readonly [key: string]: JsonValue;
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
  readonly metadata?: ToolPartMetadata;
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
  readonly metadata?: ToolPartMetadata;
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
 * Reason a transcript compaction summary was created.
 *
 * @category Context
 */
export type CompactionTrigger =
  | "token_threshold"
  | "hard_cap"
  | "growth_rate"
  | "error_fallback"
  | "manual";

/**
 * Structured anchor for a compaction summary.
 *
 * @category Context
 */
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

/**
 * A persistent summary that substitutes for a contiguous canonical message range at context-build time.
 *
 * @category Context
 */
export interface CompactionSummaryPart {
  readonly type: "compaction-summary";
  readonly summaryId: string;
  readonly coveredRange: {
    readonly startMessageId: string;
    readonly endMessageId: string;
  };
  /** Non-empty list of message IDs replaced by this summary. Order is preserved. */
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

/**
 * Discriminated union of all canonical message parts.
 *
 * @category Types
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
 * Persistence layers may set additional well-known keys on this metadata
 * — notably `isCompactionCarrier: true` to mark messages that carry a
 * `CompactionSummaryPart` as a branch annotation rather than a regular
 * conversation node.
 *
 * @category Types
 */
export interface CanonicalMessageMetadata {
  readonly schemaVersion: number;
  readonly [key: string]: unknown;
}

/**
 * A normalized immutable message in a conversation transcript.
 *
 * @category Types
 */
export interface CanonicalMessage {
  readonly id: string;
  readonly parentMessageId: string | null;
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly parts: readonly CanonicalPart[];
  readonly createdAt: string;
  readonly metadata: CanonicalMessageMetadata;
}

/**
 * Explicit branch selections keyed by parent message ID.
 *
 * Keys are fork-point parent message IDs and values are the selected child
 * message IDs to follow at those forks.
 *
 * @category Types
 */
export interface BranchSelections {
  readonly [parentMessageId: string]: string;
}

/**
 * Returns true when a canonical part is a compaction summary.
 *
 * @category Context
 */
export function isCompactionSummaryPart(part: CanonicalPart): part is CompactionSummaryPart {
  return part.type === "compaction-summary";
}

/**
 * Returns true when a canonical message carries a compaction-summary annotation.
 *
 * Carrier messages are siblings of the conversation, not branches: branch
 * resolution treats them as annotations attached to their parent message
 * rather than alternative continuations.
 *
 * @category Context
 */
export function isCompactionCarrierMessage(message: CanonicalMessage): boolean {
  return message.metadata.isCompactionCarrier === true;
}
