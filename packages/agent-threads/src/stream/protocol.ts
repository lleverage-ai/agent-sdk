import type { StoredEvent } from "./types.js";

/**
 * Protocol version for the agent-threads WebSocket wire format.
 *
 * The server performs an exact-match check during handshake: a client
 * sending a `hello` with a different version is rejected with
 * `VERSION_MISMATCH`.  When a breaking change is needed, bump this
 * constant and coordinate client upgrades.  Range-based negotiation
 * may be introduced in a future major version.
 *
 * @category Protocol
 */
export const PROTOCOL_VERSION = 1;

/**
 * Error codes used in the wire protocol.
 *
 * @category Protocol
 */
export const PROTOCOL_ERRORS = {
  VERSION_MISMATCH: "VERSION_MISMATCH",
  UNKNOWN_STREAM: "UNKNOWN_STREAM",
  REPLAY_FAILED: "REPLAY_FAILED",
  BUFFER_OVERFLOW: "BUFFER_OVERFLOW",
  INVALID_MESSAGE: "INVALID_MESSAGE",
} as const;

export type ProtocolError = (typeof PROTOCOL_ERRORS)[keyof typeof PROTOCOL_ERRORS];

// ── Client → Server ──

export interface HelloMessage {
  type: "hello";
  version: number;
}

export interface SubscribeMessage {
  type: "subscribe";
  streamId: string;
  afterSeq?: number;
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  streamId: string;
}

export interface PongMessage {
  type: "pong";
}

export type ClientMessage = HelloMessage | SubscribeMessage | UnsubscribeMessage | PongMessage;

// ── Server → Client ──

export interface ServerHelloMessage {
  type: "server-hello";
  version: number;
}

export interface EventMessage<TEvent = unknown> {
  type: "event";
  streamId: string;
  event: StoredEvent<TEvent>;
}

export interface ReplayEndMessage {
  type: "replay-end";
  streamId: string;
  lastReplaySeq: number;
}

export interface PingMessage {
  type: "ping";
}

export interface ErrorMessage {
  type: "error";
  code: ProtocolError;
  message: string;
}

export type ServerMessage<TEvent = unknown> =
  | ServerHelloMessage
  | EventMessage<TEvent>
  | ReplayEndMessage
  | PingMessage
  | ErrorMessage;

const CLIENT_MESSAGE_TYPES = new Set<ClientMessage["type"]>([
  "hello",
  "subscribe",
  "unsubscribe",
  "pong",
]);
const SERVER_MESSAGE_TYPES = new Set<ServerMessage["type"]>([
  "server-hello",
  "event",
  "replay-end",
  "ping",
  "error",
]);
const PROTOCOL_ERROR_CODES = new Set<string>(Object.values(PROTOCOL_ERRORS));

/**
 * Encode a protocol message to a JSON string.
 *
 * @category Protocol
 */
export function encodeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

/**
 * Decode a raw WebSocket data string into a validated client message.
 *
 * Returns `null` for invalid JSON, unknown message types, or malformed payloads.
 *
 * @category Protocol
 */
export function decodeClientMessage(data: string): ClientMessage | null {
  const parsed = parseRawMessage(data);
  if (!parsed) return null;
  return decodeClientMessageFromParsed(parsed);
}

/**
 * Decode a raw WebSocket data string into a validated server message.
 *
 * Returns `null` for invalid JSON, unknown message types, or malformed payloads.
 *
 * @category Protocol
 */
export function decodeServerMessage(data: string): ServerMessage | null {
  const parsed = parseRawMessage(data);
  if (!parsed) return null;
  return decodeServerMessageFromParsed(parsed);
}

/**
 * Decode a raw WebSocket data string into a validated protocol message.
 *
 * Returns `null` for invalid JSON, unknown message types, or malformed payloads.
 *
 * @category Protocol
 */
export function decodeMessage(data: string): ClientMessage | ServerMessage | null {
  const parsed = parseRawMessage(data);
  if (!parsed) return null;

  const type = parsed.type;
  if (typeof type !== "string") return null;

  if (CLIENT_MESSAGE_TYPES.has(type as ClientMessage["type"])) {
    return decodeClientMessageFromParsed(parsed);
  }

  if (SERVER_MESSAGE_TYPES.has(type as ServerMessage["type"])) {
    return decodeServerMessageFromParsed(parsed);
  }

  return null;
}

function parseRawMessage(data: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!isRecord(parsed)) return null;
    if (typeof parsed.type !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function decodeClientMessageFromParsed(parsed: Record<string, unknown>): ClientMessage | null {
  switch (parsed.type) {
    case "hello":
      return typeof parsed.version === "number" ? { type: "hello", version: parsed.version } : null;

    case "subscribe": {
      if (typeof parsed.streamId !== "string") return null;
      if (parsed.afterSeq !== undefined && !isNonNegativeInteger(parsed.afterSeq)) return null;
      return {
        type: "subscribe",
        streamId: parsed.streamId,
        afterSeq: parsed.afterSeq as number | undefined,
      };
    }

    case "unsubscribe":
      return typeof parsed.streamId === "string"
        ? { type: "unsubscribe", streamId: parsed.streamId }
        : null;

    case "pong":
      return { type: "pong" };

    default:
      return null;
  }
}

function decodeServerMessageFromParsed(parsed: Record<string, unknown>): ServerMessage | null {
  switch (parsed.type) {
    case "server-hello":
      return typeof parsed.version === "number"
        ? { type: "server-hello", version: parsed.version }
        : null;

    case "event": {
      if (typeof parsed.streamId !== "string" || !isRecord(parsed.event)) return null;
      const stored = parsed.event;
      if (
        !isNonNegativeInteger(stored.seq) ||
        typeof stored.timestamp !== "string" ||
        typeof stored.streamId !== "string" ||
        !("event" in stored)
      ) {
        return null;
      }

      return {
        type: "event",
        streamId: parsed.streamId,
        event: {
          seq: stored.seq,
          timestamp: stored.timestamp,
          streamId: stored.streamId,
          event: stored.event,
        },
      };
    }

    case "replay-end":
      if (typeof parsed.streamId !== "string" || !isNonNegativeInteger(parsed.lastReplaySeq)) {
        return null;
      }
      return {
        type: "replay-end",
        streamId: parsed.streamId,
        lastReplaySeq: parsed.lastReplaySeq,
      };

    case "ping":
      return { type: "ping" };

    case "error":
      if (
        typeof parsed.code !== "string" ||
        !PROTOCOL_ERROR_CODES.has(parsed.code) ||
        typeof parsed.message !== "string"
      ) {
        return null;
      }
      return {
        type: "error",
        code: parsed.code as ProtocolError,
        message: parsed.message,
      };

    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
