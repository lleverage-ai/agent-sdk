import type { ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  createApproximateTokenCounter,
  createContextManager,
  SUMMARY_TOOL_RESULT_MAX_CHARS,
} from "../src/context-manager.js";
import type { Agent } from "../src/types.js";

function manager() {
  return createContextManager({
    maxTokens: 1_000,
    policy: { tokenThreshold: 0.8, outputReserveTokens: 0, enableGrowthRatePrediction: false },
    summarization: { keepMessageCount: 0, keepToolResultCount: 0 },
  });
}
const before: ModelMessage[] = [{ role: "user", content: "small request" }];
const after: ModelMessage[] = [...before, { role: "assistant", content: "x".repeat(600) }];
const measured = { inputTokens: 790, outputTokens: 0, totalTokens: 790 };

describe("provider usage anchors", () => {
  it("adds append growth to provider input before checking the threshold", () => {
    const cm = manager();
    cm.updateUsage?.(measured, { messages: before });
    const growth = cm.tokenCounter.countMessages(after) - cm.tokenCounter.countMessages(before);
    expect(cm.getBudget(after)).toMatchObject({ currentTokens: 790 + growth, isActual: true });
    expect(cm.shouldCompact(after)).toEqual({ trigger: true, reason: "token_threshold" });
    expect(cm.getUsageAnchor?.()).toMatchObject({
      inputTokens: 790,
      messageCount: 1,
      staleSteps: 0,
    });
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "rejects unusable input %s, tolerates one stale boundary, and resets on fresh usage",
    (inputTokens) => {
      const cm = manager();
      expect(cm.getUsageAnchor?.()).toBeNull();
      cm.updateUsage?.({ ...measured, inputTokens, totalTokens: undefined }, { messages: before });
      expect(cm.getUsageAnchor?.()).toBeNull();
      cm.updateUsage?.(measured, { messages: before });
      cm.updateUsage?.({ ...measured, inputTokens, totalTokens: undefined }, { messages: after });
      expect(cm.getUsageAnchor?.()?.staleSteps).toBe(1);
      expect(cm.getBudget(after).currentTokens).toBeGreaterThan(790);
      cm.updateUsage?.({ ...measured, inputTokens, totalTokens: undefined }, { messages: after });
      expect(cm.getUsageAnchor?.()?.staleSteps).toBe(2);
      expect(cm.getBudget(after).currentTokens).toBe(790);
      cm.updateUsage?.(measured, { messages: before });
      expect(cm.getUsageAnchor?.()?.staleSteps).toBe(0);
    },
  );

  it("accepts zero and returns defensive copies without treating legacy seeding as a step", () => {
    const cm = manager();
    cm.updateUsage?.(measured);
    expect(cm.getUsageAnchor?.()).toBeNull();
    cm.updateUsage?.({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }, { messages: before });
    const anchor = cm.getUsageAnchor?.();
    expect(anchor?.inputTokens).toBe(0);
    if (anchor) anchor.inputTokens = 999;
    expect(cm.getUsageAnchor?.()?.inputTokens).toBe(0);
    cm.updateUsage?.(measured);
    expect(cm.getUsageAnchor?.()?.staleSteps).toBe(0);
    expect(cm.getBudget(before).currentTokens).toBe(790);
  });

  it("falls back for shorter history and a prefix with a different counter estimate", () => {
    const cm = manager();
    cm.updateUsage?.(measured, { messages: before });
    expect(cm.getBudget([]).currentTokens).toBe(790);
    expect(
      cm.getBudget([{ role: "user", content: "a materially different request" }, ...after.slice(1)])
        .currentTokens,
    ).toBe(790);
  });

  it("preserves the consumer's count-based (not content-identity) prefix check", () => {
    const cm = manager();
    cm.updateUsage?.(measured, { messages: before });
    const changed: ModelMessage[] = [{ role: "user", content: "other request" }, ...after.slice(1)];
    expect(cm.tokenCounter.countMessages(changed.slice(0, 1))).toBe(
      cm.tokenCounter.countMessages(before),
    );
    expect(cm.getBudget(changed).currentTokens).toBe(cm.getBudget(after).currentTokens);
  });

  it("keeps the larger estimate or legacy total when the anchor is smaller", () => {
    const cm = manager();
    cm.updateUsage?.({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }, { messages: before });
    expect(cm.getBudget(after)).toMatchObject({
      currentTokens: cm.tokenCounter.countMessages(after),
      isActual: false,
    });
  });
});

function toolHistory(output: unknown, id = "call-1"): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [{ type: "tool-call", toolName: "lookup", toolCallId: id, input: {} }],
    },
    {
      role: "tool",
      content: [{ type: "tool-result", toolName: "lookup", toolCallId: id, output }],
    },
  ] as ModelMessage[];
}
async function summaryInput(output: unknown) {
  const cm = manager();
  const generate = vi.fn(async () => ({ status: "complete", text: "S" }));
  await cm.compact(toolHistory(output), { generate } as unknown as Agent);
  return JSON.stringify(generate.mock.calls);
}

