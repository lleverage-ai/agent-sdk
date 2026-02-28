import { describe, expect, it } from "vitest";

import { FullContextBuilder } from "../../src/ledger/context-builder.js";
import { InMemoryLedgerStore } from "../../src/ledger/stores/memory.js";
import type { CanonicalMessage } from "../../src/ledger/types.js";

function makeMessage(
  id: string,
  role: CanonicalMessage["role"],
  parts: CanonicalMessage["parts"],
): CanonicalMessage {
  return {
    id,
    parentMessageId: null,
    role,
    parts,
    createdAt: new Date().toISOString(),
    metadata: { schemaVersion: 1 },
  };
}

async function seedStore(
  messages: CanonicalMessage[],
): Promise<{ store: InMemoryLedgerStore; threadId: string }> {
  const store = new InMemoryLedgerStore();
  const threadId = "t1";
  const run = await store.beginRun({ threadId });
  await store.activateRun(run.runId);
  await store.finalizeRun({ runId: run.runId, status: "committed", messages });
  return { store, threadId };
}

describe("FullContextBuilder", () => {
  it("returns all messages for a thread", async () => {
    const messages = [
      makeMessage("m1", "assistant", [{ type: "text", text: "Hello" }]),
      makeMessage("m2", "tool", [
        { type: "tool-result", toolCallId: "tc-1", toolName: "test", output: "ok", isError: false },
      ]),
    ];
    const { store, threadId } = await seedStore(messages);
    const builder = new FullContextBuilder(store);

    const result = await builder.build({ threadId });
    expect(result.messages).toHaveLength(2);
    expect(result.provenance.threadId).toBe(threadId);
    expect(result.provenance.messageCount).toBe(2);
    expect(result.provenance.firstMessageId).toBe("m1");
    expect(result.provenance.lastMessageId).toBe("m2");
  });

  it("limits messages with maxMessages (takes from end)", async () => {
    const messages = [
      makeMessage("m1", "assistant", [{ type: "text", text: "First" }]),
      makeMessage("m2", "assistant", [{ type: "text", text: "Second" }]),
      makeMessage("m3", "assistant", [{ type: "text", text: "Third" }]),
    ];
    const { store, threadId } = await seedStore(messages);
    const builder = new FullContextBuilder(store);

    const result = await builder.build({ threadId, maxMessages: 2 });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.id).toBe("m2");
    expect(result.messages[1]!.id).toBe("m3");
  });

  it("filters out tool results when includeToolResults is false", async () => {
    const messages = [
      makeMessage("m1", "assistant", [{ type: "text", text: "Hello" }]),
      makeMessage("m2", "tool", [
        { type: "tool-result", toolCallId: "tc-1", toolName: "test", output: "ok", isError: false },
      ]),
      makeMessage("m3", "assistant", [{ type: "text", text: "Done" }]),
    ];
    const { store, threadId } = await seedStore(messages);
    const builder = new FullContextBuilder(store);

    const result = await builder.build({ threadId, includeToolResults: false });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.id).toBe("m1");
    expect(result.messages[1]!.id).toBe("m3");
  });

  it("filters out reasoning when includeReasoning is false", async () => {
    const messages = [
      makeMessage("m1", "assistant", [
        { type: "reasoning", text: "Thinking..." },
        { type: "text", text: "Answer" },
      ]),
    ];
    const { store, threadId } = await seedStore(messages);
    const builder = new FullContextBuilder(store);

    const result = await builder.build({ threadId, includeReasoning: false });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.parts).toHaveLength(1);
    expect(result.messages[0]!.parts[0]!.type).toBe("text");
  });

  it("returns empty for unknown thread", async () => {
    const store = new InMemoryLedgerStore();
    const builder = new FullContextBuilder(store);

    const result = await builder.build({ threadId: "nonexistent" });
    expect(result.messages).toEqual([]);
    expect(result.provenance.messageCount).toBe(0);
    expect(result.provenance.firstMessageId).toBeNull();
    expect(result.provenance.lastMessageId).toBeNull();
  });

  it("handles maxMessages larger than message count", async () => {
    const messages = [makeMessage("m1", "assistant", [{ type: "text", text: "Only one" }])];
    const { store, threadId } = await seedStore(messages);
    const builder = new FullContextBuilder(store);

    const result = await builder.build({ threadId, maxMessages: 100 });
    expect(result.messages).toHaveLength(1);
  });
});
