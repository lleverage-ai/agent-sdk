import { describe, expect, it } from "vitest";

import { accumulateEvents } from "../../../src/ledger/accumulator.js";
import { createCounterIdGenerator } from "../../../src/ledger/ulid.js";
import {
  assertSLO,
  createLoadTestSetup,
  generateTextDeltaSequence,
  generateToolUseSequence,
  Stopwatch,
} from "./helpers.js";

describe("Accumulation throughput", () => {
  it("accumulates 1000 text-deltas under 100ms", () => {
    const events = generateTextDeltaSequence(1000);
    const idGen = createCounterIdGenerator("msg");

    // Convert to StoredEvent format
    const storedEvents = events.map((e, i) => ({
      seq: i + 1,
      timestamp: new Date().toISOString(),
      streamId: "s1",
      event: e,
    }));

    const t0 = performance.now();
    const messages = accumulateEvents(storedEvents, idGen);
    const elapsed = performance.now() - t0;

    expect(elapsed, `1000 text-deltas took ${elapsed.toFixed(2)}ms`).toBeLessThan(100);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("assistant");
  });

  it("accumulates 1000 events with 200 tool-call/result pairs", () => {
    const events = generateToolUseSequence(200);
    const idGen = createCounterIdGenerator("msg");

    const storedEvents = events.map((e, i) => ({
      seq: i + 1,
      timestamp: new Date().toISOString(),
      streamId: "s1",
      event: e,
    }));

    const t0 = performance.now();
    const messages = accumulateEvents(storedEvents, idGen);
    const elapsed = performance.now() - t0;

    expect(elapsed, `200 tool pairs took ${elapsed.toFixed(2)}ms`).toBeLessThan(200);

    // Each tool cycle produces: assistant msg (with tool-call), tool msg (result)
    // Plus final assistant msg with text
    // 200 tool-calls: 200 assistant + 200 tool + 1 final assistant = 401
    const assistantCount = messages.filter((m) => m.role === "assistant").length;
    const toolCount = messages.filter((m) => m.role === "tool").length;
    expect(toolCount).toBe(200);
    expect(assistantCount).toBe(201);
  });

  it("accumulates 5000 text-deltas under 500ms", () => {
    const events = generateTextDeltaSequence(5000);
    const idGen = createCounterIdGenerator("msg");

    const storedEvents = events.map((e, i) => ({
      seq: i + 1,
      timestamp: new Date().toISOString(),
      streamId: "s1",
      event: e,
    }));

    const t0 = performance.now();
    const messages = accumulateEvents(storedEvents, idGen);
    const elapsed = performance.now() - t0;

    expect(elapsed, `5000 text-deltas took ${elapsed.toFixed(2)}ms`).toBeLessThan(500);
    expect(messages).toHaveLength(1);
  });

  it("RunManager.finalizeRun with 1000 events under 200ms", async () => {
    const { manager, ledgerStore } = createLoadTestSetup();
    const run = await manager.beginRun({ threadId: "t1" });

    const events = generateTextDeltaSequence(1000);
    await manager.appendEvents(run.runId, events);

    const t0 = performance.now();
    const result = await manager.finalizeRun(run.runId, "committed");
    const elapsed = performance.now() - t0;

    expect(elapsed, `finalizeRun with 1000 events took ${elapsed.toFixed(2)}ms`).toBeLessThan(200);
    expect(result.committed).toBe(true);

    const transcript = await ledgerStore.getTranscript({ threadId: "t1" });
    expect(transcript.length).toBeGreaterThan(0);
  });

  it("50 sequential finalizeRun calls (100 events each) — p95 < 50ms", async () => {
    const sw = new Stopwatch();

    for (let i = 0; i < 50; i++) {
      const { manager } = createLoadTestSetup();
      const run = await manager.beginRun({ threadId: `t-${i}` });
      const events = generateTextDeltaSequence(100);
      await manager.appendEvents(run.runId, events);

      const stop = sw.start();
      await manager.finalizeRun(run.runId, "committed");
      stop();
    }

    const report = sw.getReport();
    assertSLO(report, "sequential-finalizeRun-100-events", { p95MaxMs: 50 });
  });
});
