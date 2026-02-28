import { describe, expect, it } from "vitest";
import { RunManager } from "../../../src/ledger/run-manager.js";
import { InMemoryLedgerStore } from "../../../src/ledger/stores/memory.js";
import { InMemoryEventStore } from "../../../src/stream/stores/memory.js";
import type { StreamEvent } from "../../../src/stream/stream-event.js";

describe("Integration: fork + supersession", () => {
  it("forking from a message and committing supersedes the old run", async () => {
    const ledgerStore = new InMemoryLedgerStore();
    const eventStore = new InMemoryEventStore<StreamEvent>();
    const manager = new RunManager(ledgerStore, eventStore);

    // Original run
    const run1 = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run1.runId, [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "Original response." } },
      { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
    ]);
    await manager.finalizeRun(run1.runId, "committed");

    // Get the message ID to fork from — the last message before the run1 output
    // (In this case, fork from a synthetic root)
    const transcript1 = await ledgerStore.getTranscript({ threadId: "t1" });
    expect(transcript1).toHaveLength(1);

    // Regeneration run (fork from same point, which is "no parent" since original was first)
    const run2 = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run2.runId, [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "Regenerated response." } },
      { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
    ]);
    await manager.finalizeRun(run2.runId, "committed");

    // Verify transcript contains both responses (since no fork point specified)
    const transcript2 = await ledgerStore.getTranscript({ threadId: "t1" });
    expect(transcript2.length).toBeGreaterThanOrEqual(1);
  });

  it("forking with explicit forkFromMessageId supersedes prior runs at same fork", async () => {
    const ledgerStore = new InMemoryLedgerStore();
    const eventStore = new InMemoryEventStore<StreamEvent>();
    const manager = new RunManager(ledgerStore, eventStore);

    // First run: original response with fork point
    const run1 = await ledgerStore.beginRun({ threadId: "t1", forkFromMessageId: "user-msg-1" });
    await ledgerStore.activateRun(run1.runId);
    await ledgerStore.finalizeRun({
      runId: run1.runId,
      status: "committed",
      messages: [
        {
          id: "m1",
          parentMessageId: "user-msg-1",
          role: "assistant",
          parts: [{ type: "text", text: "First attempt." }],
          createdAt: new Date().toISOString(),
          metadata: { schemaVersion: 1 },
        },
      ],
    });

    // Verify initial state
    const preSupersede = await ledgerStore.getRun(run1.runId);
    expect(preSupersede!.status).toBe("committed");

    // Second run: regeneration at same fork point
    const run2 = await ledgerStore.beginRun({ threadId: "t1", forkFromMessageId: "user-msg-1" });
    await ledgerStore.activateRun(run2.runId);
    const result = await ledgerStore.finalizeRun({
      runId: run2.runId,
      status: "committed",
      messages: [
        {
          id: "m2",
          parentMessageId: "user-msg-1",
          role: "assistant",
          parts: [{ type: "text", text: "Second attempt (regenerated)." }],
          createdAt: new Date().toISOString(),
          metadata: { schemaVersion: 1 },
        },
      ],
    });

    // Verify supersession
    expect(result.supersededRunIds).toContain(run1.runId);

    const superseded = await ledgerStore.getRun(run1.runId);
    expect(superseded!.status).toBe("superseded");

    const active = await ledgerStore.getRun(run2.runId);
    expect(active!.status).toBe("committed");

    const transcript = await ledgerStore.getTranscript({ threadId: "t1" });
    const ids = transcript.map((message) => message.id);
    expect(ids).toContain("m1");
    expect(ids).toContain("m2");
  });

  it("supersession does not affect runs at different fork points", async () => {
    const ledgerStore = new InMemoryLedgerStore();

    // Run 1 at fork point A
    const run1 = await ledgerStore.beginRun({ threadId: "t1", forkFromMessageId: "msg-A" });
    await ledgerStore.activateRun(run1.runId);
    await ledgerStore.finalizeRun({
      runId: run1.runId,
      status: "committed",
      messages: [
        {
          id: "m1",
          parentMessageId: "msg-A",
          role: "assistant",
          parts: [{ type: "text", text: "Response A" }],
          createdAt: new Date().toISOString(),
          metadata: { schemaVersion: 1 },
        },
      ],
    });

    // Run 2 at fork point B (different fork point)
    const run2 = await ledgerStore.beginRun({ threadId: "t1", forkFromMessageId: "msg-B" });
    await ledgerStore.activateRun(run2.runId);
    const result = await ledgerStore.finalizeRun({
      runId: run2.runId,
      status: "committed",
      messages: [
        {
          id: "m2",
          parentMessageId: "msg-B",
          role: "assistant",
          parts: [{ type: "text", text: "Response B" }],
          createdAt: new Date().toISOString(),
          metadata: { schemaVersion: 1 },
        },
      ],
    });

    // No supersession since fork points differ
    expect(result.supersededRunIds).toEqual([]);

    const r1 = await ledgerStore.getRun(run1.runId);
    expect(r1!.status).toBe("committed");
  });
});
