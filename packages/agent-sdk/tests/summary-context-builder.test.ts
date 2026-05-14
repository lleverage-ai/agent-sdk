import { describe, expect, it } from "vitest";
import type { CanonicalMessage, CompactionSummaryPart } from "../src/canonical.js";
import { FullContextBuilder, SummaryAwareContextBuilder } from "../src/summary-context-builder.js";

function message(id: string, parentMessageId: string | null, text: string): CanonicalMessage {
  return {
    id,
    parentMessageId,
    role: "user",
    parts: [{ type: "text", text }],
    createdAt: `2026-01-01T00:00:0${id.replace(/\D/g, "") || "0"}.000Z`,
    metadata: { schemaVersion: 2 },
  };
}

function carrier(summary: CompactionSummaryPart): CanonicalMessage {
  return {
    id: `c-${summary.summaryId}`,
    parentMessageId: summary.coveredRange.endMessageId,
    role: "system",
    parts: [summary],
    createdAt: summary.provenance.createdAt,
    metadata: { schemaVersion: 2, isCompactionCarrier: true, summaryId: summary.summaryId },
  };
}

function summary(
  id: string,
  coveredMessageIds: readonly [string, ...string[]],
  tier = 0,
): CompactionSummaryPart {
  return {
    type: "compaction-summary",
    summaryId: id,
    coveredRange: {
      startMessageId: coveredMessageIds[0],
      endMessageId: coveredMessageIds.at(-1) ?? coveredMessageIds[0],
    },
    coveredMessageIds,
    text: `summary ${id}`,
    provenance: {
      runId: `run-${id}`,
      model: "test",
      trigger: "token_threshold",
      tokens: { input: 10, output: 2 },
      durationMs: 1,
      tokensBefore: 10,
      tokensAfter: 2,
      createdAt: `2026-01-01T00:00:0${tier}.000Z`,
    },
    tier,
    schemaVersion: 1,
  };
}

describe("SummaryAwareContextBuilder", () => {
  it("substitutes a branch-valid summary for covered messages", async () => {
    const s1 = summary("s1", ["m1", "m2"]);
    const builder = new SummaryAwareContextBuilder({
      async getTranscript() {
        return [
          message("m1", null, "one"),
          message("m2", "m1", "two"),
          carrier(s1),
          message("m3", "c-s1", "three"),
        ];
      },
    });

    const result = await builder.build({ threadId: "t1" });

    expect(result.messages.map((item) => item.id)).toEqual(["s1", "m3"]);
    expect(result.messages[0]?.role).toBe("assistant");
    expect(result.messages[0]?.parentMessageId).toBeNull();
    expect(result.messages[1]?.parentMessageId).toBe("s1");
    expect(result.provenance.summariesHonoured).toEqual(["s1"]);
  });

  it("ignores summaries whose covered messages are not on the active path", async () => {
    const s1 = summary("s1", ["m1", "m2", "m3"]);
    const allMessages = [
      message("m1", null, "one"),
      message("m2", "m1", "two"),
      message("m3", "m2", "three"),
      carrier(s1),
      message("m4", "m2", "fork"),
    ];
    const builder = new SummaryAwareContextBuilder({
      async getTranscript({ branch }) {
        return branch === "all" ? allMessages : allMessages.filter((item) => item.id !== "m3");
      },
    });

    const result = await builder.build({ threadId: "t1" });

    expect(result.messages.map((item) => item.id)).toEqual(["m1", "m2", "m4"]);
    expect(result.provenance.summariesHonoured).toEqual([]);
  });

  it("prefers higher-tier overlapping summaries", async () => {
    const s1 = summary("s1", ["m1", "m2"], 0);
    const s2 = summary("s2", ["m1", "m2", "m3"], 1);
    const builder = new SummaryAwareContextBuilder({
      async getTranscript() {
        return [
          message("m1", null, "one"),
          message("m2", "m1", "two"),
          carrier(s1),
          message("m3", "c-s1", "three"),
          carrier(s2),
          message("m4", "c-s2", "four"),
        ];
      },
    });

    const result = await builder.build({ threadId: "t1" });

    expect(result.messages.map((item) => item.id)).toEqual(["s2", "m4"]);
    expect(result.messages[1]?.parentMessageId).toBe("s2");
    expect(result.provenance.summariesHonoured).toEqual(["s2"]);
  });

  it("stitches multiple non-overlapping summaries on the same path in transcript order", async () => {
    const sA = summary("sA", ["m1", "m2"]);
    const sB = summary("sB", ["m3", "m4"]);
    const builder = new SummaryAwareContextBuilder({
      async getTranscript() {
        return [
          message("m1", null, "one"),
          message("m2", "m1", "two"),
          carrier(sA),
          message("m3", "c-sA", "three"),
          message("m4", "m3", "four"),
          carrier(sB),
          message("m5", "c-sB", "five"),
        ];
      },
    });

    const result = await builder.build({ threadId: "t1" });

    expect(result.messages.map((item) => item.id)).toEqual(["sA", "sB", "m5"]);
    expect(result.messages[1]?.parentMessageId).toBe("sA");
    expect(result.messages[2]?.parentMessageId).toBe("sB");
    expect(result.provenance.summariesHonoured).toEqual(["sA", "sB"]);
  });

  it("does not substitute summaries for all-branch transcript views", async () => {
    const s1 = summary("s1", ["m1", "m2"]);
    const builder = new SummaryAwareContextBuilder({
      async getTranscript() {
        return [message("m1", null, "one"), message("m2", "m1", "two"), carrier(s1)];
      },
    });

    const result = await builder.build({ threadId: "t1", branch: "all" });

    expect(result.messages.map((item) => item.id)).toEqual(["m1", "m2", "c-s1"]);
    expect(result.provenance.summariesHonoured).toBeUndefined();
  });
});

