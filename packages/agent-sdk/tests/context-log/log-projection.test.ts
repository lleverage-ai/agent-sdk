/**
 * Log mode builds every request as a projection of the stream's head path
 * under the version's frozen core.
 *
 * The runtime commits each call's input and outputs itself (see
 * `log-commit.test.ts`). `commitTurn` writes history the way another writer
 * would, to seed a stream before an agent runs on it.
 */

import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { jsonSchema, type LanguageModel, type ModelMessage, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { MemorySaver } from "../../src/checkpointer/memory-saver.js";
import {
  type AgentOptions,
  ConfigurationError,
  type ContextEntryInput,
  ContextLogConflictError,
  type ContextLogStore,
  type ContextStreamRef,
  type ContextTransition,
  createAgent,
  createCheckpoint,
  createGuardrailsHooks,
  createMessageProjectionAdapter,
  createRetryHooks,
  createSecretsFilterHooks,
  definePlugin,
  GeneratePermissionDeniedError,
  isContextLogError,
  MemoryContextLogStore,
  ValidationError,
} from "../../src/index.js";
import { PromptBuilder } from "../../src/prompt-builder/index.js";

const THREAD = "thread-1";
const STREAM: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };
const DEFAULT_CONTRACT = {
  adapter: "agent-sdk/messages",
  adapterVersion: "1",
  imageInput: "true",
  fileInput: "true",
};

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

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
        usage,
        warnings: [],
      };
    },
    doStream: async (options) => {
      requests.push(options);
      calls++;
      const parts: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: `A${calls}` },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ];
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
  /** The serialised input of each request: prompt plus tool definitions. */
  const inputs = () => requests.map((request) => JSON.stringify(request.prompt));
  return { model: model as LanguageModel, requests, inputs };
}

/**
 * Commit one turn the way the commit-before-dispatch boundary will: prepare
 * the input (with the stream's first transition when it has no head),
 * dispatch, append the outputs and complete the call.
 */
async function commitTurn(
  store: ContextLogStore,
  key: string,
  append: ContextEntryInput[],
  outputs: Array<Extract<ContextEntryInput, { kind: "assistant" | "tool_result" }>>,
  transition?: ContextTransition,
) {
  const head = await store.readHead(STREAM);
  const prepared = await store.prepare({
    stream: STREAM,
    expectedRevision: head?.revision ?? 0,
    idempotencyKey: key,
    ...(transition && { transition }),
    append,
    manifest: {
      projection: { adapter: "agent-sdk/messages", version: "1" },
      model: { provider: "mock-provider", modelId: "mock-model-id" },
      inputDigest: "0".repeat(64),
    },
  });
  await store.markDispatched(prepared.manifest.id);
  if (outputs.length > 0) {
    await store.appendOutputs({
      manifestId: prepared.manifest.id,
      expectedRevision: prepared.head.revision,
      items: outputs,
    });
  }
  await store.recordOutcome(prepared.manifest.id, { status: "completed" });
}

const initialTransition = (
  core: string,
  contract: Record<string, string> = DEFAULT_CONTRACT,
): ContextTransition => ({ reason: "initial", parent: null, core, contract });

const user = (key: string, content: string): ContextEntryInput => ({
  kind: "user",
  key,
  message: { role: "user", content },
});

const assistant = (key: string, text: string) =>
  ({
    kind: "assistant",
    key,
    message: { role: "assistant", content: [{ type: "text", text }] },
  }) as const;

function logAgent(
  model: LanguageModel,
  store: ContextLogStore,
  overrides: Partial<AgentOptions> = {},
) {
  return createAgent({
    model,
    systemPrompt: "You are the core.",
    contextLog: { mode: "log", store },
    ...overrides,
  });
}

