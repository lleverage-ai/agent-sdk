/**
 * A host supplies history for a log-mode run with `contextHistory`: a root
 * history imports a stream's legacy history as its first version (the
 * declared `legacy_projection_import` transition), and appended history adds
 * messages written outside the agent (for example a voice turn) after the
 * head's path. Every entry passes the PreGenerate hooks before it is
 * committed, and the run's first prepare commits it before the run's input.
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
  type ContextAdmitInput,
  type ContextEntryInput,
  type ContextHead,
  type ContextHistoryEntry,
  type ContextHistoryInput,
  type ContextLogStore,
  type ContextPrepareRequest,
  type ContextStreamRef,
  createAgent,
  createContextManager,
  createSecretsFilterHooks,
  isContextLogError,
  LEGACY_PROJECTION_IMPORT_REASON,
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
        usage,
        warnings: [],
      };
    },
    doStream: async (options) => {
      requests.push(options);
      calls++;
      const reply = `A${calls}`;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "t" });
            controller.enqueue({ type: "text-delta", id: "t", delta: reply });
            controller.enqueue({ type: "text-end", id: "t" });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage,
            });
            controller.close();
          },
        }),
      };
    },
  });
  return { model: model as LanguageModel, requests };
}

function logAgent(
  model: LanguageModel,
  store: ContextLogStore,
  options: Partial<AgentOptions> = {},
  contextLog: Partial<NonNullable<AgentOptions["contextLog"]>> = {},
) {
  return createAgent({
    model,
    systemPrompt: "You are the core.",
    ...options,
    contextLog: { mode: "log", store, ...contextLog },
  });
}

const text = (role: "user" | "assistant", value: string) => ({
  role,
  content: [{ type: "text", text: value }],
});

/** A legacy conversation: a question, a tool call and its result, an answer. */
const legacyHistory: ContextHistoryInput = {
  root: {
    reason: LEGACY_PROJECTION_IMPORT_REASON,
    metadata: { legacyImport: { sourceEventSequence: 42 } },
  },
  entries: [
    {
      key: "import:0",
      message: { role: "user", content: "What is on Monday?" },
      metadata: { imported: true },
    },
    {
      key: "import:1",
      message: {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call-1", toolName: "calendar", input: { day: "mon" } },
        ],
      },
      metadata: { imported: true },
    },
    {
      key: "import:2",
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "calendar",
            output: { type: "json", value: { events: ["stand-up"] } },
          },
        ],
      },
      metadata: { imported: true },
    },
    {
      key: "import:3",
      message: { role: "assistant", content: "A stand-up." },
      metadata: { imported: true },
    },
  ],
};

async function readAll(store: ContextLogStore) {
  const head = (await store.readHead(MAIN))!;
  const page = await store.readPath(head, { after: 0, limit: 100 });
  return { head, entries: page.entries };
}

