import { describe, expect, it, vi } from "vitest";
import { createAgent } from "../src/agent.js";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import { createCheckpoint } from "../src/checkpointer/types.js";
import { createContextManager } from "../src/context-manager.js";
import { createMiddlewareContext, mergeHooks } from "../src/middleware/index.js";
import { createSubagent } from "../src/subagents.js";
import type {
  HookCallback,
  HookInput,
  ModelMessage,
  PostCheckpointLoadInput,
  PreGenerateInput,
} from "../src/types.js";
import { createMockModel } from "./setup.js";

/**
 * `PostCheckpointLoad` is the one point where hooks see the restored transcript.
 * It fires after the checkpointer's `load()` and before the
 * compaction check, so a host can seed its context manager from the previous
 * run's recorded usage ahead of the first compaction decision.
 */

const restored: ModelMessage[] = [
  { role: "user", content: "earlier question" },
  { role: "assistant", content: "earlier answer" },
];

async function seededSaver(metadata?: Record<string, unknown>) {
  const saver = new MemorySaver();
  await saver.save(
    createCheckpoint({
      threadId: "thread-1",
      messages: restored,
      state: { todos: [], files: {} },
      step: 3,
      metadata,
    }),
  );
  return saver;
}

function loadedHook() {
  const calls: PostCheckpointLoadInput[] = [];
  const hook: HookCallback = async (input) => {
    if (input.hook_event_name === "PostCheckpointLoad") calls.push(input);
    return {};
  };
  return { hook, calls };
}

