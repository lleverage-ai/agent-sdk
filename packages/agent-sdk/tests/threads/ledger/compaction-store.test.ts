import { describe, expect, it } from "vitest";
import { SummaryAwareContextBuilder } from "../../../src/summary-context-builder.js";

import { createLedgerCompactionStore } from "../../../src/threads/ledger/compaction-store.js";
import { InMemoryLedgerStore } from "../../../src/threads/ledger/stores/memory.js";
import type { CanonicalMessage, CompactionSummaryPart } from "../../../src/threads/ledger/types.js";

function userMessage(id: string, parentMessageId: string | null, text: string): CanonicalMessage {
  return {
    id,
    parentMessageId,
    role: "user",
    parts: [{ type: "text", text }],
    createdAt: `2026-01-01T00:00:0${id.replace(/\D/g, "") || "0"}.000Z`,
    metadata: { schemaVersion: 2 },
  };
}

function makeSummary(
  summaryId: string,
  coveredMessageIds: readonly [string, ...string[]],
  text = "summary text",
): CompactionSummaryPart {
  return {
    type: "compaction-summary",
    summaryId,
    coveredRange: {
      startMessageId: coveredMessageIds[0],
      endMessageId: coveredMessageIds.at(-1) ?? coveredMessageIds[0],
    },
    coveredMessageIds,
    text,
    provenance: {
      runId: `run-${summaryId}`,
      model: "test-model",
      trigger: "token_threshold",
      tokens: { input: 100, output: 20 },
      durationMs: 5,
      tokensBefore: 1000,
      tokensAfter: 50,
      createdAt: "2026-01-01T00:00:10.000Z",
    },
    tier: 0,
    schemaVersion: 1,
  };
}

async function seedConversation(): Promise<{
  store: InMemoryLedgerStore;
  threadId: string;
}> {
  const store = new InMemoryLedgerStore();
  const threadId = "t1";
  const run = await store.beginRun({ threadId });
  await store.activateRun(run.runId);
  await store.finalizeRun({
    runId: run.runId,
    status: "committed",
    messages: [userMessage("m1", null, "one"), userMessage("m2", "m1", "two")],
  });
  return { store, threadId };
}

describe("createLedgerCompactionStore", () => {
  it("round-trips a saved summary as a carrier with isCompactionCarrier metadata", async () => {
    const { store, threadId } = await seedConversation();
    const compactionStore = createLedgerCompactionStore(store);
    const summary = makeSummary("s1", ["m1", "m2"]);

    await compactionStore.save({ threadId, runId: "writer-run", summary });

    const loaded = await compactionStore.load({ threadId });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.summaryId).toBe("s1");
    expect(loaded[0]?.coveredMessageIds).toEqual(["m1", "m2"]);

    const all = await store.getTranscript({ threadId, branch: "all" });
    const carrier = all.find((message) => message.metadata.isCompactionCarrier === true);
    expect(carrier).toBeDefined();
    expect(carrier?.role).toBe("system");
    expect(carrier?.id).toBe("s1");
  });

  it("rejects a duplicate summaryId on subsequent save", async () => {
    const { store, threadId } = await seedConversation();
    const compactionStore = createLedgerCompactionStore(store);
    const summary = makeSummary("s1", ["m1", "m2"]);

    await compactionStore.save({ threadId, runId: "writer-run", summary });
    await expect(
      compactionStore.save({ threadId, runId: "writer-run-2", summary }),
    ).rejects.toThrow(/already exists/);
  });

  it("does not perturb the active branch when conversation has continued past endMessageId", async () => {
    // Conversation already extends past the covered range when compaction lands.
    // The carrier must not steal the active-child slot from m3.
    const store = new InMemoryLedgerStore();
    const threadId = "t1";
    const conversationRun = await store.beginRun({ threadId });
    await store.activateRun(conversationRun.runId);
    await store.finalizeRun({
      runId: conversationRun.runId,
      status: "committed",
      messages: [
        userMessage("m1", null, "one"),
        userMessage("m2", "m1", "two"),
        userMessage("m3", "m2", "three"),
      ],
    });

    const compactionStore = createLedgerCompactionStore(store);
    await compactionStore.save({
      threadId,
      runId: "writer",
      summary: makeSummary("s1", ["m1", "m2"]),
    });

    const active = await store.getTranscript({ threadId, branch: "active" });
    expect(active.map((message) => message.id)).toEqual(["m1", "m2", "s1", "m3"]);

    // The substituting builder collapses the covered range into the rendered summary.
    const builder = new SummaryAwareContextBuilder(store);
    const built = await builder.build({ threadId });
    expect(built.messages.map((message) => message.id)).toEqual(["s1", "m3"]);
    expect(built.provenance.summariesHonoured).toEqual(["s1"]);
  });

  it("marks the helper run failed and rethrows when finalizeRun rejects mid-save", async () => {
    const { store: inner, threadId } = await seedConversation();

    // Wrap the underlying store so the carrier-write finalize (status:
    // "committed") rejects exactly once; the subsequent cleanup finalize
    // (status: "failed") falls through to the real store so we can observe
    // the helper run end up in the failed state.
    let firstCommittedFinalizeSeen = false;
    const wrappedStore: typeof inner = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === "finalizeRun") {
          return async (options: Parameters<typeof inner.finalizeRun>[0]) => {
            if (!firstCommittedFinalizeSeen && options.status === "committed") {
              firstCommittedFinalizeSeen = true;
              throw new Error("simulated finalize failure");
            }
            return target.finalizeRun(options);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const compactionStore = createLedgerCompactionStore(wrappedStore);
    const summary = makeSummary("s-fail", ["m1", "m2"]);

    await expect(compactionStore.save({ threadId, runId: "writer", summary })).rejects.toThrow(
      /simulated finalize failure/,
    );

    // The carrier must not have been persisted.
    const loaded = await compactionStore.load({ threadId });
    expect(loaded).toHaveLength(0);

    // The helper run created for the (failed) carrier write should have been
    // marked `failed` by the catch block so reconciliation does not have to
    // clean it up later. Locate it among the runs for this thread (it is the
    // one beyond the seed-conversation's committed run).
    const allRuns = await inner.listRuns(threadId);
    const failedRuns = allRuns.filter((run) => run.status === "failed");
    expect(failedRuns).toHaveLength(1);
    expect(failedRuns[0]?.finishedAt).not.toBeNull();
  });
});