describe("createAgent in context log mode", () => {
  const store = new MemoryContextLogStore();
  const model = createRecordingModel().model;

  it("accepts a static systemPrompt or a core resolver", () => {
    expect(() => logAgent(model, store)).not.toThrow();
    expect(() =>
      createAgent({ model, contextLog: { mode: "log", store, resolveCore: () => "core" } }),
    ).not.toThrow();
  });

  it.each([
    ["promptBuilder", { systemPrompt: undefined, promptBuilder: new PromptBuilder() }],
    ["a missing core", { systemPrompt: undefined }],
    [
      "both core sources",
      { contextLog: { mode: "log" as const, store, resolveCore: () => "core" } },
    ],
    [
      "two producers with one name",
      {
        contextLog: {
          mode: "log" as const,
          store,
          producers: [{ name: "p", produce: () => [] }],
        },
        plugins: [
          definePlugin({ name: "plug", contextProducers: [{ name: "p", produce: () => [] }] }),
        ],
      },
    ],
  ])("rejects %s with a configuration error", (_name, overrides) => {
    expect(() => logAgent(model, store, overrides as Partial<AgentOptions>)).toThrow(
      ConfigurationError,
    );
  });
});

describe("log-mode request projection", () => {
  it("sends the frozen core and the new user input on a stream without a head", async () => {
    const { model, requests } = createRecordingModel();
    const agent = logAgent(model, new MemoryContextLogStore());

    await agent.generate({ prompt: "hello", threadId: THREAD });

    expect(requests[0]!.prompt).toEqual([
      { role: "system", content: "You are the core." },
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("produces a request whose prefix equals the previous call's full input", async () => {
    const { model, inputs, requests } = createRecordingModel();
    const store = new MemoryContextLogStore();
    const agent = logAgent(model, store);

    await agent.generate({ prompt: "first", threadId: THREAD });
    await agent.generate({ prompt: "second", threadId: THREAD });
    await agent.generate({ prompt: "third", threadId: THREAD });

    const [first, second, third] = requests.map((request) => request.prompt);
    expect(second!.slice(0, first!.length)).toEqual(first);
    expect(third!.slice(0, second!.length)).toEqual(second);
    // Byte for byte, not just structurally.
    const [i1, i2, i3] = inputs();
    expect(i2!.startsWith(i1!.slice(0, -1))).toBe(true);
    expect(i3!.startsWith(i2!.slice(0, -1))).toBe(true);
    expect(JSON.stringify(requests[2]!.tools)).toBe(JSON.stringify(requests[0]!.tools));
    expect(third).toEqual([
      { role: "system", content: "You are the core." },
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "A1" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
      { role: "assistant", content: [{ type: "text", text: "A2" }] },
      { role: "user", content: [{ type: "text", text: "third" }] },
    ]);
  });

  it("reproduces byte-identical input from the store alone after a restart", async () => {
    const store = new MemoryContextLogStore();
    const capabilities = { modelCapabilities: { imageInput: false } };
    await commitTurn(
      store,
      "turn-1",
      [
        user("u1", "look at this"),
        { kind: "runtime_context", key: "clock:1", producer: "clock", payload: { today: "x" } },
      ],
      [
        {
          kind: "assistant",
          key: "a1",
          message: {
            role: "assistant",
            content: [
              { type: "reasoning", text: "thinking", providerOptions: { p: { signature: "s" } } },
              { type: "tool-call", toolCallId: "c1", toolName: "read", input: { path: "a.png" } },
            ],
          },
        },
        {
          kind: "tool_result",
          key: "t1",
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "c1",
                toolName: "read",
                output: {
                  type: "content",
                  value: [{ type: "image-data", data: "AAAA", mediaType: "image/png" }],
                },
              },
            ],
          },
        },
      ],
      initialTransition("Stored core", { ...DEFAULT_CONTRACT, imageInput: "false" }),
    );
    await commitTurn(
      store,
      "turn-2",
      [
        {
          kind: "runtime_context",
          key: "clock:2",
          producer: "clock",
          payload: "today is y",
          supersedes: "clock:1",
        },
      ],
      [],
    );

    const before = createRecordingModel();
    await logAgent(before.model, store, capabilities).generate({
      prompt: "and now?",
      threadId: THREAD,
    });
    // A new agent object with no checkpointer and no in-memory state.
    const after = createRecordingModel();
    await logAgent(after.model, store, capabilities).generate({
      prompt: "and then?",
      threadId: THREAD,
    });

    // The new agent's request continues the previous request byte for byte.
    expect(after.inputs()[0]!.startsWith(before.inputs()[0]!.slice(0, -1))).toBe(true);
    const prompt = JSON.stringify(after.requests[0]!.prompt);
    expect(prompt).toContain("Stored core");
    expect(prompt).not.toContain("You are the core.");
    expect(prompt).toContain("[Image omitted: active model does not support image input.]");
    expect(prompt).toContain("today is y");
    expect(prompt).not.toContain('"today":"x"');
  });

  it("projects the same input through stream() as through generate()", async () => {
    const seeded = async () => {
      const store = new MemoryContextLogStore();
      await commitTurn(
        store,
        "turn-1",
        [user("u1", "first")],
        [assistant("a1", "A1")],
        initialTransition("You are the core."),
      );
      return store;
    };
    const generated = createRecordingModel();
    await logAgent(generated.model, await seeded()).generate({ prompt: "next", threadId: THREAD });
    const streamed = createRecordingModel();
    for await (const _part of logAgent(streamed.model, await seeded()).stream({
      prompt: "next",
      threadId: THREAD,
    })) {
      // drain
    }

    expect(streamed.inputs()[0]).toBe(generated.inputs()[0]);
  });

  it("keeps the version's frozen core and only resolves a core for a new version", async () => {
    const store = new MemoryContextLogStore();
    const resolveCore = vi.fn(() => "Resolved core");
    const first = createRecordingModel();
    await createAgent({
      model: first.model,
      contextLog: { mode: "log", store, resolveCore },
    }).generate({ prompt: "hi", threadId: THREAD });

    expect(resolveCore).toHaveBeenCalledTimes(1);
    expect(resolveCore).toHaveBeenCalledWith({
      stream: STREAM,
      reason: "initial",
      parent: null,
      target: { provider: "mock-provider", modelId: "mock-model-id" },
      model: first.model,
    });
    expect(first.requests[0]!.prompt[0]).toEqual({ role: "system", content: "Resolved core" });

    resolveCore.mockReturnValue("A newer resolved core");
    const second = createRecordingModel();
    await createAgent({
      model: second.model,
      contextLog: { mode: "log", store, resolveCore },
    }).generate({ prompt: "again", threadId: THREAD });
    const third = createRecordingModel();
    await logAgent(third.model, store, { systemPrompt: "A newer static core" }).generate({
      prompt: "again",
      threadId: THREAD,
    });

    expect(resolveCore).toHaveBeenCalledTimes(1);
    expect(second.requests[0]!.prompt[0]).toEqual({ role: "system", content: "Resolved core" });
    expect(third.requests[0]!.prompt[0]).toEqual({ role: "system", content: "Resolved core" });
    expect(third.inputs()[0]!.startsWith(second.inputs()[0]!.slice(0, -1))).toBe(true);
  });

  it("refuses to project a version created under a different adapter", async () => {
    const store = new MemoryContextLogStore();
    await commitTurn(
      store,
      "turn-1",
      [user("u1", "hi")],
      [],
      initialTransition("core", { ...DEFAULT_CONTRACT, adapterVersion: "0" }),
    );
    const { model, requests } = createRecordingModel();
    const agent = logAgent(model, store);

    const error = await agent.generate({ prompt: "next", threadId: THREAD }).catch((e) => e);

    expect(error).toBeInstanceOf(ContextLogConflictError);
    expect(isContextLogError(error, "conflict") && error.reason).toBe("transition_required");
    expect(requests).toHaveLength(0);
  });

  it("declares a model_change for a model with different input capabilities", async () => {
    const store = new MemoryContextLogStore();
    await commitTurn(
      store,
      "turn-1",
      [user("u1", "hi")],
      [assistant("a1", "A1")],
      initialTransition("core"),
    );
    const before = await store.readHead(STREAM);
    const { model, requests } = createRecordingModel();
    const agent = logAgent(model, store, { modelCapabilities: { imageInput: false } });

    await agent.generate({ prompt: "next", threadId: THREAD });

    const head = await store.readHead(STREAM);
    const version = await store.readVersion(head!.versionId);
    expect(version).toMatchObject({
      reason: "model_change",
      parentVersionId: before!.versionId,
      inheritedCount: before!.entryCount,
      core: "core",
      contract: { ...DEFAULT_CONTRACT, imageInput: "false" },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.prompt.slice(0, 3)).toEqual([
      { role: "system", content: "core" },
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "A1" }] },
    ]);
  });

  it("projects through a configured adapter with the version's core and contract", async () => {
    const store = new MemoryContextLogStore();
    const project = vi.fn(() => ({
      messages: [{ role: "user", content: "custom" }] as ModelMessage[],
    }));
    const adapter = { id: "host/adapter", version: "7", project };
    const { model, requests } = createRecordingModel();

    await logAgent(model, store, {
      contextLog: { mode: "log", store, projection: adapter },
    }).generate({ prompt: "hi", threadId: THREAD });

    expect(project).toHaveBeenCalledWith({
      core: "You are the core.",
      contract: {
        ...DEFAULT_CONTRACT,
        adapter: "host/adapter",
        adapterVersion: "7",
        userMedia: "placeholder",
      },
      entries: [
        {
          kind: "user",
          key: expect.stringMatching(/^user:/),
          message: { role: "user", content: "hi" },
        },
      ],
      target: { provider: "mock-provider", modelId: "mock-model-id" },
    });
    expect(requests[0]!.prompt).toEqual([
      { role: "user", content: [{ type: "text", text: "custom" }] },
    ]);
  });
});