describe("FullContextBuilder parentMessageId repair", () => {
  it("walks parentMessageId past messages sliced off the front by maxMessages", async () => {
    // Linear chain m1 -> m2 -> m3 -> m4 -> m5; maxMessages: 2 returns [m4, m5].
    // After slicing, m4's original parent (m3) is gone — it should walk up to null.
    const transcript: CanonicalMessage[] = [
      message("m1", null, "one"),
      message("m2", "m1", "two"),
      message("m3", "m2", "three"),
      message("m4", "m3", "four"),
      message("m5", "m4", "five"),
    ];
    const builder = new FullContextBuilder({
      async getTranscript() {
        return transcript;
      },
    });

    const result = await builder.build({ threadId: "t1", maxMessages: 2 });

    expect(result.messages.map((item) => item.id)).toEqual(["m4", "m5"]);
    // m4's parent (m3) was dropped; m2 and m1 are also dropped; nearest visible
    // ancestor is null.
    expect(result.messages[0]?.parentMessageId).toBeNull();
    // m5's parent (m4) is still visible — preserved unchanged.
    expect(result.messages[1]?.parentMessageId).toBe("m4");
  });

  it("repoints parentMessageId past a reasoning-only message dropped by includeReasoning: false", async () => {
    // m1 (text) <- m2 (reasoning only) <- m3 (text). includeReasoning: false
    // drops m2 entirely; m3's parent should walk up to m1.
    const transcript: CanonicalMessage[] = [
      message("m1", null, "one"),
      {
        id: "m2",
        parentMessageId: "m1",
        role: "assistant",
        parts: [{ type: "reasoning", text: "thinking" }],
        createdAt: "2026-01-01T00:00:02.000Z",
        metadata: { schemaVersion: 2 },
      },
      message("m3", "m2", "three"),
    ];
    const builder = new FullContextBuilder({
      async getTranscript() {
        return transcript;
      },
    });

    const result = await builder.build({ threadId: "t1", includeReasoning: false });

    expect(result.messages.map((item) => item.id)).toEqual(["m1", "m3"]);
    expect(result.messages[0]?.parentMessageId).toBeNull();
    // m3's original parent (m2) was dropped; walks up to m1.
    expect(result.messages[1]?.parentMessageId).toBe("m1");
  });

  it("repoints parentMessageId across multiple dropped ancestors", async () => {
    // m1 (text) <- m2 (reasoning) <- m3 (reasoning) <- m4 (text).
    // includeReasoning: false drops m2 and m3; m4 should re-link to m1.
    const transcript: CanonicalMessage[] = [
      message("m1", null, "one"),
      {
        id: "m2",
        parentMessageId: "m1",
        role: "assistant",
        parts: [{ type: "reasoning", text: "step one" }],
        createdAt: "2026-01-01T00:00:02.000Z",
        metadata: { schemaVersion: 2 },
      },
      {
        id: "m3",
        parentMessageId: "m2",
        role: "assistant",
        parts: [{ type: "reasoning", text: "step two" }],
        createdAt: "2026-01-01T00:00:03.000Z",
        metadata: { schemaVersion: 2 },
      },
      message("m4", "m3", "four"),
    ];
    const builder = new FullContextBuilder({
      async getTranscript() {
        return transcript;
      },
    });

    const result = await builder.build({ threadId: "t1", includeReasoning: false });

    expect(result.messages.map((item) => item.id)).toEqual(["m1", "m4"]);
    expect(result.messages[1]?.parentMessageId).toBe("m1");
  });
});
