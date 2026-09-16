/**
 * Tests for message assembly (`src/agent/messages.ts`).
 *
 * The agent tests cover compaction and checkpoint loading end to end. This
 * file pins the runtime's own rules: transcript reconstruction fallbacks,
 * checkpoint/history/prompt ordering in `buildMessages()`, when
 * `compactMessagesIfNeeded()` fires and which hooks it emits, and the
 * first-step rule of the streaming compaction state.
 */

import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckpointRuntime } from "../src/agent/checkpoint-runtime.js";
import {
  appendResponseMessages,
  buildMessagesFromStepResponses,
  createMessageRuntime,
  type MessageRuntimeDeps,
} from "../src/agent/messages.js";
import { createAgentState } from "../src/backends/state.js";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import type { ContextManager } from "../src/context-manager.js";
import type { Agent, HookRegistration } from "../src/types.js";

const user = (content: string): ModelMessage => ({ role: "user", content });
const assistant = (content: string): ModelMessage => ({ role: "assistant", content });

describe("appendResponseMessages", () => {
  it("appends response messages when present", () => {
    expect(appendResponseMessages([user("a")], [assistant("b")], "ignored")).toEqual([
      user("a"),
      assistant("b"),
    ]);
  });

  it("falls back to the assistant text when there are no response messages", () => {
    expect(appendResponseMessages([user("a")], [], "fallback")).toEqual([
      user("a"),
      assistant("fallback"),
    ]);
    expect(appendResponseMessages([user("a")], undefined, "fallback")).toEqual([
      user("a"),
      assistant("fallback"),
    ]);
  });

  it("returns the base transcript when there is nothing to append", () => {
    const base = [user("a")];
    expect(appendResponseMessages(base, [], "")).toBe(base);
    expect(appendResponseMessages(base, undefined, undefined)).toBe(base);
  });
});

describe("buildMessagesFromStepResponses", () => {
  it("prefers per-step response messages so intermediate tool steps survive", () => {
    const steps = [
      { text: "", response: { messages: [assistant("call"), { role: "tool", content: [] }] } },
      { text: "done", response: { messages: [assistant("done")] } },
    ];
    expect(
      buildMessagesFromStepResponses([user("q")], steps, "x", [assistant("only-last")]),
    ).toEqual([user("q"), assistant("call"), { role: "tool", content: [] }, assistant("done")]);
  });

  it("falls back to top-level response messages, then to the last step text", () => {
    const noStepMessages = [{ text: "last" }, { text: "" }];
    expect(
      buildMessagesFromStepResponses([user("q")], noStepMessages, "top", [assistant("top-level")]),
    ).toEqual([user("q"), assistant("top-level")]);

    // Empty last-step text yields to the fallback text
    expect(buildMessagesFromStepResponses([user("q")], noStepMessages, "top")).toEqual([
      user("q"),
      assistant("top"),
    ]);

    // Non-empty last-step text wins over the fallback text
    expect(buildMessagesFromStepResponses([user("q")], [{ text: "last" }], "top")).toEqual([
      user("q"),
      assistant("last"),
    ]);
  });
});

function createContextManager(
  overrides: Partial<Pick<ContextManager, "shouldCompact" | "compact">> = {},
): ContextManager {
  return {
    tokenCounter: { countMessages: vi.fn(() => 100), countTokens: vi.fn(() => 1) },
    shouldCompact: vi.fn(() => ({ trigger: false as const })),
    compact: vi.fn(async (messages: ModelMessage[]) => ({
      messagesBefore: messages.length,
      messagesAfter: 1,
      tokensBefore: 100,
      tokensAfter: 10,
      summary: "s",
      compactedMessages: messages,
      newMessages: [assistant("[summary]")],
      trigger: "token_threshold" as const,
      strategy: "summarize" as const,
    })),
    ...overrides,
  } as unknown as ContextManager;
}

interface Harness {
  deps: MessageRuntimeDeps;
  saver: MemorySaver;
  hooks: HookRegistration;
  agent: Agent;
}

function createHarness(
  overrides: {
    contextManager?: ContextManager;
    hooks?: HookRegistration;
    checkpointer?: boolean;
  } = {},
): Harness {
  const saver = new MemorySaver();
  const hooks = overrides.hooks ?? {};
  const agent = { id: "agent-test" } as unknown as Agent;
  const deps: MessageRuntimeDeps = {
    contextManager: overrides.contextManager,
    model: "test-model",
    hooks,
    getAgent: () => agent,
    checkpoints: createCheckpointRuntime({
      checkpointer: overrides.checkpointer === false ? undefined : saver,
      state: createAgentState(),
    }),
  };
  return { deps, saver, hooks, agent };
}

