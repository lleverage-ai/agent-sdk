/**
 * AgentSession in context log mode: the log is the model's history, so each
 * turn sends only the new prompt and the session's messages are a display
 * copy.
 */

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { MemorySaver } from "../../src/checkpointer/memory-saver.js";
import {
  type AgentOptions,
  ConfigurationError,
  type ContextStreamRef,
  createAgent,
  MemoryContextLogStore,
} from "../../src/index.js";
import { AgentSession } from "../../src/session.js";

const THREAD = "thread-1";
const STREAM: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };

/** A model that answers `A1`, `A2`, ... and records every request. */
function createRecordingModel() {
  let calls = 0;
  const requests: LanguageModelV3CallOptions[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      requests.push(options);
      calls++;
      return {
        content: [{ type: "text", text: `A${calls}` }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model: model as LanguageModel, requests };
}

function createLogAgent(
  model: LanguageModel,
  store: MemoryContextLogStore,
  overrides: Partial<AgentOptions> = {},
) {
  return createAgent({
    model,
    systemPrompt: "You are the core.",
    contextLog: { mode: "log", store },
    ...overrides,
  });
}

/** Send each prompt in turn and wait for its generation to finish. */
async function runTurns(session: AgentSession, prompts: string[]): Promise<string[]> {
  const replies: string[] = [];
  let next = 0;
  for await (const output of session.run()) {
    if (output.type === "waiting_for_input") {
      if (next === prompts.length) {
        session.stop();
        continue;
      }
      session.sendMessage(prompts[next++]!);
    } else if (output.type === "generation_complete") {
      replies.push(output.fullText);
    } else if (output.type === "error") {
      throw output.error;
    }
  }
  return replies;
}

/** Assert the second request extends the first by exactly its reply and the new prompt. */
function expectSecondExtendsFirst(requests: LanguageModelV3CallOptions[]) {
  expect(requests).toHaveLength(2);
  const first = requests[0]!.prompt;
  const second = requests[1]!.prompt;
  expect(second).toHaveLength(first.length + 2);
  // Byte-identical prefix: the first request's full input...
  expect(JSON.stringify(second.slice(0, first.length))).toBe(JSON.stringify(first));
  // ...then the first reply, then only the new prompt.
  expect(second[first.length]).toMatchObject({
    role: "assistant",
    content: [{ type: "text", text: "A1" }],
  });
  expect(second[first.length + 1]).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "U2" }],
  });
}

describe("AgentSession in context log mode", () => {
  it("sends only the new prompt and extends the first request on the second turn", async () => {
    const { model, requests } = createRecordingModel();
    const store = new MemoryContextLogStore();
    const agent = createLogAgent(model, store);
    const session = new AgentSession({ agent, threadId: THREAD });

    const replies = await runTurns(session, ["U1", "U2"]);

    expect(replies).toEqual(["A1", "A2"]);
    expect(requests[0]!.prompt.filter((message) => message.role !== "system")).toEqual([
      expect.objectContaining({ role: "user", content: [{ type: "text", text: "U1" }] }),
    ]);
    expectSecondExtendsFirst(requests);

    // The log holds both turns once each.
    const head = await store.readHead(STREAM);
    expect(head).toBeDefined();
    const { entries } = await store.readPath(head!, { limit: 100 });
    expect(entries.map((entry) => entry.kind)).toEqual(["user", "assistant", "user", "assistant"]);

    // The local array is a display copy of the turns.
    expect(session.getMessages()).toEqual([
      { role: "user", content: "U1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "U2" },
      { role: "assistant", content: "A2" },
    ]);
    await agent.dispose();
  });

  it("ignores the checkpointer for history when log mode is on", async () => {
    const { model, requests } = createRecordingModel();
    const store = new MemoryContextLogStore();
    const agent = createLogAgent(model, store, { checkpointer: new MemorySaver() });
    const session = new AgentSession({ agent, threadId: THREAD });

    expect(await runTurns(session, ["U1", "U2"])).toEqual(["A1", "A2"]);
    expectSecondExtendsFirst(requests);
    await agent.dispose();
  });

  it("requires a threadId", async () => {
    const { model } = createRecordingModel();
    const agent = createLogAgent(model, new MemoryContextLogStore());
    expect(() => new AgentSession({ agent })).toThrow(ConfigurationError);
    await agent.dispose();
  });

  it("rejects initialMessages, which would never reach the model", async () => {
    const { model } = createRecordingModel();
    const agent = createLogAgent(model, new MemoryContextLogStore());
    expect(
      () =>
        new AgentSession({
          agent,
          threadId: THREAD,
          initialMessages: [{ role: "user", content: "U0" }],
        }),
    ).toThrow(ConfigurationError);
    // An empty list holds no history and is accepted.
    expect(() => new AgentSession({ agent, threadId: THREAD, initialMessages: [] })).not.toThrow();
    await agent.dispose();
  });
});
