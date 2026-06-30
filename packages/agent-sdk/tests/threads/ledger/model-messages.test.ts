import { describe, expect, it } from "vitest";
import type { CanonicalMessage, CanonicalPart } from "../../../src/canonical.js";
import { canonicalMessagesToModelMessages } from "../../../src/threads/ledger/model-messages.js";

let counter = 0;
function cm(role: CanonicalMessage["role"], parts: CanonicalPart[]): CanonicalMessage {
  counter += 1;
  return {
    id: `msg-${counter}`,
    parentMessageId: null,
    role,
    parts,
    createdAt: "2026-06-30T00:00:00.000Z",
    metadata: { schemaVersion: 2 },
  };
}

describe("canonicalMessagesToModelMessages", () => {
  it("flattens system messages to a single text string", () => {
    const out = canonicalMessagesToModelMessages([
      cm("system", [
        { type: "text", text: "Be helpful." },
        { type: "text", text: "Be concise." },
      ]),
    ]);
    expect(out).toEqual([{ role: "system", content: "Be helpful.\n\nBe concise." }]);
  });

  it("converts user text and file parts to a content array", () => {
    const [message] = canonicalMessagesToModelMessages([
      cm("user", [
        { type: "text", text: "look at this" },
        { type: "file", mimeType: "image/png", url: "https://example.com/a.png", name: "a.png" },
      ]),
    ]);
    expect(message?.role).toBe("user");
    expect(message?.content).toEqual([
      { type: "text", text: "look at this" },
      {
        type: "file",
        mediaType: "image/png",
        data: { type: "url", url: new URL("https://example.com/a.png") },
        filename: "a.png",
      },
    ]);
  });

  it("converts assistant reasoning and tool-call parts", () => {
    const [message] = canonicalMessagesToModelMessages([
      cm("assistant", [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "calling tool" },
        { type: "tool-call", toolCallId: "c1", toolName: "search", input: { q: "x" } },
      ]),
    ]);
    expect(message?.content).toEqual([
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "calling tool" },
      { type: "tool-call", toolCallId: "c1", toolName: "search", input: { q: "x" } },
    ]);
  });

  it("maps tool-result output by string vs json and error flag", () => {
    const [textResult] = canonicalMessagesToModelMessages([
      cm("tool", [
        { type: "tool-result", toolCallId: "c1", toolName: "t", output: "done", isError: false },
      ]),
    ]);
    expect(textResult?.content).toEqual([
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "t",
        output: { type: "text", value: "done" },
      },
    ]);

    const [jsonError] = canonicalMessagesToModelMessages([
      cm("tool", [
        {
          type: "tool-result",
          toolCallId: "c2",
          toolName: "t",
          output: { code: 500 },
          isError: true,
        },
      ]),
    ]);
    expect(jsonError?.content).toEqual([
      {
        type: "tool-result",
        toolCallId: "c2",
        toolName: "t",
        output: { type: "error-json", value: { code: 500 } },
      },
    ]);
  });

  it("renders a compaction summary as text", () => {
    const [message] = canonicalMessagesToModelMessages([
      cm("user", [
        {
          type: "compaction-summary",
          summaryId: "s1",
          coveredRange: { startMessageId: "a", endMessageId: "b" },
          coveredMessageIds: ["a"],
          text: "earlier we did X",
          provenance: {
            runId: "r1",
            model: "m",
            trigger: "manual",
            tokens: { input: 1, output: 1 },
            durationMs: 1,
            tokensBefore: 1,
            tokensAfter: 1,
            createdAt: "2026-06-30T00:00:00.000Z",
          },
          tier: 1,
          schemaVersion: 1,
        },
      ]),
    ]);
    expect(message?.content).toEqual([{ type: "text", text: "earlier we did X" }]);
  });

  it("drops parts that are invalid for the message role", () => {
    const [message] = canonicalMessagesToModelMessages([
      cm("user", [
        { type: "text", text: "hi" },
        // tool-call is not valid on a user message and must be dropped
        { type: "tool-call", toolCallId: "c1", toolName: "t", input: {} },
      ]),
    ]);
    expect(message?.content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("omits messages that project to no content", () => {
    const out = canonicalMessagesToModelMessages([
      cm("user", [{ type: "tool-call", toolCallId: "c1", toolName: "t", input: {} }]),
      cm("assistant", [{ type: "text", text: "kept" }]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.role).toBe("assistant");
  });

  it("falls back to inline text for non-URL file references", () => {
    const [message] = canonicalMessagesToModelMessages([
      cm("user", [{ type: "file", mimeType: "text/plain", url: "relative/path.txt" }]),
    ]);
    expect(message?.content).toEqual([
      { type: "file", mediaType: "text/plain", data: { type: "text", text: "relative/path.txt" } },
    ]);
  });
});
