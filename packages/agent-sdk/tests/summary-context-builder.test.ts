import { describe, expect, it } from "vitest";
import type { CanonicalMessage, CompactionSummaryPart } from "../src/canonical.js";
import { SummaryAwareContextBuilder } from "../src/summary-context-builder.js";

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
  coveredMessageIds: readonly string[],
  tier = 0,
): CompactionSummaryPart {
  return {
    type: "compaction-summary",
    summaryId: id,
    coveredRange: {
      startMessageId: coveredMessageIds[0] ?? "",
      endMessageId: coveredMessageIds.at(-1) ?? "",
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
    expect(result.provenance.summariesHonoured).toEqual(["s1"]);
  });

  it("ignores summaries whose covered messages are not on the active path", async () => {
    const s1 = summary("s1", ["m1", "m2", "m3"]);
    const builder = new SummaryAwareContextBuilder({
      async getTranscript() {
        return [
          message("m1", null, "one"),
          message("m2", "m1", "two"),
          carrier(s1),
          message("fork", "m2", "fork"),
        ];
      },
    });

    const result = await builder.build({ threadId: "t1" });

    expect(result.messages.map((item) => item.id)).toEqual(["m1", "m2", "fork"]);
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
    expect(result.provenance.summariesHonoured).toEqual(["s2"]);
  });
});
