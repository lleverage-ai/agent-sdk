/**
 * Log mode records compaction as a declared `compaction` transition that the
 * call's prepare commits before the compacted context is first sent.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { jsonSchema, type LanguageModel, type ModelMessage, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { createLogCompactor } from "../../src/agent/log-compaction.js";
import {
  type Agent,
  type AgentOptions,
  type ContextEntry,
  type ContextEntryInput,
  type ContextHead,
  ContextLogInvalidError,
  type ContextLogStore,
  ContextLogUnavailableError,
  type ContextManager,
  type ContextPrepareRequest,
  type ContextPrepareResult,
  type ContextProducer,
  type ContextStreamRef,
  createAgent,
  createContextManager,
  createSecretsFilterHooks,
  isContextLogError,
  MemoryContextLogStore,
  type SummaryRequest,
} from "../../src/index.js";

const THREAD = "thread-1";
const STREAM: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const text = (value: string): LanguageModelV3Content[] => [{ type: "text", text: value }];

/** A reasoning part with a provider signature, then a call to `echo`. */
const thinkThenEcho = (id: string): LanguageModelV3Content[] => [
  {
    type: "reasoning",
    text: `thinking about ${id}`,
    providerMetadata: { anthropic: { signature: `sig-${id}` } },
  },
  { type: "tool-call", toolCallId: id, toolName: "echo", input: JSON.stringify({ value: id }) },
];

