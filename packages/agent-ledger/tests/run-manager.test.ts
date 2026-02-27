import type { StreamEvent } from "@lleverage-ai/agent-stream";

import { InMemoryEventStore } from "@lleverage-ai/agent-stream";
import { describe, expect, it } from "vitest";

import { RunManager } from "../src/run-manager.js";
import { InMemoryLedgerStore } from "../src/stores/memory.js";

function createTestSetup() {
  const ledgerStore = new InMemoryLedgerStore();
  const eventStore = new InMemoryEventStore<StreamEvent>();
  const manager = new RunManager(ledgerStore, eventStore);
  return { ledgerStore, eventStore, manager };
}

describe("RunManager", () => {
  it("beginRun creates a run in streaming status", async () => {
    const { manager } = createTestSetup();
    const run = await manager.beginRun({ threadId: "t1" });
    expect(run.status).toBe("streaming");
    expect(run.threadId).toBe("t1");
  });

  it("appendEvents stores events in the event store", async () => {
    const { manager, eventStore } = createTestSetup();
    const run = await manager.beginRun({ threadId: "t1" });

    const events: StreamEvent[] = [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "Hello" } },
      { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
    ];

    const stored = await manager.appendEvents(run.runId, events);
    expect(stored).toHaveLength(3);
    expect(stored[0]!.seq).toBe(1);

    const replayed = await eventStore.replay(run.streamId);
    expect(replayed).toHaveLength(3);
  });

  it("appendEvents throws for non-existent run", async () => {
    const { manager } = createTestSetup();
    await expect(
      manager.appendEvents("nonexistent", [{ kind: "text-delta", payload: { delta: "hi" } }]),
    ).rejects.toThrow("Run not found");
  });

  it("appendEvents throws for terminal run statuses", async () => {
    const { manager } = createTestSetup();
    const run = await manager.beginRun({ threadId: "t1" });
    await manager.finalizeRun(run.runId, "failed");

    await expect(
      manager.appendEvents(run.runId, [{ kind: "text-delta", payload: { delta: "late event" } }]),
    ).rejects.toThrow('Cannot append events to run in status "failed"');
  });

  it("finalizeRun with committed status accumulates messages", async () => {
    const { manager, ledgerStore } = createTestSetup();
    const run = await manager.beginRun({ threadId: "t1" });

    await manager.appendEvents(run.runId, [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "Hello, world!" } },
      { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
    ]);

    const result = await manager.finalizeRun(run.runId, "committed");
    expect(result.committed).toBe(true);

    const transcript = await ledgerStore.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(1);
    expect(transcript[0]!.role).toBe("assistant");
    expect(transcript[0]!.parts[0]).toEqual({ type: "text", text: "Hello, world!" });
  });

  it("finalizeRun with failed status does not accumulate messages", async () => {
    const { manager, ledgerStore } = createTestSetup();
    const run = await manager.beginRun({ threadId: "t1" });

    await manager.appendEvents(run.runId, [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "Partial..." } },
    ]);

    const result = await manager.finalizeRun(run.runId, "failed");
    expect(result.committed).toBe(true);

    const transcript = await ledgerStore.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(0);
  });

  it("finalizeRun with cancelled status does not accumulate messages", async () => {
    const { manager, ledgerStore } = createTestSetup();
    const run = await manager.beginRun({ threadId: "t1" });

    await manager.appendEvents(run.runId, [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "Partial..." } },
    ]);

    const result = await manager.finalizeRun(run.runId, "cancelled");
    expect(result.committed).toBe(true);

    const transcript = await ledgerStore.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(0);
  });

  it("finalizeRun throws for non-existent run", async () => {
    const { manager } = createTestSetup();
    await expect(manager.finalizeRun("nonexistent", "committed")).rejects.toThrow("Run not found");
  });

  it("handles multi-step tool use pipeline", async () => {
    const { manager, ledgerStore } = createTestSetup();
    const run = await manager.beginRun({ threadId: "t1" });

    await manager.appendEvents(run.runId, [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "Let me search." } },
      {
        kind: "tool-call",
        payload: { toolCallId: "tc-1", toolName: "search", input: { q: "test" } },
      },
      { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
      {
        kind: "tool-result",
        payload: { toolCallId: "tc-1", toolName: "search", output: "Found!", isError: false },
      },
      { kind: "step-started", payload: { stepIndex: 1 } },
      { kind: "text-delta", payload: { delta: "Here are the results." } },
      { kind: "step-finished", payload: { stepIndex: 1, finishReason: "stop" } },
    ]);

    await manager.finalizeRun(run.runId, "committed");

    const transcript = await ledgerStore.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(3);
    expect(transcript[0]!.role).toBe("assistant");
    expect(transcript[1]!.role).toBe("tool");
    expect(transcript[2]!.role).toBe("assistant");
  });
});