describe("tool result content in compaction summaries", () => {
  it.each(["text", "error-text", "json", "error-json"])(
    "unwraps %s output with its name and call ID",
    async (type) => {
      const input = await summaryInput({
        type,
        value: type.endsWith("json") ? { fact: "RESULT-ONLY-FACT" } : "RESULT-ONLY-FACT",
      });
      expect(input).toContain("[Tool result: lookup call-1]");
      expect(input).toContain("RESULT-ONLY-FACT");
      expect(input).not.toContain(`\\"type\\":\\"${type}`);
    },
  );

  it.each([0, 4_000, 4_001])(
    "bounds each payload at 4000 characters (length %s)",
    async (length) => {
      expect(SUMMARY_TOOL_RESULT_MAX_CHARS).toBe(4_000);
      const input = await summaryInput({ type: "text", value: "x".repeat(length) });
      expect(input).toContain("x".repeat(Math.min(length, 4_000)));
      expect(input.includes("characters omitted")).toBe(length > 4_000);
      if (length > 4_000) {
        expect(input).not.toContain("x".repeat(4_001));
        expect(input).toContain(
          "1 characters omitted; full result retained in the transcript under tool call call-1",
        );
      }
    },
  );

  it.each([null, undefined, "raw output", { fact: "raw JSON" }])(
    "handles legacy/raw output %j",
    async (output) => {
      const input = await summaryInput(output);
      expect(input).toContain("[Tool result: lookup call-1]");
      if (output === null || output === undefined) {
        // Absent output stays an empty result, as in the patched consumer; it is
        // not reported as a serialisation failure.
        expect(input).toContain('[Tool result: lookup call-1]\\n"');
        expect(input).not.toContain("unserialisable");
      }
    },
  );

  it.each([() => undefined, Symbol("result"), { toJSON: () => undefined }])(
    "marks JSON outputs whose serialization returns undefined instead of crashing",
    async (value) => {
      expect(await summaryInput({ type: "json", value })).toContain("[unserialisable tool output]");
      expect(await summaryInput(value)).toContain("[unserialisable tool output]");
    },
  );

  it("marks circular output and preserves anchors when summarisation fails", async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(await summaryInput({ type: "json", value: circular })).toContain(
      "[unserialisable tool output]",
    );
    const cm = manager();
    cm.updateUsage?.(measured, { messages: before });
    const error = new Error("summary unavailable");
    await expect(
      cm.compact(toolHistory({ type: "text", value: "fact" }), {
        generate: async () => {
          throw error;
        },
      } as unknown as Agent),
    ).rejects.toThrow(error);
    expect(cm.getUsageAnchor?.()?.inputTokens).toBe(790);
  });

  it("clears provider measurements on successful compaction, including summariser updates", async () => {
    const cm = manager();
    cm.updateUsage?.(measured, { messages: before });
    const result = await cm.compact(toolHistory({ type: "text", value: "fact" }), {
      generate: async () => {
        cm.updateUsage?.(measured, { messages: before });
        return { status: "complete", text: "S" };
      },
    } as Agent);
    expect(cm.getUsageAnchor?.()).toBeNull();
    expect(cm.getBudget(result.newMessages).currentTokens).toBe(
      createApproximateTokenCounter().countMessages(result.newMessages),
    );
  });
});