describe("createMessageRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildMessages()", () => {
    it("orders checkpoint messages, history, then prompt", async () => {
      const { deps } = createHarness();
      await deps.checkpoints.save("t1", [user("earlier")], 1);
      const runtime = createMessageRuntime(deps);

      const result = await runtime.buildMessages({
        threadId: "t1",
        messages: [user("history")],
        prompt: "now",
      });

      expect(result.messages).toEqual([user("earlier"), user("history"), user("now")]);
      expect(result.checkpoint?.threadId).toBe("t1");
      expect(result.forkedSessionId).toBeUndefined();
    });

    it("forks the source thread and reports the forked session id", async () => {
      const { deps, saver } = createHarness();
      await deps.checkpoints.save("src", [user("earlier")], 1);
      const runtime = createMessageRuntime(deps);

      const result = await runtime.buildMessages({
        threadId: "src",
        forkSession: "dst",
        prompt: "now",
      });

      expect(result.forkedSessionId).toBe("dst");
      expect(result.checkpoint?.threadId).toBe("dst");
      expect(result.messages).toEqual([user("earlier"), user("now")]);
      expect((await saver.load("dst"))?.messages).toEqual([user("earlier")]);
    });

    it("builds from history and prompt alone without a thread", async () => {
      const runtime = createMessageRuntime(createHarness().deps);
      const result = await runtime.buildMessages({ messages: [user("h")], prompt: "p" });
      expect(result.messages).toEqual([user("h"), user("p")]);
      expect(result.checkpoint).toBeUndefined();
    });

    it("compacts at the run boundary using the forked thread id for telemetry", async () => {
      const contextManager = createContextManager({
        shouldCompact: vi.fn(() => ({ trigger: true, reason: "token_threshold" as const })),
      });
      const preCompact = vi.fn(async () => ({}));
      const { deps } = createHarness({
        contextManager,
        hooks: { PreCompact: [preCompact] },
      });
      await deps.checkpoints.save("src", [user("earlier")], 1);
      const runtime = createMessageRuntime(deps);

      const result = await runtime.buildMessages({
        threadId: "src",
        forkSession: "dst",
        prompt: "now",
        _runId: "run-1",
      });

      expect(result.messages).toEqual([assistant("[summary]")]);
      expect(preCompact.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          hook_event_name: "PreCompact",
          session_id: "src",
          telemetry: expect.objectContaining({ runId: "run-1", threadId: "dst" }),
          message_count: 2,
          tokens_before: 100,
        }),
      );
    });
  });

  describe("compactMessagesIfNeeded()", () => {
    it("is a no-op without a context manager", async () => {
      const runtime = createMessageRuntime(createHarness().deps);
      const messages = [user("a")];
      await expect(runtime.compactMessagesIfNeeded(messages, {}, "t1")).resolves.toEqual({
        compacted: false,
        messages,
      });
    });

    it("skips when _skipCompaction is set, even if the policy would trigger", async () => {
      const contextManager = createContextManager({
        shouldCompact: vi.fn(() => ({ trigger: true, reason: "token_threshold" as const })),
      });
      const runtime = createMessageRuntime(createHarness({ contextManager }).deps);

      const result = await runtime.compactMessagesIfNeeded(
        [user("a")],
        { _skipCompaction: true },
        "t1",
      );

      expect(result.compacted).toBe(false);
      expect(contextManager.shouldCompact).not.toHaveBeenCalled();
      expect(contextManager.compact).not.toHaveBeenCalled();
    });

    it("does nothing when the policy does not trigger", async () => {
      const contextManager = createContextManager();
      const runtime = createMessageRuntime(createHarness({ contextManager }).deps);
      const messages = [user("a")];

      const result = await runtime.compactMessagesIfNeeded(messages, {}, "t1");

      expect(result).toEqual({ compacted: false, messages });
      expect(contextManager.compact).not.toHaveBeenCalled();
    });

    it("compacts with the agent and reason, emitting PreCompact and PostCompact", async () => {
      const contextManager = createContextManager({
        shouldCompact: vi.fn(() => ({ trigger: true, reason: "manual" as const })),
      });
      const preCompact = vi.fn(async () => ({}));
      const postCompact = vi.fn(async () => ({}));
      const { deps, agent } = createHarness({
        contextManager,
        hooks: { PreCompact: [preCompact], PostCompact: [postCompact] },
      });
      const runtime = createMessageRuntime(deps);
      const messages = [user("a"), assistant("b"), user("c")];

      const result = await runtime.compactMessagesIfNeeded(messages, { threadId: "t1" }, "t1");

      expect(result).toEqual({ compacted: true, messages: [assistant("[summary]")] });
      expect(contextManager.compact).toHaveBeenCalledWith(messages, agent, "manual");
      expect(preCompact.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          hook_event_name: "PreCompact",
          message_count: 3,
          tokens_before: 100,
        }),
      );
      expect(postCompact.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          hook_event_name: "PostCompact",
          messages_before: 3,
          messages_after: 1,
          tokens_before: 100,
          tokens_after: 10,
          tokens_saved: 90,
        }),
      );
      // Pre fires before compaction, Post after
      expect(preCompact.mock.invocationCallOrder[0]).toBeLessThan(
        (contextManager.compact as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
      );
      expect(postCompact.mock.invocationCallOrder[0]).toBeGreaterThan(
        (contextManager.compact as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
      );
    });
  });

  describe("createStreamingCompactionState()", () => {
    it("skips step 0 by default and compacts later steps", async () => {
      const contextManager = createContextManager({
        shouldCompact: vi.fn(() => ({ trigger: true, reason: "token_threshold" as const })),
      });
      const runtime = createMessageRuntime(createHarness({ contextManager }).deps);
      const state = runtime.createStreamingCompactionState([user("a")], {}, "t1");

      await expect(
        state.prepareStep({ messages: [user("a")], stepNumber: 0 }),
      ).resolves.toBeUndefined();
      expect(contextManager.compact).not.toHaveBeenCalled();

      await expect(state.prepareStep({ messages: [user("a")], stepNumber: 1 })).resolves.toEqual({
        messages: [assistant("[summary]")],
      });
      expect(state.messages).toEqual([assistant("[summary]")]);
    });

    it("compacts step 0 when compactFirstStep is set", async () => {
      const contextManager = createContextManager({
        shouldCompact: vi.fn(() => ({ trigger: true, reason: "token_threshold" as const })),
      });
      const runtime = createMessageRuntime(createHarness({ contextManager }).deps);
      const state = runtime.createStreamingCompactionState([user("a")], {}, "t1", true);

      await expect(state.prepareStep({ messages: [user("a")], stepNumber: 0 })).resolves.toEqual({
        messages: [assistant("[summary]")],
      });
    });

    it("returns undefined from prepareStep when nothing was compacted", async () => {
      const runtime = createMessageRuntime(
        createHarness({ contextManager: createContextManager() }).deps,
      );
      const state = runtime.createStreamingCompactionState([user("a")], {}, "t1");

      await expect(
        state.prepareStep({ messages: [user("a")], stepNumber: 3 }),
      ).resolves.toBeUndefined();
      expect(state.messages).toEqual([user("a")]);
    });

    it("tracks appended steps and finalizes from them", () => {
      const runtime = createMessageRuntime(createHarness().deps);
      const state = runtime.createStreamingCompactionState([user("a")], {}, "t1");

      const afterStep = state.appendStep({ text: "b", response: { messages: [assistant("b")] } });
      expect(afterStep).toEqual([user("a"), assistant("b")]);
      state.appendStep({ text: "c", response: { messages: [] } });
      expect(state.messages).toEqual([user("a"), assistant("b"), assistant("c")]);

      // Steps were appended, so finalize ignores the steps argument
      expect(
        state.finalize([{ text: "ignored", response: { messages: [assistant("x")] } }]),
      ).toEqual([user("a"), assistant("b"), assistant("c")]);
      // And returns a copy
      expect(state.finalize([])).not.toBe(state.messages);
    });

    it("finalizes from step responses when no step was ever appended", () => {
      const runtime = createMessageRuntime(createHarness().deps);
      const state = runtime.createStreamingCompactionState([user("a")], {}, "t1");

      expect(
        state.finalize([{ text: "z", response: { messages: [assistant("z")] } }], "fb"),
      ).toEqual([user("a"), assistant("z")]);
      expect(state.finalize([{ text: "" }], "fb")).toEqual([user("a"), assistant("fb")]);
      expect(state.finalize([], "fb")).toEqual([user("a")]);
    });
  });
});
