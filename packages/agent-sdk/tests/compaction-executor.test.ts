import type { ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  createContextManager,
  type SummaryExecutor,
  type SummaryRequest,
} from "../src/context-manager.js";
import type { Agent, GenerateOptions } from "../src/types.js";

/**
 * `summarizer` and `commitCompaction` let a host run summaries on an isolated
 * executor and await a durable write from inside `compact()`, replacing
 * reassignment of `manager.compact` and a wrapped `agent.generate`.
 */

const transcript: ModelMessage[] = [
  { role: "system", content: "UNCHANGED SYSTEM PREFIX" },
  ...Array.from(
    { length: 12 },
    (_, i): ModelMessage => ({
      role: i % 2 ? "assistant" : "user",
      content: `synthetic message ${i} ${"x".repeat(500)}`,
    }),
  ),
];

function agentStub(text = "agent summary") {
  const generate = vi.fn(async (_options: GenerateOptions) => ({ status: "complete", text }));
  return { agent: { generate } as unknown as Agent, generate };
}

function manager(
  overrides: Partial<Parameters<typeof createContextManager>[0]> = {},
  summarization: Record<string, unknown> = {},
) {
  return createContextManager({
    maxTokens: 1_500,
    policy: { tokenThreshold: 0.8, outputReserveTokens: 0, enableGrowthRatePrediction: false },
    summarization: { keepMessageCount: 2, keepToolResultCount: 0, ...summarization },
    ...overrides,
  });
}

describe("summarizer executor", () => {
  it("receives exactly the messages the agent path would send, and the agent is never called", async () => {
    const { agent: probeAgent, generate } = agentStub("baseline");
    await manager().compact(transcript, probeAgent, "hard_cap");
    const baselineRequest = generate.mock.calls[0]?.[0];
    expect(baselineRequest?._skipCompaction).toBe(true);

    const requests: SummaryRequest[] = [];
    const summarizer: SummaryExecutor = async (request) => {
      requests.push(request);
      return {
        text: "executor summary",
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      };
    };
    const { agent, generate: agentGenerate } = agentStub();
    const result = await manager({ summarizer }).compact(transcript, agent, "hard_cap");

    expect(agentGenerate).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      messages: baselineRequest?.messages,
      maxTokens: baselineRequest?.maxTokens,
      trigger: "hard_cap",
      strategy: "rollup",
    });
    expect(result.summary).toBe("executor summary");
    expect(result.newMessages[1]).toEqual({
      role: "assistant",
      content: "[Previous conversation summary]\n\nexecutor summary",
    });
    expect(result.summaryUsage).toEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30 });
    expect(result.summaryDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports usage as absent when the executor does not return it, and never on the agent path", async () => {
    const { agent } = agentStub();
    const viaExecutor = await manager({ summarizer: async () => ({ text: "s" }) }).compact(
      transcript,
      agent,
    );
    expect(viaExecutor.summaryUsage).toBeUndefined();
    const viaAgent = await manager().compact(transcript, agent);
    expect(viaAgent.summaryUsage).toBeUndefined();
    expect(viaAgent.summaryDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes strategy and tier for structured and tiered summaries", async () => {
    const { agent } = agentStub();
    const requests: SummaryRequest[] = [];
    const summarizer: SummaryExecutor = async (request) => {
      requests.push(request);
      return {
        text: JSON.stringify({
          decisions: ["d"],
          preferences: [],
          currentState: [],
          openQuestions: [],
          references: [],
        }),
      };
    };

    await manager({ summarizer }, { strategy: "structured" }).compact(transcript, agent);
    expect(requests.at(-1)).toMatchObject({ strategy: "structured" });
    expect(requests.at(-1)?.tier).toBeUndefined();

    await manager({ summarizer }, { strategy: "tiered", enableTieredSummaries: true }).compact(
      transcript,
      agent,
    );
    expect(requests.at(-1)).toMatchObject({ strategy: "tiered", tier: 0 });
  });

  it("fails the compaction, and counts a circuit failure, when the executor rejects or returns no text", async () => {
    const { agent } = agentStub();
    const rejecting = createContextManager({
      maxTokens: 1_500,
      policy: { maxConsecutiveFailures: 1, failureCooldownMs: 60_000 },
      summarization: { keepMessageCount: 2, keepToolResultCount: 0 },
      summarizer: async () => {
        throw new Error("summary deadline exceeded");
      },
    });
    await expect(rejecting.compact(transcript, agent)).rejects.toThrow("summary deadline exceeded");
    // One failure at maxConsecutiveFailures: 1 opens the circuit.
    await expect(rejecting.compact(transcript, agent)).rejects.toThrow("circuit is open");

    const empty = manager({
      summarizer: async () => ({}) as unknown as { text: string },
    });
    await expect(empty.compact(transcript, agent)).rejects.toThrow(
      "Summary executor did not return text",
    );
  });

  it("accepts empty executor text exactly as the agent path accepts an empty summary", async () => {
    // Parity, not endorsement: the built-in path already proceeds on
    // `result.text ?? ""`, and a host's commit step decides whether an empty
    // summary is persisted. Throwing here would fail the user's turn instead.
    const { agent: emptyAgent } = agentStub("");
    const viaAgent = await manager().compact(transcript, emptyAgent, "hard_cap");
    const { agent } = agentStub();
    const viaExecutor = await manager({ summarizer: async () => ({ text: "   " }) }).compact(
      transcript,
      agent,
      "hard_cap",
    );
    expect(viaAgent.summary).toBe("");
    expect(viaExecutor.summary).toBe("   ");
    expect(viaExecutor.messagesAfter).toBe(viaAgent.messagesAfter);
    expect(viaExecutor.newMessages[1]).toEqual({
      role: "assistant",
      content: "[Previous conversation summary]\n\n   ",
    });
  });

  it("does not consult the executor when there is nothing to compact", async () => {
    const summarizer = vi.fn(async () => ({ text: "unused" }));
    const { agent } = agentStub();
    const result = await manager({ summarizer }, { keepMessageCount: 100 }).compact(
      transcript,
      agent,
    );
    expect(summarizer).not.toHaveBeenCalled();
    expect(result.newMessages).toBe(transcript);
    expect(result.summaryDurationMs).toBeUndefined();
    expect(result.summaryUsage).toBeUndefined();
  });
});