/** A model that answers each call with the next scripted reply, recording every request. */
function createScriptedModel(replies: LanguageModelV3Content[][]) {
  const requests: LanguageModelV3CallOptions[] = [];
  const respond = (request: LanguageModelV3CallOptions) => {
    requests.push(request);
    return replies[Math.min(requests.length - 1, replies.length - 1)]!;
  };
  const finishFor = (content: LanguageModelV3Content[]) =>
    content.some((part) => part.type === "tool-call")
      ? { unified: "tool-calls" as const, raw: "tool_calls" }
      : { unified: "stop" as const, raw: "stop" };
  const model = new MockLanguageModelV3({
    doGenerate: async (request) => {
      const content = respond(request);
      return { content, finishReason: finishFor(content), usage, warnings: [] };
    },
    doStream: async (request) => {
      const content = respond(request);
      const parts: LanguageModelV3StreamPart[] = [{ type: "stream-start", warnings: [] }];
      for (const part of content) {
        if (part.type === "text") {
          parts.push(
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: part.text },
            { type: "text-end", id: "t" },
          );
        } else if (part.type === "reasoning") {
          parts.push(
            { type: "reasoning-start", id: "r", providerMetadata: part.providerMetadata },
            { type: "reasoning-delta", id: "r", delta: part.text },
            { type: "reasoning-end", id: "r", providerMetadata: part.providerMetadata },
          );
        } else {
          parts.push(part as LanguageModelV3StreamPart);
        }
      }
      parts.push({ type: "finish", finishReason: finishFor(content), usage });
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

const echoTools = {
  echo: tool({
    description: "Echoes its input",
    inputSchema: jsonSchema<{ value: string }>({
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    }),
    execute: async ({ value }) => `echo:${value}`,
  }),
};

/** A producer whose single, unchanging entry leads the path. */
const settings: ContextProducer = {
  name: "settings",
  produce: () => [
    { kind: "runtime_context", key: "settings:v1", producer: "settings", payload: { tz: "UTC" } },
  ],
};

/**
 * A context manager that compacts once the compaction view has more than
 * `maxMessages` messages, with a recording summarizer.
 */
function createCompactingManager(
  maxMessages: number,
  overrides: {
    keepMessageCount?: number;
    summary?: string;
    commitCompaction?: () => void;
  } = {},
) {
  const requests: SummaryRequest[] = [];
  const contextManager = createContextManager({
    maxTokens: 1_000_000,
    policy: {
      shouldCompact: (_budget, messages) =>
        messages.length > maxMessages
          ? { trigger: true, reason: "token_threshold" }
          : { trigger: false },
    },
    summarization: { keepMessageCount: overrides.keepMessageCount ?? 2, keepToolResultCount: 0 },
    summarizer: async (request) => {
      requests.push(request);
      return { text: overrides.summary ?? `summary ${requests.length}` };
    },
    ...(overrides.commitCompaction && { commitCompaction: overrides.commitCompaction }),
  });
  return { contextManager, requests };
}

function logAgent(
  model: LanguageModel,
  store: ContextLogStore,
  overrides: Partial<AgentOptions> = {},
) {
  return createAgent({
    model,
    systemPrompt: "You are the core.",
    contextLog: { mode: "log", store, producers: [settings] },
    ...overrides,
  });
}

async function readPath(store: ContextLogStore): Promise<ContextEntry[]> {
  const head = await store.readHead(STREAM);
  if (!head) return [];
  return (await store.readPath(head, { limit: 1000 })).entries;
}

/** Content of committed entries, without store-assigned fields. */
const content = (entries: readonly ContextEntry[]): ContextEntryInput[] =>
  entries.map(({ position: _p, versionId: _v, manifestId: _m, createdAt: _c, ...entry }) => entry);

/** A store whose prepare fails, uncertainly, for every compaction transition. */
class CompactionFailingStore extends MemoryContextLogStore {
  attempts = 0;
  override async prepare(request: ContextPrepareRequest): Promise<ContextPrepareResult> {
    if (request.transition?.reason === "compaction") {
      this.attempts += 1;
      throw new ContextLogUnavailableError("injected");
    }
    return super.prepare(request);
  }
}

describe("log-mode compaction", () => {
  it("commits a compaction child before sending it, and later calls reuse it", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([
      text("a1"),
      text("a2"),
      text("a3"),
      text("a4"),
      text("a5"),
      text("a6"),
      text("a7"),
    ]);
    const commitCompaction = vi.fn();
    const manager = createCompactingManager(10, { commitCompaction });
    const agent = logAgent(model, store, { contextManager: manager.contextManager });

    for (const prompt of ["q1", "q2", "q3", "q4"]) {
      await agent.generate({ prompt, threadId: THREAD });
    }
    expect(manager.requests).toHaveLength(0);
    const before = await store.readHead(STREAM);
    const parentPath = await readPath(store);

    // The fifth call's view has 11 messages: the core, the settings and nine
    // conversation messages. It compacts and keeps the last two.
    await agent.generate({ prompt: "q5", threadId: THREAD });

    expect(manager.requests).toHaveLength(1);
    const [summaryRequest] = manager.requests;
    const { runId, sourceDigest } = summaryRequest!.contextLog!;
    expect(summaryRequest!.contextLog!.stream).toEqual(STREAM);
    expect(summaryRequest!.contextLog!.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(summaryRequest!.contextLog!.summaryStream).toEqual({
      threadId: THREAD,
      branchId: "main",
      streamId: `${runId}/summary/${sourceDigest}`,
    });
    // The summariser saw the history, never the runtime context.
    const summarised = JSON.stringify(summaryRequest!.messages);
    expect(summarised).toContain("q1");
    expect(summarised).not.toContain("UTC");
    // The log write replaces the legacy durable write.
    expect(commitCompaction).not.toHaveBeenCalled();

    const head = await store.readHead(STREAM);
    const version = await store.readVersion(head!.versionId);
    expect(version).toMatchObject({
      reason: "compaction",
      parentVersionId: before!.versionId,
      // The path starts with the first prompt, so there is no runtime prefix.
      inheritedCount: 0,
      core: "You are the core.",
    });
    // The compacted context was committed by the call that first sent it.
    const compactingCall = await store.readManifest(version.createdByManifestId);
    expect(compactingCall.dispatchedAt).not.toBeNull();
    expect(compactingCall.outcome?.status).toBe("completed");
    expect(requests).toHaveLength(5);

    const childPath = await readPath(store);
    expect(childPath.map((entry) => entry.kind)).toEqual([
      "assistant",
      "runtime_context",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(childPath[0]!.kind === "assistant" && childPath[0]!.message.content).toBe(
      "[Previous conversation summary]\n\nsummary 1",
    );
    // The runtime context and the retained reply are re-appended unchanged.
    expect(content(childPath.slice(1, 3))).toEqual(content([parentPath[1]!, parentPath.at(-1)!]));
    expect(requests[4]!.prompt.map((message) => message.role)).toEqual([
      "system",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);

    // The next two calls append to the child without summarising again.
    await agent.generate({ prompt: "q6", threadId: THREAD });
    await agent.generate({ prompt: "q7", threadId: THREAD });
    expect(manager.requests).toHaveLength(1);
    const after = await store.readHead(STREAM);
    expect(after!.versionId).toBe(head!.versionId);
    expect(after!.entryCount).toBe(head!.entryCount + 4);
    expect(requests[6]!.prompt.slice(0, 5)).toEqual(requests[4]!.prompt);
  });

  it.each(["generate", "stream"] as const)(
    "fails the %s run when the compaction commit fails, before anything is sent",
    async (mode) => {
      const store = new CompactionFailingStore();
      const { model, requests } = createScriptedModel([text("a1"), text("a2"), text("a3")]);
      const commitCompaction = vi.fn();
      const manager = createCompactingManager(4, { commitCompaction });
      const agent = logAgent(model, store, { contextManager: manager.contextManager });

      await agent.generate({ prompt: "q1", threadId: THREAD });
      const before = await store.readHead(STREAM);

      const run =
        mode === "generate"
          ? agent.generate({ prompt: "q2", threadId: THREAD })
          : (async () => {
              for await (const _part of agent.stream({ prompt: "q2", threadId: THREAD })) {
                // drain
              }
            })();
      const error = await run.then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toBeDefined();
      if (mode === "generate") {
        const cause = (error as { cause?: unknown }).cause;
        expect(
          isContextLogError(error, "unavailable") || isContextLogError(cause, "unavailable"),
        ).toBe(true);
      }

      // The summary was generated, but the compacted context was never sent
      // and the log is unchanged.
      expect(manager.requests).toHaveLength(1);
      expect(store.attempts).toBeGreaterThan(0);
      expect(requests).toHaveLength(1);
      expect(await store.readHead(STREAM)).toEqual(before);
      expect(commitCompaction).not.toHaveBeenCalled();
    },
  );

  it.each(["generate", "stream"] as const)(
    "compacts between %s tool-loop steps and keeps the tail's order, reasoning and tool pairs",
    async (mode) => {
      const store = new MemoryContextLogStore();
      const { model, requests } = createScriptedModel([
        text("a1"),
        thinkThenEcho("c1"),
        thinkThenEcho("c2"),
        text("done"),
      ]);
      // Step 3's view (core, settings, q1, a1, q2, two calls and two results)
      // has nine messages; keeping the last three keeps both call blocks.
      const manager = createCompactingManager(8, { keepMessageCount: 3 });
      const agent = logAgent(model, store, {
        contextManager: manager.contextManager,
        tools: echoTools,
      });

      await agent.generate({ prompt: "q1", threadId: THREAD });
      const first = await store.readHead(STREAM);
      if (mode === "generate") {
        const result = await agent.generate({ prompt: "q2", threadId: THREAD });
        expect(result.status).toBe("complete");
      } else {
        for await (const _part of agent.stream({ prompt: "q2", threadId: THREAD })) {
          // drain
        }
      }
      expect(manager.requests).toHaveLength(1);

      const head = await store.readHead(STREAM);
      const version = await store.readVersion(head!.versionId);
      expect(version).toMatchObject({ reason: "compaction", inheritedCount: 0 });
      // The compaction is a child of the version the tool loop wrote to.
      expect(version.parentVersionId).toBe(first!.versionId);

      const path = await readPath(store);
      const parent = (
        await store.readPath({ stream: STREAM, versionId: first!.versionId, entryCount: 8 })
      ).entries;
      expect(path.map((entry) => entry.kind)).toEqual([
        "assistant",
        "runtime_context",
        "assistant",
        "tool_result",
        "assistant",
        "tool_result",
        "assistant",
      ]);
      // Both call blocks are re-appended exactly as committed, in order.
      expect(content(path.slice(2, 6))).toEqual(content(parent.slice(4, 8)));
      const firstCall = path[2]!;
      expect(firstCall.kind === "assistant" && firstCall.message.content).toEqual([
        expect.objectContaining({
          type: "reasoning",
          text: "thinking about c1",
          providerOptions: { anthropic: { signature: "sig-c1" } },
        }),
        expect.objectContaining({ type: "tool-call", toolCallId: "c1" }),
      ]);

      // The step after the compaction was sent the child's projection.
      const lastRequest = requests.at(-1)!;
      expect(lastRequest.prompt.map((message) => message.role)).toEqual([
        "system",
        "assistant",
        "user",
        "assistant",
        "tool",
        "assistant",
        "tool",
      ]);
      expect(JSON.stringify(lastRequest.prompt)).toContain("sig-c1");
      expect(JSON.stringify(lastRequest.prompt)).not.toContain("q1");
    },
  );

  it("screens the summary before it is committed", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createScriptedModel([text("a1"), text("a2")]);
    const manager = createCompactingManager(4, { summary: "The key is AKIAIOSFODNN7EXAMPLE" });
    const [inputFilter] = createSecretsFilterHooks();
    const agent = logAgent(model, store, {
      contextManager: manager.contextManager,
      hooks: { PreGenerate: [inputFilter!] },
    });

    await agent.generate({ prompt: "q1", threadId: THREAD });
    await agent.generate({ prompt: "q2", threadId: THREAD });

    const path = await readPath(store);
    expect(JSON.stringify(path)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(path.some((entry) => entry.key.includes(":summary:"))).toBe(true);
  });

  it("needs a summarizer, because a log-mode agent cannot summarise on the compacted stream", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([text("a1"), text("a2")]);
    const contextManager = createContextManager({
      maxTokens: 1_000_000,
      policy: {
        shouldCompact: (_budget, messages) =>
          messages.length > 4 ? { trigger: true, reason: "token_threshold" } : { trigger: false },
      },
      summarization: { keepMessageCount: 1 },
    });
    const agent = logAgent(model, store, { contextManager });

    await agent.generate({ prompt: "q1", threadId: THREAD });
    await expect(agent.generate({ prompt: "q2", threadId: THREAD })).rejects.toThrow(
      /needs a summarizer/,
    );
    expect(requests).toHaveLength(1);
  });

  it("refuses a compaction that splits a tool call from its result", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([thinkThenEcho("c1"), text("a1"), text("a2")]);
    const real = createCompactingManager(Number.POSITIVE_INFINITY).contextManager;
    // Keeps the tool result and drops its call.
    const splitting: ContextManager = {
      ...real,
      shouldCompact: (messages) =>
        messages.length > 5 ? { trigger: true, reason: "token_threshold" } : { trigger: false },
      compact: async (messages, _agent, trigger = "token_threshold") => {
        const kept = messages.filter(
          (message: ModelMessage) => message.role === "system" || message.role === "tool",
        );
        const summary: ModelMessage = { role: "assistant", content: "summary" };
        return {
          messagesBefore: messages.length,
          messagesAfter: kept.length + 1,
          tokensBefore: 0,
          tokensAfter: 0,
          summary: "summary",
          compactedMessages: [],
          newMessages: [
            ...kept.filter((m) => m.role === "system"),
            summary,
            ...kept.filter((m) => m.role === "tool"),
          ],
          trigger,
        };
      },
    };
    const agent = logAgent(model, store, { contextManager: splitting, tools: echoTools });

    await agent.generate({ prompt: "q1", threadId: THREAD });
    const before = await store.readHead(STREAM);
    const error = await agent.generate({ prompt: "q2", threadId: THREAD }).catch((e) => e);
    expect(
      error instanceof ContextLogInvalidError ||
        (error as { cause?: unknown }).cause instanceof ContextLogInvalidError,
    ).toBe(true);
    expect(requests).toHaveLength(2);
    expect(await store.readHead(STREAM)).toEqual(before);
  });
});

describe("log-mode compaction planning", () => {
  const head: ContextHead = {
    stream: STREAM,
    versionId: "v1",
    entryCount: 8,
    pathDigest: "d",
    revision: 4,
    lastManifestId: "m4",
  };
  const settingsEntry: ContextEntryInput = {
    kind: "runtime_context",
    key: "settings",
    producer: "settings",
    payload: { tz: "UTC" },
  };
  const path: ContextEntryInput[] = [
    settingsEntry,
    { kind: "runtime_context", key: "notes:1", producer: "notes", payload: "old notes" },
    { kind: "user", key: "u1", message: { role: "user", content: "q1" } },
    { kind: "assistant", key: "a1", message: { role: "assistant", content: "a1" } },
    {
      kind: "runtime_context",
      key: "notes:2",
      producer: "notes",
      payload: "new notes",
      supersedes: "notes:1",
    },
    { kind: "user", key: "u2", message: { role: "user", content: "q2" } },
    {
      kind: "assistant",
      key: "a2",
      message: {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "hmm",
            providerOptions: { anthropic: { signature: "sig" } },
          },
          { type: "text", text: "a2" },
        ],
      },
    },
  ];
  const pending: ContextEntryInput[] = [
    { kind: "user", key: "u3", message: { role: "user", content: "q3" } },
  ];

  it("inherits the leading runtime prefix and re-appends the kept tail in path order", async () => {
    const { contextManager, requests } = createCompactingManager(0);
    const compactor = createLogCompactor(async (messages, _options, _threadId, compactOptions) => {
      const result = await contextManager.compact(
        messages,
        {} as Agent,
        "token_threshold",
        compactOptions,
      );
      return { compacted: true, messages: result.newMessages };
    });
    const screen = vi.fn(async (entries: ContextEntryInput[]) => entries);

    const compaction = await compactor({
      stream: STREAM,
      head,
      core: "core",
      contract: { adapter: "a" },
      path,
      pending,
      keyPrefix: "compaction:run:4",
      options: { _runId: "run-1" },
      screen,
    });

    // "notes:1" is superseded, so the prefix ends before it.
    expect(compaction!.transition).toEqual({
      reason: "compaction",
      parent: { versionId: "v1", inheritedCount: 1 },
      core: "core",
      contract: { adapter: "a" },
    });
    const summary: ContextEntryInput = {
      kind: "assistant",
      key: "compaction:run:4:summary:0",
      message: { role: "assistant", content: "[Previous conversation summary]\n\nsummary 1" },
    };
    // The current notes are kept verbatim; the superseded ones and the old
    // turns are summarised. "notes:2" no longer has its target on the
    // child's path, so it becomes the slot's first value.
    const { supersedes: _target, ...currentNotes } = path[4] as Extract<
      ContextEntryInput,
      { kind: "runtime_context" }
    >;
    expect(compaction!.append).toEqual([summary, currentNotes, path[6], pending[0]]);
    expect(compaction!.entries).toEqual([settingsEntry, ...compaction!.append]);
    expect(screen).toHaveBeenCalledWith([summary]);

    const [request] = requests;
    expect(request!.contextLog).toMatchObject({ runId: "run-1", stream: STREAM });
    expect(request!.contextLog!.summaryStream.streamId).toBe(
      `run-1/summary/${request!.contextLog!.sourceDigest}`,
    );
    const summarised = JSON.stringify(request!.messages);
    expect(summarised).toContain("q1");
    expect(summarised).not.toContain("notes");
  });

  it("drops a new retraction whose target was summarised", async () => {
    const { contextManager } = createCompactingManager(0, { keepMessageCount: 1 });
    const compactor = createLogCompactor(async (messages, _options, _threadId, compactOptions) => ({
      compacted: true,
      messages: (
        await contextManager.compact(messages, {} as Agent, "token_threshold", compactOptions)
      ).newMessages,
    }));
    const conversation = path.filter((entry) => entry.kind !== "runtime_context");
    const withNote: ContextEntryInput[] = [
      conversation[0]!,
      { kind: "runtime_context", key: "doc:1", producer: "docs", payload: "doc" },
      ...conversation.slice(1),
    ];
    const retraction: ContextEntryInput = {
      kind: "runtime_context",
      key: "doc:retract",
      producer: "docs",
      payload: null,
      supersedes: "doc:1",
      retraction: true,
    };

    const compaction = await compactor({
      stream: STREAM,
      head,
      core: "",
      contract: {},
      path: withNote,
      pending: [retraction, ...pending],
      keyPrefix: "k",
      options: {},
      screen: async (entries) => entries,
    });

    // The retraction retires the document, which is not kept, so on the
    // child's path the retraction has nothing to retire and is dropped.
    expect(compaction!.entries.map((entry) => entry.key)).toEqual(["k:summary:0", "u3"]);
  });

  it("keeps a summary whose text equals an earlier summary", async () => {
    const { contextManager } = createCompactingManager(0, { keepMessageCount: 1 });
    const compactor = createLogCompactor(async (messages, _options, _threadId, compactOptions) => ({
      compacted: true,
      messages: (
        await contextManager.compact(messages, {} as Agent, "token_threshold", compactOptions)
      ).newMessages,
    }));
    const earlier: ContextEntryInput = {
      kind: "assistant",
      key: "earlier-summary",
      message: { role: "assistant", content: "[Previous conversation summary]\n\nsummary 1" },
    };

    const compaction = await compactor({
      stream: STREAM,
      head,
      core: "",
      contract: {},
      path: [earlier, path[2]!, path[3]!],
      pending,
      keyPrefix: "k",
      options: {},
      screen: async (entries) => entries,
    });

    expect(compaction!.entries.map((entry) => entry.key)).toEqual(["k:summary:0", "u3"]);
  });

  it("treats copies of kept messages as new content, never guessing their source", async () => {
    // A manager that returns copies: a copied tool call or result cannot be
    // new content, so the compaction is refused rather than matched by
    // content, whether it copies the call, the result or both.
    const copying = (copy: (message: ModelMessage) => boolean) =>
      createLogCompactor(async (messages) => ({
        compacted: true,
        messages: messages
          .filter((message) => message.role !== "user")
          .map((message) => (copy(message) ? structuredClone(message) : message)),
      }));
    const toolPath: ContextEntryInput[] = [
      path[2]!,
      {
        kind: "assistant",
        key: "call",
        message: {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "t1", toolName: "echo", input: {} }],
        },
      },
      {
        kind: "tool_result",
        key: "result",
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "t1",
              toolName: "echo",
              output: { type: "text", value: "ok" },
            },
          ],
        },
      },
    ];

    for (const copy of [
      () => true,
      (message: ModelMessage) => message.role === "assistant",
      (message: ModelMessage) => message.role === "tool",
    ]) {
      await expect(
        copying(copy)({
          stream: STREAM,
          head,
          core: "",
          contract: {},
          path: toolPath,
          pending,
          keyPrefix: "k",
          options: {},
          screen: async (entries) => entries,
        }),
      ).rejects.toMatchObject({ reason: "compaction_invalid_summary" });
    }
  });

  it("does nothing when the policy does not ask for compaction", async () => {
    const compactIfNeeded = vi.fn(async (messages: ModelMessage[]) => ({
      compacted: false,
      messages,
    }));
    const compactor = createLogCompactor(compactIfNeeded);
    const input = {
      stream: STREAM,
      head,
      core: "core",
      contract: {},
      path,
      pending,
      keyPrefix: "k",
      options: {},
      screen: async (entries: ContextEntryInput[]) => entries,
    };
    expect(await compactor(input)).toBeUndefined();
    expect(await compactor({ ...input, options: { _skipCompaction: true } })).toBeUndefined();
    expect(compactIfNeeded).toHaveBeenCalledTimes(1);
  });
});
