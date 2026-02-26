import type { StreamEvent } from "@lleverage-ai/agent-stream";

import { InMemoryEventStore } from "@lleverage-ai/agent-stream";
import { describe, expect, it } from "vitest";

import { RunManager } from "../../src/run-manager.js";
import { InMemoryLedgerStore } from "../../src/stores/memory.js";

describe("Integration: accumulator → store", () => {
  it("full pipeline: append events → accumulate → store → getTranscript", async () => {
    const ledgerStore = new InMemoryLedgerStore();
    const eventStore = new InMemoryEventStore<StreamEvent>();
    const manager = new RunManager(ledgerStore, eventStore);

    const run = await manager.beginRun({ threadId: "t1" });

    // Append events simulating a multi-step conversation
    await manager.appendEvents(run.runId, [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "I'll help you " } },
      { kind: "text-delta", payload: { delta: "with that." } },
      {
        kind: "tool-call",
        payload: { toolCallId: "tc-1", toolName: "read", input: { path: "/file.txt" } },
      },
      { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
      {
        kind: "tool-result",
        payload: { toolCallId: "tc-1", toolName: "read", output: "file contents", isError: false },
      },
      { kind: "step-started", payload: { stepIndex: 1 } },
      { kind: "text-delta", payload: { delta: "Here is the file content." } },
      { kind: "step-finished", payload: { stepIndex: 1, finishReason: "stop" } },
    ]);

    // Finalize: replay → accumulate → store
    const result = await manager.finalizeRun(run.runId, "committed");
    expect(result.committed).toBe(true);

    // Verify transcript from store
    const transcript = await ledgerStore.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(3);

    // Message 1: assistant with text + tool-call
    expect(transcript[0]!.role).toBe("assistant");
    expect(transcript[0]!.parts).toHaveLength(2);
    expect(transcript[0]!.parts[0]).toEqual({ type: "text", text: "I'll help you with that." });
    expect(transcript[0]!.parts[1]!.type).toBe("tool-call");

    // Message 2: tool result
    expect(transcript[1]!.role).toBe("tool");
    expect(transcript[1]!.parts[0]!.type).toBe("tool-result");

    // Message 3: assistant follow-up
    expect(transcript[2]!.role).toBe("assistant");
    expect(transcript[2]!.parts[0]).toEqual({ type: "text", text: "Here is the file content." });

    // Verify parent linking
    expect(transcript[0]!.parentMessageId).toBeNull();
    expect(transcript[1]!.parentMessageId).toBe(transcript[0]!.id);
    expect(transcript[2]!.parentMessageId).toBe(transcript[1]!.id);
  });

  it("multiple runs accumulate into a continuous transcript", async () => {
    const ledgerStore = new InMemoryLedgerStore();
    const eventStore = new InMemoryEventStore<StreamEvent>();
    const manager = new RunManager(ledgerStore, eventStore);

    // Run 1
    const run1 = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run1.runId, [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "First response." } },
      { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
    ]);
    await manager.finalizeRun(run1.runId, "committed");

    // Run 2
    const run2 = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run2.runId, [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "Second response." } },
      { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
    ]);
    await manager.finalizeRun(run2.runId, "committed");

    const transcript = await ledgerStore.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(2);
    expect(transcript[0]!.parts[0]).toEqual({ type: "text", text: "First response." });
    expect(transcript[1]!.parts[0]).toEqual({ type: "text", text: "Second response." });
  });

  it("failed run does not add messages to transcript", async () => {
    const ledgerStore = new InMemoryLedgerStore();
    const eventStore = new InMemoryEventStore<StreamEvent>();
    const manager = new RunManager(ledgerStore, eventStore);

    // Successful run
    const run1 = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run1.runId, [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "Good response." } },
      { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
    ]);
    await manager.finalizeRun(run1.runId, "committed");

    // Failed run
    const run2 = await manager.beginRun({ threadId: "t1" });
    await manager.appendEvents(run2.runId, [
      { kind: "step-started", payload: { stepIndex: 0 } },
      { kind: "text-delta", payload: { delta: "Partial..." } },
      { kind: "error", payload: { message: "Connection lost" } },
    ]);
    await manager.finalizeRun(run2.runId, "failed");

    const transcript = await ledgerStore.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(1);
    expect(transcript[0]!.parts[0]).toEqual({ type: "text", text: "Good response." });
  });
});
