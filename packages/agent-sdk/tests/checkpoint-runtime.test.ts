/**
 * Tests for the checkpoint runtime (`src/agent/checkpoint-runtime.ts`).
 *
 * End-to-end checkpoint behaviour (interrupt/resume, cache refresh) is covered
 * by the agent tests. This file pins the runtime's own contract: cache
 * coherence with the saver, invalidation, state restore/snapshot, error
 * wrapping, and the run-id continuation rule.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCheckpointRuntime,
  getCheckpointRunId,
  withCheckpointRunId,
} from "../src/agent/checkpoint-runtime.js";
import { createAgentState } from "../src/backends/state.js";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import type { Checkpoint, Interrupt } from "../src/checkpointer/types.js";
import { createCheckpoint } from "../src/checkpointer/types.js";
import { CheckpointError } from "../src/errors/index.js";

function makeInterrupt(overrides: Partial<Interrupt> = {}): Interrupt {
  return {
    id: "int_1",
    threadId: "t1",
    type: "custom",
    toolCallId: "call-1",
    toolName: "probe",
    request: { q: 1 },
    step: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Interrupt;
}

describe("getCheckpointRunId / withCheckpointRunId", () => {
  const base = createCheckpoint({
    threadId: "t1",
    messages: [],
    step: 2,
    state: { todos: [], files: {} },
    metadata: { runId: "run-old", keep: true },
  });

  it("reads runId only when it is a string", () => {
    expect(getCheckpointRunId(base)).toBe("run-old");
    expect(getCheckpointRunId(undefined)).toBeUndefined();
    expect(getCheckpointRunId({ ...base, metadata: { runId: 42 } })).toBeUndefined();
    expect(getCheckpointRunId({ ...base, metadata: undefined })).toBeUndefined();
  });

  it("overrides runId, preserves other metadata, and applies updates", () => {
    const interrupt = makeInterrupt();
    const next = withCheckpointRunId(base, "run-new", { pendingInterrupt: interrupt });
    expect(next.metadata).toEqual({ runId: "run-new", keep: true });
    expect(next.pendingInterrupt).toBe(interrupt);
    expect(next.step).toBe(2);
  });

  it("keeps the existing runId when none is given", () => {
    expect(withCheckpointRunId(base, undefined).metadata?.runId).toBe("run-old");
  });
});

describe("createCheckpointRuntime", () => {
  let saver: MemorySaver;
  let state: ReturnType<typeof createAgentState>;

  beforeEach(() => {
    saver = new MemorySaver();
    state = createAgentState();
  });

  describe("without a checkpointer", () => {
    it("every operation is a no-op", async () => {
      const runtime = createCheckpointRuntime({ checkpointer: undefined, state });
      const checkpoint = createCheckpoint({
        threadId: "t1",
        messages: [],
        step: 0,
        state: { todos: [], files: {} },
      });

      await expect(runtime.load("t1")).resolves.toBeUndefined();
      await expect(runtime.save("t1", [], 0)).resolves.toBeUndefined();
      await expect(runtime.commit("t1", checkpoint)).resolves.toBeUndefined();
      await expect(
        runtime.markPendingInterrupt("t1", makeInterrupt(), "run-1"),
      ).resolves.toBeUndefined();
      expect(() => runtime.invalidate("t1")).not.toThrow();
      await expect(runtime.load("t1")).resolves.toBeUndefined();
    });

    it("resolveRunId still honours _runId and otherwise mints one", async () => {
      const runtime = createCheckpointRuntime({ checkpointer: undefined, state });
      await expect(runtime.resolveRunId({ _runId: "given", threadId: "t1" })).resolves.toBe(
        "given",
      );
      const minted = await runtime.resolveRunId({ threadId: "t1" });
      expect(minted).toEqual(expect.any(String));
      expect(minted).not.toBe("");
    });
  });

  describe("load()", () => {
    it("restores agent state from the checkpoint and caches it", async () => {
      await saver.save(
        createCheckpoint({
          threadId: "t1",
          messages: [{ role: "user", content: "hi" }],
          step: 1,
          state: { todos: [{ id: "a", content: "x", status: "pending" }], files: { "/f": "1" } },
        }),
      );
      const loadSpy = vi.spyOn(saver, "load");
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });

      const first = await runtime.load("t1");
      expect(first?.messages).toHaveLength(1);
      expect(state.todos).toEqual([{ id: "a", content: "x", status: "pending" }]);
      expect(state.files).toEqual({ "/f": "1" });

      const second = await runtime.load("t1");
      expect(second).toBe(first);
      expect(loadSpy).toHaveBeenCalledTimes(1);
    });

    it("does not cache a missing checkpoint", async () => {
      const loadSpy = vi.spyOn(saver, "load");
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });

      await expect(runtime.load("nope")).resolves.toBeUndefined();
      await expect(runtime.load("nope")).resolves.toBeUndefined();
      expect(loadSpy).toHaveBeenCalledTimes(2);
    });

    it("wraps saver failures in CheckpointError", async () => {
      vi.spyOn(saver, "load").mockRejectedValue(new Error("disk"));
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });

      await expect(runtime.load("t1")).rejects.toMatchObject({
        constructor: CheckpointError,
        operation: "load",
        threadId: "t1",
      });
    });
  });

  describe("invalidate()", () => {
    function seed(step: number, todo: string, extra: Partial<Checkpoint> = {}): Checkpoint {
      return {
        ...createCheckpoint({
          threadId: "t1",
          messages: [{ role: "user", content: `at ${step}` }],
          step,
          state: { todos: [{ id: todo, content: todo, status: "pending" }], files: { "/f": todo } },
        }),
        ...extra,
      };
    }

    it("keeps serving the cache when nothing invalidates it", async () => {
      await saver.save(seed(1, "old"));
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      const first = await runtime.load("t1");

      await saver.save(seed(5, "new"));

      expect(await runtime.load("t1")).toBe(first);
      expect(state.todos.map((todo) => todo.id)).toEqual(["old"]);
    });

    it("makes the next load read the saver, restore state and notify again", async () => {
      await saver.save(seed(1, "old"));
      const onLoaded = vi.fn(async () => {});
      const runtime = createCheckpointRuntime({ checkpointer: saver, state, onLoaded });
      await runtime.load("t1");
      await saver.save(seed(5, "new"));
      const loadSpy = vi.spyOn(saver, "load");

      runtime.invalidate("t1");
      const refreshed = await runtime.load("t1");

      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(refreshed?.step).toBe(5);
      expect(state.todos.map((todo) => todo.id)).toEqual(["new"]);
      expect(state.files).toEqual({ "/f": "new" });
      expect(onLoaded).toHaveBeenCalledTimes(2);
      expect(onLoaded).toHaveBeenLastCalledWith(refreshed, "t1");
      // One refresh, one reload: the fresh checkpoint is cached again.
      expect(await runtime.load("t1")).toBe(refreshed);
      expect(loadSpy).toHaveBeenCalledTimes(1);
    });

    it("keeps the stale checkpoint as the save base until the reload", async () => {
      await saver.save({ ...seed(1, "old"), metadata: { runId: "run-1", keep: true } });
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      const first = await runtime.load("t1");

      runtime.invalidate("t1");
      const interrupt = makeInterrupt();
      const marked = await runtime.markPendingInterrupt("t1", interrupt, undefined);
      const saved = await runtime.save("t1", [], 2);

      expect(marked?.createdAt).toBe(first?.createdAt);
      expect(marked?.pendingInterrupt).toBe(interrupt);
      expect(saved?.metadata).toEqual({ runId: "run-1", keep: true });
      expect(saved?.pendingInterrupt).toBe(interrupt);
    });

    it("keeps a pending interrupt that is in the store", async () => {
      const interrupt = makeInterrupt({ id: "int_store" });
      await saver.save(seed(1, "old"));
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      await runtime.load("t1");
      await saver.save({ ...seed(3, "new"), pendingInterrupt: interrupt });

      runtime.invalidate("t1");

      expect((await runtime.load("t1"))?.pendingInterrupt).toEqual(interrupt);
    });

    it("drops the cache when the store no longer has the thread", async () => {
      await saver.save(seed(1, "old"));
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      await runtime.load("t1");
      await saver.delete("t1");

      runtime.invalidate("t1");

      await expect(runtime.load("t1")).resolves.toBeUndefined();
      // The next save starts a new checkpoint rather than updating the old one.
      const saved = await runtime.save("t1", [], 1);
      expect(saved?.messages).toEqual([]);
    });

    it("stays stale when the reload fails", async () => {
      await saver.save(seed(1, "old"));
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      await runtime.load("t1");
      await saver.save(seed(5, "new"));
      const loadSpy = vi.spyOn(saver, "load").mockRejectedValueOnce(new Error("disk"));

      runtime.invalidate("t1");
      await expect(runtime.load("t1")).rejects.toBeInstanceOf(CheckpointError);

      expect((await runtime.load("t1"))?.step).toBe(5);
      expect(loadSpy).toHaveBeenCalledTimes(2);
    });

    it("does not let a load that started before the refresh fill the cache", async () => {
      await saver.save(seed(1, "old"));
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const realLoad = saver.load.bind(saver);
      vi.spyOn(saver, "load").mockImplementationOnce(async (threadId) => {
        const loaded = await realLoad(threadId);
        await gate;
        return loaded;
      });

      const inFlight = runtime.load("t1");
      await Promise.resolve();
      await saver.save(seed(5, "new"));
      runtime.invalidate("t1");
      release();

      expect((await inFlight)?.step).toBe(1);
      expect((await runtime.load("t1"))?.step).toBe(5);
    });

    it("only affects the thread it names", async () => {
      await saver.save(seed(1, "old"));
      await saver.save({ ...seed(1, "other"), threadId: "t2" });
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      const other = await runtime.load("t2");
      await runtime.load("t1");

      runtime.invalidate("t1");

      expect(await runtime.load("t2")).toBe(other);
    });
  });

  describe("save()", () => {
    it("creates a checkpoint snapshotting agent state, then updates it in place", async () => {
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      state.todos.push({ id: "a", content: "x", status: "pending" });

      const created = await runtime.save("t1", [{ role: "user", content: "hi" }], 1, "run-1");
      expect(created?.step).toBe(1);
      expect(created?.state.todos).toEqual([{ id: "a", content: "x", status: "pending" }]);
      expect(created?.metadata).toEqual({ runId: "run-1" });
      // Snapshot, not a live reference
      expect(created?.state.todos).not.toBe(state.todos);

      const updated = await runtime.save("t1", [], 2);
      expect(updated?.createdAt).toBe(created?.createdAt);
      expect(updated?.step).toBe(2);
      // runId survives a save without one
      expect(updated?.metadata).toEqual({ runId: "run-1" });
      expect((await saver.load("t1"))?.step).toBe(2);
      expect(await runtime.load("t1")).toBe(updated);
    });

    it("wraps saver failures in CheckpointError and leaves the cache untouched", async () => {
      vi.spyOn(saver, "save").mockRejectedValue(new Error("disk"));
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });

      await expect(runtime.save("t1", [], 3)).rejects.toMatchObject({
        constructor: CheckpointError,
        operation: "save",
        metadata: { threadId: "t1", step: 3 },
      });
      // Nothing cached: the next load goes to the saver, which has nothing.
      vi.restoreAllMocks();
      await expect(runtime.load("t1")).resolves.toBeUndefined();
    });
  });

  describe("commit()", () => {
    it("persists the given checkpoint and makes it the cached one", async () => {
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      const shaped = createCheckpoint({
        threadId: "t1",
        messages: [{ role: "user", content: "shaped" }],
        step: 9,
        state: { todos: [], files: {} },
      });

      await runtime.commit("t1", shaped);

      expect(await runtime.load("t1")).toBe(shaped);
      expect((await saver.load("t1"))?.step).toBe(9);
    });
  });

  describe("markPendingInterrupt()", () => {
    it("stamps the interrupt and run id on the cached checkpoint", async () => {
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      await runtime.save("t1", [], 1, "run-1");
      const interrupt = makeInterrupt();

      const marked = await runtime.markPendingInterrupt("t1", interrupt, "run-2");

      expect(marked?.pendingInterrupt).toBe(interrupt);
      expect(marked?.metadata).toEqual({ runId: "run-2" });
      expect(await runtime.load("t1")).toBe(marked);
      expect((await saver.load("t1"))?.pendingInterrupt?.id).toBe("int_1");
    });

    it("uses an explicit base checkpoint over the cache", async () => {
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      await runtime.save("t1", [], 1, "run-1");
      const base: Checkpoint = createCheckpoint({
        threadId: "t1",
        messages: [{ role: "user", content: "explicit" }],
        step: 7,
        state: { todos: [], files: {} },
      });

      const marked = await runtime.markPendingInterrupt("t1", makeInterrupt(), undefined, base);

      expect(marked?.step).toBe(7);
      expect(marked?.metadata).toEqual({});
      expect(await runtime.load("t1")).toBe(marked);
    });

    it("returns undefined when there is no checkpoint to stamp", async () => {
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      await expect(
        runtime.markPendingInterrupt("t1", makeInterrupt(), "run-1"),
      ).resolves.toBeUndefined();
      expect(await saver.load("t1")).toBeUndefined();
    });
  });

  describe("resolveRunId()", () => {
    it("prefers an explicit _runId", async () => {
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      await runtime.save("t1", [], 0, "run-ckpt");
      await runtime.markPendingInterrupt("t1", makeInterrupt(), "run-ckpt");

      await expect(runtime.resolveRunId({ _runId: "run-given", threadId: "t1" })).resolves.toBe(
        "run-given",
      );
    });

    it("continues the run id of a pending interrupt", async () => {
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      await runtime.save("t1", [], 0, "run-ckpt");
      await runtime.markPendingInterrupt("t1", makeInterrupt(), "run-ckpt");

      await expect(runtime.resolveRunId({ threadId: "t1" })).resolves.toBe("run-ckpt");
    });

    it("mints a new id when there is no pending interrupt", async () => {
      const runtime = createCheckpointRuntime({ checkpointer: saver, state });
      await runtime.save("t1", [], 0, "run-ckpt");

      const resolved = await runtime.resolveRunId({ threadId: "t1" });
      expect(resolved).not.toBe("run-ckpt");
      expect(resolved).toEqual(expect.any(String));
    });
  });
});
