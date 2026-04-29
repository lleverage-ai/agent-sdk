import { Projector } from "../stream/projector.js";
import type { StreamEvent } from "../stream/stream-event.js";
import type { ProjectorConfig, StoredEvent } from "../stream/types.js";

import type {
  CanonicalMessage,
  CanonicalMessageMetadata,
  CanonicalPart,
  JsonPrimitive,
  JsonValue,
  ToolCallPart,
  ToolPartMetadata,
} from "./types.js";
import type { IdGenerator } from "./ulid.js";
import { ulid } from "./ulid.js";

// ---------------------------------------------------------------------------
// Event payload shapes
// ---------------------------------------------------------------------------

interface ToolCallEventPayload {
  toolCallId: string;
  toolName: string;
  input: unknown;
  metadata?: ToolPartMetadata;
}

interface ToolResultEventPayload {
  toolCallId: string;
  toolName?: string;
  output: unknown;
  isError?: boolean;
  metadata?: ToolPartMetadata;
}

interface PendingToolCall {
  toolName: string;
  input: unknown;
  metadata?: ToolPartMetadata;
}

interface PendingToolResult {
  toolCallId: string;
  toolName: string;
  output: unknown;
  isError: boolean;
  metadata?: ToolPartMetadata;
}

interface FileEventPayload {
  mimeType: string;
  url: string;
  name?: string;
}

interface StepStartedEventPayload {
  stepIndex: number;
}

interface StepFinishedEventPayload {
  [key: string]: unknown;
}

interface UserMessageEventPayload {
  content: string;
}

interface TextDeltaEventPayload {
  delta: string;
}

