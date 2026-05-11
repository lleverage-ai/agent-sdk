/**
 * Canonical transcript types shared by agent runtimes and persistence layers.
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

/** A persistent summary that substitutes for a contiguous canonical message range at context-build time. */
export interface CompactionSummaryPart {
  readonly type: "compaction-summary";
  readonly summaryId: string;
  readonly coveredRange: {
    readonly startMessageId: string;
    readonly endMessageId: string;
  };
  readonly coveredMessageIds: readonly string[];
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

/** Returns true when a canonical part is a compaction summary. */
export function isCompactionSummaryPart(part: CanonicalPart): part is CompactionSummaryPart {
  return part.type === "compaction-summary";
}
