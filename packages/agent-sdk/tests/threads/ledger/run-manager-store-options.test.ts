import { describe, expect, expectTypeOf, it } from "vitest";
import { RunManager } from "../../../src/threads/ledger/run-manager.js";
import type { ILedgerStore } from "../../../src/threads/ledger/stores/ledger-store.js";
import { InMemoryLedgerStore } from "../../../src/threads/ledger/stores/memory.js";
import type { BeginRunOptions, RunRecord } from "../../../src/threads/ledger/types.js";
import { InMemoryEventStore } from "../../../src/threads/stream/stores/memory.js";
import type { StreamEvent } from "../../../src/threads/stream/stream-event.js";

// M14: a host ledger store may accept extra per-run fields on beginRun.
// RunManager infers the store's option type and forwards the object as-is;
// the activate / recover-on-activation-failure sequence is unchanged.

interface HostBeginRunOptions extends BeginRunOptions {
  runId?: string;
  clientRunRequestId?: string;
  target?: { mode: string; branchId?: string };
  organisationToken?: string;
}

/**
 * Mirrors the consumer pattern: an interface that omits `beginRun` from the
 * SDK store and redeclares it with a wider option type, implemented by a
 * class that delegates the rest to the SDK in-memory store.
 */
interface HostLedgerStore extends Omit<ILedgerStore, "beginRun"> {
  beginRun(options: HostBeginRunOptions): Promise<RunRecord>;
}

class RecordingHostStore extends InMemoryLedgerStore implements HostLedgerStore {
  readonly beginRunCalls: unknown[] = [];
  readonly calls: string[] = [];
  failActivation = false;
  failRecovery = false;

  override async beginRun(options: HostBeginRunOptions): Promise<RunRecord> {
    this.beginRunCalls.push(options);
    this.calls.push("beginRun");
    const { runId: _runId, ...sdkOptions } = options;
    return super.beginRun(sdkOptions);
  }

  override async activateRun(runId: string): Promise<RunRecord> {
    this.calls.push("activateRun");
    if (this.failActivation) throw new Error("activate failed");
    return super.activateRun(runId);
  }

  override async recoverRun(
    options: Parameters<InMemoryLedgerStore["recoverRun"]>[0],
  ): Promise<Awaited<ReturnType<InMemoryLedgerStore["recoverRun"]>>> {
    this.calls.push(`recoverRun:${options.action}`);
    if (this.failRecovery) throw new Error("recover failed");
    return super.recoverRun(options);
  }
}

function setup() {
  const store = new RecordingHostStore();
  const eventStore = new InMemoryEventStore<StreamEvent>();
  const manager = new RunManager(store, eventStore, {
    logger: { warn() {}, error() {} },
  });
  return { store, eventStore, manager };
}

describe("RunManager with a store declaring wider beginRun options", () => {
  it("infers the store's option type without a cast", () => {
    const { manager } = setup();
    expectTypeOf(manager).toEqualTypeOf<RunManager<HostBeginRunOptions>>();
    expectTypeOf(manager.beginRun).parameter(0).toEqualTypeOf<HostBeginRunOptions>();

    // The default stays BeginRunOptions for plain SDK stores.
    const plain = new RunManager(new InMemoryLedgerStore(), new InMemoryEventStore<StreamEvent>());
    expectTypeOf(plain).toEqualTypeOf<RunManager<BeginRunOptions>>();
    expectTypeOf(plain.beginRun).parameter(0).toEqualTypeOf<BeginRunOptions>();
  });

  it("forwards the exact options object to the store", async () => {
    const { store, manager } = setup();
    const options: HostBeginRunOptions = {
      threadId: "t1",
      forkFromMessageId: "m9",
      clientRunRequestId: "req-1",
      target: { mode: "append", branchId: "b1" },
      organisationToken: "org-token",
    };

    const run = await manager.beginRun(options);

    expect(store.beginRunCalls).toHaveLength(1);
    expect(store.beginRunCalls[0]).toBe(options);
    expect(store.beginRunCalls[0]).toEqual({
      threadId: "t1",
      forkFromMessageId: "m9",
      clientRunRequestId: "req-1",
      target: { mode: "append", branchId: "b1" },
      organisationToken: "org-token",
    });
    expect(run.status).toBe("streaming");
    expect(run.threadId).toBe("t1");
    expect(run.forkFromMessageId).toBe("m9");
  });

  it("keeps the beginRun -> activateRun sequence and returns a streaming record", async () => {
    const { store, manager } = setup();
    const run = await manager.beginRun({ threadId: "t1", clientRunRequestId: "r" });

    expect(store.calls).toEqual(["beginRun", "activateRun"]);
    expect(run.status).toBe("streaming");
    expect((await store.getRun(run.runId))?.status).toBe("streaming");
  });

  it("fails the orphaned run and rethrows when activation fails", async () => {
    const { store, manager } = setup();
    store.failActivation = true;

    await expect(manager.beginRun({ threadId: "t1", organisationToken: "x" })).rejects.toThrow(
      "activate failed",
    );

    expect(store.calls).toEqual(["beginRun", "activateRun", "recoverRun:fail"]);
    const runs = await store.listRuns("t1");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("failed");
  });

  it("rethrows the activation error when recovery also fails", async () => {
    const { store, manager } = setup();
    store.failActivation = true;
    store.failRecovery = true;

    await expect(manager.beginRun({ threadId: "t1" })).rejects.toThrow("activate failed");
    expect(store.calls).toEqual(["beginRun", "activateRun", "recoverRun:fail"]);
    const runs = await store.listRuns("t1");
    expect(runs[0]!.status).toBe("created");
  });
});
