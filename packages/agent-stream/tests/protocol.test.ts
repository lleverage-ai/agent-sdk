import { describe, expect, it } from "vitest";
import type { ClientMessage, ServerMessage } from "../src/protocol.js";
import {
  decodeClientMessage,
  decodeMessage,
  decodeServerMessage,
  encodeMessage,
  PROTOCOL_ERRORS,
  PROTOCOL_VERSION,
} from "../src/protocol.js";

describe("Protocol", () => {
  describe("constants", () => {
    it("exports protocol version", () => {
      expect(PROTOCOL_VERSION).toBe(1);
    });

    it("exports error codes", () => {
      expect(PROTOCOL_ERRORS.VERSION_MISMATCH).toBe("VERSION_MISMATCH");
      expect(PROTOCOL_ERRORS.UNKNOWN_STREAM).toBe("UNKNOWN_STREAM");
      expect(PROTOCOL_ERRORS.REPLAY_FAILED).toBe("REPLAY_FAILED");
      expect(PROTOCOL_ERRORS.BUFFER_OVERFLOW).toBe("BUFFER_OVERFLOW");
      expect(PROTOCOL_ERRORS.INVALID_MESSAGE).toBe("INVALID_MESSAGE");
    });
  });

  describe("encodeMessage / decodeMessage round-trip", () => {
    it("round-trips a client hello message", () => {
      const msg: ClientMessage = { type: "hello", version: 1 };
      const encoded = encodeMessage(msg);
      const decoded = decodeMessage(encoded);
      expect(decoded).toEqual(msg);
      expect(decodeClientMessage(encoded)).toEqual(msg);
    });

    it("round-trips a server event message", () => {
      const msg: ServerMessage = {
        type: "event",
        streamId: "s1",
        event: {
          seq: 1,
          timestamp: "2025-01-01T00:00:00Z",
          streamId: "s1",
          event: { kind: "test" },
        },
      };
      const encoded = encodeMessage(msg);
      const decoded = decodeMessage(encoded);
      expect(decoded).toEqual(msg);
      expect(decodeServerMessage(encoded)).toEqual(msg);
    });

    it("round-trips a subscribe message with afterSeq", () => {
      const msg: ClientMessage = { type: "subscribe", streamId: "s1", afterSeq: 5 };
      const decoded = decodeMessage(encodeMessage(msg));
      expect(decoded).toEqual(msg);
    });
  });

  describe("decodeMessage error handling", () => {
    it("returns null for invalid JSON", () => {
      expect(decodeMessage("not json")).toBeNull();
    });

    it("returns null for JSON without type field", () => {
      expect(decodeMessage('{"foo":"bar"}')).toBeNull();
    });

    it("returns null for non-object JSON", () => {
      expect(decodeMessage('"just a string"')).toBeNull();
      expect(decodeMessage("42")).toBeNull();
      expect(decodeMessage("null")).toBeNull();
    });

    it("returns null for unknown message types", () => {
      expect(decodeMessage('{"type":"unknown"}')).toBeNull();
    });

    it("validates client message required fields", () => {
      expect(decodeClientMessage('{"type":"subscribe"}')).toBeNull();
      expect(decodeClientMessage('{"type":"hello","version":"1"}')).toBeNull();
    });

    it("validates server message required fields", () => {
      expect(decodeServerMessage('{"type":"event","streamId":"s1"}')).toBeNull();
      expect(decodeServerMessage('{"type":"error","code":"NOPE","message":"x"}')).toBeNull();
      expect(
        decodeServerMessage(
          '{"type":"event","streamId":"s1","event":{"seq":1,"timestamp":"2025-01-01T00:00:00Z","streamId":"s1"}}',
        ),
      ).toBeNull();
    });
  });
});
