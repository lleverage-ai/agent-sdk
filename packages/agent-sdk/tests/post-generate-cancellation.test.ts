import { MockLanguageModelV3 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeHooksWithTimeout } from "../src/hooks.js";
import {
  createAgent,
  createTaskTool,
  type HookCallback,
  type HookOutput,
  type LanguageModel,
  type PostGenerateInput,
} from "../src/index.js";

const model = new MockLanguageModelV3({
  doGenerate: {
    content: [{ type: "text", text: "done" }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  },
}) as unknown as LanguageModel;
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function input(signal: AbortSignal): PostGenerateInput {
  return {
    hook_event_name: "PostGenerate",
    session_id: "test",
    cwd: process.cwd(),
    options: { signal },
    result: { status: "complete", text: "done", finishReason: "stop", steps: [] },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PostGenerate cancellation", () => {
  it("forwards cancellation to an ordinary hook and removes forwarding listeners", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const reason = new Error("caller cancelled");
    const work = deferred<HookOutput>();
    let hookSignal: AbortSignal | undefined;
    const result = invokeHooksWithTimeout(
      [
        (_input, _id, context) => {
          hookSignal = context.signal;
          return work.promise;
        },
      ],
      input(controller.signal),
      null,
      createAgent({ model }),
    );
    void result.catch(() => {});
    try {
      controller.abort(reason);
      expect(hookSignal?.aborted).toBe(true);
      expect(hookSignal?.reason).toBe(reason);
      await expect(result).rejects.toBe(reason);
      const forwarding = add.mock.calls.find(([event]) => event === "abort")?.[1];
      expect(forwarding).toBeDefined();
      expect(remove).toHaveBeenCalledWith("abort", forwarding);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      work.resolve({});
      await result.catch(() => {});
    }
  });

  it("rejects updatedResult and skips later hooks after synchronous cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled in hook");
    const later = vi.fn();
    const result = invokeHooksWithTimeout(
      [
        () => {
          controller.abort(reason);
          return {
            hookSpecificOutput: {
              updatedResult: { ...input(controller.signal).result, text: "late rewrite" },
            },
          };
        },
        later,
      ],
      input(controller.signal),
      null,
      createAgent({ model }),
    );
    await expect(result).rejects.toBe(reason);
    expect(later).not.toHaveBeenCalled();
  });

  function ownedFixture(hook: HookCallback, delegationTimeoutMs?: number, composeSignal = false) {
    const release = vi.fn();
    const parent = createAgent({
      model,
      ownedTaskPolicy: { cancellationGraceMs: 50, delegationTimeoutMs },
      ownedTaskCallbacks: { admit: () => release },
    });
    const child = createAgent({
      model,
      hooks: {
        PreGenerate: composeSignal
          ? [
              (input) => {
                if (input.hook_event_name !== "PreGenerate") return;
                return {
                  hookSpecificOutput: {
                    updatedInput: {
                      ...input.options,
                      signal: AbortSignal.any([
                        input.options.signal!,
                        new AbortController().signal,
                      ]),
                    },
                  },
                };
              },
            ]
          : [],
        PostGenerate: [hook],
      },
    });
    const generate = vi.spyOn(child, "generate");
    const tool = createTaskTool({
      parentAgent: parent,
      defaultModel: model,
      taskManager: parent.taskManager,
      includeGeneralPurpose: false,
      subagents: [{ type: "child", description: "child", create: () => child }],
    });
    const result = tool.execute!(
      { description: "work", subagent_type: "child" },
      { toolCallId: "call", messages: [], context: undefined },
    ) as Promise<unknown>;
    void result.catch(() => {});
    return { parent, result, release, generate };
  }

  it.each(
    (["resolve", "reject"] as const).flatMap((outcome) =>
      [false, true].map((composeSignal) => ({ outcome, composeSignal })),
    ),
  )(
    "retains real child PostGenerate ownership through late $outcome (host-composed signal=$composeSignal)",
    async ({ outcome, composeSignal }) => {
      vi.useFakeTimers();
      const entered = deferred<void>();
      const work = deferred<HookOutput>();
      let hookSignal: AbortSignal | undefined;
      const f = ownedFixture(
        (_input, _id, context) => {
          hookSignal = context.signal;
          entered.resolve();
          return work.promise;
        },
        undefined,
        composeSignal,
      );
      try {
        await entered.promise;
        const id = f.parent.taskManager.getAllTasks()[0]!.id;
        const killed = f.parent.taskManager.killTask(id);
        expect(hookSignal?.aborted).toBe(true);
        const assertion = expect(f.result).rejects.toMatchObject({
          code: "subagent_cleanup_unresolved",
        });
        await vi.advanceTimersByTimeAsync(50);
        expect(await killed).toEqual({ killed: false, reason: "subagent_cleanup_unresolved" });
        await assertion;
        expect(f.release).not.toHaveBeenCalled();
        expect(f.parent.taskManager.owned!.outstanding.records).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
        if (outcome === "resolve")
          work.resolve({
            hookSpecificOutput: {
              updatedResult: {
                status: "complete",
                text: "late rewrite",
                finishReason: "stop",
                steps: [],
              },
            },
          });
        else work.reject(new Error("late hook failure"));
        await flush();
        await expect(f.generate.mock.results[0]!.value).rejects.toMatchObject({
          message: "Sub-agent task killed",
        });
        expect(f.release).toHaveBeenCalledTimes(1);
        expect(f.parent.taskManager.owned!.outstanding.records).toBe(0);
      } finally {
        work.resolve({});
        await flush();
        await f.result.catch(() => {});
      }
    },
  );

  it("isolates owned hooks from a concurrent ordinary caller", async () => {
    vi.useFakeTimers();
    const entered = deferred<void>();
    const ownedWork = deferred<HookOutput>();
    const ordinaryWork = deferred<HookOutput>();
    const f = ownedFixture(() => {
      entered.resolve();
      return ownedWork.promise;
    });
    try {
      await entered.promise;
      const controller = new AbortController();
      const ordinary = invokeHooksWithTimeout(
        [() => ordinaryWork.promise],
        input(controller.signal),
        null,
        createAgent({ model }),
      );
      const reason = new Error("ordinary caller cancelled");
      const assertion = expect(ordinary).rejects.toBe(reason);
      controller.abort(reason);
      await assertion;
      expect(f.release).not.toHaveBeenCalled();
      expect(f.parent.taskManager.owned!.outstanding.records).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      ordinaryWork.resolve({});
      ownedWork.resolve({});
      await flush();
      await f.result;
    }
  });

  it("does not impose a hidden PostGenerate lifetime on grace-only ownership", async () => {
    vi.useFakeTimers();
    const entered = deferred<void>();
    const work = deferred<HookOutput>();
    const f = ownedFixture(() => {
      entered.resolve();
      return work.promise;
    });
    let completed = false;
    void f.result.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(completed).toBe(false);
      expect(f.release).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      work.resolve({});
      await expect(f.result).resolves.toMatchObject({ success: true, text: "done" });
      expect(f.release).toHaveBeenCalledTimes(1);
    } finally {
      work.resolve({});
      await flush();
      await f.result.catch(() => {});
    }
  });

  it("an explicit delegation lifetime still cancels a cooperative PostGenerate hook", async () => {
    vi.useFakeTimers();
    const entered = deferred<void>();
    const work = deferred<HookOutput>();
    const f = ownedFixture((_input, _id, context) => {
      context.signal.addEventListener("abort", () => work.reject(context.signal.reason), {
        once: true,
      });
      entered.resolve();
      return work.promise;
    }, 100);
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(150);
      await expect(f.result).resolves.toMatchObject({
        error: true,
        message: "Sub-agent delegation deadline exceeded",
      });
      expect(f.release).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      work.resolve({});
      await flush();
      await f.result.catch(() => {});
    }
  });
});
