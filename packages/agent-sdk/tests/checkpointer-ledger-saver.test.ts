import { beforeEach, describe, expect, it } from "vitest";
import { createAgentState } from "../src/backends/state.js";
import type { CanonicalMessage } from "../src/canonical.js";
import { createLedgerCheckpointer } from "../src/checkpointer/ledger-saver.js";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import type { Checkpoint, Interrupt } from "../src/checkpointer/types.js";
import type { ILedgerStore } from "../src/threads/ledger/index.js";

function userText(text: string): CanonicalMessage {
  return {
    id: `m-${text}`,
    parentMessageId: null,
    role: "user",
    parts: [{ type: "text", text }],
    createdAt: "2026-06-30T00:00:00.000Z",
    metadata: { schemaVersion: 2 },
  };
}

function fakeLedger(transcripts: Record<string, CanonicalMessage[]>): ILedgerStore {
  return {
    async getTranscript({ threadId }: { threadId: string }) {
      return transcripts[threadId] ?? [];
    },
    async deleteThread(threadId: string) {
      delete transcripts[threadId];
    },
  } as unknown as ILedgerStore;
}

function baseCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    threadId: "t1",
    step: 0,
    messages: [],
    state: createAgentState(),
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("createLedgerCheckpointer", () => {
  let resumeSaver: MemorySaver;

  beforeEach(() => {
    resumeSaver = new MemorySaver();
  });

  it("returns undefined when there is no resume state and no transcript", async () => {
    const cp = createLedgerCheckpointer({ ledgerStore: fakeLedger({}), resumeSaver });
    expect(await cp.load("t1")).toBeUndefined();
  });

  it("reconstructs messages from the ledger even without a prior save", async () => {
    const cp = createLedgerCheckpointer({
      ledgerStore: fakeLedger({ t1: [userText("hello")] }),
      resumeSaver,
    });
    const loaded = await cp.load("t1");
    expect(loaded?.step).toBe(0);
    expect(loaded?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(loaded?.state).toEqual(createAgentState());
  });

  it("round-trips the resume delta and rebuilds messages from the ledger", async () => {
    const interrupt: Interrupt = {
      id: "int-1",
      threadId: "t1",
      type: "approval",
      toolCallId: "call-1",
      toolName: "deleteFile",
      request: { toolName: "deleteFile", args: { path: "/x" } },
      step: 3,
      createdAt: "2026-06-30T00:00:00.000Z",
    };
    const cp = createLedgerCheckpointer({
      ledgerStore: fakeLedger({ t1: [userText("hi")] }),
      resumeSaver,
    });

    await cp.save(
      baseCheckpoint({
        step: 3,
        // These messages must NOT be the source of truth on reload.
        messages: [{ role: "assistant", content: "stale" }],
        state: {
          todos: [{ id: "td-1", content: "do x", status: "pending", createdAt: "x" }],
          files: {},
        },
        pendingInterrupt: interrupt,
        metadata: { foo: "bar" },
      }),
    );

    const loaded = await cp.load("t1");
    expect(loaded?.step).toBe(3);
    expect(loaded?.pendingInterrupt).toEqual(interrupt);
    expect(loaded?.state.todos).toHaveLength(1);
    expect(loaded?.metadata).toEqual({ foo: "bar" });
    // messages come from the ledger transcript, not the saved blob
    expect(loaded?.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
  });

  it("does not persist messages — they are owned by the ledger", async () => {
    const cp = createLedgerCheckpointer({ ledgerStore: fakeLedger({}), resumeSaver });
    await cp.save(
      baseCheckpoint({ step: 2, messages: [{ role: "user", content: "should not persist" }] }),
    );

    // The inner resume saver stores the checkpoint with messages emptied out.
    const innerRaw = await resumeSaver.load("t1");
    expect(innerRaw?.messages).toEqual([]);

    // And because the ledger is empty, reload yields no messages but keeps step.
    const loaded = await cp.load("t1");
    expect(loaded?.step).toBe(2);
    expect(loaded?.messages).toEqual([]);
  });

  it("exists() is true when there is resume state or a transcript", async () => {
    const withTranscript = createLedgerCheckpointer({
      ledgerStore: fakeLedger({ t1: [userText("hi")] }),
      resumeSaver,
    });
    expect(await withTranscript.exists("t1")).toBe(true);
    expect(await withTranscript.exists("missing")).toBe(false);

    const empty = createLedgerCheckpointer({ ledgerStore: fakeLedger({}), resumeSaver });
    expect(await empty.exists("t1")).toBe(false);
    await empty.save(baseCheckpoint({ step: 1 }));
    expect(await empty.exists("t1")).toBe(true);
  });

  it("list() reflects threads with a persisted resume delta", async () => {
    const cp = createLedgerCheckpointer({ ledgerStore: fakeLedger({}), resumeSaver });
    await cp.save(baseCheckpoint({ threadId: "a" }));
    await cp.save(baseCheckpoint({ threadId: "b" }));
    expect((await cp.list()).sort()).toEqual(["a", "b"]);
  });

  it("delete() removes the whole thread, including the durable transcript", async () => {
    const ledgerStore = fakeLedger({ t1: [userText("hi")] });
    const cp = createLedgerCheckpointer({ ledgerStore, resumeSaver });
    await cp.save(baseCheckpoint({ threadId: "t1", step: 4 }));

    expect(await cp.delete("t1")).toBe(true);
    // Both the resume delta and the ledger transcript are gone, so the thread
    // is no longer resolvable — not silently reconstructed from the ledger.
    expect(await cp.exists("t1")).toBe(false);
    expect(await cp.load("t1")).toBeUndefined();
  });

  it("delete() reports true for a transcript-only thread and removes it", async () => {
    const ledgerStore = fakeLedger({ t1: [userText("hi")] });
    const cp = createLedgerCheckpointer({ ledgerStore, resumeSaver });

    // No prior save(): the thread exists only as a ledger transcript.
    expect(await cp.exists("t1")).toBe(true);
    expect(await cp.delete("t1")).toBe(true);
    expect(await cp.exists("t1")).toBe(false);

    // A genuinely unknown thread reports not-found.
    expect(await cp.delete("missing")).toBe(false);
  });
});
