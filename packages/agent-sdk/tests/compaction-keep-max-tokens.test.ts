import type { ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createContextManager } from "../src/index.js";
import type { Agent } from "../src/types.js";

// LLE-14171: a compaction keeps the newest messages by count, so a few very
// large turns all fell inside the keep window and nothing was summarised.
// `keepMaxTokens` bounds what is kept.

const big = (label: string) => `${label} ${"x".repeat(40_000)}`;

/** Four huge turns: well inside a ten-message keep window. */
const hugeTurns: ModelMessage[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: `The vault code is 7-3-9-1. ${big("one")}` },
  { role: "assistant", content: "OK" },
  { role: "user", content: big("two") },
  { role: "assistant", content: "OK" },
  { role: "user", content: big("three") },
  { role: "assistant", content: "OK" },
  { role: "user", content: "What is the vault code?" },
];

function agentStub() {
  const generate = vi.fn(async () => ({ status: "complete", text: "Vault code 7-3-9-1." }));
  return { generate } as unknown as Agent;
}

function manager(keepMaxTokens?: number) {
  return createContextManager({
    maxTokens: 100_000,
    policy: { tokenThreshold: 0.8, outputReserveTokens: 0, enableGrowthRatePrediction: false },
    summarization: {
      keepMessageCount: 10,
      keepToolResultCount: 5,
      ...(keepMaxTokens !== undefined && { keepMaxTokens }),
    },
  });
}

describe("compaction retention bounded by tokens (LLE-14171)", () => {
  it("keeps every message inside the count window without a token bound", async () => {
    const result = await manager().compact(hugeTurns, agentStub(), "hard_cap");
    expect(result.summary).toBe("");
    expect(result.newMessages).toBe(hugeTurns);
  });

  it("summarises the oldest kept messages until the kept ones fit the bound", async () => {
    const counter = manager(15_000).tokenCounter;
    const result = await manager(15_000).compact(hugeTurns, agentStub(), "hard_cap");

    expect(result.summary).toBe("Vault code 7-3-9-1.");
    const kept = result.newMessages.slice(2);
    expect(counter.countMessages(kept)).toBeLessThanOrEqual(15_000);
    // Only the newest huge turn (and the short reply before it) fits; the
    // earlier huge turns, with the fact, are summarised.
    expect(kept).toEqual(hugeTurns.slice(4));
    expect(result.compactedMessages).toEqual(hugeTurns.slice(1, 4));
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });

  it("always keeps the newest message, even when it alone is over the bound", async () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Remember 42." },
      { role: "assistant", content: "OK" },
      { role: "user", content: big("pasted") },
    ];
    const result = await manager(100).compact(messages, agentStub(), "hard_cap");
    expect(result.newMessages.at(-1)).toEqual(messages[2]);
    expect(result.compactedMessages).toEqual(messages.slice(0, 2));
  });

  it("releases a tool call block whole, never splitting a call from its result", async () => {
    const messages: ModelMessage[] = [
      { role: "user", content: big("first") },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "c1", toolName: "search", input: {} }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "search",
            output: { type: "text", value: big("result") },
          },
        ],
      },
      { role: "assistant", content: "Found it." },
      { role: "user", content: "Thanks." },
    ];
    const result = await manager(2_000).compact(messages, agentStub(), "hard_cap");
    const kept = result.newMessages.slice(1);
    const hasCall = kept.some((m) => m === messages[1]);
    const hasResult = kept.some((m) => m === messages[2]);
    expect(hasCall).toBe(hasResult);
    expect(kept.at(-1)).toEqual(messages[4]);
  });
});
