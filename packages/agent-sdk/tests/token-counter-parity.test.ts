import { describe, expect, it } from "vitest";
import { createApproximateTokenCounter, createCustomTokenCounter } from "../src/context-manager.js";
import type { ModelMessage } from "../src/types.js";

/**
 * Exact-count corpus for the approximate counter. Figures are the reference
 * counts of Lleverage's `createPlatformTokenCounter()` (4 chars/token, +4 per
 * message, flat 1000/500 for image/file), which this counter must reproduce
 * so the platform can drop its local counter. Every row was a differential
 * mismatch or a confirmed match against that oracle.
 */

const big = "x".repeat(4000); // 1000 tokens
const msg = (m: unknown): ModelMessage => m as ModelMessage;
const toolResult = (fields: Record<string, unknown>) =>
  msg({
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "c1", toolName: "bash", ...fields }],
  });

const corpus: Array<[string, ModelMessage, number]> = [
  ["string user content", msg({ role: "user", content: "u".repeat(1000) }), 254],
  ["text part", msg({ role: "assistant", content: [{ type: "text", text: big }] }), 1004],
  ["reasoning part", msg({ role: "assistant", content: [{ type: "reasoning", text: big }] }), 1004],
  [
    "text part with non-string text",
    msg({ role: "assistant", content: [{ type: "text", text: 42 }] }),
    4,
  ],
  [
    "tool-call input",
    msg({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "c", toolName: "edit", input: { a: big } }],
    }),
    1007,
  ],
  [
    "tool-call legacy args",
    msg({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "c", toolName: "edit", args: { a: big } }],
    }),
    1007,
  ],
  [
    "tool-call with both input and args counts input only",
    msg({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "c",
          toolName: "edit",
          input: { a: big },
          args: { b: big },
        },
      ],
    }),
    1007,
  ],
  [
    "tool-call without input",
    msg({ role: "assistant", content: [{ type: "tool-call", toolCallId: "c", toolName: "edit" }] }),
    5,
  ],
  ["tool-result typed text output", toolResult({ output: { type: "text", value: big } }), 1012],
  ["tool-result plain string output", toolResult({ output: big }), 1005],
  [
    "tool-result json output",
    toolResult({ output: { type: "json", value: { rows: [big] } } }),
    1015,
  ],
  ["tool-result legacy result", toolResult({ result: big }), 1005],
  ["tool-result null output", toolResult({ output: null }), 5],
  ["tool-result undefined output", toolResult({ output: undefined }), 5],
  ["tool-result without output key", toolResult({}), 5],
  [
    "tool-result multi-modal output plus content",
    toolResult({
      output: { type: "text", value: "ok" },
      content: [
        { type: "text", text: big },
        { type: "image", data: "AAAA", mediaType: "image/png" },
      ],
    }),
    1033,
  ],
  ["tool-result content only", toolResult({ content: [{ type: "text", text: big }] }), 1012],
  ["tool-result false output", toolResult({ output: false }), 7],
  ["tool-result zero output", toolResult({ output: 0 }), 6],
  [
    "tool-result toJSON returning undefined",
    toolResult({ output: { toJSON: () => undefined } }),
    5,
  ],
  [
    "tool-result circular output",
    (() => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      return toolResult({ output: circular });
    })(),
    5,
  ],
  ["tool-result bigint output", toolResult({ output: { n: 10n } }), 5],
  [
    "image part with image key",
    msg({ role: "user", content: [{ type: "image", image: "data:image/png;base64,AAAA" }] }),
    1004,
  ],
  [
    "image part with data key",
    msg({ role: "user", content: [{ type: "image", data: "AAAA", mediaType: "image/png" }] }),
    1004,
  ],
  [
    "file part with data",
    msg({ role: "user", content: [{ type: "file", data: "AAAA", mediaType: "application/pdf" }] }),
    504,
  ],
  [
    "file part with url only",
    msg({
      role: "user",
      content: [{ type: "file", url: "https://example.test/y.pdf", mediaType: "application/pdf" }],
    }),
    504,
  ],
  [
    "unknown part type charges serialised size",
    msg({ role: "assistant", content: [{ type: "future-part", payload: big }] }),
    1013,
  ],
  [
    "unknown part with image key",
    msg({ role: "assistant", content: [{ type: "future", image: big }] }),
    1004,
  ],
  [
    "unknown part with data key",
    msg({ role: "assistant", content: [{ type: "future", data: big }] }),
    504,
  ],
  [
    "unknown part with text key serialises the whole part",
    msg({ role: "assistant", content: [{ type: "future", text: big }] }),
    1011,
  ],
  [
    "tool-approval-request",
    msg({
      role: "assistant",
      content: [{ type: "tool-approval-request", approvalId: "a1", toolCallId: "c1" }],
    }),
    21,
  ],
  [
    "tool-approval-response",
    msg({
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: "a1",
          approved: true,
          reason: "r".repeat(400),
        },
      ],
    }),
    124,
  ],
  ["empty array content", msg({ role: "user", content: [] }), 4],
  ["null content", msg({ role: "user", content: null }), 4],
  ["undefined content", msg({ role: "user" }), 4],
  ["object content", msg({ role: "user", content: { weird: big } }), 4],
];

