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
import {
  createLogCompactor,
  type LogCompactionInput,
  type LogCompactor,
} from "../../src/agent/log-compaction.js";
import { MemorySaver } from "../../src/checkpointer/memory-saver.js";
import {
  type Agent,
  type AgentOptions,
  type ContextEntry,
  type ContextEntryInput,
  type ContextHead,
  type ContextLogStore,
  ContextLogUnavailableError,
  type ContextManager,
  type ContextPrepareRequest,
  type ContextPrepareResult,
  type ContextProducer,
  type ContextStreamRef,
  createAgent,
  createContextManager,
  createMessageProjectionAdapter,
  createSecretsFilterHooks,
  isContextLogError,
  MemoryContextLogStore,
  type SummaryRequest,
  summaryRequestDigest,
} from "../../src/index.js";

/**
 * A compactor for direct tests: projects with the default adapter (the
 * budget) and never finds a pruned child still over budget, unless told.
 */
function testCompactor(
  compactIfNeeded: Parameters<typeof createLogCompactor>[0],
  wouldCompact: Parameters<typeof createLogCompactor>[1] = () => false,
): (
  input: Omit<LogCompactionInput, "project"> & Partial<Pick<LogCompactionInput, "project">>,
) => ReturnType<LogCompactor> {
  const compactor = createLogCompactor(compactIfNeeded, wouldCompact);
  const adapter = createMessageProjectionAdapter();
  return (input) =>
    compactor({
      ...input,
      project:
        input.project ??
        (async (entries) =>
          (
            await adapter.project({
              core: input.core,
              contract: input.contract,
              entries,
              target: { provider: "p", modelId: "m" },
            })
          ).messages),
    });
}

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
/** A scripted reply, or a function that throws to fail the provider call. */
type Reply = LanguageModelV3Content[] | (() => never);

function createScriptedModel(replies: Reply[]) {
  const requests: LanguageModelV3CallOptions[] = [];
  const respond = (request: LanguageModelV3CallOptions) => {
    requests.push(request);
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)]!;
    if (typeof reply === "function") reply();
    return reply as LanguageModelV3Content[];
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
    keepToolResultCount?: number;
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
    summarization: {
      keepMessageCount: overrides.keepMessageCount ?? 2,
      keepToolResultCount: overrides.keepToolResultCount ?? 0,
    },
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
/**
 * A store whose prepare fails, uncertainly, for compaction transitions:
 * `failures` times, then it recovers.
 */
class CompactionFailingStore extends MemoryContextLogStore {
  attempts = 0;
  constructor(private failures = Number.POSITIVE_INFINITY) {
    super();
  }
  override async prepare(request: ContextPrepareRequest): Promise<ContextPrepareResult> {
    if (request.transition?.reason === "compaction" && this.attempts < this.failures) {
      this.attempts += 1;
      throw new ContextLogUnavailableError("injected");
    }
    return super.prepare(request);
  }
}

