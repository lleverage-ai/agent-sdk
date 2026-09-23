/**
 * `agent.invalidateCheckpoint(threadId)`: the host's way to make an agent
 * re-read a thread's checkpoint after the store changed behind it.
 *
 * An agent loads each thread's checkpoint once and then serves it from memory.
 * These tests pin both halves of that contract at the agent level: without a
 * refresh the cached checkpoint is still used, and after one the next call
 * reads the store, restores agent state and fires `PostCheckpointLoad` again.
 */

import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createAgent } from "../src/agent.js";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import type { Checkpoint, Interrupt } from "../src/checkpointer/types.js";
import { createCheckpoint } from "../src/checkpointer/types.js";
import type { HookCallback, PostCheckpointLoadInput } from "../src/types.js";
import { createMockModel } from "./setup.js";

const THREAD = "thread-1";

function storedCheckpoint(marker: string, step: number, extra: Partial<Checkpoint> = {}) {
  return {
    ...createCheckpoint({
      threadId: THREAD,
      messages: [
        { role: "user", content: `question ${marker}` },
        { role: "assistant", content: `answer ${marker}` },
      ],
      step,
      state: {
        todos: [{ id: marker, content: `todo ${marker}`, status: "pending" }],
        files: { "/notes.md": `notes ${marker}` },
      },
    }),
    ...extra,
  };
}

function loadedHook() {
  const calls: PostCheckpointLoadInput[] = [];
  const hook: HookCallback = async (input) => {
    if (input.hook_event_name === "PostCheckpointLoad") calls.push(input);
    return {};
  };
  return { hook, calls };
}

/** The prompt the model received on its most recent call, as text. */
function lastPrompt(model: LanguageModel): string {
  const doGenerate = (model as unknown as { doGenerate: ReturnType<typeof vi.fn> }).doGenerate;
  const call = doGenerate.mock.calls.at(-1)?.[0] as { prompt: unknown } | undefined;
  return JSON.stringify(call?.prompt);
}

async function setup() {
  const saver = new MemorySaver();
  await saver.save(storedCheckpoint("v1", 1));
  const { hook, calls } = loadedHook();
  const model = createMockModel({ text: "ok" });
  const agent = createAgent({
    model,
    checkpointer: saver,
    hooks: { PostCheckpointLoad: [hook] },
  });
  return { saver, agent, model, calls };
}

describe("agent.invalidateCheckpoint()", () => {
  it("without a refresh, later calls keep using the cached checkpoint", async () => {
    const { saver, agent, model, calls } = await setup();
    await agent.generate({ prompt: "first", threadId: THREAD });

    // The store moves on behind the agent.
    await saver.save(storedCheckpoint("v2", 7));
    const loadSpy = vi.spyOn(saver, "load");
    await agent.generate({ prompt: "second", threadId: THREAD });

    expect(loadSpy).not.toHaveBeenCalled();
    expect(lastPrompt(model)).not.toContain("question v2");
    expect(lastPrompt(model)).toContain("question v1");
    expect(calls).toHaveLength(1);
  });

  it("after a refresh, the next call loads the store's state and fires the hook", async () => {
    const { saver, agent, model, calls } = await setup();
    await agent.generate({ prompt: "first", threadId: THREAD });
    expect(agent.state.todos.map((todo) => todo.id)).toEqual(["v1"]);

    await saver.save(storedCheckpoint("v2", 7, { metadata: { source: "host" } }));
    const loadSpy = vi.spyOn(saver, "load");
    agent.invalidateCheckpoint(THREAD);
    await agent.generate({ prompt: "second", threadId: THREAD });

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith(THREAD);
    expect(lastPrompt(model)).toContain("question v2");
    expect(lastPrompt(model)).not.toContain("question v1");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ step: 7, metadata: { source: "host" } });
    expect(agent.state.todos.map((todo) => todo.id)).toEqual(["v2"]);
    expect(agent.state.files).toEqual({ "/notes.md": "notes v2" });
    // The call's own save builds on the refreshed checkpoint.
    const saved = await saver.load(THREAD);
    expect(saved?.metadata?.source).toBe("host");
    expect(JSON.stringify(saved?.messages)).toContain("question v2");
  });

  it("refreshes once: the call after the reload is served from the cache again", async () => {
    const { saver, agent, calls } = await setup();
    await agent.generate({ prompt: "first", threadId: THREAD });
    agent.invalidateCheckpoint(THREAD);
    await agent.generate({ prompt: "second", threadId: THREAD });

    const loadSpy = vi.spyOn(saver, "load");
    await agent.generate({ prompt: "third", threadId: THREAD });

    expect(loadSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
  });

  it("keeps a pending interrupt the store still holds", async () => {
    const { saver, agent, calls } = await setup();
    await agent.generate({ prompt: "first", threadId: THREAD });
    const interrupt: Interrupt = {
      id: "int_1",
      threadId: THREAD,
      type: "custom",
      toolCallId: "call-1",
      toolName: "ask",
      request: { question: "continue?" },
      step: 1,
      createdAt: new Date().toISOString(),
    };
    await saver.save(storedCheckpoint("v2", 2, { pendingInterrupt: interrupt }));

    agent.invalidateCheckpoint(THREAD);

    expect(await agent.getInterrupt(THREAD)).toEqual(interrupt);
    await agent.generate({ prompt: "second", threadId: THREAD });
    expect(calls.at(-1)?.has_pending_interrupt).toBe(true);
  });

  it("is a no-op without a checkpointer", async () => {
    const agent = createAgent({ model: createMockModel({ text: "ok" }) });

    expect(() => agent.invalidateCheckpoint(THREAD)).not.toThrow();
    const result = await agent.generate({ prompt: "hi", threadId: THREAD });
    expect(result.status).toBe("complete");
  });
});