describe("createApproximateTokenCounter parity corpus", () => {
  it.each(corpus)("%s", (_name, message, expected) => {
    expect(createApproximateTokenCounter().countMessages([message])).toBe(expected);
  });

  it("counts the corpus identically through a shared cached instance", () => {
    const counter = createApproximateTokenCounter();
    const total = corpus.reduce((sum, [, message]) => sum + counter.countMessages([message]), 0);
    const expected = corpus.reduce((sum, [, , count]) => sum + count, 0);
    expect(total).toBe(expected);
    // Second pass hits the cache and must not drift.
    const again = corpus.reduce((sum, [, message]) => sum + counter.countMessages([message]), 0);
    expect(again).toBe(expected);
  });

  it("does not share cache entries between tool results that differ only in content", () => {
    const counter = createApproximateTokenCounter();
    const smallContent = [{ type: "text", text: "ok" }];
    const largeContent = [{ type: "text", text: big }];
    const small = counter.countMessages([toolResult({ content: smallContent })]);
    const large = counter.countMessages([toolResult({ content: largeContent })]);
    const tokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);
    expect(large - small).toBe(tokens(largeContent) - tokens(smallContent));
  });

  it("does not alias a text part containing a delimiter with a two-part array", () => {
    // A flat, delimiter-joined cache key would give these the same hash even
    // though they count differently; the key must encode part boundaries.
    const unknownPart = { type: "future", payload: "b" };
    const twoParts = msg({
      role: "assistant",
      content: [{ type: "text", text: "a" }, unknownPart],
    });
    const oneText = msg({
      role: "assistant",
      content: [{ type: "text", text: `a|unknown:${JSON.stringify(unknownPart)}` }],
    });
    const fresh = createApproximateTokenCounter();
    const twoPartsExpected = fresh.countMessages([twoParts]);
    const oneTextExpected = createApproximateTokenCounter().countMessages([oneText]);
    expect(twoPartsExpected).not.toBe(oneTextExpected);

    const shared = createApproximateTokenCounter();
    expect(shared.countMessages([twoParts])).toBe(twoPartsExpected);
    expect(shared.countMessages([oneText])).toBe(oneTextExpected);
  });

  it("does not alias string content with a single text part of the same text", () => {
    const shared = createApproximateTokenCounter();
    const asString = msg({ role: "user", content: "hello" });
    const asPart = msg({ role: "user", content: [{ type: "text", text: "hello" }] });
    // Both count identically today; assert the cache is keyed apart anyway by
    // checking a shape that does differ: an unknown-part array versus the
    // string that equals its serialised key.
    expect(shared.countMessages([asString])).toBe(shared.countMessages([asPart]));
    const unknownArray = msg({ role: "user", content: [{ type: "future", payload: "p" }] });
    const unknownAsString = msg({
      role: "user",
      content: JSON.stringify([["unknown", JSON.stringify({ type: "future", payload: "p" })]]),
    });
    const a = createApproximateTokenCounter().countMessages([unknownArray]);
    const b = createApproximateTokenCounter().countMessages([unknownAsString]);
    expect(a).not.toBe(b);
    expect(shared.countMessages([unknownArray])).toBe(a);
    expect(shared.countMessages([unknownAsString])).toBe(b);
  });

  it("counts a tool-heavy transcript at no less than its dominant tool outputs", () => {
    const counter = createApproximateTokenCounter();
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 50; i++) {
      messages.push(
        msg({
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: `c${i}`, toolName: "bash", input: { command: "ls" } },
          ],
        }),
      );
      messages.push(toolResult({ output: { type: "text", value: "o".repeat(20_000) } }));
    }
    expect(counter.countMessages(messages)).toBeGreaterThan(250_000);
  });
});

describe("createCustomTokenCounter uses the same part rules", () => {
  it("matches the approximate counter when given the same text function", () => {
    const custom = createCustomTokenCounter({ countFn: (text) => Math.ceil(text.length / 4) });
    for (const [, message, expected] of corpus) {
      expect(custom.countMessages([message])).toBe(expected);
    }
  });
});