describe("PostCheckpointLoad hook", () => {
  it("fires once with the restored transcript, step, metadata and interrupt flag", async () => {
    const { hook, calls } = loadedHook();
    const agent = createAgent({
      model: createMockModel({ text: "ok" }),
      checkpointer: await seededSaver({ lastRunUsage: { contextTokens: 1200 } }),
      hooks: { PostCheckpointLoad: [hook] },
    });

    await agent.generate({ prompt: "next", threadId: "thread-1" });

    expect(calls).toHaveLength(1);
    const input = calls[0]!;
    expect(input.thread_id).toBe("thread-1");
    expect(input.session_id).toBe("thread-1");
    expect(input.step).toBe(3);
    expect(input.messages).toEqual(restored);
    expect(input.metadata).toEqual({ lastRunUsage: { contextTokens: 1200 } });
    expect(input.has_pending_interrupt).toBe(false);
    expect(input.telemetry?.threadId).toBe("thread-1");
  });

  it("sees the transcript that PreGenerate cannot", async () => {
    const seen: Record<string, number> = {};
    const preGenerate: HookCallback = async (input: HookInput) => {
      seen.PreGenerate = (input as PreGenerateInput).options.messages?.length ?? 0;
      return {};
    };
    const loaded: HookCallback = async (input) => {
      if (input.hook_event_name === "PostCheckpointLoad")
        seen.PostCheckpointLoad = input.messages.length;
      return {};
    };
    const agent = createAgent({
      model: createMockModel({ text: "ok" }),
      checkpointer: await seededSaver(),
      hooks: { PreGenerate: [preGenerate], PostCheckpointLoad: [loaded] },
    });

    await agent.generate({ prompt: "next", threadId: "thread-1" });

    expect(seen).toEqual({ PreGenerate: 0, PostCheckpointLoad: restored.length });
  });

  it("does not fire without a threadId or when the thread has no checkpoint", async () => {
    const { hook, calls } = loadedHook();
    const agent = createAgent({
      model: createMockModel({ text: "ok" }),
      checkpointer: await seededSaver(),
      hooks: { PostCheckpointLoad: [hook] },
    });

    await agent.generate({ prompt: "no thread" });
    await agent.generate({ prompt: "fresh thread", threadId: "thread-new" });

    expect(calls).toHaveLength(0);
  });

  it("does not call the checkpointer when no hook is registered", async () => {
    const saver = await seededSaver();
    const loadSpy = vi.spyOn(saver, "load");
    const agent = createAgent({ model: createMockModel({ text: "ok" }), checkpointer: saver });

    await agent.generate({ prompt: "next", threadId: "thread-1" });

    // One load for the run-id resolution / message build; the hook adds none.
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it("fires before the compaction check so a seeded usage can trigger compaction", async () => {
    const contextManager = createContextManager({
      maxTokens: 10_000,
      policy: { tokenThreshold: 0.8, outputReserveTokens: 0, enableGrowthRatePrediction: false },
      summarizationModel: createMockModel({ text: "summary" }),
      summarization: { keepMessageCount: 0, keepToolResultCount: 0 },
    });
    const shouldCompactSpy = vi.spyOn(contextManager, "shouldCompact");
    const seed: HookCallback = async (input) => {
      if (input.hook_event_name === "PostCheckpointLoad") {
        const usage = input.metadata?.lastRunUsage as { contextTokens: number };
        contextManager.updateUsage?.({
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: usage.contextTokens,
        });
      }
      return {};
    };
    const agent = createAgent({
      model: createMockModel({ text: "ok" }),
      checkpointer: await seededSaver({ lastRunUsage: { contextTokens: 9_500 } }),
      contextManager,
      hooks: { PostCheckpointLoad: [seed] },
    });

    await agent.generate({ prompt: "next", threadId: "thread-1" });

    expect(shouldCompactSpy).toHaveBeenCalled();
    // The seeded 9,500 tokens (over the 8,000 soft threshold) drove compaction
    // even though the two restored messages estimate to a handful of tokens.
    expect(shouldCompactSpy.mock.results[0]?.value).toMatchObject({ trigger: true });
  });

  it("fires once for sequential generations on a thread, not on cached re-reads", async () => {
    const { hook, calls } = loadedHook();
    const saver = await seededSaver();
    const loadSpy = vi.spyOn(saver, "load");
    const agent = createAgent({
      model: createMockModel({ text: "ok" }),
      checkpointer: saver,
      hooks: { PostCheckpointLoad: [hook] },
    });

    await agent.generate({ prompt: "first", threadId: "thread-1" });
    await agent.generate({ prompt: "second", threadId: "thread-1" });

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it("does not fire when the saver throws", async () => {
    const { hook, calls } = loadedHook();
    const saver = await seededSaver();
    vi.spyOn(saver, "load").mockRejectedValue(new Error("store down"));
    const agent = createAgent({
      model: createMockModel({ text: "ok" }),
      checkpointer: saver,
      hooks: { PostCheckpointLoad: [hook] },
    });

    await expect(agent.generate({ prompt: "next", threadId: "thread-1" })).rejects.toThrow(
      "Failed to load checkpoint",
    );
    expect(calls).toHaveLength(0);
  });

  it("contains a throwing hook and still generates", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const boom: HookCallback = async () => {
        throw new Error("listener failed");
      };
      const agent = createAgent({
        model: createMockModel({ text: "ok" }),
        checkpointer: await seededSaver(),
        hooks: { PostCheckpointLoad: [boom] },
      });

      const result = await agent.generate({ prompt: "next", threadId: "thread-1" });
      expect(result.text).toBe("ok");
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("is registrable through middleware and merged across registrations", () => {
    const { hook: a } = loadedHook();
    const { hook: b } = loadedHook();
    const { context, getHooks } = createMiddlewareContext();
    context.onPostCheckpointLoad(a);

    const merged = mergeHooks(getHooks(), { PostCheckpointLoad: [b] });

    expect(merged.PostCheckpointLoad).toEqual([a, b]);
  });

  it("is inheritable by subagents", () => {
    const { hook } = loadedHook();
    const parent = createAgent({
      model: createMockModel({ text: "ok" }),
      hooks: { PostCheckpointLoad: [hook] },
    });
    const child = createSubagent(parent, {
      name: "child",
      description: "inherits checkpoint hooks",
      inheritHooks: ["PostCheckpointLoad"],
    });
    expect(child.options.hooks?.PostCheckpointLoad).toEqual([hook]);
  });
});