describe("log-mode imported history", () => {
  it("imports a stream's history as its first version before the run's input", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createRecordingModel();
    const admitted: ContextAdmitInput[] = [];

    await logAgent(
      model,
      store,
      {},
      {
        admit: (input) => {
          admitted.push(input);
          return { allow: true };
        },
      },
    ).generate({ prompt: "And Tuesday?", threadId: THREAD, contextHistory: legacyHistory });

    const { head, entries } = await readAll(store);
    expect(entries.map((entry) => entry.key)).toEqual([
      "import:0",
      "import:1",
      "import:2",
      "import:3",
      expect.stringMatching(/^user:/),
      expect.stringMatching(/^output:/),
    ]);
    expect(entries.slice(0, 4).every((entry) => entry.metadata?.imported === true)).toBe(true);
    const version = await store.readVersion(head.versionId);
    expect(version).toMatchObject({
      reason: LEGACY_PROJECTION_IMPORT_REASON,
      parentVersionId: null,
      core: "You are the core.",
      metadata: { legacyImport: { sourceEventSequence: 42 } },
    });
    // The admit hook sees the declared cause.
    const prepare = admitted.find((input) => input.phase === "prepare");
    expect(prepare?.phase === "prepare" && prepare.request.transition?.reason).toBe(
      LEGACY_PROJECTION_IMPORT_REASON,
    );
    // The provider receives the imported history, then the new input.
    const prompt = requests[0]!.prompt;
    expect(prompt[1]).toEqual(text("user", "What is on Monday?"));
    expect(prompt.at(-1)).toEqual(text("user", "And Tuesday?"));
  });

  it("ignores root history once the stream has a head, so concurrent first runs converge", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createRecordingModel();
    const agent = logAgent(model, store);
    await agent.generate({ prompt: "First run", threadId: THREAD, contextHistory: legacyHistory });
    const first = await readAll(store);

    // A second run that read the same legacy source, after the import.
    await agent.generate({ prompt: "Second run", threadId: THREAD, contextHistory: legacyHistory });
    const second = await readAll(store);
    expect(second.head.versionId).toBe(first.head.versionId);
    expect(second.entries.filter((entry) => entry.key.startsWith("import:"))).toHaveLength(4);
    expect(second.entries).toHaveLength(first.entries.length + 2);
  });

  it("ignores root history on a declared branch, which inherits its source instead", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createRecordingModel();
    const agent = logAgent(model, store);
    await agent.generate({ prompt: "first", threadId: THREAD });
    const head = (await store.readHead(MAIN))!;
    await agent.generate({
      prompt: "edited",
      threadId: THREAD,
      contextStream: {
        branchId: "edit",
        branchFrom: { stream: MAIN, versionId: head.versionId, entryCount: 1 },
      },
      contextHistory: legacyHistory,
    });
    const edit = (await store.readHead({ ...MAIN, branchId: "edit" }))!;
    const page = await store.readPath(edit, { after: 0, limit: 100 });
    expect(page.entries.some((entry) => entry.key.startsWith("import:"))).toBe(false);
    expect((await store.readVersion(edit.versionId)).reason).toBe("branch");
  });

  it("refuses imported history that ends with an unanswered tool call", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createRecordingModel();
    const pending: ContextHistoryInput = {
      root: legacyHistory.root,
      entries: legacyHistory.entries.slice(0, 2),
    };
    const error = await logAgent(model, store)
      .generate({ prompt: "Hi", threadId: THREAD, contextHistory: pending })
      .catch((caught: unknown) => caught);
    expect(isContextLogError(error, "invalid")).toBe(true);
    expect((error as { reason?: string }).reason).toBe("history_unanswered_tool_call");
    expect(await store.readHead(MAIN)).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("screens every history entry with the PreGenerate hooks before it is committed", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createRecordingModel();
    const seen: string[] = [];
    const agent = logAgent(model, store, {
      hooks: {
        PreGenerate: [
          (input) => {
            if (input.hook_event_name !== "PreGenerate") return undefined;
            // Hooks never see the unscreened option itself.
            expect(input.options.contextHistory).toBeUndefined();
            const messages = (input.options.messages ?? []).map((message) => {
              seen.push(message.role);
              return JSON.parse(
                JSON.stringify(message).replaceAll("stand-up", "[REDACTED]"),
              ) as typeof message;
            });
            return {
              hookSpecificOutput: {
                hookEventName: "PreGenerate",
                updatedInput: { ...input.options, messages },
              },
            };
          },
        ],
      },
    });
    await agent.generate({ prompt: "Hi", threadId: THREAD, contextHistory: legacyHistory });
    expect(seen.slice(0, 4)).toEqual(["user", "assistant", "tool", "assistant"]);
    const { entries } = await readAll(store);
    expect(JSON.stringify(entries)).not.toContain("stand-up");
    expect(JSON.stringify(requests[0]!.prompt)).not.toContain("stand-up");
  });

  it("rejects malformed history before anything is committed", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createRecordingModel();
    const agent = logAgent(model, store);
    const cases: unknown[] = [
      { entries: "nope" },
      { entries: [{ key: "", message: { role: "user", content: "x" } }] },
      {
        entries: [
          { key: "a", message: { role: "user", content: "x" } },
          { key: "a", message: { role: "user", content: "y" } },
        ],
      },
      { entries: [{ key: "a", message: { role: "system", content: "x" } }] },
      { root: { reason: "initial" }, entries: [] },
    ];
    for (const contextHistory of cases) {
      await expect(
        agent.generate({
          prompt: "Hi",
          threadId: THREAD,
          contextHistory: contextHistory as ContextHistoryInput,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await store.readHead(MAIN)).toBeNull();
  });

  it("refuses contextHistory outside log mode", async () => {
    const { model } = createRecordingModel();
    await expect(
      createAgent({ model }).generate({ prompt: "Hi", contextHistory: legacyHistory }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });
});

describe("log-mode appended history", () => {
  const voice: ContextHistoryInput = {
    entries: [
      {
        key: "outside:event-7",
        message: { role: "user", content: "Move Monday to Tuesday." },
        metadata: { eventId: "event-7" },
      },
      {
        key: "outside:event-8",
        message: { role: "assistant", content: "Moved." },
        metadata: { eventId: "event-8" },
      },
    ],
  };

  it("appends history after the head's path and before the run's input", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createRecordingModel();
    const agent = logAgent(model, store);
    await agent.generate({ prompt: "Plan my week.", threadId: THREAD });
    const before = await readAll(store);

    await agent.generate({ prompt: "Recap.", threadId: THREAD, contextHistory: voice });

    const after = await readAll(store);
    // A pure append: the earlier path is unchanged and the same version.
    expect(after.head.versionId).toBe(before.head.versionId);
    expect(after.entries.slice(0, before.entries.length)).toEqual(before.entries);
    expect(after.entries.slice(before.entries.length).map((entry) => entry.key)).toEqual([
      "outside:event-7",
      "outside:event-8",
      expect.stringMatching(/^user:/),
      expect.stringMatching(/^output:/),
    ]);
    expect(after.entries[before.entries.length]!.metadata).toEqual({ eventId: "event-7" });
    const prompt = requests.at(-1)!.prompt;
    expect(prompt.slice(-3)).toEqual([
      text("user", "Move Monday to Tuesday."),
      text("assistant", "Moved."),
      text("user", "Recap."),
    ]);
  });

  it("never appends an entry twice across repeated runs, and sends identical bytes", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createRecordingModel();
    const agent = logAgent(model, store);
    await agent.generate({ prompt: "Plan my week.", threadId: THREAD });
    await agent.generate({ prompt: "Recap.", threadId: THREAD, contextHistory: voice });
    const once = await readAll(store);
    // The next run reads the same outside events again.
    await agent.generate({ prompt: "Thanks.", threadId: THREAD, contextHistory: voice });
    const twice = await readAll(store);
    expect(twice.entries.filter((entry) => entry.key.startsWith("outside:"))).toHaveLength(2);
    expect(twice.entries.slice(0, once.entries.length)).toEqual(once.entries);
    // The second run's request extends the first's byte for byte.
    const [, first, second] = requests;
    expect(
      JSON.stringify(second!.prompt).startsWith(JSON.stringify(first!.prompt).slice(0, -1)),
    ).toBe(true);
  });

  it("re-plans identical history after an uncertain first prepare", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createRecordingModel();
    const prepared: string[] = [];
    let failures = 1;
    const flaky: ContextLogStore = Object.assign(Object.create(store), {
      prepare: async (request: Parameters<ContextLogStore["prepare"]>[0]) => {
        prepared.push(JSON.stringify(request.append));
        if (failures-- > 0) {
          const { ContextLogUnavailableError } = await import("../../src/index.js");
          throw new ContextLogUnavailableError("flaky");
        }
        return store.prepare(request);
      },
    });
    await logAgent(model, flaky).generate({
      prompt: "Hi",
      threadId: THREAD,
      contextHistory: voice,
    });
    expect(prepared.length).toBeGreaterThanOrEqual(2);
    expect(new Set(prepared).size).toBe(1);
    const { entries } = await readAll(store);
    expect(entries.filter((entry) => entry.key.startsWith("outside:"))).toHaveLength(2);
  });
});