describe("log-mode input", () => {
  it("rejects caller-supplied history and a missing threadId before calling the model", async () => {
    const { model, requests } = createRecordingModel();
    const agent = logAgent(model, new MemoryContextLogStore());

    await expect(
      agent.generate({ messages: [{ role: "user", content: "old" }], threadId: THREAD }),
    ).rejects.toThrow(ValidationError);
    await expect(
      agent.generate({
        prompt: "hi",
        threadId: THREAD,
        _historyUnlessCheckpointed: [{ role: "user", content: "old" }],
      }),
    ).rejects.toThrow(ValidationError);
    await expect(agent.generate({ prompt: "hi" })).rejects.toThrow(ValidationError);
    expect(requests).toHaveLength(0);
  });

  it("passes new user input through the secrets filter before it is sent", async () => {
    const { model, inputs } = createRecordingModel();
    const [inputFilter] = createSecretsFilterHooks();
    const agent = logAgent(model, new MemoryContextLogStore(), {
      hooks: { PreGenerate: [inputFilter] },
    });

    await agent.generate({ prompt: "my key is AKIAIOSFODNN7EXAMPLE", threadId: THREAD });

    expect(inputs()[0]).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(inputs()[0]).toContain("[REDACTED]");
  });

  it("lets guardrails deny new user input", async () => {
    const { model, requests } = createRecordingModel();
    const [inputFilter] = createGuardrailsHooks({ blockedInputPatterns: [/forbidden/] });
    const agent = logAgent(model, new MemoryContextLogStore(), {
      hooks: { PreGenerate: [inputFilter] },
    });

    await expect(agent.generate({ prompt: "a forbidden ask", threadId: THREAD })).rejects.toThrow(
      GeneratePermissionDeniedError,
    );
    expect(requests).toHaveLength(0);
  });

  it("rejects a PreGenerate hook that injects non-user messages", async () => {
    const { model, requests } = createRecordingModel();
    const agent = logAgent(model, new MemoryContextLogStore(), {
      hooks: {
        PreGenerate: [
          async (input) => ({
            hookSpecificOutput: {
              hookEventName: "PreGenerate",
              updatedInput: {
                ...(input as { options: object }).options,
                messages: [{ role: "assistant", content: "rewritten history" }],
              },
            },
          }),
        ],
      },
    });

    const error = await agent.generate({ prompt: "hi", threadId: THREAD }).catch((e) => e);

    expect(isContextLogError(error, "invalid") && error.reason).toBe("log_mode_hook_violation");
    expect(requests).toHaveLength(0);
  });
});