interface ReasoningEventPayload {
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isUnsafeMetadataKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function sanitizeJsonValue(value: unknown): JsonValue | undefined {
  if (isJsonPrimitive(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const item of value) {
      const sanitizedItem = sanitizeJsonValue(item);
      if (sanitizedItem !== undefined) {
        items.push(sanitizedItem);
      }
    }
    return items;
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  return sanitizeMetadataBag(value);
}

function sanitizeMetadataBag(record: Record<string, unknown>): ToolPartMetadata | undefined {
  const metadata: Record<string, JsonValue> = {};

  for (const [key, value] of Object.entries(record)) {
    if (isUnsafeMetadataKey(key)) {
      continue;
    }

    const sanitizedValue = sanitizeJsonValue(value);
    if (sanitizedValue !== undefined) {
      metadata[key] = sanitizedValue;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function extractLegacyToolMetadata(record: Record<string, unknown>): ToolPartMetadata | undefined {
  const legacyMetadata: Record<string, JsonValue> = {};

  const toolLabel = getString(record, "toolLabel");
  if (toolLabel !== undefined) {
    legacyMetadata.toolLabel = toolLabel;
  }

  const skillName = getString(record, "skillName");
  if (skillName !== undefined) {
    legacyMetadata.skillName = skillName;
  }

  const skillIcon = getString(record, "skillIcon");
  if (skillIcon !== undefined) {
    legacyMetadata.skillIcon = skillIcon;
  }

  return Object.keys(legacyMetadata).length > 0 ? legacyMetadata : undefined;
}

function extractToolMetadata(record: Record<string, unknown>): ToolPartMetadata | undefined {
  const metadata = isPlainObject(record.metadata)
    ? sanitizeMetadataBag(record.metadata)
    : undefined;
  const legacyMetadata = extractLegacyToolMetadata(record);

  if (!metadata && !legacyMetadata) {
    return undefined;
  }

  return {
    ...(legacyMetadata ?? {}),
    ...(metadata ?? {}),
  };
}

function mergeToolMetadata(
  base?: ToolPartMetadata,
  override?: ToolPartMetadata,
): ToolPartMetadata | undefined {
  if (!base && !override) {
    return undefined;
  }

  if (!base) {
    return sanitizeMetadataBag(override ?? {});
  }

  if (!override) {
    return sanitizeMetadataBag(base);
  }

  const keys = new Set([...Object.keys(base), ...Object.keys(override)]);
  const metadata: Record<string, JsonValue> = {};

  for (const key of keys) {
    if (isUnsafeMetadataKey(key)) {
      continue;
    }

    const baseValue = base[key];
    const overrideValue = override[key];
    const mergedValue =
      isPlainObject(baseValue) && isPlainObject(overrideValue)
        ? mergeToolMetadata(sanitizeMetadataBag(baseValue), sanitizeMetadataBag(overrideValue))
        : (overrideValue ?? baseValue);

    if (mergedValue !== undefined) {
      metadata[key] = mergedValue;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function parseToolCallEventPayload(payload: unknown): ToolCallEventPayload | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const toolCallId = getString(payload, "toolCallId");
  const toolName = getString(payload, "toolName");
  if (!toolCallId || !toolName || !("input" in payload)) {
    return undefined;
  }

  return {
    toolCallId,
    toolName,
    input: payload.input,
    metadata: extractToolMetadata(payload),
  };
}

function parseToolResultEventPayload(payload: unknown): ToolResultEventPayload | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const toolCallId = getString(payload, "toolCallId");
  const toolName = getString(payload, "toolName");
  if (!toolCallId || !("output" in payload)) {
    return undefined;
  }

  return {
    toolCallId,
    toolName,
    output: payload.output,
    isError: getBoolean(payload, "isError"),
    metadata: extractToolMetadata(payload),
  };
}

function parseUserMessageEventPayload(payload: unknown): UserMessageEventPayload | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const content = getString(payload, "content");
  return content === undefined ? undefined : { content };
}

function parseTextDeltaEventPayload(payload: unknown): TextDeltaEventPayload | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const delta = getString(payload, "delta");
  return delta === undefined ? undefined : { delta };
}

function parseReasoningEventPayload(payload: unknown): ReasoningEventPayload | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const text = getString(payload, "text");
  return text === undefined ? undefined : { text };
}

function parseFileEventPayload(payload: unknown): FileEventPayload | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const mimeType = getString(payload, "mimeType");
  const url = getString(payload, "url");
  if (!mimeType || !url) {
    return undefined;
  }

  return {
    mimeType,
    url,
    name: getString(payload, "name"),
  };
}

function parseStepStartedEventPayload(payload: unknown): StepStartedEventPayload | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const stepIndex = getNumber(payload, "stepIndex");
  return stepIndex === undefined ? undefined : { stepIndex };
}

function parseStepFinishedEventPayload(payload: unknown): StepFinishedEventPayload | undefined {
  return isRecord(payload) ? payload : undefined;
}

function parseErrorEventPayload(payload: unknown): Record<string, unknown> | undefined {
  return isRecord(payload) ? payload : undefined;
}

// ---------------------------------------------------------------------------
// Accumulator State
// ---------------------------------------------------------------------------

/**
 * Internal state maintained by the accumulator reducer.
 *
 * @category Accumulator
 */
export interface AccumulatorState {
  /** Completed messages */
  messages: CanonicalMessage[];
  /** The assistant message currently being built, or null */
  currentMessage: {
    id: string;
    parentMessageId: string | null;
    parts: CanonicalPart[];
    createdAt: string;
    metadata: CanonicalMessageMetadata;
  } | null;
  /** Text buffer for coalescing consecutive text-deltas */
  textBuffer: string;
  /** Pending tool calls awaiting results */
  pendingToolCalls: Map<string, PendingToolCall>;
  /** Tool results received before their assistant step boundary closes */
  pendingToolResults: PendingToolResult[];
  /** ID of the last committed message */
  lastMessageId: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInitialState(): AccumulatorState {
  return {
    messages: [],
    currentMessage: null,
    textBuffer: "",
    pendingToolCalls: new Map(),
    pendingToolResults: [],
    lastMessageId: null,
  };
}

function flushTextBuffer(state: AccumulatorState): void {
  if (state.textBuffer.length > 0 && state.currentMessage) {
    state.currentMessage.parts.push({ type: "text", text: state.textBuffer });
    state.textBuffer = "";
  }
}

function ensureCurrentMessage(state: AccumulatorState, idGen: IdGenerator): void {
  if (!state.currentMessage) {
    state.currentMessage = {
      id: idGen(),
      parentMessageId: state.lastMessageId,
      parts: [],
      createdAt: new Date().toISOString(),
      metadata: { schemaVersion: 1 },
    };
  }
}

function commitCurrentMessage(state: AccumulatorState): void {
  if (!state.currentMessage) return;
  flushTextBuffer(state);
  if (state.currentMessage.parts.length === 0) {
    state.currentMessage = null;
    return;
  }

  const msg: CanonicalMessage = {
    id: state.currentMessage.id,
    parentMessageId: state.currentMessage.parentMessageId,
    role: "assistant",
    parts: [...state.currentMessage.parts],
    createdAt: state.currentMessage.createdAt,
    metadata: { ...state.currentMessage.metadata },
  };
  state.messages.push(msg);
  state.lastMessageId = msg.id;
  state.currentMessage = null;
}

function materializeToolResult(
  state: AccumulatorState,
  idGen: IdGenerator,
  result: PendingToolResult,
): void {
  const toolMsg: CanonicalMessage = {
    id: idGen(),
    parentMessageId: state.lastMessageId,
    role: "tool",
    parts: [
      {
        type: "tool-result",
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        output: result.output,
        isError: result.isError,
        ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
      },
    ],
    createdAt: new Date().toISOString(),
    metadata: { schemaVersion: 1 },
  };
  state.messages.push(toolMsg);
  state.lastMessageId = toolMsg.id;
}

function flushPendingToolResults(state: AccumulatorState, idGen: IdGenerator): void {
  if (state.pendingToolResults.length === 0) {
    return;
  }

  const pendingResults = state.pendingToolResults;
  state.pendingToolResults = [];
  for (const result of pendingResults) {
    materializeToolResult(state, idGen, result);
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function createReducer(
  idGen: IdGenerator,
): (state: AccumulatorState, event: StoredEvent<StreamEvent>) => AccumulatorState {
  // This reducer intentionally mutates `state` in place for throughput.
  // Projector#getState() returns cloned snapshots, so callers cannot mutate
  // the projector's internal accumulator state by reference.
  return (state: AccumulatorState, event: StoredEvent<StreamEvent>): AccumulatorState => {
    const { kind, payload } = event.event;

    switch (kind) {
      case "step-started": {
        const _p = parseStepStartedEventPayload(payload);
        if (!_p) {
          break;
        }
        commitCurrentMessage(state);
        flushPendingToolResults(state, idGen);
        ensureCurrentMessage(state, idGen);
        break;
      }

      case "user-message": {
        const p = parseUserMessageEventPayload(payload);
        if (!p) {
          break;
        }
        commitCurrentMessage(state);
        flushPendingToolResults(state, idGen);
        const userMsg = {
          id: idGen(),
          parentMessageId: state.lastMessageId,
          role: "user" as const,
          parts: [{ type: "text" as const, text: p.content }],
          createdAt: new Date().toISOString(),
          metadata: { schemaVersion: 1 },
        };
        state.messages.push(userMsg);
        state.lastMessageId = userMsg.id;
        break;
      }

      case "text-delta": {
        const p = parseTextDeltaEventPayload(payload);
        if (!p) {
          break;
        }
        ensureCurrentMessage(state, idGen);
        state.textBuffer += p.delta;
        break;
      }

      case "reasoning": {
        const p = parseReasoningEventPayload(payload);
        if (!p) {
          break;
        }
        ensureCurrentMessage(state, idGen);
        flushTextBuffer(state);
        state.currentMessage!.parts.push({ type: "reasoning", text: p.text });
        break;
      }

      case "tool-call": {
        const p = parseToolCallEventPayload(payload);
        if (!p) {
          break;
        }
        ensureCurrentMessage(state, idGen);
        flushTextBuffer(state);

        // Duplicate tool-call events (e.g. async label updates) update the
        // existing part rather than appending a new one.
        const existingPartIndex = state.currentMessage!.parts.findIndex(
          (part) => part.type === "tool-call" && part.toolCallId === p.toolCallId,
        );

        if (existingPartIndex >= 0) {
          const existing = state.currentMessage!.parts[existingPartIndex];
          if (existing?.type !== "tool-call") {
            break;
          }

          const nextMetadata = mergeToolMetadata(existing.metadata, p.metadata);
          const nextPart: ToolCallPart = {
            ...existing,
            ...(nextMetadata !== undefined ? { metadata: nextMetadata } : {}),
          };

          state.currentMessage!.parts[existingPartIndex] = nextPart;
          const existingPending = state.pendingToolCalls.get(p.toolCallId);
          if (existingPending) {
            const nextMetadata = mergeToolMetadata(existingPending.metadata, p.metadata);
            state.pendingToolCalls.set(p.toolCallId, {
              ...existingPending,
              ...(nextMetadata !== undefined ? { metadata: nextMetadata } : {}),
            });
          }
          state.pendingToolResults = state.pendingToolResults.map((result) => {
            if (result.toolCallId !== p.toolCallId) {
              return result;
            }

            const nextMetadata = mergeToolMetadata(result.metadata, p.metadata);
            return {
              ...result,
              toolName: p.toolName,
              ...(nextMetadata !== undefined ? { metadata: nextMetadata } : {}),
            };
          });
        } else {
          const nextPart: ToolCallPart = {
            type: "tool-call",
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            input: p.input,
            ...(p.metadata !== undefined ? { metadata: p.metadata } : {}),
          };
          state.currentMessage!.parts.push(nextPart);

          const pendingToolCall: PendingToolCall = {
            toolName: p.toolName,
            input: p.input,
            ...(p.metadata !== undefined ? { metadata: p.metadata } : {}),
          };
          state.pendingToolCalls.set(p.toolCallId, pendingToolCall);
        }
        break;
      }

      case "tool-result": {
        const p = parseToolResultEventPayload(payload);
        if (!p) {
          break;
        }
        const pending = state.pendingToolCalls.get(p.toolCallId);
        const toolName = p.toolName ?? pending?.toolName ?? "unknown";
        state.pendingToolCalls.delete(p.toolCallId);

        const metadata = mergeToolMetadata(pending?.metadata, p.metadata);

        const result: PendingToolResult = {
          toolCallId: p.toolCallId,
          toolName,
          output: p.output,
          isError: p.isError ?? false,
          ...(metadata !== undefined ? { metadata } : {}),
        };

        if (state.currentMessage) {
          state.pendingToolResults.push(result);
        } else {
          materializeToolResult(state, idGen, result);
        }
        break;
      }

      case "file": {
        const p = parseFileEventPayload(payload);
        if (!p) {
          break;
        }
        ensureCurrentMessage(state, idGen);
        flushTextBuffer(state);
        state.currentMessage!.parts.push({
          type: "file",
          mimeType: p.mimeType,
          url: p.url,
          ...(p.name !== undefined && { name: p.name }),
        });
        break;
      }

      case "step-finished": {
        const p = parseStepFinishedEventPayload(payload);
        flushTextBuffer(state);
        if (state.currentMessage) {
          if (p) {
            state.currentMessage.metadata = { ...state.currentMessage.metadata, stepFinish: p };
          }
        }
        commitCurrentMessage(state);
        flushPendingToolResults(state, idGen);
        break;
      }

      case "error": {
        const p = parseErrorEventPayload(payload);
        if (!p) {
          break;
        }
        ensureCurrentMessage(state, idGen);
        state.currentMessage!.metadata = { ...state.currentMessage!.metadata, error: p };
        break;
      }

      default:
        // Open-world: unknown event kinds are silently ignored
        break;
    }

    return state;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a Projector configuration for accumulating stream events into canonical messages.
 *
 * @param idGenerator - Optional custom ID generator (defaults to ULID). Use
 *   `createCounterIdGenerator()` for deterministic tests.
 * @returns A ProjectorConfig suitable for constructing a Projector
 *
 * @category Accumulator
 */
export function createAccumulatorProjectorConfig(
  idGenerator?: IdGenerator,
): ProjectorConfig<AccumulatorState, StreamEvent> {
  const idGen = idGenerator ?? ulid;
  return {
    initialState: createInitialState(),
    reducer: createReducer(idGen),
  };
}

/**
 * Creates a Projector that accumulates stream events into canonical messages.
 *
 * @param idGenerator - Optional custom ID generator
 * @returns A Projector instance
 *
 * @category Accumulator
 */
export function createAccumulatorProjector(
  idGenerator?: IdGenerator,
): Projector<AccumulatorState, StreamEvent> {
  return new Projector(createAccumulatorProjectorConfig(idGenerator));
}

/**
 * Convenience function to accumulate stored events into canonical messages.
 *
 * After reducing all events, any in-progress assistant message is flushed
 * (text buffer coalesced, non-empty message committed) so the returned
 * array includes partial messages from incomplete steps.
 *
 * @param events - Stored stream events to reduce
 * @param idGenerator - Optional custom ID generator
 * @param options - Optional fork context; when `forkFromMessageId` is provided,
 *   the first accumulated message is linked to that parent
 * @returns The resulting canonical messages
 *
 * @category Accumulator
 */
export function accumulateEvents(
  events: StoredEvent<StreamEvent>[],
  idGenerator?: IdGenerator,
  options?: { forkFromMessageId?: string },
): CanonicalMessage[] {
  const idGen = idGenerator ?? ulid;
  const config = createAccumulatorProjectorConfig(idGen);
  // Empty fork IDs are treated as absent to avoid creating dangling parent links.
  if (options?.forkFromMessageId) {
    config.initialState.lastMessageId = options.forkFromMessageId;
  }
  const projector = new Projector(config);
  projector.apply(events);
  // Flush any in-progress message (getState() returns a clone, so mutation is safe)
  const state = projector.getState();
  commitCurrentMessage(state);
  flushPendingToolResults(state, idGen);
  return state.messages;
}