describe("log-mode history screening", () => {
  const SECRET = "AKIAIOSFODNN7EXAMPLE";

  it("screens the provider options of host-supplied assistant and tool messages, at message and part level", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createRecordingModel();
    const [inputFilter] = createSecretsFilterHooks();
    const history: ContextHistoryInput = {
      root: { reason: LEGACY_PROJECTION_IMPORT_REASON },
      entries: [
        { key: "h:0", message: { role: "user", content: "Look it up." } },
        {
          key: "h:1",
          message: {
            role: "assistant",
            content: [
              {
                type: "reasoning",
                text: "I should look.",
                providerOptions: { anthropic: { signature: "sig-1", note: `part ${SECRET}` } },
              },
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "lookup",
                input: {},
                providerOptions: { test: { trace: `call ${SECRET}` } },
              },
            ],
            providerOptions: { test: { label: `message ${SECRET}` } },
          },
        },
        {
          key: "h:2",
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "lookup",
                output: { type: "text", value: "found" },
                providerOptions: { test: { trace: `result ${SECRET}` } },
              },
            ],
            providerOptions: { test: { label: `tool ${SECRET}` } },
          },
        },
        {
          key: "h:3",
          message: {
            role: "assistant",
            content: "Found it.",
            providerOptions: { test: { label: `string ${SECRET}` } },
          },
        },
      ],
    };

    await logAgent(model, store, { hooks: { PreGenerate: [inputFilter] } }).generate({
      prompt: "Thanks.",
      threadId: THREAD,
      contextHistory: history,
    });

    const { entries } = await readAll(store);
    expect(JSON.stringify(entries)).not.toContain(SECRET);
    expect(JSON.stringify(requests[0]!.prompt)).not.toContain(SECRET);
    // Screened, not stripped: the reasoning signature is kept.
    const reasoning = (entries[1] as { message: { content: Array<{ providerOptions?: unknown }> } })
      .message.content[0]!;
    expect(reasoning.providerOptions).toEqual({
      anthropic: { signature: "sig-1", note: "part [REDACTED]" },
    });
    expect(
      Object.keys((entries[2] as { message: { providerOptions: object } }).message.providerOptions),
    ).toEqual(["test"]);
  });
});

