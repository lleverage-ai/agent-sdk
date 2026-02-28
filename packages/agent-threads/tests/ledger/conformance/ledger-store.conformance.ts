import { describe, expect, it } from "vitest";

import type { ILedgerStore } from "../../../src/ledger/stores/ledger-store.js";
import type { CanonicalMessage } from "../../../src/ledger/types.js";

function makeMessage(
  id: string,
  parentId: string | null,
  role: CanonicalMessage["role"],
): CanonicalMessage {
  return {
    id,
    parentMessageId: parentId,
    role,
    parts: [{ type: "text", text: `Message ${id}` }],
    createdAt: new Date().toISOString(),
    metadata: { schemaVersion: 1 },
  };
}

/**
 * Reusable conformance test suite for ILedgerStore implementations.
 *
 * Call this with a store factory to verify any store adapter conforms
 * to the ILedgerStore contract.
 */
export function ledgerStoreConformanceTests(name: string, createStore: () => ILedgerStore): void {
  describe(`${name} conformance`, () => {
    // --- beginRun ---

    it("beginRun creates a run with status 'created'", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      expect(run.status).toBe("created");
      expect(run.threadId).toBe("t1");
      expect(run.forkFromMessageId).toBeNull();
      expect(run.finishedAt).toBeNull();
      expect(run.messageCount).toBe(0);
      expect(run.streamId).toBe(`run:${run.runId}`);
    });

    it("beginRun with forkFromMessageId", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1", forkFromMessageId: "msg-1" });
      expect(run.forkFromMessageId).toBe("msg-1");
    });

    it("beginRun assigns unique run IDs", async () => {
      const store = createStore();
      const r1 = await store.beginRun({ threadId: "t1" });
      const r2 = await store.beginRun({ threadId: "t1" });
      expect(r1.runId).not.toBe(r2.runId);
    });

    // --- activateRun ---

    it("activateRun transitions from created to streaming", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      const activated = await store.activateRun(run.runId);
      expect(activated.status).toBe("streaming");
    });

    it("activateRun throws for non-existent run", async () => {
      const store = createStore();
      await expect(store.activateRun("nonexistent")).rejects.toThrow("Run not found");
    });

    it("activateRun throws for non-created run", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      await store.activateRun(run.runId);
      await expect(store.activateRun(run.runId)).rejects.toThrow();
    });

    // --- finalizeRun ---

    it("finalizeRun commits with messages", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      await store.activateRun(run.runId);

      const messages = [makeMessage("m1", null, "assistant")];
      const result = await store.finalizeRun({
        runId: run.runId,
        status: "committed",
        messages,
      });

      expect(result.committed).toBe(true);
      expect(result.supersededRunIds).toEqual([]);

      const finalized = await store.getRun(run.runId);
      expect(finalized!.status).toBe("committed");
      expect(finalized!.finishedAt).not.toBeNull();
    });

    it("finalizeRun with failed status", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      await store.activateRun(run.runId);

      const result = await store.finalizeRun({ runId: run.runId, status: "failed" });
      expect(result.committed).toBe(true);

      const finalized = await store.getRun(run.runId);
      expect(finalized!.status).toBe("failed");
    });

    it("finalizeRun with cancelled status", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      await store.activateRun(run.runId);

      const result = await store.finalizeRun({ runId: run.runId, status: "cancelled" });
      expect(result.committed).toBe(true);

      const finalized = await store.getRun(run.runId);
      expect(finalized!.status).toBe("cancelled");
    });

    it("finalizeRun is idempotent for same status", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      await store.activateRun(run.runId);

      const messages = [makeMessage("m1", null, "assistant")];
      await store.finalizeRun({ runId: run.runId, status: "committed", messages });
      const result = await store.finalizeRun({ runId: run.runId, status: "committed", messages });

      expect(result.committed).toBe(true);
      expect(result.supersededRunIds).toEqual([]);
    });

    it("finalizeRun returns committed:false for already-terminal with different status", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      await store.activateRun(run.runId);

      await store.finalizeRun({ runId: run.runId, status: "failed" });
      const result = await store.finalizeRun({
        runId: run.runId,
        status: "committed",
        messages: [],
      });

      expect(result.committed).toBe(false);
    });

    it("finalizeRun supersedes prior committed runs at same fork point", async () => {
      const store = createStore();

      // First run: commit with a fork from msg-root
      const r1 = await store.beginRun({ threadId: "t1", forkFromMessageId: "msg-root" });
      await store.activateRun(r1.runId);
      await store.finalizeRun({
        runId: r1.runId,
        status: "committed",
        messages: [makeMessage("m1", "msg-root", "assistant")],
      });

      // Second run at same fork point
      const r2 = await store.beginRun({ threadId: "t1", forkFromMessageId: "msg-root" });
      await store.activateRun(r2.runId);
      const result = await store.finalizeRun({
        runId: r2.runId,
        status: "committed",
        messages: [makeMessage("m2", "msg-root", "assistant")],
      });

      expect(result.supersededRunIds).toContain(r1.runId);

      const superseded = await store.getRun(r1.runId);
      expect(superseded!.status).toBe("superseded");
    });

    it("finalizeRun on fork preserves previously committed branch messages", async () => {
      const store = createStore();

      const r1 = await store.beginRun({ threadId: "t1", forkFromMessageId: "msg-root" });
      await store.activateRun(r1.runId);
      await store.finalizeRun({
        runId: r1.runId,
        status: "committed",
        messages: [makeMessage("m1", "msg-root", "assistant")],
      });

      const r2 = await store.beginRun({ threadId: "t1", forkFromMessageId: "msg-root" });
      await store.activateRun(r2.runId);
      await store.finalizeRun({
        runId: r2.runId,
        status: "committed",
        messages: [makeMessage("m2", "msg-root", "assistant")],
      });

      const transcript = await store.getTranscript({ threadId: "t1" });
      const ids = transcript.map((message) => message.id);
      expect(ids).toContain("m1");
      expect(ids).toContain("m2");
    });

    it("finalizeRun throws for non-existent run", async () => {
      const store = createStore();
      await expect(store.finalizeRun({ runId: "nonexistent", status: "failed" })).rejects.toThrow(
        "Run not found",
      );
    });

    // --- getRun ---

    it("getRun returns null for non-existent run", async () => {
      const store = createStore();
      expect(await store.getRun("nonexistent")).toBeNull();
    });

    it("getRun returns the run record", async () => {
      const store = createStore();
      const created = await store.beginRun({ threadId: "t1" });
      const retrieved = await store.getRun(created.runId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.runId).toBe(created.runId);
      expect(retrieved!.threadId).toBe("t1");
    });

    // --- listRuns ---

    it("listRuns returns empty for unknown thread", async () => {
      const store = createStore();
      expect(await store.listRuns("nonexistent")).toEqual([]);
    });

    it("listRuns returns all runs in thread", async () => {
      const store = createStore();
      await store.beginRun({ threadId: "t1" });
      await store.beginRun({ threadId: "t1" });
      await store.beginRun({ threadId: "t2" });

      const t1Runs = await store.listRuns("t1");
      expect(t1Runs).toHaveLength(2);

      const t2Runs = await store.listRuns("t2");
      expect(t2Runs).toHaveLength(1);
    });

    // --- getTranscript ---

    it("getTranscript returns empty for unknown thread", async () => {
      const store = createStore();
      const transcript = await store.getTranscript({ threadId: "nonexistent" });
      expect(transcript).toEqual([]);
    });

    it("getTranscript returns committed messages", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      await store.activateRun(run.runId);

      const messages = [makeMessage("m1", null, "assistant"), makeMessage("m2", "m1", "tool")];
      await store.finalizeRun({ runId: run.runId, status: "committed", messages });

      const transcript = await store.getTranscript({ threadId: "t1" });
      expect(transcript).toHaveLength(2);
      expect(transcript[0]!.id).toBe("m1");
      expect(transcript[1]!.id).toBe("m2");
    });

    // --- listStaleRuns ---

    it("listStaleRuns returns empty when no runs are stale", async () => {
      const store = createStore();
      await store.beginRun({ threadId: "t1" });
      const stale = await store.listStaleRuns({ olderThanMs: 60_000 });
      expect(stale).toEqual([]);
    });

    // --- recoverRun ---

    it("recoverRun fails a stale run", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      await store.activateRun(run.runId);

      const result = await store.recoverRun({ runId: run.runId, action: "fail" });
      expect(result.previousStatus).toBe("streaming");
      expect(result.newStatus).toBe("failed");

      const recovered = await store.getRun(run.runId);
      expect(recovered!.status).toBe("failed");
    });

    it("recoverRun cancels a stale run", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });

      const result = await store.recoverRun({ runId: run.runId, action: "cancel" });
      expect(result.previousStatus).toBe("created");
      expect(result.newStatus).toBe("cancelled");
    });

    it("recoverRun throws for non-existent run", async () => {
      const store = createStore();
      await expect(store.recoverRun({ runId: "nonexistent", action: "fail" })).rejects.toThrow(
        "Run not found",
      );
    });

    it("recoverRun throws for already-terminal run", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      await store.activateRun(run.runId);
      await store.finalizeRun({ runId: run.runId, status: "committed", messages: [] });

      await expect(store.recoverRun({ runId: run.runId, action: "fail" })).rejects.toThrow();
    });

    // --- deleteThread ---

    it("deleteThread removes all runs and messages", async () => {
      const store = createStore();
      const run = await store.beginRun({ threadId: "t1" });
      await store.activateRun(run.runId);
      await store.finalizeRun({
        runId: run.runId,
        status: "committed",
        messages: [makeMessage("m1", null, "assistant")],
      });

      await store.deleteThread("t1");

      expect(await store.listRuns("t1")).toEqual([]);
      expect(await store.getTranscript({ threadId: "t1" })).toEqual([]);
    });

    it("deleteThread is a no-op for unknown threads", async () => {
      const store = createStore();
      await expect(store.deleteThread("nonexistent")).resolves.toBeUndefined();
    });

    // --- Thread isolation ---

    it("threads are isolated from each other", async () => {
      const store = createStore();

      const r1 = await store.beginRun({ threadId: "t1" });
      await store.activateRun(r1.runId);
      await store.finalizeRun({
        runId: r1.runId,
        status: "committed",
        messages: [makeMessage("m1", null, "assistant")],
      });

      const r2 = await store.beginRun({ threadId: "t2" });
      await store.activateRun(r2.runId);
      await store.finalizeRun({
        runId: r2.runId,
        status: "committed",
        messages: [makeMessage("m2", null, "assistant")],
      });

      await store.deleteThread("t1");

      expect(await store.getTranscript({ threadId: "t1" })).toEqual([]);
      const t2Transcript = await store.getTranscript({ threadId: "t2" });
      expect(t2Transcript).toHaveLength(1);
      expect(t2Transcript[0]!.id).toBe("m2");
    });
  });
}