describe("log-mode checkpoints", () => {
  it("store control state and the log cursor, never messages", async () => {
    const store = new MemoryContextLogStore();
    await commitTurn(
      store,
      "turn-1",
      [user("u1", "hi")],
      [assistant("a1", "A1")],
      initialTransition("core"),
    );
    const checkpointer = new MemorySaver();
    const { model } = createRecordingModel();

    await logAgent(model, store, { checkpointer }).generate({ prompt: "next", threadId: THREAD });

    // The cursor is the head after this run's own commits.
    const head = await store.readHead(STREAM);
    const saved = await checkpointer.load(THREAD);
    expect(saved?.messages).toEqual([]);
    expect(saved?.step).toBe(1);
    expect(saved?.metadata?.contextLog).toEqual({
      branchId: "main",
      streamId: "main",
      versionId: head!.versionId,
      entryCount: head!.entryCount,
      revision: head!.revision,
      pathDigest: head!.pathDigest,
    });
  });

  it("never restores history from a checkpoint", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    await checkpointer.save(
      createCheckpoint({
        threadId: THREAD,
        step: 3,
        messages: [{ role: "user", content: "legacy history" }],
        state: { todos: [], files: {} },
      }),
    );
    const loadedMessages: unknown[] = [];
    const { model, inputs } = createRecordingModel();
    const agent = logAgent(model, store, {
      checkpointer,
      hooks: {
        PostCheckpointLoad: [
          async (input) => {
            loadedMessages.push((input as { messages: unknown }).messages);
            return {};
          },
        ],
      },
    });

    await agent.generate({ prompt: "hi", threadId: THREAD });

    expect(inputs()[0]).not.toContain("legacy history");
    expect(loadedMessages).toEqual([[]]);
    expect((await checkpointer.load(THREAD))?.step).toBe(4);
  });

  it("reloads the head after invalidateCheckpoint() without substituting history", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const { model, requests } = createRecordingModel();
    const agent = logAgent(model, store, { checkpointer });

    await agent.generate({ prompt: "first", threadId: THREAD });
    // Another writer extends the log behind this agent.
    await commitTurn(store, "turn-1", [user("u1", "elsewhere")], [assistant("a1", "B1")]);
    agent.invalidateCheckpoint(THREAD);
    await agent.generate({ prompt: "second", threadId: THREAD });

    expect(requests[1]!.prompt).toEqual([
      { role: "system", content: "You are the core." },
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "A1" }] },
      { role: "user", content: [{ type: "text", text: "elsewhere" }] },
      { role: "assistant", content: [{ type: "text", text: "B1" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ]);
  });
});

