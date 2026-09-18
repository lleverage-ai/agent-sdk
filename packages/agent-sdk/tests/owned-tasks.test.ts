// Ported unchanged assertions from lleverage 8b5c5c41647b6df1b7ac9f7d28c970e33fd75e68.
// Only SDK/fixture import paths and this suite's name differ.

import { createUIMessageStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgent,
  createTaskOutputTool,
  createTaskTool,
  type GenerateResult,
  type HookCallback,
  type HookOutput,
  type LanguageModel,
  TaskManager,
} from "../src/index.js";
import { Semaphore } from "./fixtures/ownership-semaphore.js";

/** Explicit opt-in lifetime clocks: the fixture default so deadline paths stay covered. */
const policy = {
  delegationTimeoutMs: 1_000,
  drainTimeoutMs: 500,
  cancellationGraceMs: 50,
};
/** The platform default shape: ownership with grace only, no lifetime timers. */
const graceOnly = { cancellationGraceMs: 50 };
const FIVE_MINUTES = 5 * 60_000;
const answer: GenerateResult = {
  status: "complete",
  text: "result",
  finishReason: "stop",
  steps: [],
};
const model = new MockLanguageModelV3({}) as unknown as LanguageModel;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

const releaseFixtures = new Set<() => void>();

function fixture(
  options: {
    cooperative?: boolean;
    /** Give every generate() call its own deferred instead of the shared `work`. */
    independent?: boolean;
    ready?: Promise<void>;
    cancelInFactory?: boolean;
    startHook?: HookCallback;
    stopHook?: HookCallback;
    policy?: {
      delegationTimeoutMs?: number;
      drainTimeoutMs?: number;
      cancellationGraceMs: number;
    };
  } = {},
) {
  const parent = createAgent({
    model,
    ownedTaskPolicy: options.policy ?? policy,
    hooks: {
      ...(options.startHook ? { SubagentStart: [options.startHook] } : {}),
      ...(options.stopHook ? { SubagentStop: [options.stopHook] } : {}),
    },
  });
  const manager = parent.taskManager;
  const caller = new AbortController();
  manager.beginTaskScope({
    runId: "run",
    attemptId: "attempt",
    signal: caller.signal,
  });
  const work = deferred<GenerateResult>();
  releaseFixtures.add(() => work.resolve(answer));
  const works: ReturnType<typeof deferred<GenerateResult>>[] = [];
  const child = createAgent({ model });
  let signal: AbortSignal | undefined;
  const signals: AbortSignal[] = [];
  const generate = vi.spyOn(child, "generate").mockImplementation((input) => {
    signal = input.signal;
    if (signal) signals.push(signal);
    let own = work;
    if (options.independent) {
      own = deferred<GenerateResult>();
      works.push(own);
      releaseFixtures.add(() => own.resolve(answer));
    }
    if (options.cooperative) {
      const ownSignal = signal;
      ownSignal?.addEventListener("abort", () => own.reject(ownSignal.reason), {
        once: true,
      });
    }
    return own.promise;
  });
  const factory = vi.fn((ctx: { signal?: AbortSignal }): typeof child | Promise<typeof child> => {
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    if (options.cancelInFactory) caller.abort(new Error("cancelled in factory"));
    return options.ready
      ? new Proxy(child, {
          get(target, key, receiver) {
            return key === "ready" ? options.ready : Reflect.get(target, key, receiver);
          },
        })
      : child;
  });
  const task = createTaskTool({
    parentAgent: parent,
    defaultModel: model,
    includeGeneralPurpose: false,
    taskManager: manager,
    subagents: [{ type: "stub", description: "stub", create: factory }],
  });
  let callIndex = 0;
  const start = (background = true, toolCallId = `call-${++callIndex}`) =>
    task.execute!(
      {
        description: "bounded",
        subagent_type: "stub",
        run_in_background: background,
      },
      {
        toolCallId,
        messages: [],
        context: undefined,
        abortSignal: caller.signal,
      },
    );
  const id = () => {
    const task = manager.getAllTasks()[0];
    if (!task) throw new Error("No task registered");
    return task.id;
  };
  return {
    parent,
    manager,
    caller,
    work,
    generate,
    factory,
    start,
    id,
    signal: () => signal,
    signals,
    works,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const release of releaseFixtures) release();
  releaseFixtures.clear();
  await flush();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("owned delegation lifecycle (consumer characterisation)", () => {
  it.each([false, true])(
    "registers foreground/background before ready and propagates kill (%s)",
    async (background) => {
      const f = fixture({ cooperative: true });
      const result = f.start(background);
      await flush();
      expect(f.manager.getAllTasks()).toHaveLength(1);
      expect(f.signal()?.aborted).toBe(false);
      expect(await f.manager.killTask(f.id())).toEqual({ killed: true });
      expect(f.signal()?.aborted).toBe(true);
      await result;
      await f.manager.settleOwnedTasks("final");
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("never sends foreground results into the background completion queue", async () => {
    const f = fixture();
    const completed = vi.fn();
    f.manager.on("taskCompleted", completed);
    const result = f.start(false);
    await flush();
    expect(f.manager.hasBackgroundTasks()).toBe(false);
    f.work.resolve(answer);
    await expect(result).resolves.toMatchObject({
      success: true,
      text: "result",
    });
    expect(completed).not.toHaveBeenCalled();
    expect(f.manager.getAllTasks()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"] as const)(
    "quarantines abort-ignoring work; late %s only releases ownership",
    async (outcome) => {
      const f = fixture();
      await f.start();
      await flush();
      const taskId = f.id();
      const kill = f.manager.killTask(taskId);
      await vi.advanceTimersByTimeAsync(50);
      expect(await kill).toEqual({
        killed: false,
        reason: "subagent_cleanup_unresolved",
      });
      expect(f.manager.getTask(taskId)?.status).toBe("killed");
      const replacement = fixture();
      await expect(replacement.start()).rejects.toThrow("subagent_cleanup_unresolved");
      expect(replacement.factory).not.toHaveBeenCalled();
      if (outcome === "resolve") f.work.resolve(answer);
      else f.work.reject(new Error("late provider failure"));
      await flush();
      expect(f.manager.getTask(taskId)?.status).toBe("killed");
      // The failed run stays failed even if the provider settles before finalisation.
      await expect(f.manager.settleOwnedTasks("final")).rejects.toThrow(
        "subagent_cleanup_unresolved",
      );
      expect(() => f.manager.beginTaskScope({ runId: "run", attemptId: "replacement" })).toThrow(
        "subagent_cleanup_unresolved",
      );
      const next = fixture();
      await next.start();
      next.work.resolve(answer);
      await flush();
      await next.manager.settleOwnedTasks("final");
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "a background deadline quarantines without a drain; late %s only releases ownership",
    async (outcome) => {
      const f = fixture();
      const completed = vi.fn();
      const failed = vi.fn();
      f.manager.on("taskCompleted", completed);
      f.manager.on("taskFailed", failed);
      // No kill, drain or explicit settlement call drives this cancellation.
      await f.start(true);
      await flush();
      const taskId = f.id();
      await vi.advanceTimersByTimeAsync(policy.delegationTimeoutMs);
      expect(f.signal()?.aborted).toBe(true);
      expect(f.manager.getTask(taskId)?.status).toBe("killed");
      await vi.advanceTimersByTimeAsync(policy.cancellationGraceMs);
      const next = fixture();
      await expect(next.start()).rejects.toMatchObject({
        code: "subagent_cleanup_unresolved",
        tasks: [{ id: taskId, runId: "run", attemptId: "attempt" }],
      });
      expect(next.factory).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      if (outcome === "resolve") f.work.resolve(answer);
      else f.work.reject(new Error("late provider failure"));
      await flush();
      expect(f.manager.getTask(taskId)?.status).toBe("killed");
      expect(completed).not.toHaveBeenCalled();
      expect(failed).not.toHaveBeenCalled();
      const result = next.start(false);
      next.work.resolve(answer);
      await expect(result).resolves.toMatchObject({ success: true });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("waits one shared cancellation grace for several children, not one per child", async () => {
    const f = fixture();
    await Promise.all([f.start(), f.start(), f.start()]);
    await flush();
    const closing = f.manager.settleOwnedTasks("attempt abandoned");
    const assertion = expect(closing).rejects.toMatchObject({
      code: "subagent_cleanup_unresolved",
      tasks: expect.arrayContaining([
        expect.objectContaining({ runId: "run", attemptId: "attempt" }),
      ]),
    });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    f.work.resolve(answer);
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("distinguishes ordinary admission closure from unresolved work (settled scope)", async () => {
    const f = fixture({ cooperative: true });
    await f.manager.settleOwnedTasks("scope ended");
    await expect(f.start()).rejects.toMatchObject({
      code: "subagent_admission_closed",
      message: "Sub-agent delegation admission is closed",
    });
    // A closed, settled scope neither poisons another manager nor prevents
    // this manager from opening its next explicitly authorised attempt.
    const next = fixture();
    const nextResult = next.start(false);
    next.work.resolve(answer);
    await expect(nextResult).resolves.toMatchObject({ success: true });
    expect(() => f.manager.beginTaskScope({ runId: "run", attemptId: "next" })).not.toThrow();
    f.generate.mockResolvedValue(answer);
    await expect(f.start(false)).resolves.toMatchObject({ success: true });
    await f.manager.settleOwnedTasks("final");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a cooperative delegation timeout leaves admission open for the same scope", async () => {
    const f = fixture({ cooperative: true });
    await f.start();
    await flush();
    const expired = f.id();
    await vi.advanceTimersByTimeAsync(policy.delegationTimeoutMs);
    expect(f.manager.getTask(expired)?.status).toBe("killed");
    expect(f.manager.consumeTask(expired)?.status).toBe("killed");
    // Amendment: one child's timeout is not a fail-fast decision for the run.
    // No new scope is needed before the next delegation is admitted.
    const work = deferred<GenerateResult>();
    f.generate.mockImplementationOnce(() => work.promise);
    const replacement = f.start(false);
    await flush();
    expect(f.factory).toHaveBeenCalledTimes(2);
    work.resolve(answer);
    await expect(replacement).resolves.toMatchObject({ success: true });
    await f.manager.settleOwnedTasks("final");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 25])(
    "an expired sibling does not deny a newly cancelled task its grace (%sms)",
    async (settleDelay) => {
      const f = fixture();
      await f.start();
      await flush();
      const stuckId = f.id();
      let siblingSettled = false;
      f.generate.mockImplementationOnce(
        (options) =>
          new Promise((_, reject) => {
            options.signal!.addEventListener(
              "abort",
              () => {
                const settle = () => {
                  siblingSettled = true;
                  reject(options.signal!.reason);
                };
                if (settleDelay) setTimeout(settle, settleDelay);
                else settle();
              },
              { once: true },
            );
          }),
      );
      await f.start();
      await flush();
      const kill = f.manager.killTask(stuckId);
      await vi.advanceTimersByTimeAsync(policy.cancellationGraceMs);
      expect(await kill).toEqual({
        killed: false,
        reason: "subagent_cleanup_unresolved",
      });
      const startTime = Date.now();
      const closing = f.manager.settleOwnedTasks("attempt ended").catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(settleDelay);
      const error = await closing;
      expect(siblingSettled).toBe(true);
      expect(error).toMatchObject({
        code: "subagent_cleanup_unresolved",
        tasks: [{ id: stuckId }],
      });
      // Old unresolved work gets no renewed wait; only the newly cancelled
      // sibling's actual settlement delays the already-failed outcome.
      expect(Date.now() - startTime).toBe(settleDelay);
      expect(await f.manager.killTask(stuckId)).toEqual({
        killed: false,
        reason: "subagent_cleanup_unresolved",
      });
      f.work.resolve(answer);
      await flush();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("kill-all cancels concurrently and spends only one shared grace", async () => {
    const f = fixture();
    await Promise.all([f.start(), f.start(), f.start()]);
    await flush();
    const all = f.manager.killAllTasks();
    expect(f.manager.getAllTasks().every((task) => task.status === "killed")).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(await all).toEqual({ killed: 0, failed: 3 });
    expect(vi.getTimerCount()).toBe(0);
    f.work.resolve(answer);
    await flush();
  });

  it("does not report successful SDK disposal when kill-all could not settle work", async () => {
    const f = fixture();
    await f.start();
    await flush();
    const disposal = f.parent.dispose();
    const assertion = expect(disposal).rejects.toThrow("subagent_cleanup_unresolved");
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(f.manager.getAllTasks()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    f.work.resolve(answer);
    await flush();
  });

  it("completion keeps its terminal win even if consumed before the promise finally runs", async () => {
    const f = fixture();
    let kill: ReturnType<TaskManager["killTask"]> | undefined;
    f.manager.on("taskCompleted", (task) => {
      expect(f.manager.consumeTask(task.id)?.result).toBe("result");
      kill = f.manager.killTask(task.id);
    });
    await f.start();
    f.work.resolve(answer);
    await flush();
    expect(await kill).toEqual({
      killed: false,
      reason: "Task already finished",
    });
  });

  it("settles before allowing a replacement attempt and preserves completed background results", async () => {
    const f = fixture();
    await f.start();
    f.work.resolve(answer);
    await flush();
    const id = f.id();
    await f.manager.settleOwnedTasks("attempt ended");
    f.manager.beginTaskScope({ runId: "run", attemptId: "next" });
    expect(f.manager.consumeTask(id)?.result).toBe("result");
    expect(f.manager.consumeTask(id)).toBeUndefined();
  });

  it("task_output and automatic completion use one synchronous consume decision", async () => {
    const f = fixture();
    await f.start();
    const id = f.id();
    const auto = f.manager.waitForNextCompletion().then((task) => f.manager.consumeTask(task.id));
    const output = createTaskOutputTool({ taskManager: f.manager });
    f.work.resolve(answer);
    await flush();
    const manual = await output.execute!(
      { task_id: id, block: false },
      { toolCallId: "out", messages: [], context: undefined },
    );
    expect((await auto)?.result).toBe("result");
    expect(manual).not.toHaveProperty("result");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    "does not spawn a completed tool call again after an attempt retry (%s)",
    async (background) => {
      const f = fixture();
      const first = f.start(background, "same-call");
      f.work.resolve(answer);
      await first;
      await flush();
      await f.manager.settleOwnedTasks("retry boundary");
      f.manager.beginTaskScope({ runId: "run", attemptId: "next" });
      const replay = await f.start(background, "same-call");
      expect(f.factory).toHaveBeenCalledTimes(1);
      expect(f.generate).toHaveBeenCalledTimes(1);
      expect(replay).toMatchObject(
        background ? { status: "completed" } : { success: true, text: "result" },
      );
      f.manager.releaseOwnedTaskResults();
      expect(f.manager.getAllTasks()).toHaveLength(0);
    },
  );

  it("two concurrent manual consumers cannot both receive the result", async () => {
    const f = fixture();
    await f.start();
    f.work.resolve(answer);
    await flush();
    const output = createTaskOutputTool({ taskManager: f.manager });
    const id = f.id();
    const results = await Promise.all(
      [1, 2].map(() =>
        output.execute!(
          { task_id: id, block: false },
          { toolCallId: "out", messages: [], context: undefined },
        ),
      ),
    );
    expect(
      results.filter(
        (result) => typeof result === "object" && result !== null && "result" in result,
      ),
    ).toHaveLength(1);
  });

  it("cancellation during ready prevents generation even if ready resolves late", async () => {
    const ready = deferred<void>();
    const f = fixture({ ready: ready.promise });
    const result = f.start(false);
    await flush();
    f.caller.abort(new Error("stop during ready"));
    ready.resolve();
    await expect(result).resolves.toMatchObject({ error: true });
    expect(f.generate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"] as const)(
    "owns ready after factory cancellation until its late %s",
    async (outcome) => {
      const ready = deferred<void>();
      releaseFixtures.add(() => ready.resolve());
      const f = fixture({ ready: ready.promise, cancelInFactory: true });
      const result = f.start(false);
      const assertion = expect(result).rejects.toThrow("subagent_cleanup_unresolved");
      await vi.advanceTimersByTimeAsync(policy.cancellationGraceMs);
      await assertion;
      expect(f.generate).not.toHaveBeenCalled();
      const replacement = fixture();
      await expect(replacement.start()).rejects.toThrow("subagent_cleanup_unresolved");
      expect(replacement.factory).not.toHaveBeenCalled();
      if (outcome === "resolve") ready.resolve();
      else ready.reject(new Error("late initialisation failure"));
      await flush();
      const next = fixture();
      await next.start();
      next.work.resolve(answer);
      await flush();
      await next.manager.settleOwnedTasks("final");
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("awaits owned initialisation before a potentially failing start hook", async () => {
    const ready = deferred<void>();
    releaseFixtures.add(() => ready.resolve());
    const startHook = vi.fn(() => {
      throw new Error("start hook failed");
    });
    const f = fixture({ ready: ready.promise, startHook });
    const result = f.start(false);
    const assertion = expect(result).rejects.toThrow("subagent_cleanup_unresolved");
    await flush();
    const closing = expect(f.manager.settleOwnedTasks("final")).rejects.toThrow(
      "subagent_cleanup_unresolved",
    );
    await vi.advanceTimersByTimeAsync(policy.cancellationGraceMs);
    await Promise.all([assertion, closing]);
    expect(startHook).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    ready.reject(new Error("late initialisation failure"));
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("already aborted runs never invoke the factory", async () => {
    const f = fixture();
    f.caller.abort(new Error("cancelled before initialisation"));
    await expect(f.start(false)).resolves.toMatchObject({ error: true });
    expect(f.factory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("completion wins over a subsequent kill, and repeated kill does not resurrect work", async () => {
    const f = fixture();
    await f.start();
    f.work.resolve(answer);
    await flush();
    const id = f.id();
    expect(await f.manager.killTask(id)).toEqual({
      killed: false,
      reason: "Task already finished",
    });
    expect(await f.manager.killTask(id)).toEqual({
      killed: false,
      reason: "Task already finished",
    });
    expect(f.manager.getTask(id)?.status).toBe("completed");
  });

  it("drain deadline cancels cooperative requests and removes every wait listener", async () => {
    const f = fixture({ cooperative: true });
    await f.start();
    await flush();
    const wait = f.manager.waitForNextCompletion();
    const assertion = expect(wait).rejects.toThrow("background drain deadline");
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(f.signal()?.aborted).toBe(true);
    for (const event of ["taskCompleted", "taskFailed", "taskKilled"] as const)
      expect(f.manager.listenerCount(event)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an explicit delegation deadline cancels only its own child, without blocking heartbeat timers", async () => {
    const f = fixture();
    const heartbeat = vi.fn();
    const timer = setInterval(heartbeat, 100);
    // Independent deferred children: A is registered first and ignores
    // nothing; B is younger and completes after A's deadline.
    const a = deferred<GenerateResult>();
    const b = deferred<GenerateResult>();
    f.generate
      .mockImplementationOnce((input) => {
        f.signals.push(input.signal!);
        input.signal!.addEventListener("abort", () => a.reject(input.signal!.reason), {
          once: true,
        });
        return a.promise;
      })
      .mockImplementationOnce((input) => {
        f.signals.push(input.signal!);
        return b.promise;
      });
    await f.start();
    const [idA] = f.manager.getAllTasks().map((task) => task.id);
    await vi.advanceTimersByTimeAsync(400);
    await f.start();
    const idB = f.manager
      .getAllTasks()
      .map((task) => task.id)
      .find((id) => id !== idA)!;
    await flush();
    await vi.advanceTimersByTimeAsync(600);
    expect(heartbeat).toHaveBeenCalledTimes(10);
    expect(f.signals[0]?.aborted).toBe(true);
    expect(f.signals[1]?.aborted).toBe(false);
    expect(f.manager.getTask(idA!)?.status).toBe("killed");
    expect(f.manager.getTask(idB)?.status).toBe("running");
    // B keeps its own deadline (registered 400ms later) and can still finish.
    await vi.advanceTimersByTimeAsync(300);
    expect(f.signals[1]?.aborted).toBe(false);
    b.resolve(answer);
    await flush();
    expect(f.manager.getTask(idB)?.status).toBe("completed");
    // A third child is still admitted after A's cooperative timeout.
    f.generate.mockResolvedValueOnce(answer);
    await expect(f.start(false)).resolves.toMatchObject({ success: true });
    await f.manager.settleOwnedTasks("final");
    clearInterval(timer);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("B's own deadline still fires after A's, and each cancels only itself", async () => {
    const f = fixture({ cooperative: true, independent: true });
    await f.start();
    await vi.advanceTimersByTimeAsync(400);
    await f.start();
    await flush();
    const [idA, idB] = f.manager.getAllTasks().map((task) => task.id);
    await vi.advanceTimersByTimeAsync(600);
    expect(f.manager.getTask(idA!)?.status).toBe("killed");
    expect(f.manager.getTask(idB!)?.status).toBe("running");
    await vi.advanceTimersByTimeAsync(400);
    expect(f.manager.getTask(idB!)?.status).toBe("killed");
    await f.manager.settleOwnedTasks("final");
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("grace-only policy (platform default shape)", () => {
    it.each([false, true])(
      "healthy work runs past five minutes and completes (background=%s)",
      async (background) => {
        const f = fixture({ policy: graceOnly });
        const result = f.start(background);
        await flush();
        const taskId = f.id();
        // Silent healthy generation: nothing observable for well over five minutes.
        await vi.advanceTimersByTimeAsync(FIVE_MINUTES + 60_000);
        expect(f.signal()?.aborted).toBe(false);
        expect(f.manager.getTask(taskId)?.status).toBe("running");
        // No lifetime timer exists at all; only the heartbeat-free fixture's own.
        expect(vi.getTimerCount()).toBe(0);
        f.work.resolve(answer);
        if (background) {
          await flush();
          expect(f.manager.getTask(taskId)?.status).toBe("completed");
          expect(f.manager.consumeTask(taskId)?.result).toBe("result");
        } else {
          await expect(result).resolves.toMatchObject({
            success: true,
            text: "result",
          });
        }
        await f.manager.settleOwnedTasks("final");
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it("a background join beyond five minutes waits without a drain clock", async () => {
      const f = fixture({ policy: graceOnly });
      await f.start(true);
      await flush();
      const wait = f.manager.waitForNextCompletion();
      let settled = false;
      void wait.then(
        () => (settled = true),
        () => (settled = true),
      );
      await vi.advanceTimersByTimeAsync(FIVE_MINUTES * 3);
      expect(settled).toBe(false);
      expect(f.signal()?.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      f.work.resolve(answer);
      await expect(wait).resolves.toMatchObject({ status: "completed" });
      for (const event of ["taskCompleted", "taskFailed", "taskKilled"] as const)
        expect(f.manager.listenerCount(event)).toBe(0);
      await f.manager.settleOwnedTasks("final");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("long factory, ready, start and stop work is not cancelled by any lifetime clock", async () => {
      const gate = {
        factory: deferred<void>(),
        ready: deferred<void>(),
        start: deferred<void>(),
        stop: deferred<void>(),
      };
      const startHook: HookCallback = async () => {
        await gate.start.promise;
        return {} as HookOutput;
      };
      const stopHook: HookCallback = async () => {
        await gate.stop.promise;
        return {} as HookOutput;
      };
      const f = fixture({
        policy: graceOnly,
        ready: gate.ready.promise,
        startHook,
        stopHook,
      });
      f.factory.mockImplementationOnce(async (ctx) => {
        await gate.factory.promise;
        return f.factory.getMockImplementation()!(ctx);
      });
      const result = f.start(false);
      for (const phase of ["factory", "ready", "start"] as const) {
        await vi.advanceTimersByTimeAsync(FIVE_MINUTES);
        gate[phase].resolve();
        await flush();
      }
      expect(f.generate).toHaveBeenCalledTimes(1);
      expect(f.signal()?.aborted).toBe(false);
      f.work.resolve(answer);
      await vi.advanceTimersByTimeAsync(FIVE_MINUTES);
      gate.stop.resolve();
      await expect(result).resolves.toMatchObject({ success: true });
      await f.manager.settleOwnedTasks("final");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("queueing behind the execution semaphore for over five minutes is not a lifetime failure", async () => {
      const f = fixture({ policy: graceOnly, independent: true });
      const semaphore = new Semaphore(1);
      // Route each child's generate() through the real FIFO semaphore, exactly
      // like limitAgentConcurrency does for platform model sub-agents.
      const inner = f.generate.getMockImplementation()!;
      f.generate.mockImplementation((input) => semaphore.run(() => inner(input), input.signal));
      await f.start(true);
      await f.start(true);
      await flush();
      const [running, queued] = f.manager.getAllTasks().map((task) => task.id);
      expect(f.works).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(FIVE_MINUTES + 30_000);
      expect(f.works).toHaveLength(1);
      expect(f.manager.getTask(queued!)?.status).toBe("running");
      expect(f.signals[0]?.aborted).toBe(false);
      f.works[0]!.resolve(answer);
      await flush();
      expect(f.manager.getTask(running!)?.status).toBe("completed");
      expect(f.works).toHaveLength(2);
      f.works[1]!.resolve(answer);
      await flush();
      expect(f.manager.getTask(queued!)?.status).toBe("completed");
      await f.manager.settleOwnedTasks("final");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("an explicit delegation timeout counts queue time and cancels only the queued child", async () => {
      const f = fixture({
        policy: { ...graceOnly, delegationTimeoutMs: 1_000 },
        independent: true,
        cooperative: true,
      });
      const semaphore = new Semaphore(1);
      const inner = f.generate.getMockImplementation()!;
      f.generate.mockImplementation((input) => semaphore.run(() => inner(input), input.signal));
      await f.start(true);
      await vi.advanceTimersByTimeAsync(500);
      await f.start(true);
      await flush();
      const [running, queued] = f.manager.getAllTasks().map((task) => task.id);
      // The running child's deadline fires first; queued survives with its own.
      await vi.advanceTimersByTimeAsync(500);
      expect(f.manager.getTask(running!)?.status).toBe("killed");
      expect(f.manager.getTask(queued!)?.status).toBe("running");
      await flush();
      // The queued child was admitted to the slot when the first settled.
      expect(f.works).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(500);
      expect(f.manager.getTask(queued!)?.status).toBe("killed");
      await f.manager.settleOwnedTasks("final");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("advancing hours produces no hidden fallback timer or overflow cancellation", async () => {
      const f = fixture({ policy: graceOnly });
      await f.start(true);
      await flush();
      for (let hour = 0; hour < 30; hour++) {
        await vi.advanceTimersByTimeAsync(60 * 60_000);
      }
      expect(f.signal()?.aborted).toBe(false);
      expect(f.manager.getTask(f.id())?.status).toBe("running");
      expect(vi.getTimerCount()).toBe(0);
      // Explicit stop still works and still takes exactly one grace.
      const kill = f.manager.killTask(f.id());
      await vi.advanceTimersByTimeAsync(graceOnly.cancellationGraceMs);
      expect(await kill).toEqual({
        killed: false,
        reason: "subagent_cleanup_unresolved",
      });
      f.work.resolve(answer);
      await flush();
      await expect(f.manager.settleOwnedTasks("final")).rejects.toThrow(
        "subagent_cleanup_unresolved",
      );
      expect(vi.getTimerCount()).toBe(0);
    });

    it("explicit kill, parent cancellation and kill-all still cancel and settle", async () => {
      const f = fixture({
        policy: graceOnly,
        cooperative: true,
        independent: true,
      });
      await Promise.all([f.start(), f.start(), f.start()]);
      await flush();
      await vi.advanceTimersByTimeAsync(FIVE_MINUTES);
      expect(f.signals.every((signal) => !signal.aborted)).toBe(true);
      const [first, second, third] = f.manager.getAllTasks().map((task) => task.id);
      expect(await f.manager.killTask(first!)).toEqual({ killed: true });
      expect(f.manager.getTask(second!)?.status).toBe("running");
      expect(f.manager.getTask(third!)?.status).toBe("running");
      expect(await f.manager.killAllTasks()).toMatchObject({
        killed: 2,
        failed: 0,
      });
      expect(f.manager.getTask(second!)?.status).toBe("killed");
      expect(f.manager.getTask(third!)?.status).toBe("killed");
      // Parent-scope cancellation on a fresh scope with a live child.
      f.manager.beginTaskScope({
        runId: "run",
        attemptId: "attempt-2",
        signal: f.caller.signal,
      });
      await f.start();
      await flush();
      const fourth = f.manager.getAllTasks().find((task) => task.status === "running")!.id;
      f.caller.abort(new Error("parent run cancelled"));
      await flush();
      expect(f.signals.every((signal) => signal.aborted)).toBe(true);
      expect(f.manager.getTask(fourth)?.status).toBe("killed");
      await expect(f.manager.settleOwnedTasks("final")).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
      ["delegationTimeoutMs", 0],
      ["delegationTimeoutMs", Number.POSITIVE_INFINITY],
      ["delegationTimeoutMs", Number.NaN],
      ["drainTimeoutMs", -1],
      ["drainTimeoutMs", 0],
      ["cancellationGraceMs", 0],
      ["cancellationGraceMs", Number.POSITIVE_INFINITY],
    ] as const)("rejects an invalid explicit duration (%s=%s)", (field, value) => {
      const manager = new TaskManager();
      expect(() => manager.configureOwnedTasks({ ...graceOnly, [field]: value })).toThrow(
        `Owned task policy ${field} must be positive finite milliseconds`,
      );
    });

    it("requires the cancellation grace even when every lifetime is omitted", () => {
      const manager = new TaskManager();
      expect(() =>
        manager.configureOwnedTasks({} as unknown as { cancellationGraceMs: number }),
      ).toThrow("cancellationGraceMs is required");
    });
  });

  it("keeps existing bash task completion and consume-once delivery compatible", async () => {
    const manager = new TaskManager();
    manager.configureOwnedTasks(policy);
    const now = new Date().toISOString();
    manager.registerTask({
      id: "bash",
      subagentType: "bash",
      description: "shell",
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    const next = manager.waitForNextCompletion();
    manager.updateTask("bash", { status: "completed", result: "shell output" });
    expect(manager.consumeTask((await next).id)?.result).toBe("shell output");
    expect(manager.consumeTask("bash")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("SDK outer retry waits for its child before running the retry hook or replacement model request", async () => {
    let calls = 0;
    let childSettled = false;
    const child = createAgent({ model });
    vi.spyOn(child, "generate").mockImplementation(
      (options) =>
        new Promise((_, reject) => {
          options.signal!.addEventListener(
            "abort",
            () => {
              childSettled = true;
              reject(options.signal!.reason);
            },
            { once: true },
          );
        }),
    );
    const parentModel = new MockLanguageModelV3({
      doGenerate: async () => {
        calls++;
        if (calls === 1)
          return {
            content: [
              {
                type: "tool-call",
                toolCallId: "delegate",
                toolName: "task",
                input: JSON.stringify({
                  description: "child",
                  subagent_type: "stub",
                  run_in_background: true,
                }),
              },
            ],
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            warnings: [],
          };
        if (calls === 2) {
          await flush();
          throw new Error("deterministic parent failure");
        }
        expect(childSettled).toBe(true);
        return {
          content: [{ type: "text", text: "recovered" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        };
      },
    });
    const retry = vi.fn(() => {
      expect(childSettled).toBe(true);
      return {
        hookSpecificOutput: {
          hookEventName: "PostGenerateFailure" as const,
          retry: true,
        },
      };
    });
    const parent = createAgent({
      model: parentModel as unknown as LanguageModel,
      ownedTaskPolicy: policy,
      includeGeneralPurposeSubagent: false,
      subagents: [{ type: "stub", description: "stub", create: () => child }],
      generationRetryPolicy: { maxRetries: 1 },
      hooks: { PostGenerateFailure: [retry] },
    });
    parent.taskManager.beginTaskScope({ runId: "run", attemptId: "attempt" });
    await expect(parent.generate({ prompt: "delegate then recover" })).resolves.toMatchObject({
      text: "recovered",
    });
    expect(calls).toBe(3);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["start", "stop"] as const)("preserves the %s hook context", async (phase) => {
    const hook = vi.fn<HookCallback>(() => ({}));
    const f = fixture(phase === "start" ? { startHook: hook } : { stopHook: hook });
    const result = f.start(false);
    f.work.resolve(answer);
    await expect(result).resolves.toMatchObject({ success: true });
    expect(hook).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        hook_event_name: phase === "start" ? "SubagentStart" : "SubagentStop",
      }),
      null,
      { agent: f.parent, signal: f.signal(), retryAttempt: 0 },
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["start", "resolve"],
    ["start", "reject"],
    ["stop", "resolve"],
    ["stop", "reject"],
  ] as const)("bounds an abort-ignoring %s hook and owns its late %s", async (phase, outcome) => {
    const pending = deferred<HookOutput>();
    releaseFixtures.add(() => pending.resolve({}));
    const hook = vi.fn<HookCallback>(() => pending.promise);
    const f = fixture(phase === "start" ? { startHook: hook } : { stopHook: hook });
    const completed = vi.fn();
    f.manager.on("taskCompleted", completed);
    const result = f.start(false);
    const assertion = expect(result).rejects.toThrow("subagent_cleanup_unresolved");
    f.work.resolve(answer);
    await flush();
    expect(hook).toHaveBeenCalledTimes(1);
    const hookSignal = hook.mock.calls[0]![2].signal;
    await vi.advanceTimersByTimeAsync(policy.delegationTimeoutMs);
    expect(hookSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(policy.cancellationGraceMs);
    await assertion;
    const replacement = fixture();
    await expect(replacement.start()).rejects.toThrow("subagent_cleanup_unresolved");
    expect(replacement.factory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    if (outcome === "resolve") pending.resolve({});
    else pending.reject(new Error("late hook rejection"));
    await flush();
    expect(completed).not.toHaveBeenCalled();
    if (phase === "start") expect(f.generate).not.toHaveBeenCalled();
    await expect(f.manager.settleOwnedTasks("final")).rejects.toThrow(
      "subagent_cleanup_unresolved",
    );
    const next = fixture();
    await next.start();
    next.work.resolve(answer);
    await flush();
    await next.manager.settleOwnedTasks("final");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop-hook failure reports once without background success or unhandled rejection", async () => {
    const stopHook = vi.fn(() => {
      throw new Error("stop hook failed");
    });
    const f = fixture({ stopHook });
    const completed = vi.fn();
    const failed = vi.fn();
    f.manager.on("taskCompleted", completed);
    f.manager.on("taskFailed", failed);
    await f.start();
    f.work.resolve(answer);
    await flush();
    expect(stopHook).toHaveBeenCalledTimes(1);
    expect(completed).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(f.manager.getTask(f.id())?.error).toBe("stop hook failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes kill through streamRaw and fences streamed completion", async () => {
    const entered = deferred<void>();
    let requestSignal: AbortSignal | undefined;
    const streamingModel = new MockLanguageModelV3({
      doStream: async (options) => {
        requestSignal = options.abortSignal;
        type Parts = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>["stream"];
        const stream: Parts = new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text" });
            controller.enqueue({
              type: "text-delta",
              id: "text",
              delta: "partial",
            });
            options.abortSignal?.addEventListener(
              "abort",
              () => controller.error(options.abortSignal?.reason),
              { once: true },
            );
            entered.resolve();
          },
        });
        return { stream };
      },
    });
    const manager = new TaskManager();
    manager.configureOwnedTasks(policy);
    const parent = createAgent({ model });
    const streamingChild = createAgent({
      model: streamingModel as unknown as LanguageModel,
    });
    const result = deferred<unknown>();
    const output = createUIMessageStream({
      execute: async ({ writer }) => {
        const task = createTaskTool({
          parentAgent: parent,
          defaultModel: model,
          taskManager: manager,
          includeGeneralPurpose: false,
          streamingContext: { writer },
          subagents: [
            {
              type: "stream",
              description: "stream",
              streaming: true,
              create: () => streamingChild,
            },
          ],
        });
        result.resolve(
          await task.execute!(
            { description: "stream", subagent_type: "stream" },
            { toolCallId: "stream", messages: [], context: undefined },
          ),
        );
      },
    });
    const chunks: unknown[] = [];
    const drain = (async () => {
      const reader = output.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
      }
    })();
    await entered.promise;
    const taskId = manager.getAllTasks()[0]!.id;
    expect(await manager.killTask(taskId)).toEqual({ killed: true });
    expect(requestSignal?.aborted).toBe(true);
    await expect(result.promise).resolves.toMatchObject({ error: true });
    await drain;
    expect(JSON.stringify(chunks)).not.toContain('"event":"complete"');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("repeated completed runs return task state, timers and listeners to baseline", async () => {
    for (let i = 0; i < 100; i++) {
      const f = fixture();
      const result = f.start(false);
      f.work.resolve(answer);
      await result;
      await f.manager.settleOwnedTasks("final");
      expect(f.manager.getAllTasks()).toHaveLength(0);
      expect(f.manager.eventNames()).toHaveLength(0);
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
