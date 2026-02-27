import { describe, expect, it } from "vitest";
import type { ClientMessage, ServerMessage } from "../src/protocol.js";
import {
  decodeMessage,
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
  });
});
