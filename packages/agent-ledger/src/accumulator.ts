import type { ProjectorConfig, StoredEvent, StreamEvent } from "@lleverage-ai/agent-stream";
import { Projector } from "@lleverage-ai/agent-stream";

import type { CanonicalMessage, CanonicalMessageMetadata, CanonicalPart } from "./types.js";
import type { IdGenerator } from "./ulid.js";
import { ulid } from "./ulid.js";

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
  pendingToolCalls: Map<string, { toolName: string; input: unknown }>;
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
  if (state.currentMessage.parts.length === 0) return;

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

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function createReducer(
  idGen: IdGenerator,
): (state: AccumulatorState, event: StoredEvent<StreamEvent>) => AccumulatorState {
  return (state: AccumulatorState, event: StoredEvent<StreamEvent>): AccumulatorState => {
    const { kind, payload } = event.event;

    switch (kind) {
      case "step-started": {
        flushTextBuffer(state);
        ensureCurrentMessage(state, idGen);
        break;
      }

      case "text-delta": {
        ensureCurrentMessage(state, idGen);
        const p = payload as { delta: string };
        state.textBuffer += p.delta;
        break;
      }

      case "reasoning": {
        ensureCurrentMessage(state, idGen);
        flushTextBuffer(state);
        const p = payload as { text: string };
        state.currentMessage!.parts.push({ type: "reasoning", text: p.text });
        break;
      }

      case "tool-call": {
        ensureCurrentMessage(state, idGen);
        flushTextBuffer(state);
        const p = payload as { toolCallId: string; toolName: string; input: unknown };
        state.currentMessage!.parts.push({
          type: "tool-call",
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          input: p.input,
        });
        state.pendingToolCalls.set(p.toolCallId, {
          toolName: p.toolName,
          input: p.input,
        });
        break;
      }

      case "tool-result": {
        // Commit the current assistant message first
        commitCurrentMessage(state);

        const p = payload as {
          toolCallId: string;
          toolName: string;
          output: unknown;
          isError?: boolean;
        };
        const pending = state.pendingToolCalls.get(p.toolCallId);
        const toolName = p.toolName ?? pending?.toolName ?? "unknown";
        state.pendingToolCalls.delete(p.toolCallId);

        const toolMsg: CanonicalMessage = {
          id: idGen(),
          parentMessageId: state.lastMessageId,
          role: "tool",
          parts: [
            {
              type: "tool-result",
              toolCallId: p.toolCallId,
              toolName,
              output: p.output,
              isError: p.isError ?? false,
            },
          ],
          createdAt: new Date().toISOString(),
          metadata: { schemaVersion: 1 },
        };
        state.messages.push(toolMsg);
        state.lastMessageId = toolMsg.id;
        break;
      }

      case "file": {
        ensureCurrentMessage(state, idGen);
        flushTextBuffer(state);
        const p = payload as { mimeType: string; url: string; name?: string };
        const part: CanonicalPart = { type: "file", mimeType: p.mimeType, url: p.url };
        if (p.name) {
          (part as { name?: string }).name = p.name;
        }
        state.currentMessage!.parts.push(part);
        break;
      }

      case "step-finished": {
        flushTextBuffer(state);
        if (state.currentMessage) {
          const p = payload as Record<string, unknown> | undefined;
          if (p) {
            state.currentMessage.metadata = { ...state.currentMessage.metadata, stepFinish: p };
          }
        }
        commitCurrentMessage(state);
        break;
      }

      case "error": {
        ensureCurrentMessage(state, idGen);
        const p = payload as Record<string, unknown>;
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
 * @param events - Stored stream events to reduce
 * @param idGenerator - Optional custom ID generator
 * @returns The resulting canonical messages
 *
 * @category Accumulator
 */
export function accumulateEvents(
  events: StoredEvent<StreamEvent>[],
  idGenerator?: IdGenerator,
): CanonicalMessage[] {
  const projector = createAccumulatorProjector(idGenerator);
  projector.apply(events);
  // Flush any in-progress message
  const state = projector.getState();
  if (state.currentMessage) {
    flushTextBuffer(state);
    if (state.currentMessage.parts.length > 0) {
      const msg: CanonicalMessage = {
        id: state.currentMessage.id,
        parentMessageId: state.currentMessage.parentMessageId,
        role: "assistant",
        parts: [...state.currentMessage.parts],
        createdAt: state.currentMessage.createdAt,
        metadata: { ...state.currentMessage.metadata },
      };
      state.messages.push(msg);
    }
  }
  return state.messages;
}