describe("log-mode history tool calls", () => {
  const call = (id: string, providerExecuted?: boolean) => ({
    type: "tool-call" as const,
    toolCallId: id,
    toolName: "lookup",
    input: {},
    ...(providerExecuted ? { providerExecuted: true } : {}),
  });
  const result = (id: string) => ({
    type: "tool-result" as const,
    toolCallId: id,
    toolName: "lookup",
    output: { type: "text" as const, value: `result ${id}` },
  });
  const entries = (...messages: ContextHistoryEntry["message"][]): ContextHistoryEntry[] =>
    messages.map((message, index) => ({ key: `h:${index}`, message }));

  async function supply(history: ContextHistoryEntry[], root = true) {
    const store = new MemoryContextLogStore();
    const { model } = createRecordingModel();
    const agent = logAgent(model, store);
    if (!root) await agent.generate({ prompt: "first", threadId: THREAD });
    return agent
      .generate({
        prompt: "next",
        threadId: THREAD,
        contextHistory: {
          entries: history,
          ...(root ? { root: { reason: LEGACY_PROJECTION_IMPORT_REASON } } : {}),
        },
      })
      .then(
        () => "accepted",
        (error: unknown) =>
          isContextLogError(error, "invalid") ? (error as { reason?: string }).reason : error,
      );
  }

  it("accepts parallel calls that are all answered", async () => {
    expect(
      await supply(
        entries(
          { role: "user", content: "q" },
          { role: "assistant", content: [call("a"), call("b")] },
          { role: "tool", content: [result("b")] },
          { role: "tool", content: [result("a")] },
          { role: "assistant", content: "done" },
        ),
      ),
    ).toBe("accepted");
  });

  it("refuses parallel calls answered only in part, root or appended", async () => {
    const partial = entries(
      { role: "user", content: "q" },
      { role: "assistant", content: [call("a"), call("b")] },
      { role: "tool", content: [result("a")] },
    );
    expect(await supply(partial)).toBe("history_unanswered_tool_call");
    expect(await supply(partial, false)).toBe("history_unanswered_tool_call");
  });

  it("refuses a call answered only after the next user message", async () => {
    expect(
      await supply(
        entries(
          { role: "user", content: "q" },
          { role: "assistant", content: [call("a")] },
          { role: "user", content: "never mind" },
          { role: "tool", content: [result("a")] },
        ),
      ),
    ).toBe("history_unanswered_tool_call");
  });

  it("accepts a result without a call, as the AI SDK does", async () => {
    expect(
      await supply(
        entries(
          { role: "user", content: "q" },
          { role: "tool", content: [result("orphan")] },
          { role: "assistant", content: "done" },
        ),
      ),
    ).toBe("accepted");
  });

  it("accepts provider-executed calls, with or without their result in the assistant message", async () => {
    expect(
      await supply(
        entries(
          { role: "user", content: "q" },
          {
            role: "assistant",
            content: [call("search-1", true), { ...result("search-1") }, call("search-2", true)],
          },
          { role: "assistant", content: "done" },
        ),
      ),
    ).toBe("accepted");
  });

  it("refuses an approved call that has no result", async () => {
    expect(
      await supply(
        entries(
          { role: "user", content: "q" },
          {
            role: "assistant",
            content: [
              call("a"),
              { type: "tool-approval-request", approvalId: "ap-1", toolCallId: "a" },
            ],
          } as ContextHistoryEntry["message"],
          {
            role: "tool",
            content: [{ type: "tool-approval-response", approvalId: "ap-1", approved: true }],
          } as ContextHistoryEntry["message"],
        ),
      ),
    ).toBe("history_unanswered_tool_call");
  });

  it("checks keys structurally", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createRecordingModel();
    for (const key of ["k".repeat(1025), "line\nbreak", "nul\u0000", "c1\u0085"]) {
      await expect(
        logAgent(model, store).generate({
          prompt: "Hi",
          threadId: THREAD,
          contextHistory: { entries: [{ key, message: { role: "user", content: "x" } }] },
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await store.readHead(MAIN)).toBeNull();
  });
});

describe("log-mode history and background follow-ups", () => {
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

  /** Replies in order: plain text, except that the second call asks for `echo`. */
  function createToolStepModel() {
    let calls = 0;
    const reply = (): LanguageModelV3Content[] => {
      calls++;
      return calls === 2
        ? [{ type: "tool-call", toolCallId: "echo-1", toolName: "echo", input: '{"value":"x"}' }]
        : [{ type: "text", text: `A${calls}` }];
    };
    const finish = (content: LanguageModelV3Content[]) =>
      content.some((part) => part.type === "tool-call")
        ? { unified: "tool-calls" as const, raw: "tool_calls" }
        : { unified: "stop" as const, raw: "stop" };
    return new MockLanguageModelV3({
      doGenerate: async () => {
        const content = reply();
        return { content, finishReason: finish(content), usage, warnings: [] };
      },
      doStream: async () => {
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
    }) as LanguageModel;
  }

  const echo = tool({
    inputSchema: jsonSchema<{ value: string }>({
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    }),
    execute: async ({ value }) => `echo:${value}`,
  });

  const outside: ContextHistoryInput = {
    entries: [
      { key: "outside:1", message: { role: "user", content: "Spoken question." } },
      { key: "outside:2", message: { role: "assistant", content: "Spoken answer." } },
    ],
  };

  for (const kind of ["generate", "stream", "streamDataResponse"] as const) {
    it(`never brings back history a later step compacted away, in a follow-up (${kind})`, async () => {
      const store = new MemoryContextLogStore();
      const appended: string[][] = [];
      const recording: ContextLogStore = Object.assign(Object.create(store), {
        prepare: (request: ContextPrepareRequest) => {
          appended.push(request.append.map((entry: ContextEntryInput) => entry.key));
          return store.prepare(request);
        },
      });
      const agent = logAgent(createToolStepModel(), recording, {
        contextManager: compacting(),
        tools: { echo },
      });
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
      // The run commits the history with its input, then its tool step's
      // prepare compacts it into a summary; the follow-up runs after that.
      const options = { prompt: "Now.", threadId: THREAD, contextHistory: outside };
      if (kind === "generate") await agent.generate(options);
      else if (kind === "stream") for await (const _part of agent.stream(options)) void _part;
      else await (await agent.streamDataResponse(options)).text();

      const withHistory = appended.filter((keys) => keys.includes("outside:1"));
      expect(withHistory).toHaveLength(1);
      const keys = (await readAll(store)).entries.map((entry) => entry.key);
      expect(keys.some((key) => key.startsWith("outside:"))).toBe(false);
      // The follow-up did run, on the compacted path.
      expect(appended.length).toBeGreaterThanOrEqual(4);
    });
  }
});

describe("log-mode concurrent first imports", () => {
  it("lets one of two runs that both saw no head import; the other loses the CAS and its retry continues the import", async () => {
    const store = new MemoryContextLogStore();
    // Both runs read the empty head before either prepares.
    let waiting = 0;
    let release: () => void = () => undefined;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const racing: ContextLogStore = Object.assign(Object.create(store), {
      readHead: async (stream: ContextStreamRef): Promise<ContextHead | null> => {
        const head = await store.readHead(stream);
        if (head === null && waiting < 2) {
          waiting++;
          if (waiting === 2) release();
          await bothRead;
        }
        return head;
      },
    });
    const prepared: Array<{ transition?: string; keys: string[] }> = [];
    const recording: ContextLogStore = Object.assign(Object.create(racing), {
      prepare: (request: ContextPrepareRequest) => {
        prepared.push({
          ...(request.transition ? { transition: request.transition.reason } : {}),
          keys: request.append.map((entry: ContextEntryInput) => entry.key),
        });
        return store.prepare(request);
      },
    });
    const { model, requests } = createRecordingModel();
    const agent = logAgent(model, recording);
    const runs = await Promise.allSettled([
      agent.generate({ prompt: "One", threadId: THREAD, contextHistory: legacyHistory }),
      agent.generate({ prompt: "Two", threadId: THREAD, contextHistory: legacyHistory }),
    ]);

    // Both planned the import on the same empty head; the store's CAS let
    // exactly one commit it, and the other run failed before dispatching.
    expect(prepared.filter((p) => p.transition === LEGACY_PROJECTION_IMPORT_REASON)).toHaveLength(
      2,
    );
    expect(runs.map((run) => run.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = runs.find((run) => run.status === "rejected") as PromiseRejectedResult;
    expect(isContextLogError(lost.reason, "conflict")).toBe(true);
    expect(requests).toHaveLength(1);
    const once = await readAll(store);
    expect((await store.readVersion(once.head.versionId)).reason).toBe(
      LEGACY_PROJECTION_IMPORT_REASON,
    );
    expect(
      once.entries.map((entry) => entry.key).filter((key) => key.startsWith("import:")),
    ).toEqual(["import:0", "import:1", "import:2", "import:3"]);

    // The host retries the lost run with the same history: it continues the
    // winner's import instead of importing again.
    await agent.generate({ prompt: "Two", threadId: THREAD, contextHistory: legacyHistory });
    const after = await readAll(store);
    expect(after.head.versionId).toBe(once.head.versionId);
    expect(after.entries.slice(0, once.entries.length)).toEqual(once.entries);
    expect(after.entries.slice(once.entries.length).map((entry) => entry.key)).toEqual([
      expect.stringMatching(/^user:/),
      expect.stringMatching(/^output:/),
    ]);
    expect(prepared.at(-1)?.transition).toBeUndefined();
  });
});