/** A PostGenerateFailure hook that asks to retry every failure. */
const retryEverything = () =>
  vi.fn(async () => ({
    hookSpecificOutput: {
      hookEventName: "PostGenerateFailure" as const,
      retry: true,
      retryDelayMs: 0,
    },
  }));

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

  it("is the only place superseded runtime context is dropped", async () => {
    // A slot that changes every turn, as a memory digest can.
    const digest: ContextProducer = {
      name: "digest",
      produce: ({ path }) => {
        const latest = path.filter((entry) => entry.key.startsWith("digest:")).at(-1);
        const turn = path.filter((entry) => entry.kind === "user").length + 1;
        return [
          {
            kind: "runtime_context",
            key: `digest:${turn}`,
            producer: "digest",
            payload: `digest ${turn}`,
            ...(latest && { supersedes: latest.key }),
          },
        ];
      },
    };
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([text("a")]);
    const manager = createCompactingManager(11);
    const agent = logAgent(model, store, {
      contextManager: manager.contextManager,
      contextLog: { mode: "log", store, producers: [settings, digest] },
    });

    for (const prompt of ["q1", "q2", "q3"]) {
      await agent.generate({ prompt, threadId: THREAD });
    }
    // Before compaction every value stays in the projection, in place.
    expect(manager.requests).toHaveLength(0);
    const beforeCompaction = JSON.stringify(requests[2]!.prompt);
    for (const value of ["digest 1", "digest 2", "(updates earlier context)\\ndigest 3"]) {
      expect(beforeCompaction).toContain(value);
    }

    await agent.generate({ prompt: "q4", threadId: THREAD });

    expect(manager.requests).toHaveLength(1);
    const head = await store.readHead(STREAM);
    expect((await store.readVersion(head!.versionId)).reason).toBe("compaction");
    // The child inherits only active entries: the slot's current value, with
    // no reference to the values it replaced.
    const childPath = await readPath(store);
    const digests = childPath.filter((entry) => entry.key.startsWith("digest:"));
    expect(content(digests)).toEqual([
      { kind: "runtime_context", key: "digest:4", producer: "digest", payload: "digest 4" },
    ]);
    const compacted = JSON.stringify(requests[3]!.prompt);
    expect(compacted).not.toMatch(/digest [123]|updates earlier context/);
    expect(compacted).toContain("digest 4");
  });

  it("counts superseded runtime context and drops it without a summary when no history can go", async () => {
    const digest: ContextProducer = {
      name: "digest",
      produce: ({ path }) => {
        const latest = path.filter((entry) => entry.key.startsWith("digest:")).at(-1);
        const turn = path.filter((entry) => entry.kind === "user").length + 1;
        return [
          {
            kind: "runtime_context",
            key: `digest:${turn}`,
            producer: "digest",
            payload: `digest ${turn}`,
            ...(latest && { supersedes: latest.key }),
          },
        ];
      },
    };
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([text("a")]);
    const views: number[] = [];
    // Keeps every conversation message: nothing can be summarised.
    const manager = createCompactingManager(11, { keepMessageCount: 100 });
    const shouldCompact = manager.contextManager.shouldCompact.bind(manager.contextManager);
    manager.contextManager.shouldCompact = (messages) => {
      views.push(messages.length);
      return shouldCompact(messages);
    };
    const agent = logAgent(model, store, {
      contextManager: manager.contextManager,
      contextLog: { mode: "log", store, producers: [settings, digest] },
    });

    for (const prompt of ["q1", "q2", "q3"]) {
      await agent.generate({ prompt, threadId: THREAD });
    }
    const before = await store.readHead(STREAM);
    expect((await store.readVersion(before!.versionId)).reason).toBe("initial");

    // The fourth call's view: the core, the settings, three superseded
    // digests, the current one and seven conversation messages: 13, over the
    // threshold of 11. The active entries alone (ten) would not be.
    await agent.generate({ prompt: "q4", threadId: THREAD });

    // The compaction view had 13 messages (the guard then checks the
    // pruned child's projection too).
    expect(views).toContain(13);
    expect(manager.requests).toHaveLength(0);
    const head = await store.readHead(STREAM);
    const version = await store.readVersion(head!.versionId);
    expect(version).toMatchObject({ reason: "compaction", parentVersionId: before!.versionId });
    const childPath = await readPath(store);
    // Every conversation entry is kept and no summary is added; only the
    // superseded digests are gone.
    expect(
      childPath.filter((entry) => entry.kind === "user").map((entry) => entry.key),
    ).toHaveLength(4);
    expect(childPath.some((entry) => entry.key.includes(":summary:"))).toBe(false);
    expect(content(childPath.filter((entry) => entry.key.startsWith("digest:")))).toEqual([
      { kind: "runtime_context", key: "digest:4", producer: "digest", payload: "digest 4" },
    ]);
    expect(JSON.stringify(requests[3]!.prompt)).not.toMatch(/digest [123]/);
  });

  it("never retries or falls back after a compaction commit failed, even if the store recovers", async () => {
    // Three uncertain failures exhaust the identical-request retries; the
    // store would accept a fresh compaction afterwards.
    const store = new CompactionFailingStore(3);
    const { model, requests } = createScriptedModel([text("a1"), text("a2"), text("a3")]);
    const fallback = createScriptedModel([text("fallback")]);
    const manager = createCompactingManager(4);
    const retry = retryEverything();
    const agent = logAgent(model, store, {
      contextManager: manager.contextManager,
      fallbackModel: fallback.model,
      hooks: { PostGenerateFailure: [retry] },
    });

    await agent.generate({ prompt: "q1", threadId: THREAD });
    const before = await store.readHead(STREAM);

    await expect(agent.generate({ prompt: "q2", threadId: THREAD })).rejects.toThrow();

    expect(store.attempts).toBe(3);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(manager.requests).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(0);
    expect(await store.readHead(STREAM)).toEqual(before);
  });

  it("does not append the run's prompt again when a retry follows a compaction that summarised it", async () => {
    const store = new MemoryContextLogStore();
    let executions = 0;
    const tools = {
      echo: tool({
        inputSchema: jsonSchema<{ value: string }>({
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        }),
        execute: async ({ value }) => {
          executions += 1;
          return `echo:${value}`;
        },
      }),
    };
    const { model, requests } = createScriptedModel([
      thinkThenEcho("c1"),
      thinkThenEcho("c2"),
      () => {
        throw new Error("provider down");
      },
      text("done"),
    ]);
    // Before step 3 the view (core, the prompt, settings, two calls and two
    // results) has seven messages: the compaction keeps the last call block
    // and summarises the prompt and the first call.
    const manager = createCompactingManager(6);
    const retry = retryEverything();
    const agent = logAgent(model, store, {
      contextManager: manager.contextManager,
      tools,
      hooks: { PostGenerateFailure: [retry] },
    });

    const result = await agent.generate({ prompt: "go", threadId: THREAD });

    expect(result.status).toBe("complete");
    expect(retry).toHaveBeenCalledTimes(1);
    expect(manager.requests).toHaveLength(1);
    expect(requests).toHaveLength(4);
    expect(executions).toBe(2);
    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual([
      "assistant",
      "runtime_context",
      "assistant",
      "tool_result",
      "assistant",
    ]);
    // The retry was sent the same compacted context as the failed call.
    expect(requests[3]!.prompt).toEqual(requests[2]!.prompt);
  });

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

  it("keeps a tool call with its result when the manager keeps only one of them", async () => {
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
    const before = await readPath(store);
    await agent.generate({ prompt: "q2", threadId: THREAD });

    // The manager dropped the call and kept its result: the call is kept too.
    expect(requests).toHaveLength(3);
    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual([
      "assistant",
      "runtime_context",
      "assistant",
      "tool_result",
      "user",
      "assistant",
    ]);
    expect(content(path.slice(2, 4))).toEqual(content(before.slice(2, 4)));
  });

  it("keeps an approval request, its resolution and its result with the call after a resume", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const runs: string[] = [];
    const deploy = {
      deploy: tool({
        inputSchema: jsonSchema<{ env: string }>({
          type: "object",
          properties: { env: { type: "string" } },
          required: ["env"],
        }),
        execute: async (input, options) => {
          const interrupt = (
            options as unknown as {
              interrupt: (request: unknown, options?: { type?: string }) => Promise<unknown>;
            }
          ).interrupt;
          const decision = (await interrupt(
            { toolName: "deploy", args: input },
            { type: "approval" },
          )) as { approved: boolean };
          runs.push(`${options.toolCallId}:${decision.approved}`);
          return `deployed:${input.env}`;
        },
      }),
    };
    const { model, requests } = createScriptedModel([
      [{ type: "tool-call", toolCallId: "c1", toolName: "deploy", input: '{"env":"prod"}' }],
      text("deployed it"),
      text("a2"),
    ]);
    // The second run's view (core, go, settings, the call, its resolution
    // shown with its result, the reply and q2) has seven messages. Keeping
    // the last three keeps the result, and with it the call and resolution.
    const manager = createCompactingManager(6, { keepMessageCount: 3 });
    const agent = logAgent(model, store, {
      contextManager: manager.contextManager,
      tools: deploy,
      checkpointer,
    });

    const interrupted = await agent.generate({ prompt: "go", threadId: THREAD });
    expect(interrupted.status).toBe("interrupted");
    if (interrupted.status !== "interrupted") return;
    // Nothing is compacted around the pending interrupt.
    await agent.resume(THREAD, interrupted.interrupt.id, { approved: true });
    expect(runs).toEqual(["c1:true"]);
    expect(manager.requests).toHaveLength(0);
    const before = await readPath(store);
    // go, settings, the call, its resolution, its result, the reply.
    const group = before.slice(2, 5);
    expect(group.map((entry) => entry.kind)).toEqual(["assistant", "tool_result", "tool_result"]);

    await agent.generate({ prompt: "q2", threadId: THREAD });

    expect(manager.requests).toHaveLength(1);
    const head = await store.readHead(STREAM);
    expect((await store.readVersion(head!.versionId)).reason).toBe("compaction");
    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual([
      "assistant",
      "runtime_context",
      "assistant",
      "tool_result",
      "tool_result",
      "assistant",
      "user",
      "assistant",
    ]);
    // The call with its approval request, the resolution and the result are
    // re-appended together and unchanged, in order.
    expect(content(path.slice(2, 5))).toEqual(content(group));
    expect(JSON.stringify(path[2])).toContain("tool-approval-request");
    expect(JSON.stringify(path[3])).toContain("tool-approval-response");
    expect(JSON.stringify(path[4])).toContain("deployed:prod");
    expect(requests).toHaveLength(3);
  });
});

