import { describe, expect, it } from "vitest";

import { SQLiteLedgerStore } from "../../../src/ledger/stores/sqlite.js";
import type { CanonicalMessage } from "../../../src/ledger/types.js";
import { MockSQLiteDatabase } from "../helpers/mock-sqlite-database.js";
import { CrashSimulationError } from "./crashing-ledger-store.js";
import { CrashingSQLiteDatabase, type SQLCrashPoint } from "./crashing-sqlite-database.js";

function createMessages(count: number, startId = 1): CanonicalMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${startId + i}`,
    parentMessageId: i === 0 ? null : `msg-${startId + i - 1}`,
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: `Message ${startId + i}` }],
    createdAt: new Date().toISOString(),
    metadata: { schemaVersion: 1 },
  }));
}

async function setupStreamingRun(store: SQLiteLedgerStore, threadId = "t1") {
  const run = await store.beginRun({ threadId });
  await store.activateRun(run.runId);
  return run;
}

async function setupWithForkPoint(store: SQLiteLedgerStore, threadId = "t1") {
  // Create initial committed run with messages (no fork point)
  const run1 = await setupStreamingRun(store, threadId);
  await store.finalizeRun({
    runId: run1.runId,
    status: "committed",
    messages: createMessages(3),
  });

  // Create a second run that forks from msg-3 and commits
  // This establishes a committed run at the fork point for supersession tests
  const runAtFork = await store.beginRun({
    threadId,
    forkFromMessageId: "msg-3",
  });
  await store.activateRun(runAtFork.runId);
  await store.finalizeRun({
    runId: runAtFork.runId,
    status: "committed",
    messages: createMessages(1, 50), // msg-50
  });

  // Create a third run also forking from msg-3 — this is the one we'll crash
  const forkRun = await store.beginRun({
    threadId,
    forkFromMessageId: "msg-3",
  });
  await store.activateRun(forkRun.runId);
  return { initialRun: run1, committedAtFork: runAtFork, forkRun };
}

describe("Finalize crash SQLite transaction atomicity", () => {
  it("crash after BEGIN — ROLLBACK, run stays streaming", async () => {
    const mockDb = new MockSQLiteDatabase();
    const crashDb = new CrashingSQLiteDatabase(mockDb);
    const store = new SQLiteLedgerStore(crashDb);

    const run = await setupStreamingRun(store);
    crashDb.arm("after-begin");

    await expect(
      store.finalizeRun({ runId: run.runId, status: "committed", messages: createMessages(2) }),
    ).rejects.toThrow(CrashSimulationError);

    // ROLLBACK was called; run should still be streaming
    const runRecord = await store.getRun(run.runId);
    expect(runRecord!.status).toBe("streaming");

    // No messages written
    const transcript = await store.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(0);
  });

  it("crash after fork message pruning — ROLLBACK restores pruned messages", async () => {
    const mockDb = new MockSQLiteDatabase();
    const crashDb = new CrashingSQLiteDatabase(mockDb);
    const store = new SQLiteLedgerStore(crashDb);

    const { forkRun } = await setupWithForkPoint(store);

    // Messages: msg-1, msg-2, msg-3 (from initial), msg-50 (from committedAtFork)
    const beforeTranscript = await store.getTranscript({ threadId: "t1" });
    expect(beforeTranscript).toHaveLength(4);

    crashDb.arm("after-delete-messages");

    await expect(
      store.finalizeRun({
        runId: forkRun.runId,
        status: "committed",
        messages: createMessages(2, 10),
      }),
    ).rejects.toThrow(CrashSimulationError);

    // ROLLBACK should restore the deleted messages
    const afterTranscript = await store.getTranscript({ threadId: "t1" });
    expect(afterTranscript).toHaveLength(4);
  });

  it("crash after supersession — ROLLBACK restores superseded run to committed", async () => {
    const mockDb = new MockSQLiteDatabase();
    const crashDb = new CrashingSQLiteDatabase(mockDb);
    const store = new SQLiteLedgerStore(crashDb);

    const { committedAtFork, forkRun } = await setupWithForkPoint(store);
    crashDb.arm("after-supersede");

    await expect(
      store.finalizeRun({
        runId: forkRun.runId,
        status: "committed",
        messages: createMessages(2, 10),
      }),
    ).rejects.toThrow(CrashSimulationError);

    // ROLLBACK should restore the committedAtFork run to committed
    const restoredRun = await store.getRun(committedAtFork.runId);
    expect(restoredRun!.status).toBe("committed");
  });

  it("crash after message insertion — ROLLBACK removes inserted messages", async () => {
    const mockDb = new MockSQLiteDatabase();
    const crashDb = new CrashingSQLiteDatabase(mockDb);
    const store = new SQLiteLedgerStore(crashDb);

    const run = await setupStreamingRun(store);
    crashDb.arm("after-insert-messages");

    await expect(
      store.finalizeRun({ runId: run.runId, status: "committed", messages: createMessages(3) }),
    ).rejects.toThrow(CrashSimulationError);

    // ROLLBACK should remove the inserted messages
    const transcript = await store.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(0);

    // Run should still be streaming
    const runRecord = await store.getRun(run.runId);
    expect(runRecord!.status).toBe("streaming");
  });

  it("crash after run status update — ROLLBACK reverts status to streaming", async () => {
    const mockDb = new MockSQLiteDatabase();
    const crashDb = new CrashingSQLiteDatabase(mockDb);
    const store = new SQLiteLedgerStore(crashDb);

    const run = await setupStreamingRun(store);
    crashDb.arm("after-update-run");

    await expect(
      store.finalizeRun({ runId: run.runId, status: "committed", messages: createMessages(2) }),
    ).rejects.toThrow(CrashSimulationError);

    // ROLLBACK should revert status
    const runRecord = await store.getRun(run.runId);
    expect(runRecord!.status).toBe("streaming");
  });

  it("crash after COMMIT — data persisted, idempotent re-call is no-op", async () => {
    const mockDb = new MockSQLiteDatabase();
    const crashDb = new CrashingSQLiteDatabase(mockDb);
    const store = new SQLiteLedgerStore(crashDb);

    const run = await setupStreamingRun(store);
    crashDb.arm("after-commit");

    await expect(
      store.finalizeRun({ runId: run.runId, status: "committed", messages: createMessages(2) }),
    ).rejects.toThrow(CrashSimulationError);

    // Data should be persisted (COMMIT succeeded)
    const runRecord = await store.getRun(run.runId);
    expect(runRecord!.status).toBe("committed");

    const transcript = await store.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(2);

    // Idempotent re-call
    crashDb.disarm();
    const result = await store.finalizeRun({
      runId: run.runId,
      status: "committed",
      messages: createMessages(2),
    });
    expect(result.committed).toBe(true);

    // No duplicate messages
    const transcript2 = await store.getTranscript({ threadId: "t1" });
    expect(transcript2).toHaveLength(2);
  });

  it.each([
    "after-begin",
    "after-delete-messages",
    "after-supersede",
    "after-insert-messages",
    "after-update-run",
  ] satisfies SQLCrashPoint[])("no partial writes at crash point: %s", async (crashPoint) => {
    const mockDb = new MockSQLiteDatabase();
    const crashDb = new CrashingSQLiteDatabase(mockDb);
    const store = new SQLiteLedgerStore(crashDb);

    // Need a fork scenario for delete/supersede crash points
    if (crashPoint === "after-delete-messages" || crashPoint === "after-supersede") {
      const { forkRun } = await setupWithForkPoint(store);
      crashDb.arm(crashPoint);

      await expect(
        store.finalizeRun({
          runId: forkRun.runId,
          status: "committed",
          messages: createMessages(2, 10),
        }),
      ).rejects.toThrow(CrashSimulationError);

      // Verify consistency: original messages intact (3 from initial + 1 from committedAtFork)
      const transcript = await store.getTranscript({ threadId: "t1" });
      expect(transcript).toHaveLength(4);
    } else {
      const run = await setupStreamingRun(store);
      crashDb.arm(crashPoint);

      await expect(
        store.finalizeRun({
          runId: run.runId,
          status: "committed",
          messages: createMessages(3),
        }),
      ).rejects.toThrow(CrashSimulationError);

      // No orphaned messages
      const transcript = await store.getTranscript({ threadId: "t1" });
      expect(transcript).toHaveLength(0);

      // Run not in inconsistent state
      const runRecord = await store.getRun(run.runId);
      expect(runRecord!.status).toBe("streaming");
    }
  });

  it.each([
    "after-begin",
    "after-delete-messages",
    "after-supersede",
    "after-insert-messages",
    "after-update-run",
  ] satisfies SQLCrashPoint[])("recovery after SQLite crash at: %s", async (crashPoint) => {
    const mockDb = new MockSQLiteDatabase();
    const crashDb = new CrashingSQLiteDatabase(mockDb);
    const store = new SQLiteLedgerStore(crashDb);

    let runId: string;

    if (crashPoint === "after-delete-messages" || crashPoint === "after-supersede") {
      const { forkRun } = await setupWithForkPoint(store);
      runId = forkRun.runId;
    } else {
      const run = await setupStreamingRun(store);
      runId = run.runId;
    }

    crashDb.arm(crashPoint);

    await expect(
      store.finalizeRun({
        runId,
        status: "committed",
        messages: createMessages(2, 20),
      }),
    ).rejects.toThrow(CrashSimulationError);

    crashDb.disarm();

    // Run should be recoverable
    const runRecord = await store.getRun(runId);
    expect(["created", "streaming"]).toContain(runRecord!.status);

    // Recover
    const result = await store.recoverRun({ runId, action: "fail" });
    expect(result.newStatus).toBe("failed");

    // No crashed messages in transcript
    const transcript = await store.getTranscript({ threadId: "t1" });
    const crashedMsgIds = transcript.filter((m) => m.id === "msg-20" || m.id === "msg-21");
    expect(crashedMsgIds).toHaveLength(0);
  });

  it("retry finalizeRun after crash — succeeds with correct data", async () => {
    const mockDb = new MockSQLiteDatabase();
    const crashDb = new CrashingSQLiteDatabase(mockDb);
    const store = new SQLiteLedgerStore(crashDb);

    const { committedAtFork, forkRun } = await setupWithForkPoint(store);

    // Crash on first attempt
    crashDb.arm("after-insert-messages");
    await expect(
      store.finalizeRun({
        runId: forkRun.runId,
        status: "committed",
        messages: createMessages(2, 10),
      }),
    ).rejects.toThrow(CrashSimulationError);

    // Disarm and retry
    crashDb.disarm();
    const result = await store.finalizeRun({
      runId: forkRun.runId,
      status: "committed",
      messages: createMessages(2, 10),
    });
    expect(result.committed).toBe(true);

    // Messages written correctly:
    // Fork prunes messages after msg-3 (removes msg-50), adds msg-10 and msg-11
    // Result: msg-1, msg-2, msg-3, msg-10, msg-11
    const transcript = await store.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(5);

    // committedAtFork should be superseded
    const supersededRun = await store.getRun(committedAtFork.runId);
    expect(supersededRun!.status).toBe("superseded");
  });
});
