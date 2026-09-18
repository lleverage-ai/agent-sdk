import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTask, TaskManager } from "../src/index.js";

const task = (id: string) =>
  createBackgroundTask({ id, description: "work", subagentType: "child" });
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());

describe("owned-task host callbacks and replay bounds", () => {
  it("honours cancellation from a synchronous taskCreated listener before execution", async () => {
    vi.useFakeTimers();
    const manager = new TaskManager();
    manager.configureOwnedTasks({ cancellationGraceMs: 50 });
    let killed: ReturnType<TaskManager["killTask"]> | undefined;
    manager.on("taskCreated", (created) => {
      killed = manager.killTask(created.id);
    });
    const execute = vi.fn(async () => "must not run");
    const result = await manager.owned!.run(task("created"), false, undefined, execute);
    expect(await killed).toEqual({ killed: true });
    expect(result).toMatchObject({ error: true });
    expect(execute).not.toHaveBeenCalled();
    expect(manager.owned!.outstanding.records).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases admission when a synchronous registration listener throws", async () => {
    vi.useFakeTimers();
    const failure = new Error("registration observer failed");
    const release = vi.fn();
    const manager = new TaskManager();
    manager.configureOwnedTasks({ cancellationGraceMs: 50 }, { admit: () => release });
    manager.on("taskCreated", () => {
      throw failure;
    });
    const execute = vi.fn(async () => "must not run");
    await expect(manager.owned!.run(task("created"), false, undefined, execute)).rejects.toBe(
      failure,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(manager.getAllTasks()).toHaveLength(0);
    expect(manager.owned!.outstanding.records).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["reject", "never-settle"] as const)(
    "does not lose ownership or await an async unresolved callback (%s)",
    async (outcome) => {
      vi.useFakeTimers();
      let resolve!: (text: string) => void;
      const work = new Promise<string>((done) => {
        resolve = done;
      });
      const report = vi.fn(() =>
        outcome === "reject"
          ? Promise.reject(new Error("report failed"))
          : new Promise<void>(() => {}),
      );
      const manager = new TaskManager();
      manager.configureOwnedTasks({ cancellationGraceMs: 50 }, { onUnresolved: report });
      try {
        await manager.owned!.run(task("child"), true, undefined, () => work);
        await flush();
        const killed = manager.killTask("child");
        await vi.advanceTimersByTimeAsync(50);
        expect(await killed).toEqual({ killed: false, reason: "subagent_cleanup_unresolved" });
        expect(report).toHaveBeenCalledTimes(1);
        expect(manager.owned!.outstanding.records).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        resolve("late");
        await flush();
      }
      expect(manager.owned!.outstanding.records).toBe(0);
    },
  );

  it("reserves before execution and releases exactly once after settlement", async () => {
    const release = vi.fn();
    const admit = vi.fn(() => release);
    const manager = new TaskManager();
    manager.configureOwnedTasks({ cancellationGraceMs: 50 }, { admit });
    manager.beginTaskScope({ runId: "run", attemptId: "attempt" });
    const execute = vi.fn(async () => {
      expect(admit).toHaveBeenCalledExactlyOnceWith({
        id: "child",
        runId: "run",
        attemptId: "attempt",
      });
      expect(release).not.toHaveBeenCalled();
      return "done";
    });
    await expect(
      manager.owned!.run(task("child"), false, undefined, execute, "call"),
    ).resolves.toMatchObject({ success: true });
    await manager.settleOwnedTasks("done");
    expect(release).toHaveBeenCalledTimes(1);
    expect(manager.owned!.outstanding).toEqual({ records: 0, replayEntries: 1, replayBytes: 4 });
  });

  it("contains a rejected release callback without changing completed execution", async () => {
    const manager = new TaskManager();
    const release = vi.fn(async () => {
      throw new Error("release notification failed");
    });
    manager.configureOwnedTasks({ cancellationGraceMs: 50 }, { admit: () => release });
    await expect(
      manager.owned!.run(task("child"), false, undefined, async () => "done"),
    ).resolves.toMatchObject({ success: true, text: "done" });
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
    expect(manager.owned!.outstanding.records).toBe(0);
  });

  it("admission rejection starts no execution, registration or timer", async () => {
    vi.useFakeTimers();
    const failure = new Error("tenant full");
    const execute = vi.fn();
    const manager = new TaskManager();
    manager.configureOwnedTasks(
      { cancellationGraceMs: 50 },
      {
        admit: () => {
          throw failure;
        },
      },
    );
    await expect(manager.owned!.run(task("child"), false, undefined, execute)).rejects.toBe(
      failure,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(manager.getAllTasks()).toHaveLength(0);
    expect(manager.owned!.outstanding.records).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a permit and global admission fence through quarantine/result cleanup until actual settlement", async () => {
    vi.useFakeTimers();
    let resolve!: (text: string) => void;
    const pending = new Promise<string>((done) => {
      resolve = done;
    });
    const release = vi.fn();
    const onUnresolved = vi.fn(() => {
      throw new Error("host diagnostic failed");
    });
    const manager = new TaskManager();
    manager.configureOwnedTasks(
      { cancellationGraceMs: 50 },
      { admit: () => release, onUnresolved },
    );
    manager.beginTaskScope({ runId: "run", attemptId: "attempt" });
    try {
      await manager.owned!.run(task("child"), true, undefined, () => pending);
      await flush();
      const closing = expect(manager.settleOwnedTasks("final")).rejects.toMatchObject({
        code: "subagent_cleanup_unresolved",
      });
      await vi.advanceTimersByTimeAsync(50);
      await closing;
      expect(onUnresolved).toHaveBeenCalledTimes(1);
      expect(onUnresolved).toHaveBeenCalledWith(
        expect.objectContaining({
          tasks: [{ id: "child", runId: "run", attemptId: "attempt" }],
          unresolvedCount: 1,
        }),
      );
      await expect(manager.settleOwnedTasks("again")).rejects.toThrow(
        "subagent_cleanup_unresolved",
      );
      manager.releaseOwnedTaskResults();
      expect(release).not.toHaveBeenCalled();
      expect(manager.owned!.outstanding.records).toBe(1);
      expect(() => manager.clear()).toThrow("subagent_cleanup_unresolved");
      const next = new TaskManager();
      next.configureOwnedTasks({ cancellationGraceMs: 50 });
      await expect(
        next.owned!.run(task("next"), false, undefined, async () => "no"),
      ).rejects.toThrow("subagent_cleanup_unresolved");
      resolve("late");
      await flush();
      expect(release).toHaveBeenCalledTimes(1);
      expect(onUnresolved).toHaveBeenCalledTimes(1);
      expect(manager.owned!.outstanding.records).toBe(0);
      await expect(
        next.owned!.run(task("next"), false, undefined, async () => "yes"),
      ).resolves.toMatchObject({ text: "yes" });
      await expect(manager.settleOwnedTasks("failed scope stays failed")).rejects.toThrow(
        "subagent_cleanup_unresolved",
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      resolve("cleanup");
      await flush();
    }
  });

  it.each([false, true])(
    "counts UTF-8 foreground payload bytes without evicting replay (failure=%s)",
    async (failure) => {
      const manager = new TaskManager();
      manager.configureOwnedTasks({ cancellationGraceMs: 50, replayBudget: { maxBytes: 4 } });
      manager.beginTaskScope({ runId: "run", attemptId: "one" });
      const execute = vi.fn(async () => {
        if (failure) throw new Error("éé");
        return "éé";
      });
      const result = await manager.owned!.run(task("first"), false, undefined, execute, "same");
      expect(manager.owned!.outstanding.replayBytes).toBe(4);
      await manager.settleOwnedTasks("retry");
      manager.beginTaskScope({ runId: "run", attemptId: "two" });
      expect(await manager.owned!.run(task("replay"), false, undefined, execute, "same")).toEqual(
        result,
      );
      await expect(
        manager.owned!.run(task("new"), false, undefined, execute, "new"),
      ).rejects.toMatchObject({ code: "subagent_replay_budget_exhausted" });
      expect(execute).toHaveBeenCalledTimes(1);
      manager.beginTaskScope({ runId: "different-run", attemptId: "one" });
      expect(manager.owned!.outstanding).toEqual({ records: 0, replayEntries: 0, replayBytes: 0 });
    },
  );

  it("retains completed background handles at the entry budget, not duplicate delivery", async () => {
    const manager = new TaskManager();
    manager.configureOwnedTasks({ cancellationGraceMs: 50, replayBudget: { maxEntries: 1 } });
    const execute = vi.fn(async () => "done");
    await manager.owned!.run(task("first"), true, undefined, execute, "same");
    await flush();
    expect(manager.consumeTask("first")?.result).toBe("done");
    expect(manager.consumeTask("first")).toBeUndefined();
    expect(
      await manager.owned!.run(task("replay"), true, undefined, execute, "same"),
    ).toMatchObject({ taskId: "first", status: "completed" });
    await expect(
      manager.owned!.run(task("new"), true, undefined, execute, "new"),
    ).rejects.toMatchObject({ code: "subagent_replay_budget_exhausted" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid replay budgets (%s)",
    (value) => {
      for (const field of ["maxEntries", "maxBytes"] as const) {
        expect(() =>
          new TaskManager().configureOwnedTasks({
            cancellationGraceMs: 50,
            replayBudget: { [field]: value },
          }),
        ).toThrow("must be a positive integer");
      }
    },
  );
});
