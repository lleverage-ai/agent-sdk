import { describe, expect, it } from "vitest";

import {
  DEFAULT_STALE_THRESHOLD_MS,
  listStaleRuns,
  recoverAllStaleRuns,
} from "../src/reconciliation.js";
import { InMemoryLedgerStore } from "../src/stores/memory.js";

describe("Reconciliation", () => {
  it("DEFAULT_STALE_THRESHOLD_MS is 5 minutes", () => {
    expect(DEFAULT_STALE_THRESHOLD_MS).toBe(5 * 60 * 1000);
  });

  it("listStaleRuns returns empty when no runs exist", async () => {
    const store = new InMemoryLedgerStore();
    const stale = await listStaleRuns(store);
    expect(stale).toEqual([]);
  });

  it("listStaleRuns returns empty when runs are recent", async () => {
    const store = new InMemoryLedgerStore();
    await store.beginRun({ threadId: "t1" });
    const stale = await listStaleRuns(store, { olderThanMs: 60_000 });
    expect(stale).toEqual([]);
  });

  it("listStaleRuns finds stale runs with custom threshold", async () => {
    const store = new InMemoryLedgerStore();
    await store.beginRun({ threadId: "t1" });

    // Stale with threshold of 0ms (anything is stale)
    const stale = await listStaleRuns(store, { olderThanMs: 0 });
    expect(stale).toHaveLength(1);
    expect(stale[0]!.run.threadId).toBe("t1");
    expect(stale[0]!.staleDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("listStaleRuns filters by threadId", async () => {
    const store = new InMemoryLedgerStore();
    await store.beginRun({ threadId: "t1" });
    await store.beginRun({ threadId: "t2" });

    const stale = await listStaleRuns(store, { threadId: "t1", olderThanMs: 0 });
    expect(stale).toHaveLength(1);
    expect(stale[0]!.run.threadId).toBe("t1");
  });

  it("listStaleRuns ignores terminal runs", async () => {
    const store = new InMemoryLedgerStore();
    const run = await store.beginRun({ threadId: "t1" });
    await store.activateRun(run.runId);
    await store.finalizeRun({ runId: run.runId, status: "committed", messages: [] });

    const stale = await listStaleRuns(store, { olderThanMs: 0 });
    expect(stale).toEqual([]);
  });

  it("recoverAllStaleRuns recovers all stale runs", async () => {
    const store = new InMemoryLedgerStore();
    const r1 = await store.beginRun({ threadId: "t1" });
    const r2 = await store.beginRun({ threadId: "t1" });

    const results = await recoverAllStaleRuns(store, "fail", { olderThanMs: 0 });
    expect(results).toHaveLength(2);

    const recovered1 = await store.getRun(r1.runId);
    expect(recovered1!.status).toBe("failed");

    const recovered2 = await store.getRun(r2.runId);
    expect(recovered2!.status).toBe("failed");
  });

  it("recoverAllStaleRuns with cancel action", async () => {
    const store = new InMemoryLedgerStore();
    const run = await store.beginRun({ threadId: "t1" });

    const results = await recoverAllStaleRuns(store, "cancel", { olderThanMs: 0 });
    expect(results).toHaveLength(1);
    expect(results[0]!.newStatus).toBe("cancelled");

    const recovered = await store.getRun(run.runId);
    expect(recovered!.status).toBe("cancelled");
  });

  it("recoverAllStaleRuns returns empty when nothing is stale", async () => {
    const store = new InMemoryLedgerStore();
    const results = await recoverAllStaleRuns(store, "fail", { olderThanMs: 60_000 });
    expect(results).toEqual([]);
  });

  it("recoverAllStaleRuns continues when one run recovery fails", async () => {
    const store = new InMemoryLedgerStore();
    const r1 = await store.beginRun({ threadId: "t1" });
    const r2 = await store.beginRun({ threadId: "t1" });

    const originalRecoverRun = store.recoverRun.bind(store);
    store.recoverRun = async (options) => {
      if (options.runId === r1.runId) {
        throw new Error("simulated recover failure");
      }
      return originalRecoverRun(options);
    };

    const results = await recoverAllStaleRuns(store, "fail", { olderThanMs: 0 });
    expect(results).toHaveLength(1);
    expect(results[0]!.runId).toBe(r2.runId);

    const run1 = await store.getRun(r1.runId);
    const run2 = await store.getRun(r2.runId);
    expect(run1!.status).toBe("created");
    expect(run2!.status).toBe("failed");
  });
});
