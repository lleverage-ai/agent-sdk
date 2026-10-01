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
import type { HookCallback, PreGenerateInput } from "../src/index.js";
import {
  COMMON_SECRET_PATTERNS,
  createAgent,
  createCheckpoint,
  createGuardrailsHooks,
  createSecretsFilterHooks,
} from "../src/index.js";
import { AgentSession } from "../src/session.js";

type PromptMessage = { role: string; content: string | Array<{ type: string; text?: string }> };

/** A mock model that answers `A1`, `A2`, ... and records every request. */
function createRecordingModel(options: { failFirstCall?: boolean } = {}) {
  let calls = 0;
  let failNext = options.failFirstCall ?? false;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      if (failNext) {
        failNext = false;
        throw new Error("model unavailable");
      }
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

  describe("with hooks on a checkpointed thread", () => {
    const context: ModelMessage = { role: "user", content: "CTX" };

    it("keeps messages a PreGenerate hook adds through updatedInput", async () => {
      const { model, requests } = createRecordingModel();
      const addContext: HookCallback = async (input) => ({
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          updatedInput: {
            ...(input as PreGenerateInput).options,
            messages: [...((input as PreGenerateInput).options.messages ?? []), context],
          },
        },
      });
      const agent = createAgent({
        model,
        checkpointer: new MemorySaver(),
        hooks: { PreGenerate: [addContext] },
      });
      const session = new AgentSession({ agent, threadId: "thread-1" });

      await runTurns(session, ["U1", "U2"]);

      expect(requests()).toEqual([
        ["user:CTX", "user:U1"],
        ["user:CTX", "user:U1", "assistant:A1", "user:CTX", "user:U2"],
      ]);
      await agent.dispose();
    });

    it("keeps messages a PreGenerate hook sets on the options in place", async () => {
      const { model, requests } = createRecordingModel();
      const addContext: HookCallback = async (input) => {
        const options = (input as PreGenerateInput).options;
        options.messages = [...(options.messages ?? []), context];
        return {};
      };
      const agent = createAgent({
        model,
        checkpointer: new MemorySaver(),
        hooks: { PreGenerate: [addContext] },
      });
      const session = new AgentSession({ agent, threadId: "thread-1" });

      await runTurns(session, ["U1", "U2"]);

      expect(requests()[1]).toEqual(["user:CTX", "user:U1", "assistant:A1", "user:CTX", "user:U2"]);
      // The hook's change does not leak into the session's own history.
      expect(session.getMessages().map((message) => message.content)).toEqual([
        "U1",
        "A1",
        "U2",
        "A2",
      ]);
      await agent.dispose();
    });

    it("does not duplicate history when a hook rebuilds the options from public fields", async () => {
      const { model, requests } = createRecordingModel();
      const rebuild: HookCallback = async (input) => {
        const { prompt, threadId, messages } = (input as PreGenerateInput).options;
        return {
          hookSpecificOutput: {
            hookEventName: "PreGenerate",
            updatedInput: { prompt, threadId, messages },
          },
        };
      };
      const agent = createAgent({
        model,
        checkpointer: new MemorySaver(),
        hooks: { PreGenerate: [rebuild] },
      });
      const session = new AgentSession({
        agent,
        threadId: "thread-1",
        initialMessages: [
          { role: "user", content: "U0" },
          { role: "assistant", content: "A0" },
        ],
      });

      await runTurns(session, ["U1", "U2"]);

      expect(requests()).toEqual([
        ["user:U0", "assistant:A0", "user:U1"],
        ["user:U0", "assistant:A0", "user:U1", "assistant:A1", "user:U2"],
      ]);
      await agent.dispose();
    });

    it("keeps the session's history when a failure hook retries with rebuilt options", async () => {
      const { model, requests } = createRecordingModel({ failFirstCall: true });
      const retry: HookCallback = async (input) => {
        if (input.hook_event_name !== "PostGenerateFailure") return {};
        const { prompt, threadId, messages } = input.options;
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerateFailure",
            retry: true,
            updatedInput: { prompt, threadId, messages },
          },
        };
      };
      const agent = createAgent({
        model,
        checkpointer: new MemorySaver(),
        hooks: { PostGenerateFailure: [retry] },
      });
      const session = new AgentSession({
        agent,
        threadId: "thread-1",
        initialMessages: [
          { role: "user", content: "U0" },
          { role: "assistant", content: "A0" },
        ],
      });

      const replies = await runTurns(session, ["U1"]);

      expect(replies).toEqual(["A1"]);
      expect(requests()).toEqual([
        ["user:U0", "assistant:A0", "user:U1"],
        ["user:U0", "assistant:A0", "user:U1"],
      ]);
      await agent.dispose();
    });
  });

  describe("input-security hooks on a new checkpointed thread", () => {
    const awsKey = "AKIAABCDEFGHIJKLMNOP";

    it("lets the secrets filter redact secrets in initial messages", async () => {
      const { model, requests } = createRecordingModel();
      const checkpointer = new MemorySaver();
      const [redactInput] = createSecretsFilterHooks({
        patterns: [COMMON_SECRET_PATTERNS.AWS_ACCESS_KEY],
        filterOutput: false,
      });
      const agent = createAgent({ model, checkpointer, hooks: { PreGenerate: [redactInput] } });
      const session = new AgentSession({
        agent,
        threadId: "thread-1",
        initialMessages: [
          { role: "user", content: `My key is ${awsKey}` },
          { role: "assistant", content: "A0" },
        ],
      });

      await runTurns(session, ["U1", "U2"]);

      expect(requests()[0]).toEqual(["user:My key is [REDACTED]", "assistant:A0", "user:U1"]);
      expect(JSON.stringify(requests())).not.toContain(awsKey);
      expect(JSON.stringify(await checkpointer.load("thread-1"))).not.toContain(awsKey);
      await agent.dispose();
    });

    it("lets guardrails deny blocked content in initial messages", async () => {
      const { model, requests } = createRecordingModel();
      const [checkInput] = createGuardrailsHooks({ blockedInputPatterns: [/forbidden/i] });
      const agent = createAgent({
        model,
        checkpointer: new MemorySaver(),
        hooks: { PreGenerate: [checkInput] },
      });
      const session = new AgentSession({
        agent,
        threadId: "thread-1",
        initialMessages: [{ role: "user", content: "a forbidden request" }],
      });

      await expect(runTurns(session, ["U1"])).rejects.toThrow("Generation denied by hook");
      expect(requests()).toEqual([]);
      await agent.dispose();
    });

    it("lets hooks see the session's history again after delete and invalidate", async () => {
      const { model, requests } = createRecordingModel();
      const checkpointer = new MemorySaver();
      const seen: number[] = [];
      const record: HookCallback = async (input) => {
        seen.push((input as PreGenerateInput).options.messages?.length ?? 0);
        return {};
      };
      const agent = createAgent({ model, checkpointer, hooks: { PreGenerate: [record] } });
      const session = new AgentSession({ agent, threadId: "thread-1" });

      await runTurns(session, ["U1", "U2"]);
      await checkpointer.delete("thread-1");
      agent.invalidateCheckpoint("thread-1");
      await runTurns(session, ["U3"]);

      // Turn 2 used the checkpoint; turn 3 had none, so hooks saw all 4 messages.
      expect(seen).toEqual([0, 0, 4]);
      expect(requests()[2]).toEqual([
        "user:U1",
        "assistant:A1",
        "user:U2",
        "assistant:A2",
        "user:U3",
      ]);
      await agent.dispose();
    });
  });

  it("loads a new thread's checkpoint no more often than a plain generate()", async () => {
    const countLoads = () => {
      const checkpointer = new MemorySaver();
      const load = checkpointer.load.bind(checkpointer);
      let loads = 0;
      checkpointer.load = async (threadId) => {
        loads++;
        return load(threadId);
      };
      return { checkpointer, loads: () => loads };
    };

    const plain = countLoads();
    const plainAgent = createAgent({
      model: createRecordingModel().model,
      checkpointer: plain.checkpointer,
    });
    await plainAgent.generate({ prompt: "U1", threadId: "thread-1" });

    const viaSession = countLoads();
    const agent = createAgent({
      model: createRecordingModel().model,
      checkpointer: viaSession.checkpointer,
    });
    const session = new AgentSession({
      agent,
      threadId: "thread-1",
      initialMessages: [{ role: "user", content: "U0" }],
    });
    await runTurns(session, ["U1"]);

    expect(viaSession.loads()).toBeLessThanOrEqual(plain.loads());
    await plainAgent.dispose();
    await agent.dispose();
  });

  describe("when the store changes between the history decision and message assembly", () => {
    it("ignores a checkpoint a PreGenerate hook creates for a new thread", async () => {
      const { model, requests } = createRecordingModel();
      const checkpointer = new MemorySaver();
      let created = false;
      const createOnce: HookCallback = async () => {
        if (!created) {
          created = true;
          await checkpointer.save(
            createCheckpoint({
              threadId: "thread-1",
              messages: [{ role: "user", content: "OTHER" }],
              state: { todos: [], files: {} },
            }),
          );
        }
        return {};
      };
      const agent = createAgent({ model, checkpointer, hooks: { PreGenerate: [createOnce] } });
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
    });

    it("keeps the checkpoint it decided on when a PreGenerate hook deletes and invalidates it", async () => {
      const { model, requests } = createRecordingModel();
      const checkpointer = new MemorySaver();
      let turn = 0;
      const agentRef: { current?: ReturnType<typeof createAgent> } = {};
      const deleteOnSecondTurn: HookCallback = async () => {
        if (++turn === 2) {
          await checkpointer.delete("thread-1");
          agentRef.current?.invalidateCheckpoint("thread-1");
        }
        return {};
      };
      const agent = createAgent({
        model,
        checkpointer,
        hooks: { PreGenerate: [deleteOnSecondTurn] },
      });
      agentRef.current = agent;
      const session = new AgentSession({ agent, threadId: "thread-1" });

      await runTurns(session, ["U1", "U2"]);

      expect(requests()[1]).toEqual(["user:U1", "assistant:A1", "user:U2"]);
      await agent.dispose();
    });

    it("never reuses a snapshot passed in from an earlier run", async () => {
      const { model, requests } = createRecordingModel();
      const agent = createAgent({ model, checkpointer: new MemorySaver() });
      await agent.generate({ prompt: "U1", threadId: "thread-1" });

      await agent.generate({
        prompt: "U2",
        threadId: "thread-1",
        _checkpointSnapshot: { threadId: "thread-1", checkpoint: undefined },
      });

      expect(requests()[1]).toEqual(["user:U1", "assistant:A1", "user:U2"]);
      await agent.dispose();
    });
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