describe("createMessageProjectionAdapter", () => {
  const adapter = createMessageProjectionAdapter();
  const target = { provider: "p", modelId: "m" };

  it("omits an empty core and renders runtime context deterministically", async () => {
    const result = await adapter.project({
      core: "",
      contract: DEFAULT_CONTRACT,
      entries: [
        { kind: "runtime_context", key: "a", producer: "p", payload: { b: 1, a: [2] } },
        { kind: "runtime_context", key: "b", producer: "p", payload: "text" },
        {
          kind: "runtime_context",
          key: "c",
          producer: "p",
          payload: null,
          supersedes: "b",
          retraction: true,
        },
      ],
      target,
    });

    expect(result.messages).toEqual([
      { role: "user", content: [{ type: "text", text: '{"a":[2],"b":1}' }] },
    ]);
  });

  it("downgrades tool-result media only when the contract says so", async () => {
    const entries: ContextEntryInput[] = [
      {
        kind: "tool_result",
        key: "t",
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "c",
              toolName: "read",
              output: {
                type: "content",
                value: [{ type: "file-data", data: "AAAA", mediaType: "application/pdf" }],
              },
            },
          ],
        },
      },
    ];
    const keep = await adapter.project({ core: "c", contract: DEFAULT_CONTRACT, entries, target });
    const omit = await adapter.project({
      core: "c",
      contract: { ...DEFAULT_CONTRACT, fileInput: "false" },
      entries,
      target,
    });

    expect(JSON.stringify(keep.messages)).toContain("application/pdf");
    expect(JSON.stringify(omit.messages)).toContain("[File omitted");
  });
});

/**
 * A model that calls `pic` on its first request and answers on the next, and
 * records every request.
 */