describe("commitCompaction", () => {
  it("is awaited before compact() resolves and receives the built result after onCompact", async () => {
    const order: string[] = [];
    let release!: () => void;
    const written = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { agent } = agentStub();
    const cm = manager({
      summarizer: async () => ({ text: "s", usage: { totalTokens: 3 } }),
      onCompact: () => order.push("onCompact"),
      commitCompaction: async (result) => {
        order.push(`commit:${result.summary}:${result.summaryUsage?.totalTokens}`);
        await written;
        order.push("written");
      },
    });

    let settled = false;
    const pending = cm.compact(transcript, agent, "token_threshold").then((r) => {
      settled = true;
      return r;
    });
    await vi.waitFor(() => expect(order).toContain("commit:s:3"));
    expect(settled).toBe(false);
    release();
    const result = await pending;
    expect(result.messagesAfter).toBeLessThan(transcript.length);
    expect(order).toEqual(["onCompact", "commit:s:3", "written"]);
  });

  it("keeps the valid in-memory result and a healthy circuit when the write fails", async () => {
    const { agent } = agentStub();
    const cm = manager({
      commitCompaction: async () => {
        throw new Error("unavailable");
      },
    });
    const result = await cm.compact(transcript, agent, "hard_cap");
    expect(result.newMessages.length).toBeLessThan(transcript.length);
    // A second compaction runs: the failed write did not open the circuit.
    await expect(cm.compact(transcript, agent, "hard_cap")).resolves.toMatchObject({
      messagesAfter: result.messagesAfter,
    });
  });

  it("is not called when nothing was compacted, and not called when summary generation fails", async () => {
    const commitCompaction = vi.fn(async () => {});
    const { agent } = agentStub();
    await manager({ commitCompaction }, { keepMessageCount: 100 }).compact(transcript, agent);
    expect(commitCompaction).not.toHaveBeenCalled();

    await expect(
      manager({
        commitCompaction,
        summarizer: async () => {
          throw new Error("boom");
        },
      }).compact(transcript, agent),
    ).rejects.toThrow("boom");
    expect(commitCompaction).not.toHaveBeenCalled();
  });
});