describe("log-mode compaction with a declared transition", () => {
  it("replaces a core_policy_change with one compaction under the new core and contract", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createScriptedModel([text("a1"), text("a2")]);
    await logAgent(model, store, {
      contextLog: { mode: "log", store, producers: [settings], coreVersion: "1" },
    }).generate({ prompt: "q1", threadId: THREAD });
    const before = await store.readHead(STREAM);
    const manager = createCompactingManager(4, { keepMessageCount: 1 });
    const second = createScriptedModel([text("b1")]);

    // The view has the core, the settings, q1, a1 and q2: it compacts.
    await logAgent(second.model, store, {
      systemPrompt: "Core v2",
      contextManager: manager.contextManager,
      contextLog: { mode: "log", store, producers: [settings], coreVersion: "2" },
    }).generate({ prompt: "q2", threadId: THREAD });

    expect(manager.requests).toHaveLength(1);
    const head = await store.readHead(STREAM);
    const version = await store.readVersion(head!.versionId);
    expect(version).toMatchObject({
      reason: "compaction",
      parentVersionId: before!.versionId,
      core: "Core v2",
      contract: { coreVersion: "2" },
    });
    expect(second.requests[0]!.prompt[0]).toEqual({ role: "system", content: "Core v2" });
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
    const compactor = testCompactor(async (messages, _options, _threadId, compactOptions) => {
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
    const compactor = testCompactor(async (messages, _options, _threadId, compactOptions) => ({
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
    const compactor = testCompactor(async (messages, _options, _threadId, compactOptions) => ({
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
      testCompactor(async (messages) => ({
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

  it.each([
    ["a missing entry", "nothing"],
    ["a user entry", "u1"],
    ["an already superseded entry", "notes:1"],
  ])(
    "refuses new runtime context that supersedes %s, as the store would",
    async (_name, target) => {
      const compactIfNeeded = vi.fn(async (messages: ModelMessage[]) => ({
        compacted: true,
        messages,
      }));
      await expect(
        testCompactor(compactIfNeeded)({
          stream: STREAM,
          head,
          core: "",
          contract: {},
          path,
          pending: [
            {
              kind: "runtime_context",
              key: "bad",
              producer: "notes",
              payload: "x",
              supersedes: target,
            },
            ...pending,
          ],
          keyPrefix: "k",
          options: {},
          screen: async (entries) => entries,
        }),
      ).rejects.toMatchObject({ kind: "conflict", reason: "invalid_supersession" });
      expect(compactIfNeeded).not.toHaveBeenCalled();
    },
  );

  it("never compacts while a call waits for its interrupt's resolution", async () => {
    const compactIfNeeded = vi.fn(async (messages: ModelMessage[]) => ({
      compacted: true,
      messages,
    }));
    const waiting: ContextEntryInput = {
      kind: "assistant",
      key: "waiting",
      message: {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "t9", toolName: "deploy", input: {} },
          { type: "tool-approval-request", approvalId: "int_t9", toolCallId: "t9" },
        ],
      },
    };
    const compaction = await testCompactor(compactIfNeeded)({
      stream: STREAM,
      head,
      core: "",
      contract: {},
      path: [...path, waiting],
      pending: [],
      keyPrefix: "k",
      options: {},
      screen: async (entries) => entries,
    });
    expect(compaction).toBeUndefined();
    expect(compactIfNeeded).not.toHaveBeenCalled();
  });

  describe("an approval group", () => {
    const call: ContextEntryInput = {
      kind: "assistant",
      key: "call",
      message: {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "d1", toolName: "deploy", input: { env: "prod" } },
          { type: "tool-approval-request", approvalId: "int_d1", toolCallId: "d1" },
        ],
      },
    };
    const resolution: ContextEntryInput = {
      kind: "tool_result",
      key: "resolution",
      message: {
        role: "tool",
        content: [{ type: "tool-approval-response", approvalId: "int_d1", approved: true }],
      },
    };
    const result: ContextEntryInput = {
      kind: "tool_result",
      key: "result",
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "d1",
            toolName: "deploy",
            output: { type: "text", value: "deployed:prod" },
          },
        ],
      },
    };
    const group = [call, resolution, result];
    const plan = (compactor: ReturnType<typeof createLogCompactor>, entries: ContextEntryInput[]) =>
      compactor({
        stream: STREAM,
        head,
        core: "core",
        contract: {},
        path: entries,
        pending: [],
        keyPrefix: "k",
        options: {},
        screen: async (screened) => screened,
      });
    const builtIn = (keepMessageCount: number, keepToolResultCount = 0) => {
      const manager = createCompactingManager(0, { keepMessageCount, keepToolResultCount });
      const compactor = testCompactor(async (messages, _options, _threadId, compactOptions) => ({
        compacted: true,
        messages: (
          await manager.contextManager.compact(
            messages,
            {} as Agent,
            "token_threshold",
            compactOptions,
          )
        ).newMessages,
      }));
      return { compactor, requests: manager.requests };
    };

    it("is never summarised or committed again when it alone is over budget", async () => {
      // Keeping the result keeps its whole block: the call, the resolution
      // and the result. Nothing is left to summarise.
      const { compactor, requests } = builtIn(1);
      for (let check = 0; check < 3; check += 1) {
        expect(await plan(compactor, group)).toBeUndefined();
      }
      expect(requests).toHaveLength(0);
    });

    it("is kept whole when earlier history is summarised", async () => {
      const { compactor, requests } = builtIn(1);
      const compaction = await plan(compactor, [path[2]!, path[3]!, ...group]);
      expect(requests).toHaveLength(1);
      expect(JSON.stringify(requests[0]!.messages)).not.toContain("deployed:prod");
      expect(compaction!.entries.map((entry) => entry.key)).toEqual([
        "k:summary:0",
        "call",
        "resolution",
        "result",
      ]);
    });

    it("counts a resolution and its result once against the tool-result quota", async () => {
      // A second interrupted call with its own resolution and result.
      const second = group.map((entry) =>
        JSON.parse(
          JSON.stringify(entry)
            .replaceAll("d1", "d2")
            .replace(/"key":"(\w+)"/, '"key":"$1-2"'),
        ),
      ) as ContextEntryInput[];
      // Keeping the last two results keeps both calls whole; the last
      // message alone would keep only the second.
      const { compactor, requests } = builtIn(1, 2);
      const compaction = await plan(compactor, [path[2]!, ...group, path[3]!, path[5]!, ...second]);
      expect(requests).toHaveLength(1);
      expect(compaction!.entries.map((entry) => entry.key)).toEqual([
        "k:summary:0",
        "call",
        "resolution",
        "result",
        "call-2",
        "resolution-2",
        "result-2",
      ]);
    });

    it("declares no transition when a manager drops history without a summary", async () => {
      const compactor = testCompactor(async (messages) => ({
        compacted: true,
        messages: messages.slice(-3),
      }));
      expect(await plan(compactor, [path[2]!, path[3]!, ...group])).toBeUndefined();
    });

    it("declares no transition when restoring a split group keeps every entry", async () => {
      // A custom manager that keeps the call and summarises its resolution
      // and result: restoring them would leave every entry plus a summary,
      // which is no compaction.
      const compactor = testCompactor(async (messages) => ({
        compacted: true,
        messages: [
          ...messages.filter((message) => message.role === "system"),
          { role: "assistant", content: "summary" },
          ...messages.filter((message) => message.role === "assistant"),
        ],
      }));
      expect(await plan(compactor, group)).toBeUndefined();
    });
  });

  it("does nothing when the policy does not ask for compaction", async () => {
    const compactIfNeeded = vi.fn(async (messages: ModelMessage[]) => ({
      compacted: false,
      messages,
    }));
    const compactor = testCompactor(compactIfNeeded);
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

describe("log-mode compaction budget (LLE-14056)", () => {
  const head: ContextHead = {
    stream: STREAM,
    versionId: "v1",
    entryCount: 6,
    pathDigest: "d",
    revision: 3,
    lastManifestId: "m3",
  };
  // A slot that changed twice: two superseded values and the current one,
  // with a short conversation.
  const path: ContextEntryInput[] = [
    { kind: "runtime_context", key: "digest:1", producer: "digest", payload: "digest 1" },
    { kind: "user", key: "u1", message: { role: "user", content: "q1" } },
    {
      kind: "runtime_context",
      key: "digest:2",
      producer: "digest",
      payload: "digest 2",
      supersedes: "digest:1",
    },
    { kind: "assistant", key: "a1", message: { role: "assistant", content: "a1" } },
    {
      kind: "runtime_context",
      key: "digest:3",
      producer: "digest",
      payload: "digest 3",
      supersedes: "digest:2",
    },
    { kind: "user", key: "u2", message: { role: "user", content: "q2" } },
  ];
  const appendOnly = { adapter: "agent-sdk/messages", supersession: "append" };
  const baseInput = {
    stream: STREAM,
    head,
    core: "core",
    contract: appendOnly,
    path,
    pending: [] as ContextEntryInput[],
    keyPrefix: "compaction:run:3",
    options: { _runId: "run-1" },
    screen: async (entries: ContextEntryInput[]) => entries,
  };

  it("hands the manager the adapter's projection as the budget, and the view to compact", async () => {
    const projected: ModelMessage[] = [{ role: "user", content: "the host's rendering" }];
    const project = vi.fn(async () => projected);
    const compactIfNeeded = vi.fn(async (messages: ModelMessage[]) => ({
      compacted: false,
      messages,
    }));

    await testCompactor(compactIfNeeded)({ ...baseInput, project });

    expect(project).toHaveBeenCalledWith(path);
    const [view, , , , budgetMessages] = compactIfNeeded.mock.calls[0]! as unknown as [
      ModelMessage[],
      unknown,
      unknown,
      unknown,
      ModelMessage[],
    ];
    expect(budgetMessages).toBe(projected);
    // The view still shows runtime context as system messages it keeps.
    expect(view.some((message) => message.role === "system")).toBe(true);
  });

  it("declares a prune-only child only when it brings the request back under budget", async () => {
    // The manager keeps every message: nothing can be summarised.
    const keepAll = async (messages: ModelMessage[]) => ({ compacted: true, messages });

    const stillOver = await testCompactor(keepAll, () => true)(baseInput);
    expect(stillOver).toBeUndefined();

    const pruned = await testCompactor(keepAll, () => false)(baseInput);
    expect(pruned?.transition.reason).toBe("compaction");
    expect(pruned!.entries.map((entry) => entry.key)).toEqual(["u1", "a1", "digest:3", "u2"]);
  });

  it("compacts on a host adapter's rendering that the default rendering stays under", async () => {
    // Budget: 600 estimated tokens. The host renders each runtime entry with
    // a long preamble the default adapter does not add.
    const tokenManager = () => {
      const requests: SummaryRequest[] = [];
      const contextManager = createContextManager({
        maxTokens: 1_000_000,
        policy: {
          shouldCompact: (budget) =>
            budget.currentTokens > 600
              ? { trigger: true, reason: "token_threshold" }
              : { trigger: false },
        },
        summarization: { keepMessageCount: 2, keepToolResultCount: 0 },
        summarizer: async (request) => {
          requests.push(request);
          return { text: "summary" };
        },
      });
      return { contextManager, requests };
    };
    const inner = createMessageProjectionAdapter();
    const inflating = {
      id: "host/inflating",
      version: "1",
      project: async (input: Parameters<typeof inner.project>[0]) => {
        const { messages } = await inner.project(input);
        return {
          messages: messages.map((message, index) => {
            const entry = input.entries[input.core === "" ? index : index - 1];
            return entry?.kind === "runtime_context" && message.role === "user"
              ? {
                  role: "user" as const,
                  content: `${"preamble ".repeat(400)}${JSON.stringify(message.content)}`,
                }
              : message;
          }),
        };
      },
    };
    const run = async (projection?: typeof inflating) => {
      const store = new MemoryContextLogStore();
      const manager = tokenManager();
      const agent = logAgent(createScriptedModel([text("a")]).model, store, {
        contextManager: manager.contextManager,
        contextLog: {
          mode: "log",
          store,
          producers: [settings],
          ...(projection && { projection }),
        },
      });
      for (const prompt of ["q1", "q2", "q3"]) {
        await agent.generate({ prompt, threadId: THREAD });
      }
      return manager.requests.length;
    };

    expect(await run()).toBe(0);
    expect(await run(inflating)).toBeGreaterThan(0);
  });
});

describe("log-mode prepared compaction summaries (LLE-14017)", () => {
  /** A message-count manager whose summarizer keeps summaries by request digest. */
  function cachingManager(maxMessages: number) {
    const cache = new Map<string, string>();
    const generated: string[] = [];
    const digests: string[] = [];
    const contextManager = createContextManager({
      maxTokens: 1_000_000,
      policy: {
        shouldCompact: (_budget, messages) =>
          messages.length > maxMessages
            ? { trigger: true, reason: "token_threshold" }
            : { trigger: false },
      },
      summarization: { keepMessageCount: 2, keepToolResultCount: 0 },
      summarizer: async (request) => {
        const digest = summaryRequestDigest(request);
        digests.push(digest);
        const known = cache.get(digest);
        if (known !== undefined) return { text: known };
        const text = `summary ${generated.length + 1}`;
        generated.push(digest);
        cache.set(digest, text);
        return { text };
      },
    });
    return { contextManager, generated, digests };
  }

  async function fourTurns(maxMessages = 10) {
    const store = new MemoryContextLogStore();
    const manager = cachingManager(maxMessages);
    const agent = logAgent(createScriptedModel([text("a")]).model, store, {
      contextManager: manager.contextManager,
    });
    for (const prompt of ["q1", "q2", "q3", "q4"]) {
      await agent.generate({ prompt, threadId: THREAD });
    }
    expect(manager.digests).toHaveLength(0);
    return { store, manager, agent };
  }

  it("generates the next call's summary ahead of time, and the call reuses it", async () => {
    const { store, manager, agent } = await fourTurns();
    const before = await store.readHead(STREAM);

    const prepared = await agent.prepareCompaction!({ threadId: THREAD });

    expect(prepared).toEqual({ prepared: true, head: before });
    expect(manager.generated).toHaveLength(1);
    // Nothing was committed to the compacted stream.
    expect(await store.readHead(STREAM)).toEqual(before);

    // The next call compacts with the same summary request: no new summary.
    await agent.generate({ prompt: "q5", threadId: THREAD });
    expect(manager.digests).toHaveLength(2);
    expect(manager.digests[1]).toBe(manager.digests[0]);
    expect(manager.generated).toHaveLength(1);
    const head = await store.readHead(STREAM);
    expect((await store.readVersion(head!.versionId)).reason).toBe("compaction");
    const summary = (await readPath(store)).find((entry) => entry.key.includes(":summary:"));
    expect(summary?.kind === "assistant" && summary.message.content).toBe(
      "[Previous conversation summary]\n\nsummary 1",
    );
  });

  it("falls back to summarising when the next call's request differs", async () => {
    const { manager, agent } = await fourTurns();

    // Prepared for two new messages; the call brings one, so the retained
    // tail differs and so does the summarised history.
    await agent.prepareCompaction!({ threadId: THREAD, pendingMessages: 2 });
    await agent.generate({ prompt: "q5", threadId: THREAD });

    expect(manager.digests).toHaveLength(2);
    expect(manager.digests[1]).not.toBe(manager.digests[0]);
    expect(manager.generated).toHaveLength(2);
  });

  it("prepares nothing when the policy would not compact or the stream is empty", async () => {
    const { manager, agent } = await fourTurns(20);
    expect(await agent.prepareCompaction!({ threadId: THREAD })).toEqual({
      prepared: false,
      reason: "not_needed",
    });
    expect(await agent.prepareCompaction!({ threadId: "other-thread" })).toEqual({
      prepared: false,
      reason: "no_head",
    });
    expect(manager.digests).toHaveLength(0);
  });

  it("is refused outside log mode", async () => {
    const agent = createAgent({
      model: createScriptedModel([text("a")]).model,
      systemPrompt: "core",
    });
    const error = await agent.prepareCompaction!({ threadId: THREAD }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect((error as Error).name).toBe("ConfigurationError");
  });
});
