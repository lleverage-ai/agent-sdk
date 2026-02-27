import type { StreamEvent } from "@lleverage-ai/agent-stream";

import { InMemoryEventStore } from "@lleverage-ai/agent-stream";
import { describe, expect, it } from "vitest";
import { RunManager } from "../../src/run-manager.js";
import { InMemoryLedgerStore } from "../../src/stores/memory.js";
import { CrashingLedgerStore, CrashSimulationError } from "./crashing-ledger-store.js";

function createChaosSetup() {
  const innerStore = new InMemoryLedgerStore();
  const crashingStore = new CrashingLedgerStore(innerStore);
  const eventStore = new InMemoryEventStore<StreamEvent>();
  const manager = new RunManager(crashingStore, eventStore);
  return { innerStore, crashingStore, eventStore, manager };
}

function textDeltaEvents(count: number): StreamEvent[] {
  const events: StreamEvent[] = [{ kind: "step-started", payload: { stepIndex: 0 } }];
  for (let i = 0; i < count; i++) {
    events.push({ kind: "text-delta", payload: { delta: `chunk-${i}-` } });
  }
  events.push({ kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } });
  return events;
}

describe("Finalize crash windows (InMemory)", () => {
  it("crash after beginRun, before activateRun — run stays 'created'", async () => {
    const innerStore = new InMemoryLedgerStore();
    const eventStore = new InMemoryEventStore<StreamEvent>();

    const run = await innerStore.beginRun({ threadId: "t1" });
    expect(run.status).toBe("created");

    // Simulate crash: never call activateRun
    const staleRuns = await innerStore.listStaleRuns({ threadId: "t1", olderThanMs: 0 });
    expect(staleRuns).toHaveLength(1);
    expect(staleRuns[0]!.run.status).toBe("created");

    // Recovery works
    const result = await innerStore.recoverRun({ runId: run.runId, action: "fail" });
    expect(result.newStatus).toBe("failed");

    // No messages
    const transcript = await innerStore.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(0);
  });

  it("crash after activateRun, before finalizeRun — run stays 'streaming'", async () => {
    const innerStore = new InMemoryLedgerStore();

    const run = await innerStore.beginRun({ threadId: "t1" });
    await innerStore.activateRun(run.runId);

    // Simulate crash: never finalize
    const staleRuns = await innerStore.listStaleRuns({ threadId: "t1", olderThanMs: 0 });
    expect(staleRuns).toHaveLength(1);
    expect(staleRuns[0]!.run.status).toBe("streaming");

    // Recovery works
    const result = await innerStore.recoverRun({ runId: run.runId, action: "fail" });
    expect(result.previousStatus).toBe("streaming");
    expect(result.newStatus).toBe("failed");

    // No messages
    const transcript = await innerStore.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(0);
  });

  it("crash before finalizeRun (CrashingLedgerStore) — run stays 'streaming', retry succeeds", async () => {
    const { crashingStore, manager, innerStore } = createChaosSetup();
    const run = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run.runId, textDeltaEvents(10));

    // Arm crash before finalize
    crashingStore.arm("before-finalize", 1);

    await expect(manager.finalizeRun(run.runId, "committed")).rejects.toThrow(CrashSimulationError);
    expect(crashingStore.crashesTriggered).toBe(1);

    // Run should still be streaming
    const runRecord = await innerStore.getRun(run.runId);
    expect(runRecord!.status).toBe("streaming");

    // Crash is disarmed (count exhausted), retry succeeds
    const result = await manager.finalizeRun(run.runId, "committed");
    expect(result.committed).toBe(true);

    const transcript = await innerStore.getTranscript({ threadId: "t1" });
    expect(transcript.length).toBeGreaterThan(0);
  });

  it("crash after commit (CrashingLedgerStore) — inner store committed, re-call is idempotent", async () => {
    const { crashingStore, manager, innerStore } = createChaosSetup();
    const run = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run.runId, textDeltaEvents(10));

    // Arm crash after commit
    crashingStore.arm("after-commit", 1);

    await expect(manager.finalizeRun(run.runId, "committed")).rejects.toThrow(CrashSimulationError);

    // Inner store already committed
    const runRecord = await innerStore.getRun(run.runId);
    expect(runRecord!.status).toBe("committed");

    // Re-call should be idempotent (no-op)
    const result = await manager.finalizeRun(run.runId, "committed");
    expect(result.committed).toBe(true);
  });

  it("idempotent re-finalization after crash — no duplicate messages", async () => {
    const { crashingStore, manager, innerStore } = createChaosSetup();
    const run = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run.runId, textDeltaEvents(10));

    // Crash before finalize
    crashingStore.arm("before-finalize", 1);
    await expect(manager.finalizeRun(run.runId, "committed")).rejects.toThrow();

    // Retry
    const result = await manager.finalizeRun(run.runId, "committed");
    expect(result.committed).toBe(true);

    const transcript = await innerStore.getTranscript({ threadId: "t1" });
    const messageCount = transcript.length;

    // Retry again — should be idempotent
    const result2 = await manager.finalizeRun(run.runId, "committed");
    expect(result2.committed).toBe(true);

    const transcript2 = await innerStore.getTranscript({ threadId: "t1" });
    expect(transcript2).toHaveLength(messageCount);
  });

  it("recovery produces no duplicate messages", async () => {
    const { crashingStore, manager, innerStore } = createChaosSetup();
    const run = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run.runId, textDeltaEvents(10));

    // Crash before finalize
    crashingStore.arm("before-finalize", 1);
    await expect(manager.finalizeRun(run.runId, "committed")).rejects.toThrow();

    // Recover crashed run instead of retrying
    await crashingStore.recoverRun({ runId: run.runId, action: "fail" });

    // Start a new successful run
    const run2 = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run2.runId, textDeltaEvents(5));
    await manager.finalizeRun(run2.runId, "committed");

    // Only the successful run's messages should be in the transcript
    const transcript = await innerStore.getTranscript({ threadId: "t1" });
    expect(transcript.length).toBeGreaterThan(0);

    // Each message ID should be unique
    const ids = transcript.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("multiple consecutive crashes then success", async () => {
    const { crashingStore, manager, innerStore } = createChaosSetup();
    const run = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run.runId, textDeltaEvents(10));

    // Arm 3 crashes
    crashingStore.arm("before-finalize", 3);

    for (let i = 0; i < 3; i++) {
      await expect(manager.finalizeRun(run.runId, "committed")).rejects.toThrow(
        CrashSimulationError,
      );
    }
    expect(crashingStore.crashesTriggered).toBe(3);

    // 4th attempt succeeds (count exhausted)
    const result = await manager.finalizeRun(run.runId, "committed");
    expect(result.committed).toBe(true);

    const runRecord = await innerStore.getRun(run.runId);
    expect(runRecord!.status).toBe("committed");
  });

  it("concurrent crash + successful run — first recoverable, second correct", async () => {
    const { crashingStore, manager, innerStore } = createChaosSetup();

    // Run 1: will crash
    const run1 = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run1.runId, textDeltaEvents(10));

    // Run 2: will succeed (different thread to avoid interference)
    const run2 = await manager.beginRun({ threadId: "t2" });
    await manager.appendEvents(run2.runId, textDeltaEvents(5));

    // Arm crash for the next finalize call only
    crashingStore.arm("before-finalize", 1);

    // Run 1 crashes
    await expect(manager.finalizeRun(run1.runId, "committed")).rejects.toThrow();

    // Run 2 succeeds (crash count exhausted)
    const result2 = await manager.finalizeRun(run2.runId, "committed");
    expect(result2.committed).toBe(true);

    // Run 1 still recoverable
    const run1Record = await innerStore.getRun(run1.runId);
    expect(run1Record!.status).toBe("streaming");

    // Recover run 1
    await crashingStore.recoverRun({ runId: run1.runId, action: "fail" });
    const run1After = await innerStore.getRun(run1.runId);
    expect(run1After!.status).toBe("failed");

    // Run 2's messages are correct
    const transcript2 = await innerStore.getTranscript({ threadId: "t2" });
    expect(transcript2.length).toBeGreaterThan(0);

    // Run 1's thread has no messages
    const transcript1 = await innerStore.getTranscript({ threadId: "t1" });
    expect(transcript1).toHaveLength(0);
  });
});