function createToolLoopModel(options: { failFirst?: boolean } = {}) {
  const requests: LanguageModelV3CallOptions[] = [];
  let failNext = options.failFirst ?? false;
  const firstStep = () => requests.length === 1;
  const model = new MockLanguageModelV3({
    doGenerate: async (call) => {
      requests.push(call);
      if (failNext) {
        failNext = false;
        throw new Error("rate limit exceeded");
      }
      return {
        content: firstStep()
          ? [{ type: "tool-call", toolCallId: "c1", toolName: "pic", input: "{}" }]
          : [{ type: "text", text: "done" }],
        finishReason: firstStep()
          ? { unified: "tool-calls", raw: "tool_calls" }
          : { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
    doStream: async (call) => {
      requests.push(call);
      const first = firstStep();
      const parts: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: [] },
        ...(first
          ? [
              {
                type: "tool-call" as const,
                toolCallId: "c1",
                toolName: "pic",
                input: "{}",
              },
            ]
          : [
              { type: "text-start" as const, id: "t" },
              { type: "text-delta" as const, id: "t", delta: "done" },
              { type: "text-end" as const, id: "t" },
            ]),
        {
          type: "finish",
          finishReason: first
            ? { unified: "tool-calls", raw: "tool_calls" }
            : { unified: "stop", raw: "stop" },
          usage,
        },
      ];
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

/** A tool whose model output is an image. */
const picTools = {
  pic: tool({
    description: "Returns a picture",
    inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
    execute: async () => "raw-tool-output",
    toModelOutput: () => ({
      type: "content" as const,
      value: [{ type: "image-data" as const, data: "AAAA", mediaType: "image/png" }],
    }),
  }),
};

describe("log-mode tool loops", () => {
  const runModes = {
    generate: (agent: ReturnType<typeof createAgent>) =>
      agent.generate({ prompt: "draw", threadId: THREAD }),
    stream: async (agent: ReturnType<typeof createAgent>) => {
      for await (const _part of agent.stream({ prompt: "draw", threadId: THREAD })) {
        // drain
      }
    },
    streamRaw: async (agent: ReturnType<typeof createAgent>) => {
      const result = await agent.streamRaw({ prompt: "draw", threadId: THREAD });
      await result.consumeStream();
      await result.text;
    },
  };

  it.each(Object.keys(runModes) as Array<keyof typeof runModes>)(
    "projects tool-loop continuations under the contract in %s()",
    async (mode) => {
      const { model, requests } = createToolLoopModel();
      const agent = logAgent(model, new MemoryContextLogStore(), {
        tools: picTools,
        modelCapabilities: { imageInput: false },
      });

      await runModes[mode](agent);

      expect(requests).toHaveLength(2);
      const [first, second] = requests.map((request) => request.prompt);
      expect(second!.slice(0, first!.length)).toEqual(first);
      const continuation = JSON.stringify(second);
      expect(continuation).toContain("[Image omitted: active model does not support image input.]");
      expect(continuation).not.toContain("AAAA");
    },
  );

  it.each(Object.keys(runModes) as Array<keyof typeof runModes>)(
    "sends tool results shaped only by the adapter in %s()",
    async (mode) => {
      const base = createMessageProjectionAdapter();
      const adapter = {
        id: "host/shaping",
        version: "1",
        project: async (input: Parameters<typeof base.project>[0]) => {
          const { messages } = await base.project(input);
          return {
            messages: messages.map((message) =>
              message.role === "tool"
                ? {
                    ...message,
                    content: message.content.map((part) =>
                      part.type === "tool-result"
                        ? { ...part, output: { type: "text" as const, value: "shaped by adapter" } }
                        : part,
                    ),
                  }
                : message,
            ),
          };
        },
      };
      const store = new MemoryContextLogStore();
      const { model, requests } = createToolLoopModel();
      const agent = logAgent(model, store, {
        tools: picTools,
        contextLog: { mode: "log", store, projection: adapter },
      });

      await runModes[mode](agent);

      const continuation = JSON.stringify(requests[1]!.prompt);
      expect(continuation).toContain("shaped by adapter");
      expect(continuation).not.toContain("AAAA");
    },
  );
});

describe("log-mode projection input", () => {
  it("gives an adapter the same entry bytes before and after commit", async () => {
    const seen: string[] = [];
    const adapter = {
      id: "host/enumerating",
      version: "1",
      project: ({ entries }: { entries: readonly ContextEntryInput[] }) => {
        seen.push(JSON.stringify(entries));
        return { messages: [{ role: "user", content: "x" }] as ModelMessage[] };
      },
    };
    const store = new MemoryContextLogStore();
    const { model } = createRecordingModel();
    const agent = logAgent(model, store, {
      contextLog: { mode: "log", store, projection: adapter },
    });

    await agent.generate({ prompt: "first", threadId: THREAD });
    await agent.generate({ threadId: THREAD });

    // The second call's entries are the first call's, committed, followed by
    // the committed output: the same bytes before and after commit.
    const first = JSON.parse(seen[0]!) as ContextEntryInput[];
    const second = JSON.parse(seen[1]!) as ContextEntryInput[];
    expect(JSON.stringify(second.slice(0, first.length))).toBe(seen[0]);
    expect(second.slice(first.length).map((entry) => entry.kind)).toEqual(["assistant"]);
  });
});

describe("log-mode retries", () => {
  it("resends the same projected input after a retried failure", async () => {
    const { model, requests } = createToolLoopModel({ failFirst: true });
    const agent = logAgent(model, new MemoryContextLogStore(), {
      hooks: {
        PostGenerateFailure: [createRetryHooks({ maxRetries: 2, baseDelay: 1, jitter: false })],
      },
    });

    await agent.generate({ prompt: "draw", threadId: THREAD });

    expect(JSON.stringify(requests[1]!.prompt)).toBe(JSON.stringify(requests[0]!.prompt));
  });

  it("refuses a retry hook that changes the input instead of dropping it", async () => {
    const { model, requests } = createToolLoopModel({ failFirst: true });
    const agent = logAgent(model, new MemoryContextLogStore(), {
      hooks: {
        PostGenerateFailure: [
          async (input) => ({
            hookSpecificOutput: {
              hookEventName: "PostGenerateFailure",
              retry: true,
              retryDelayMs: 0,
              updatedInput: { ...(input as { options: object }).options, prompt: "changed" },
            },
          }),
        ],
      },
    });

    await expect(agent.generate({ prompt: "draw", threadId: THREAD })).rejects.toMatchObject({
      kind: "invalid",
      reason: "log_mode_hook_violation",
    });
    expect(requests).toHaveLength(1);
  });

  it("refuses a retry hook that changes the input in place", async () => {
    const { model, requests } = createToolLoopModel({ failFirst: true });
    const agent = logAgent(model, new MemoryContextLogStore(), {
      hooks: {
        PostGenerateFailure: [
          async (input) => {
            const options = (input as { options: { messages: ModelMessage[] } }).options;
            options.messages[0] = { role: "user", content: "mutated in place" };
            return {
              hookSpecificOutput: {
                hookEventName: "PostGenerateFailure",
                retry: true,
                retryDelayMs: 0,
              },
            };
          },
        ],
      },
    });

    await expect(agent.generate({ prompt: "draw", threadId: THREAD })).rejects.toMatchObject({
      kind: "invalid",
      reason: "log_mode_hook_violation",
    });
    expect(requests).toHaveLength(1);
  });

  it("refuses a retry hook that changes provider options in place", async () => {
    const { model, requests } = createToolLoopModel({ failFirst: true });
    const providerOptions = { openai: { instructions: "original" } };
    const agent = logAgent(model, new MemoryContextLogStore(), {
      hooks: {
        PostGenerateFailure: [
          async (input) => {
            const options = (input as { options: { providerOptions: typeof providerOptions } })
              .options;
            options.providerOptions.openai.instructions = "injected";
            return {
              hookSpecificOutput: {
                hookEventName: "PostGenerateFailure",
                retry: true,
                retryDelayMs: 0,
                updatedInput: { ...options },
              },
            };
          },
        ],
      },
    });

    await expect(
      agent.generate({ prompt: "draw", threadId: THREAD, providerOptions }),
    ).rejects.toMatchObject({ kind: "invalid", reason: "log_mode_hook_violation" });
    expect(requests).toHaveLength(1);
    expect(providerOptions.openai.instructions).toBe("original");
  });

  it("accepts a retry hook that passes the options through unchanged", async () => {
    const { model, requests } = createToolLoopModel({ failFirst: true });
    const agent = logAgent(model, new MemoryContextLogStore(), {
      hooks: {
        PostGenerateFailure: [
          async (input) => ({
            hookSpecificOutput: {
              hookEventName: "PostGenerateFailure",
              retry: true,
              retryDelayMs: 0,
              updatedInput: { ...(input as { options: object }).options, maxTokens: 50 },
            },
          }),
        ],
      },
    });

    await agent.generate({ prompt: "draw", threadId: THREAD });

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.prompt)).toBe(JSON.stringify(requests[0]!.prompt));
  });
});
