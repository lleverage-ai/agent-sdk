import type { StoredEvent } from "./types.js";

/**
 * Protocol version for the agent-stream WebSocket wire format.
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

/**
 * Encode a protocol message to a JSON string.
 *
 * @category Protocol
 */
export function encodeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

/**
 * Decode a raw WebSocket data string into a protocol message.
 *
 * Returns `null` if the data is not valid JSON or lacks a `type` field.
 *
 * @category Protocol
 */
export function decodeMessage(data: string): ClientMessage | ServerMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
      return null;
    }
    return parsed as ClientMessage | ServerMessage;
  } catch {
    return null;
  }
}
