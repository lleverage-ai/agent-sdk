/**
 * A host settles tool calls for a log-mode run with `contextSettledToolCalls`:
 * calls it already ran (for example a skill the user invoked by name, loaded
 * with the run's own `skill` tool), with their results. The run's first
 * prepare commits them after the run's input, screened like input, so the
 * first model request already holds them and the model makes no call for
 * them.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { jsonSchema, type LanguageModel, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  type AgentOptions,
  ConfigurationError,
  type ContextEntryInput,
  type ContextLogStore,
  type ContextPrepareRequest,
  type ContextSettledToolCallsInput,
  type ContextStreamRef,
  createAgent,
  createContextManager,
  createSecretsFilterHooks,
  MemoryContextLogStore,
  ValidationError,
} from "../../src/index.js";
import { createBackgroundTask } from "../../src/task-store/types.js";

const THREAD = "thread-1";
const MAIN: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/**
 * A model that replies with text, except on the calls `toolCallsOn` lists,
 * where it asks for `echo`.
 */
function createModel(toolCallsOn: readonly number[] = []) {
  let calls = 0;
  const requests: LanguageModelV3CallOptions[] = [];
  const reply = (): LanguageModelV3Content[] => {
    calls++;
    return toolCallsOn.includes(calls)
      ? [
          {
            type: "tool-call",
            toolCallId: `echo-${calls}`,
            toolName: "echo",
            input: '{"value":"x"}',
          },
        ]
      : [{ type: "text", text: `A${calls}` }];
  };
  const finish = (content: LanguageModelV3Content[]) =>
    content.some((part) => part.type === "tool-call")
      ? { unified: "tool-calls" as const, raw: "tool_calls" }
      : { unified: "stop" as const, raw: "stop" };
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      requests.push(options);
      const content = reply();
      return { content, finishReason: finish(content), usage, warnings: [] };
    },
    doStream: async (options) => {
      requests.push(options);
      const content = reply();
      const parts: LanguageModelV3StreamPart[] = [{ type: "stream-start", warnings: [] }];
      for (const part of content) {
        if (part.type === "text") {
          parts.push(
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: part.text },
            { type: "text-end", id: "t" },
          );
        } else parts.push(part as LanguageModelV3StreamPart);
      }
      parts.push({ type: "finish", finishReason: finish(content), usage });
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  });
  return { model: model as LanguageModel, requests };
}

const echo = tool({
  inputSchema: jsonSchema<{ value: string }>({
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  }),
  execute: async ({ value }) => `echo:${value}`,
});

const skill = tool({
  inputSchema: jsonSchema<{ skill_name: string }>({
    type: "object",
    properties: { skill_name: { type: "string" } },
    required: ["skill_name"],
  }),
  execute: async ({ skill_name }) => ({ success: true, skill: skill_name }),
});

function logAgent(
  model: LanguageModel,
  store: ContextLogStore,
  options: Partial<AgentOptions> = {},
) {
  return createAgent({
    model,
    systemPrompt: "You are the core.",
    tools: { echo, skill },
    ...options,
    contextLog: { mode: "log", store },
  });
}

const skillCall = {
  role: "assistant" as const,
  content: [
    {
      type: "tool-call" as const,
      toolCallId: "load-1",
      toolName: "skill",
      input: { skill_name: "orders" },
    },
  ],
};

const skillResult = {
  role: "tool" as const,
  content: [
    {
      type: "tool-result" as const,
      toolCallId: "load-1",
      toolName: "skill",
      output: { type: "json" as const, value: { success: true, skill: "orders" } },
    },
  ],
};

const settled: ContextSettledToolCallsInput = {
  entries: [
    { key: "load:1:call", message: skillCall, metadata: { harnessLoad: true } },
    { key: "load:1:result", message: skillResult, metadata: { harnessLoad: true } },
  ],
};

async function readAll(store: ContextLogStore) {
  const head = (await store.readHead(MAIN))!;
  const page = await store.readPath(head, { after: 0, limit: 100 });
  return { head, entries: page.entries };
}

