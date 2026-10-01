/**
 * AgentSession with a real agent: the model request must contain each earlier
 * turn exactly once, whether the history comes from the session or from the
 * agent's checkpointer.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { LanguageModel, ModelMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { FileSaver } from "../src/checkpointer/file-saver.js";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import { createAgent } from "../src/index.js";
import { AgentSession } from "../src/session.js";

type PromptMessage = { role: string; content: string | Array<{ type: string; text?: string }> };

/** A mock model that answers `A1`, `A2`, ... and records every request. */
function createRecordingModel() {
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
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
  /** Non-system messages of each model request as `role:text` strings. */
  const requests = () =>
    model.doGenerateCalls.map((call) =>
      (call.prompt as PromptMessage[])
        .filter((message) => message.role !== "system")
        .map((message) => {
          const text =
            typeof message.content === "string"
              ? message.content
              : message.content.map((part) => part.text ?? `[${part.type}]`).join("");
          return `${message.role}:${text}`;
        }),
    );
  return { model: model as LanguageModel, requests };
}

/** Send each prompt in turn and wait for its generation to finish. */
async function runTurns(session: AgentSession, prompts: string[]): Promise<string[]> {
  const replies: string[] = [];
  const iterator = session.run();
  let next = 0;
  for await (const output of iterator) {
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

describe("AgentSession history with a real agent", () => {
  it("sends only the new prompt once the checkpointer holds the thread", async () => {
    const { model, requests } = createRecordingModel();
    const checkpointer = new MemorySaver();
    const agent = createAgent({ model, checkpointer });
    const session = new AgentSession({ agent, threadId: "thread-1" });

    const replies = await runTurns(session, ["U1", "U2"]);

    expect(replies).toEqual(["A1", "A2"]);
    expect(requests()).toEqual([["user:U1"], ["user:U1", "assistant:A1", "user:U2"]]);
    // The local array is still kept for display.
    expect(session.getMessages()).toEqual([
      { role: "user", content: "U1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "U2" },
      { role: "assistant", content: "A2" },
    ]);
    await agent.dispose();
  });

  it("sends initial messages once on a new checkpointed thread", async () => {
    const { model, requests } = createRecordingModel();
    const agent = createAgent({ model, checkpointer: new MemorySaver() });
    const initialMessages: ModelMessage[] = [
      { role: "user", content: "U0" },
      { role: "assistant", content: "A0" },
    ];
    const session = new AgentSession({ agent, threadId: "thread-1", initialMessages });

    await runTurns(session, ["U1", "U2"]);

    expect(requests()).toEqual([
      ["user:U0", "assistant:A0", "user:U1"],
      ["user:U0", "assistant:A0", "user:U1", "assistant:A1", "user:U2"],
    ]);
    await agent.dispose();
  });

  it("does not resend initial messages over an existing checkpoint", async () => {
    const { model, requests } = createRecordingModel();
    const checkpointer = new MemorySaver();
    const agent = createAgent({ model, checkpointer });
    await agent.generate({ prompt: "U1", threadId: "thread-1" });

    const session = new AgentSession({
      agent,
      threadId: "thread-1",
      initialMessages: [{ role: "user", content: "stale" }],
    });
    await runTurns(session, ["U2"]);

    expect(requests()[1]).toEqual(["user:U1", "assistant:A1", "user:U2"]);
    await agent.dispose();
  });

  it("sends its own history again after the host deletes and invalidates the thread", async () => {
    const { model, requests } = createRecordingModel();
    const checkpointer = new MemorySaver();
    const agent = createAgent({ model, checkpointer });
    const session = new AgentSession({ agent, threadId: "thread-1" });

    await runTurns(session, ["U1"]);
    await checkpointer.delete("thread-1");
    agent.invalidateCheckpoint("thread-1");
    await runTurns(session, ["U2"]);

    expect(requests()[1]).toEqual(["user:U1", "assistant:A1", "user:U2"]);
    await agent.dispose();
  });

  it("uses the checkpoint the agent has cached after the store deletes it", async () => {
    const { model, requests } = createRecordingModel();
    const checkpointer = new MemorySaver();
    const agent = createAgent({ model, checkpointer });
    const session = new AgentSession({ agent, threadId: "thread-1" });

    await runTurns(session, ["U1"]);
    // Without invalidateCheckpoint() the agent keeps using its cached copy.
    await checkpointer.delete("thread-1");
    await runTurns(session, ["U2"]);

    expect(requests()[1]).toEqual(["user:U1", "assistant:A1", "user:U2"]);
    await agent.dispose();
  });

  it("sends its own history when the stored checkpoint is not a valid checkpoint", async () => {
    const { model, requests } = createRecordingModel();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "session-history-"));
    try {
      const checkpointer = new FileSaver({ dir });
      await fs.writeFile(checkpointer.getFilePath("thread-1"), JSON.stringify({ foo: "bar" }));
      expect(await checkpointer.exists("thread-1")).toBe(true);
      expect(await checkpointer.load("thread-1")).toBeUndefined();

      const agent = createAgent({ model, checkpointer });
      const session = new AgentSession({
        agent,
        threadId: "thread-1",
        initialMessages: [
          { role: "user", content: "U0" },
          { role: "assistant", content: "A0" },
        ],
      });
      await runTurns(session, ["U1"]);

      expect(requests()[0]).toEqual(["user:U0", "assistant:A0", "user:U1"]);
      await agent.dispose();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not depend on the checkpointer's exists()", async () => {
    const { model, requests } = createRecordingModel();
    const checkpointer = new MemorySaver();
    checkpointer.exists = async () => {
      throw new Error("exists() unavailable");
    };
    const agent = createAgent({ model, checkpointer });
    const session = new AgentSession({ agent, threadId: "thread-1" });

    await runTurns(session, ["U1", "U2"]);

    expect(requests()).toEqual([["user:U1"], ["user:U1", "assistant:A1", "user:U2"]]);
    await agent.dispose();
  });

  it("sends its own history when the session has no threadId", async () => {
    const { model, requests } = createRecordingModel();
    const agent = createAgent({ model, checkpointer: new MemorySaver() });
    const session = new AgentSession({ agent });

    await runTurns(session, ["U1", "U2"]);

    expect(requests()).toEqual([["user:U1"], ["user:U1", "assistant:A1", "user:U2"]]);
    await agent.dispose();
  });

  it("still sends its own history when the agent has no checkpointer", async () => {
    const { model, requests } = createRecordingModel();
    const agent = createAgent({ model });
    const session = new AgentSession({ agent, threadId: "thread-1" });

    await runTurns(session, ["U1", "U2"]);

    expect(requests()).toEqual([["user:U1"], ["user:U1", "assistant:A1", "user:U2"]]);
    await agent.dispose();
  });
});
