import { describe, expect, it } from "vitest";

import { createLoadTestSetup, generateTextDeltaSequence } from "./helpers.js";

describe("Concurrent finalization", () => {
  it("10 runs finalizing concurrently — all succeed with correct transcripts", async () => {
    const { manager, ledgerStore } = createLoadTestSetup();

    // Create 10 runs on separate threads
    const runs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => manager.beginRun({ threadId: `t-${i}` })),
    );

    // Append events to all
    await Promise.all(
      runs.map((run) => manager.appendEvents(run.runId, generateTextDeltaSequence(50))),
    );

    // Finalize all concurrently
    const results = await Promise.all(
      runs.map((run) => manager.finalizeRun(run.runId, "committed")),
    );

    for (const result of results) {
      expect(result.committed).toBe(true);
    }

    // Each thread should have its own transcript
    for (let i = 0; i < 10; i++) {
      const transcript = await ledgerStore.getTranscript({ threadId: `t-${i}` });
      expect(transcript.length).toBeGreaterThan(0);
    }
  });

  it("concurrent finalize at same fork point — supersession occurs", async () => {
    const { manager, ledgerStore } = createLoadTestSetup();

    // Create an initial run to establish a fork point
    const initialRun = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(initialRun.runId, generateTextDeltaSequence(10));
    await manager.finalizeRun(initialRun.runId, "committed");

    const transcript = await ledgerStore.getTranscript({ threadId: "t1" });
    const lastMsgId = transcript[transcript.length - 1]!.id;

    // Create 5 competing runs all forking from the same message
    const competitors = await Promise.all(
      Array.from({ length: 5 }, () =>
        manager.beginRun({ threadId: "t1", forkFromMessageId: lastMsgId }),
      ),
    );

    // Append events to all competitors
    await Promise.all(
      competitors.map((run) => manager.appendEvents(run.runId, generateTextDeltaSequence(10))),
    );

    // Finalize all sequentially (InMemoryLedgerStore is single-threaded)
    const results = await Promise.all(
      competitors.map((run) => manager.finalizeRun(run.runId, "committed")),
    );

    // All should report committed (each supersedes previously committed ones)
    for (const result of results) {
      expect(result.committed).toBe(true);
    }

    // Check that supersession occurred:
    // Promise.all resolves sequentially for in-memory store; each run supersedes the prior.
    // The initial run (no fork) + the last competitor should be committed;
    // earlier competitors get superseded by later ones at the same fork point.
    const allRuns = await ledgerStore.listRuns("t1");
    const supersededRuns = allRuns.filter((r) => r.status === "superseded");
    expect(supersededRuns.length).toBeGreaterThanOrEqual(1);

    // At least some competitors were superseded
    const competitorStatuses = await Promise.all(
      competitors.map((r) => ledgerStore.getRun(r.runId)),
    );
    const supersededCompetitors = competitorStatuses.filter((r) => r!.status === "superseded");
    expect(supersededCompetitors.length).toBeGreaterThanOrEqual(1);
  });

  it("mixed committed/failed/cancelled concurrent — correct statuses", async () => {
    const { manager, ledgerStore } = createLoadTestSetup();

    const statuses: Array<"committed" | "failed" | "cancelled"> = [
      "committed",
      "failed",
      "cancelled",
      "committed",
      "failed",
      "cancelled",
      "committed",
      "failed",
      "cancelled",
      "committed",
    ];

    const runs = await Promise.all(
      statuses.map((_, i) => manager.beginRun({ threadId: `t-${i}` })),
    );

    await Promise.all(
      runs.map((run) => manager.appendEvents(run.runId, generateTextDeltaSequence(20))),
    );

    const results = await Promise.all(
      runs.map((run, i) => manager.finalizeRun(run.runId, statuses[i]!)),
    );

    for (const result of results) {
      expect(result.committed).toBe(true);
    }

    // Only committed runs should add messages
    for (let i = 0; i < statuses.length; i++) {
      const transcript = await ledgerStore.getTranscript({ threadId: `t-${i}` });
      if (statuses[i] === "committed") {
        expect(transcript.length).toBeGreaterThan(0);
      } else {
        expect(transcript).toHaveLength(0);
      }
    }
  });

  it("10 independent threads concurrent — all succeed, no cross-thread leakage", async () => {
    const { manager, ledgerStore } = createLoadTestSetup();

    const runs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => manager.beginRun({ threadId: `thread-${i}` })),
    );

    await Promise.all(
      runs.map((run) => manager.appendEvents(run.runId, generateTextDeltaSequence(30))),
    );

    const results = await Promise.all(
      runs.map((run) => manager.finalizeRun(run.runId, "committed")),
    );

    for (const result of results) {
      expect(result.committed).toBe(true);
    }

    // Verify thread isolation: each thread has its own messages
    const transcriptLengths: number[] = [];
    for (let i = 0; i < 10; i++) {
      const transcript = await ledgerStore.getTranscript({ threadId: `thread-${i}` });
      transcriptLengths.push(transcript.length);
      expect(transcript.length).toBeGreaterThan(0);
    }

    // All threads should have the same number of messages (same input)
    const uniqueLengths = new Set(transcriptLengths);
    expect(uniqueLengths.size).toBe(1);
  });
});
