/**
 * Resume entry keys for interrupt ids (LLE-16135).
 *
 * A Gemini tool call id carries the step's base64 thought signature, so the
 * interrupt minted from it (`int_<toolCallId>`) can be thousands of
 * characters with `+`, `/` and `=`. Its resume keys must still be short and
 * portable, while keys for today's ids stay exactly as they were.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  INTERRUPT_KEY_SEGMENT_MAX_CHARS,
  interruptEntryKeySegment,
  interruptEntryKeys,
} from "../../src/index.js";

/** The identifier rule a host store (lleverage's agent-service) applies to entry keys. */
const HOST_KEY = /^[A-Za-z0-9_-][A-Za-z0-9._:@/%!~*'()-]*$/;
const HOST_KEY_MAX_CHARS = 1024;

const CREATED_AT = "2026-10-21T10:44:00.000Z";

/** A Gemini-style tool call id: `call_<n>__thought__<base64 signature>`. */
function geminiToolCallId(signatureBytes: number): string {
  const bytes = Buffer.alloc(signatureBytes);
  for (let index = 0; index < signatureBytes; index++) bytes[index] = (index * 7 + 251) % 256;
  return `call_901458__thought__EuQCCuECAWkUfRNRDfIOyZQQ86LY${bytes.toString("base64")}`;
}

const GEMINI_INTERRUPT_ID = `int_${geminiToolCallId(19_501)}`;

describe("interruptEntryKeySegment", () => {
  it("keeps today's ids unchanged", () => {
    for (const id of [
      "int_toolu_01A09q90qw90lq917835lq9", // Anthropic
      "int_toolu_vrtx_01XyZ", // Anthropic on Vertex
      "int_call_a1b2c3d4e5f6", // OpenAI chat
      "int_fc_68f1d2e3a4b5c6d7", // OpenAI responses
      "int_call_901458", // Gemini without a thought signature
      "int_tooluse_AbC-dEf_123", // Bedrock
      "int_a.b:c@d/e%f!g~h*i'j(k)l-m",
      "x".repeat(INTERRUPT_KEY_SEGMENT_MAX_CHARS),
    ]) {
      expect(interruptEntryKeySegment(id)).toBe(id);
    }
  });

  it("digests a long Gemini id with +, / and = into a short portable segment", () => {
    expect(GEMINI_INTERRUPT_ID.length).toBeGreaterThan(26_000);
    expect(GEMINI_INTERRUPT_ID).toMatch(/\+/);
    expect(GEMINI_INTERRUPT_ID).toMatch(/\//);
    expect(GEMINI_INTERRUPT_ID).toMatch(/=$/);

    const segment = interruptEntryKeySegment(GEMINI_INTERRUPT_ID);
    const digest = createHash("sha256").update(GEMINI_INTERRUPT_ID, "utf8").digest("hex");
    // The prefix is the id's leading run of letters, digits, `.`, `_` and `-`.
    expect(segment).toBe(
      `int_call_901458__thought__EuQCCuECAWkUfRNRDfIOyZQQ86LY~${digest.slice(0, 32)}`,
    );
    expect(segment).toMatch(/^[A-Za-z0-9._-]+~[0-9a-f]{32}$/);
    expect(segment.length).toBeLessThanOrEqual(97);
  });

  it("digests a short id with characters a host store refuses", () => {
    const id = "int_call_1__thought__Eu+h/3=";
    const digest = createHash("sha256").update(id, "utf8").digest("hex").slice(0, 32);
    expect(interruptEntryKeySegment(id)).toBe(`int_call_1__thought__Eu~${digest}`);
    expect(interruptEntryKeySegment("int_a b")).toMatch(/^int_a~[0-9a-f]{32}$/);
    expect(interruptEntryKeySegment("int_é")).toMatch(/^int_~[0-9a-f]{32}$/);
    expect(interruptEntryKeySegment("")).toMatch(/^~[0-9a-f]{32}$/);
  });

  it("digests a portable id longer than the limit, keeping at most 64 characters of it", () => {
    const id = "y".repeat(INTERRUPT_KEY_SEGMENT_MAX_CHARS + 1);
    const segment = interruptEntryKeySegment(id);
    expect(segment).toMatch(new RegExp(`^${"y".repeat(64)}~[0-9a-f]{32}$`));
    expect(segment.length).toBe(97);
  });

  it("is deterministic and gives distinct ids distinct segments", () => {
    expect(interruptEntryKeySegment(GEMINI_INTERRUPT_ID)).toBe(
      interruptEntryKeySegment(GEMINI_INTERRUPT_ID),
    );
    const other = `int_${geminiToolCallId(19_500)}`;
    expect(interruptEntryKeySegment(other)).not.toBe(interruptEntryKeySegment(GEMINI_INTERRUPT_ID));
    // Same 64-character prefix, different ids.
    const first = `int_${"a".repeat(70)}+1`;
    const second = `int_${"a".repeat(70)}+2`;
    expect(interruptEntryKeySegment(first).slice(0, 65)).toBe(
      interruptEntryKeySegment(second).slice(0, 65),
    );
    expect(interruptEntryKeySegment(first)).not.toBe(interruptEntryKeySegment(second));
  });
});

describe("interruptEntryKeys", () => {
  it("keeps today's keys unchanged", () => {
    expect(interruptEntryKeys({ id: "int_toolu_01ABC", createdAt: CREATED_AT })).toEqual({
      resolution: `interrupt:int_toolu_01ABC:${CREATED_AT}:resolution`,
      result: `interrupt:int_toolu_01ABC:${CREATED_AT}:result`,
    });
  });

  it("builds keys a host store accepts for a 26k-character Gemini id", () => {
    const keys = interruptEntryKeys({ id: GEMINI_INTERRUPT_ID, createdAt: CREATED_AT });
    const segment = interruptEntryKeySegment(GEMINI_INTERRUPT_ID);
    expect(keys).toEqual({
      resolution: `interrupt:${segment}:${CREATED_AT}:resolution`,
      result: `interrupt:${segment}:${CREATED_AT}:result`,
    });
    for (const key of [keys.resolution, keys.result]) {
      expect(key).toMatch(HOST_KEY);
      expect(key.length).toBeLessThanOrEqual(HOST_KEY_MAX_CHARS);
    }
  });
});