/** A store that records the keys each prepare appends. */
function recordingStore() {
  const store = new MemoryContextLogStore();
  const appended: string[][] = [];
  const recording: ContextLogStore = Object.assign(Object.create(store), {
    prepare: (request: ContextPrepareRequest) => {
      appended.push(request.append.map((entry: ContextEntryInput) => entry.key));
      return store.prepare(request);
    },
  });
  return { store, recording, appended };
}

describe("log-mode settled tool calls", () => {
  for (const kind of ["generate", "stream", "streamDataResponse"] as const) {
    it(`commits them after the run's input, before the first model call (${kind})`, async () => {
      const store = new MemoryContextLogStore();
      const { model, requests } = createModel();
      const agent = logAgent(model, store);
      const options = {
        input: [{ role: "user" as const, content: "/orders process this one" }],
        threadId: THREAD,
        contextSettledToolCalls: settled,
      };
      if (kind === "generate") await agent.generate(options);
      else if (kind === "stream") for await (const _part of agent.stream(options)) void _part;
      else await (await agent.streamDataResponse(options)).text();

      const { entries } = await readAll(store);
      expect(entries.map((entry) => entry.key)).toEqual([
        expect.stringMatching(/^user:/),
        "load:1:call",
        "load:1:result",
        expect.stringMatching(/^output:/),
      ]);
      expect(entries.map((entry) => entry.kind)).toEqual([
        "user",
        "assistant",
        "tool_result",
        "assistant",
      ]);
      // Host metadata is kept on the entries; the input and the calls are
      // committed by the same prepare.
      expect(entries[1]!.metadata).toEqual({ harnessLoad: true });
      expect(entries[2]!.metadata).toEqual({ harnessLoad: true });
      expect(entries[1]!.manifestId).toBe(entries[0]!.manifestId);
      expect(entries[2]!.manifestId).toBe(entries[0]!.manifestId);

      // One model call, whose request already holds the settled call.
      expect(requests).toHaveLength(1);
      const prompt = requests[0]!.prompt;
      expect(prompt.slice(-3).map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "tool",
      ]);
      expect(prompt.at(-2)!.content).toEqual([
        expect.objectContaining({
          type: "tool-call",
          toolCallId: "load-1",
          toolName: "skill",
        }),
      ]);
      expect(prompt.at(-1)!.content).toEqual([
        expect.objectContaining({
          type: "tool-result",
          toolCallId: "load-1",
          toolName: "skill",
          output: { type: "json", value: { success: true, skill: "orders" } },
        }),
      ]);
    });
  }

  it("commits them after earlier history and before later steps of the run", async () => {
    const { store, recording, appended } = recordingStore();
    const { model, requests } = createModel([2]);
    const agent = logAgent(model, recording);
    await agent.generate({ prompt: "Earlier.", threadId: THREAD });

    await agent.generate({
      prompt: "/orders go",
      threadId: THREAD,
      contextSettledToolCalls: settled,
    });

    // Appended once, by the run's first prepare; its tool step's prepare
    // appends nothing of them again.
    expect(appended.filter((keys) => keys.includes("load:1:call"))).toEqual([
      [expect.stringMatching(/^user:/), "load:1:call", "load:1:result"],
    ]);
    const keys = (await readAll(store)).entries.map((entry) => entry.key);
    expect(keys.slice(2)).toEqual([
      expect.stringMatching(/^user:/),
      "load:1:call",
      "load:1:result",
      expect.stringMatching(/^output:/),
      expect.stringMatching(/^output:/),
      expect.stringMatching(/^output:/),
    ]);
    // The model's own echo call comes after the settled one.
    expect(requests).toHaveLength(3);
    const last = requests.at(-1)!.prompt.map((message) => message.role);
    expect(last.slice(-5)).toEqual(["user", "assistant", "tool", "assistant", "tool"]);
  });

  it("never appends them twice across a repeated run, and re-plans identically after an uncertain prepare", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createModel();
    const prepared: string[] = [];
    let failures = 1;
    const flaky: ContextLogStore = Object.assign(Object.create(store), {
      prepare: async (request: ContextPrepareRequest) => {
        prepared.push(JSON.stringify(request.append));
        if (failures-- > 0) {
          const { ContextLogUnavailableError } = await import("../../src/index.js");
          throw new ContextLogUnavailableError("flaky");
        }
        return store.prepare(request);
      },
    });
    const agent = logAgent(model, flaky);
    await agent.generate({ prompt: "Hi", threadId: THREAD, contextSettledToolCalls: settled });
    expect(prepared.length).toBeGreaterThanOrEqual(2);
    expect(new Set(prepared).size).toBe(1);

    // A later run that passes the same keys finds them on the path.
    await agent.generate({ prompt: "Again", threadId: THREAD, contextSettledToolCalls: settled });
    const { entries } = await readAll(store);
    expect(entries.filter((entry) => entry.key.startsWith("load:"))).toHaveLength(2);
  });

  it("screens them with the PreGenerate hooks before they are committed or sent", async () => {
    const SECRET = "AKIAIOSFODNN7EXAMPLE";
    const store = new MemoryContextLogStore();
    const { model, requests } = createModel();
    const [inputFilter] = createSecretsFilterHooks();
    const roles: string[] = [];
    const agent = logAgent(model, store, {
      hooks: {
        PreGenerate: [
          inputFilter!,
          (input) => {
            if (input.hook_event_name !== "PreGenerate") return undefined;
            // Hooks never see the unscreened option itself.
            expect(input.options.contextSettledToolCalls).toBeUndefined();
            roles.push(...(input.options.messages ?? []).map((message) => message.role));
            return undefined;
          },
        ],
      },
    });
    await agent.generate({
      prompt: "Load it.",
      threadId: THREAD,
      contextSettledToolCalls: {
        entries: [
          {
            key: "load:1:call",
            message: {
              ...skillCall,
              content: [{ ...skillCall.content[0], input: { skill_name: "orders", note: SECRET } }],
            },
          },
          {
            key: "load:1:result",
            message: {
              ...skillResult,
              content: [
                { ...skillResult.content[0], output: { type: "text", value: `key ${SECRET}` } },
              ],
            },
          },
        ],
      },
    });
    // The first screening is the prepare's: the input, then the calls. (The
    // model's own output is screened after it.)
    expect(roles.slice(0, 3)).toEqual(["user", "assistant", "tool"]);
    const { entries } = await readAll(store);
    expect(JSON.stringify(entries)).not.toContain(SECRET);
    expect(JSON.stringify(requests[0]!.prompt)).not.toContain(SECRET);
  });

  it("rejects malformed or unsettled calls before anything is committed, never quoting them", async () => {
    const SECRET = "AKIAIOSFODNN7EXAMPLE";
    const store = new MemoryContextLogStore();
    const { model, requests } = createModel();
    const agent = logAgent(model, store);
    const call = (id: string, extra: object = {}) => ({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: id, toolName: "skill", input: {}, ...extra }],
    });
    const result = (id: string) => ({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName: "skill",
          output: { type: "text", value: "ok" },
        },
      ],
    });
    const cases: Array<{ settled: unknown; detail: RegExp }> = [
      { settled: [], detail: /must be an object with entries/ },
      { settled: { entries: "nope" }, detail: /entries must be an array/ },
      {
        settled: { entries: [{ key: "a", message: { role: "user", content: SECRET } }] },
        detail: /assistant or tool message/,
      },
      {
        settled: { entries: [{ key: "a", message: { role: "assistant", content: SECRET } }] },
        detail: /at least one tool call or tool result/,
      },
      {
        settled: {
          entries: [
            {
              key: "a",
              message: {
                role: "assistant",
                content: [{ type: "text", text: SECRET }, ...call("c1").content],
              },
            },
            { key: "b", message: result("c1") },
          ],
        },
        detail: /content\[0\] must be a tool call/,
      },
      {
        settled: {
          entries: [
            { key: "a", message: call("c1", { providerExecuted: true }) },
            { key: "b", message: result("c1") },
          ],
        },
        detail: /must not be provider executed/,
      },
      { settled: { entries: [{ key: "a", message: call("c1") }] }, detail: /without a result/ },
      {
        settled: { entries: [{ key: "a", message: result("c1") }] },
        detail: /must answer a tool call made before it/,
      },
      {
        settled: {
          entries: [
            { key: "a", message: result("c1") },
            { key: "b", message: call("c1") },
          ],
        },
        detail: /must answer a tool call made before it/,
      },
      {
        settled: {
          entries: [
            { key: "a", message: call("c1") },
            { key: "a", message: result("c1") },
          ],
        },
        detail: /repeats an earlier key/,
      },
      {
        settled: {
          entries: [
            { key: "a", message: call("c1") },
            {
              key: "b",
              message: {
                role: "tool",
                content: [{ type: "tool-approval-response", approvalId: "x", approved: true }],
              },
            },
          ],
        },
        detail: /must be a tool result/,
      },
      {
        settled: {
          entries: [
            { key: "a", message: call("c1"), metadata: { at: new Date() } },
            { key: "b", message: result("c1") },
          ],
        },
        detail: /entries\[0\]\.metadata must be plain JSON/,
      },
    ];
    for (const { settled: value, detail } of cases) {
      const error = await agent
        .generate({
          prompt: "Hi",
          threadId: THREAD,
          contextSettledToolCalls: value as ContextSettledToolCallsInput,
        })
        .catch((caught: unknown) => caught);
      expect(error, String(detail)).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toMatch(detail);
      expect((error as Error).message).not.toContain(SECRET);
    }
    expect(await store.readHead(MAIN)).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("is refused with a fork, before anything is committed", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createModel();
    const streamId = "main/subagent/forker-x";
    const error = await logAgent(model, store)
      .generate({
        prompt: "Brief",
        threadId: THREAD,
        contextStream: {
          streamId,
          forkFrom: { sourceManifestId: "m-1", toolCallId: "call-x", subagentType: "forker" },
        },
        contextSettledToolCalls: settled,
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(/cannot be supplied for a fork/);
    expect(await store.readHead({ ...MAIN, streamId })).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("is refused outside log mode, and leaves legacy runs unchanged", async () => {
    const { model, requests } = createModel();
    const agent = createAgent({ model, tools: { echo, skill } });
    await expect(
      agent.generate({ prompt: "Hi", contextSettledToolCalls: settled }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(requests).toHaveLength(0);

    const result = await agent.generate({ prompt: "Hi" });
    expect(result.text).toBe("A1");
    expect(
      requests[0]!.prompt.filter((message) => message.role !== "system").map((m) => m.role),
    ).toEqual(["user"]);
  });
});

describe("log-mode settled tool calls and background follow-ups", () => {
  /** Compacts once the view holds more than five messages, keeping two. */
  function compacting() {
    return createContextManager({
      maxTokens: 1_000_000,
      policy: {
        shouldCompact: (_budget, messages) =>
          messages.length > 5 ? { trigger: true, reason: "token_threshold" } : { trigger: false },
      },
      summarization: { keepMessageCount: 2, keepToolResultCount: 0 },
      summarizer: async () => ({ text: "summary" }),
    });
  }

  for (const kind of ["generate", "stream", "streamDataResponse"] as const) {
    it(`never brings back settled calls a later step compacted away, in a follow-up (${kind})`, async () => {
      const { store, recording, appended } = recordingStore();
      const { model } = createModel([2]);
      const agent = logAgent(model, recording, { contextManager: compacting() });
      await agent.generate({ prompt: "Earlier.", threadId: THREAD });
      agent.taskManager.registerTask(
        createBackgroundTask({
          id: "task-1",
          subagentType: "researcher",
          description: "Research",
          status: "completed",
          completedAt: new Date().toISOString(),
          result: "Research done.",
        }),
      );
      const options = { prompt: "Now.", threadId: THREAD, contextSettledToolCalls: settled };
      if (kind === "generate") await agent.generate(options);
      else if (kind === "stream") for await (const _part of agent.stream(options)) void _part;
      else await (await agent.streamDataResponse(options)).text();

      expect(appended.filter((keys) => keys.includes("load:1:call"))).toHaveLength(1);
      const keys = (await readAll(store)).entries.map((entry) => entry.key);
      expect(keys.some((key) => key.startsWith("load:"))).toBe(false);
      // The follow-up did run, on the compacted path.
      expect(appended.length).toBeGreaterThanOrEqual(4);
    });
  }
});
