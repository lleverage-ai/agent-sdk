/**
 * Log mode commits every model call's input before dispatch and every model
 * output before anything uses it.
 *
 * Failure injection runs against `FaultyStore`, which wraps the in-memory
 * store. A "crash" makes the store refuse every later call, as if the process
 * had died at that point; recovery then runs a fresh agent against the
 * underlying store.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import {
  APICallError,
  jsonSchema,
  type LanguageModel,
  type LanguageModelMiddleware,
  Output,
  tool,
} from "ai";
import { convertToLanguageModelPrompt } from "ai/internal";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import {
  describeProviderCall,
  isolateCallOptions,
  sha256Hex,
} from "../../src/agent/log-boundary.js";
import { InterruptSignal } from "../../src/agent/tool-pipeline.js";
import { MemorySaver } from "../../src/checkpointer/memory-saver.js";
import { createInterrupt } from "../../src/checkpointer/types.js";
import {
  type AgentOptions,
  ConfigurationError,
  type ContextAppendOutputsRequest,
  type ContextAppendOutputsResult,
  type ContextCallOutcome,
  type ContextEntry,
  type ContextHead,
  ContextLogConflictError,
  ContextLogRefusedError,
  type ContextLogStore,
  ContextLogUnavailableError,
  type ContextManifest,
  type ContextPathPage,
  type ContextPathReadOptions,
  type ContextPathRef,
  type ContextPrepareRequest,
  type ContextPrepareResult,
  type ContextStreamRef,
  type ContextVersion,
  createAgent,
  createGuardrailsHooks,
  createMessageProjectionAdapter,
  createRetryHooks,
  createSecretsFilterHooks,
  createSlotContextProducer,
  definePlugin,
  GeneratePermissionDeniedError,
  isContextLogError,
  MemoryContextLogStore,
} from "../../src/index.js";
import { createBackgroundTask } from "../../src/task-store/types.js";

const THREAD = "thread-1";
const STREAM: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

class CrashError extends Error {
  constructor() {
    super("process crashed");
  }
}

/** Whether an error, or the error the agent wrapped, is a simulated crash. */
const isCrash = (error: unknown): boolean =>
  error instanceof CrashError ||
  (error instanceof Error && (error as { cause?: unknown }).cause instanceof CrashError);

type StoreMethod = "prepare" | "markDispatched" | "appendOutputs" | "recordOutcome";
/**
 * - `unavailable` - Throws an uncertain failure without committing
 * - `unavailable-after-commit` - Commits, then throws an uncertain failure
 * - `crash` - Throws, and every later call throws too
 */
type Fault = "unavailable" | "unavailable-after-commit" | "crash";

/** An in-memory store with injectable faults and a call log. */
class FaultyStore implements ContextLogStore {
  readonly inner = new MemoryContextLogStore();
  readonly calls: Array<{ method: StoreMethod; request: unknown }> = [];
  crashed = false;
  private readonly faults = new Map<StoreMethod, Fault[]>();
  /** Runs before each prepare, for example to let another writer race it. */
  beforePrepare: (() => Promise<void>) | undefined;

  fail(method: StoreMethod, fault: Fault, times = 1): this {
    this.faults.set(method, [...(this.faults.get(method) ?? []), ...Array(times).fill(fault)]);
    return this;
  }

  private async run<T>(method: StoreMethod, request: unknown, write: () => Promise<T>) {
    if (this.crashed) throw new CrashError();
    this.calls.push({ method, request: structuredClone(request) });
    const fault = this.faults.get(method)?.shift();
    if (fault === "crash") {
      this.crashed = true;
      throw new CrashError();
    }
    if (fault === "unavailable") throw new ContextLogUnavailableError("injected");
    const result = await write();
    if (fault === "unavailable-after-commit") throw new ContextLogUnavailableError("injected");
    return result;
  }

  private guardRead(): void {
    if (this.crashed) throw new CrashError();
  }

  async readHead(stream: ContextStreamRef): Promise<ContextHead | null> {
    this.guardRead();
    return this.inner.readHead(stream);
  }
  async readPath(ref: ContextPathRef, options?: ContextPathReadOptions): Promise<ContextPathPage> {
    this.guardRead();
    return this.inner.readPath(ref, options);
  }
  async readVersion(versionId: string): Promise<ContextVersion> {
    this.guardRead();
    return this.inner.readVersion(versionId);
  }
  async readManifest(manifestId: string): Promise<ContextManifest> {
    this.guardRead();
    return this.inner.readManifest(manifestId);
  }
  async prepare(request: ContextPrepareRequest): Promise<ContextPrepareResult> {
    if (this.beforePrepare) await this.beforePrepare();
    return this.run("prepare", request, () => this.inner.prepare(request));
  }
  async markDispatched(manifestId: string): Promise<ContextManifest> {
    return this.run("markDispatched", manifestId, () => this.inner.markDispatched(manifestId));
  }
  async appendOutputs(request: ContextAppendOutputsRequest): Promise<ContextAppendOutputsResult> {
    return this.run("appendOutputs", request, () => this.inner.appendOutputs(request));
  }
  async recordOutcome(manifestId: string, outcome: ContextCallOutcome): Promise<ContextManifest> {
    return this.run("recordOutcome", { manifestId, outcome }, () =>
      this.inner.recordOutcome(manifestId, outcome),
    );
  }
}

type Reply = LanguageModelV3Content[] | (() => never);

const text = (value: string): LanguageModelV3Content[] => [{ type: "text", text: value }];
const toolCalls = (...calls: Array<[id: string, name: string, input: object]>) =>
  calls.map(
    ([toolCallId, toolName, input]): LanguageModelV3Content => ({
      type: "tool-call",
      toolCallId,
      toolName,
      input: JSON.stringify(input),
    }),
  );

/**
 * A model that answers each call with the next scripted reply, and records
 * every request. `onCall` runs when the provider receives a request.
 */
function createScriptedModel(
  replies: Reply[],
  options: {
    modelId?: string;
    provider?: string;
    onCall?: (request: LanguageModelV3CallOptions, index: number) => Promise<void> | void;
  } = {},
) {
  const requests: LanguageModelV3CallOptions[] = [];
  const respond = async (request: LanguageModelV3CallOptions) => {
    const index = requests.length;
    requests.push(request);
    await options.onCall?.(request, index);
    const reply = replies[Math.min(index, replies.length - 1)]!;
    if (typeof reply === "function") reply();
    return reply as LanguageModelV3Content[];
  };
  const finishFor = (content: LanguageModelV3Content[]) =>
    content.some((part) => part.type === "tool-call")
      ? { unified: "tool-calls" as const, raw: "tool_calls" }
      : { unified: "stop" as const, raw: "stop" };
  const model = new MockLanguageModelV3({
    modelId: options.modelId ?? "mock-model-id",
    provider: options.provider ?? "mock-provider",
    doGenerate: async (request) => {
      const content = await respond(request);
      return { content, finishReason: finishFor(content), usage, warnings: [] };
    },
    doStream: async (request) => {
      const content = await respond(request);
      const parts: LanguageModelV3StreamPart[] = [{ type: "stream-start", warnings: [] }];
      for (const part of content) {
        if (part.type === "text") {
          parts.push(
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: part.text },
            { type: "text-end", id: "t" },
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

async function readPath(store: ContextLogStore, stream = STREAM): Promise<ContextEntry[]> {
  const head = await store.readHead(stream);
  if (!head) return [];
  return (await store.readPath(head, { limit: 1000 })).entries;
}

/** Manifests of the path, in the order their calls were prepared. */
async function readManifests(store: ContextLogStore, stream = STREAM): Promise<ContextManifest[]> {
  const head = await store.readHead(stream);
  const ids = new Set((await readPath(store, stream)).map((entry) => entry.manifestId));
  if (head) ids.add(head.lastManifestId);
  return Promise.all([...ids].map((id) => store.readManifest(id)));
}

const runModes = {
  generate: async (agent: ReturnType<typeof createAgent>, prompt = "go") => {
    await agent.generate({ prompt, threadId: THREAD });
  },
  stream: async (agent: ReturnType<typeof createAgent>, prompt = "go") => {
    for await (const _part of agent.stream({ prompt, threadId: THREAD })) {
      // drain
    }
  },
  streamRaw: async (agent: ReturnType<typeof createAgent>, prompt = "go") => {
    const result = await agent.streamRaw({ prompt, threadId: THREAD });
    await result.consumeStream();
    await result.text;
  },
  streamDataResponse: async (agent: ReturnType<typeof createAgent>, prompt = "go") => {
    const response = await agent.streamDataResponse({ prompt, threadId: THREAD });
    await response.text();
  },
};
const modes = Object.keys(runModes) as Array<keyof typeof runModes>;

describe("log-mode commit before dispatch", () => {
  it("commits and dispatches each call's exact input before the provider receives it", async () => {
    const store = new MemoryContextLogStore();
    const seen: Array<{ manifest: ContextManifest; path: ContextEntry[] }> = [];
    const { model, requests } = createScriptedModel(
      [toolCalls(["c1", "echo", { value: "a" }]), text("done")],
      {
        onCall: async () => {
          const head = await store.readHead(STREAM);
          const manifest = await store.readManifest(head!.lastManifestId);
          seen.push({ manifest, path: (await store.readPath(manifest)).entries });
        },
      },
    );

    await logAgent(model, store, { tools: echoTools }).generate({
      prompt: "hello",
      threadId: THREAD,
    });

    expect(seen).toHaveLength(2);
    for (const [index, { manifest, path }] of seen.entries()) {
      expect(manifest.dispatchedAt).not.toBeNull();
      expect(manifest.outcome).toBeNull();
      expect(manifest.inputDigest).toBe(describeProviderCall(requests[index]!).inputDigest);
      expect(manifest.toolSnapshot).toBe(JSON.stringify(requests[index]!.tools));
      expect(manifest.ordinal).toBe(index + 1);
      expect(manifest.attempt).toBe(1);
      // The provider is sent the projection of exactly the committed path.
      const projected = path.map((entry) => ("message" in entry ? entry.message.role : ""));
      expect(requests[index]!.prompt.map((message) => message.role)).toEqual([
        "system",
        ...projected,
      ]);
    }
    expect(seen[0]!.path.map((entry) => entry.kind)).toEqual(["user"]);
    expect(seen[1]!.path.map((entry) => entry.kind)).toEqual(["user", "assistant", "tool_result"]);
  });

  it.each(modes)(
    "commits parallel tool results as one entry per result in %s() without changing the provider input (LLE-13965)",
    async (mode) => {
      const script = () =>
        createScriptedModel([
          toolCalls(["c1", "echo", { value: "a" }], ["c2", "echo", { value: "b" }]),
          text("done"),
        ]);
      const store = new MemoryContextLogStore();
      const log = script();
      await runModes[mode](logAgent(log.model, store, { tools: echoTools }));

      const path = await readPath(store);
      expect(path.map((entry) => entry.kind)).toEqual([
        "user",
        "assistant",
        "tool_result",
        "tool_result",
        "assistant",
      ]);
      // One result per entry, in the step's order, keyed by part index.
      const results = path.filter((entry) => entry.kind === "tool_result");
      expect(
        results.map((entry) =>
          entry.kind === "tool_result"
            ? entry.message.content.map((part) =>
                part.type === "tool-result" ? part.toolCallId : part.type,
              )
            : [],
        ),
      ).toEqual([["c1"], ["c2"]]);
      expect(results.map((entry) => entry.key.split(":").slice(-2).join(":"))).toEqual([
        "1:0",
        "1:1",
      ]);

      // The next call sends one tool message holding both results, exactly
      // as a legacy agent sends the same step.
      const legacy = script();
      await runModes[mode](
        createAgent({
          model: legacy.model,
          systemPrompt: "You are the core.",
          tools: echoTools,
        }),
      );
      const toolMessages = (request: LanguageModelV3CallOptions) =>
        request.prompt.filter((message) => message.role === "tool");
      expect(toolMessages(log.requests[1]!)).toHaveLength(1);
      expect(toolMessages(log.requests[1]!)).toEqual(toolMessages(legacy.requests[1]!));
    },
  );

  it.each(modes)("records every output of a three-step tool loop in %s()", async (mode) => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([
      toolCalls(["c1", "echo", { value: "a" }]),
      toolCalls(["c2", "echo", { value: "b" }]),
      text("done"),
    ]);

    await runModes[mode](logAgent(model, store, { tools: echoTools }));

    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "tool_result",
      "assistant",
      "tool_result",
      "assistant",
    ]);
    // A run that ends with a plain reply leaves it as the last item.
    expect(path.at(-1)).toMatchObject({
      kind: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      model: { provider: "mock-provider", modelId: "mock-model-id" },
    });
    expect(JSON.stringify(path[4])).toContain("echo:b");

    const manifests = await readManifests(store);
    expect(manifests.map((manifest) => manifest.outcome?.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(manifests.map((manifest) => manifest.ordinal)).toEqual([1, 2, 3]);
    expect(requests).toHaveLength(3);
    for (const [index, request] of requests.entries()) {
      expect(manifests[index]!.inputDigest).toBe(describeProviderCall(request).inputDigest);
      if (index > 0) {
        expect(request.prompt.slice(0, requests[index - 1]!.prompt.length)).toEqual(
          requests[index - 1]!.prompt,
        );
      }
    }
  });

  it.each(modes)("projects the next run from the committed log in %s()", async (mode) => {
    const store = new MemoryContextLogStore();
    const first = createScriptedModel([text("A1")]);
    await runModes[mode](logAgent(first.model, store), "first");
    const second = createScriptedModel([text("A2")]);

    await runModes[mode](logAgent(second.model, store), "second");

    expect(second.requests[0]!.prompt).toEqual([
      { role: "system", content: "You are the core." },
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "A1" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ]);
  });

  it("commits structured output as the last item", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createScriptedModel([text('{"answer":42}')]);

    const result = await logAgent(model, store).generate({
      prompt: "answer",
      threadId: THREAD,
      output: Output.object({
        schema: jsonSchema<{ answer: number }>({
          type: "object",
          properties: { answer: { type: "number" } },
          required: ["answer"],
        }),
      }),
    });

    expect(result.status === "complete" && result.output).toEqual({ answer: 42 });
    const path = await readPath(store);
    expect(path.at(-1)).toMatchObject({
      kind: "assistant",
      message: { content: [{ type: "text", text: '{"answer":42}' }] },
    });
    const [manifest] = await readManifests(store);
    expect(manifest!.callOptions).toContain("responseFormat");
  });

  it("runs on the branch and stream a call names", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createScriptedModel([text("A1")]);
    const child = { threadId: THREAD, branchId: "branch-7", streamId: "child" };

    await logAgent(model, store).generate({
      prompt: "hi",
      threadId: THREAD,
      contextStream: { branchId: "branch-7", streamId: "child" },
    });

    expect(await store.readHead(STREAM)).toBeNull();
    expect((await readPath(store, child)).map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("rejects contextStream outside log mode and a model id string in log mode", async () => {
    const { model } = createScriptedModel([text("A1")]);
    await expect(
      createAgent({ model, systemPrompt: "x" }).generate({
        prompt: "hi",
        contextStream: { streamId: "child" },
      }),
    ).rejects.toThrow(ConfigurationError);
    expect(() =>
      createAgent({
        model: "anthropic/claude-haiku-4.5",
        systemPrompt: "x",
        contextLog: { mode: "log", store: new MemoryContextLogStore() },
      }),
    ).toThrow(ConfigurationError);
  });
});

describe("log-mode admission", () => {
  it("asks the admit hook at prepare and at dispatch", async () => {
    const store = new MemoryContextLogStore();
    const admit = vi.fn(() => ({ allow: true as const }));
    const { model } = createScriptedModel([text("A1")]);

    await logAgent(model, store, { contextLog: { mode: "log", store, admit } }).generate({
      prompt: "hi",
      threadId: THREAD,
    });

    expect(admit.mock.calls.map(([input]) => input.phase)).toEqual(["prepare", "dispatch"]);
    const [prepare, dispatch] = admit.mock.calls.map(([input]) => input);
    expect(prepare).toMatchObject({ phase: "prepare", head: null });
    expect(dispatch).toMatchObject({ phase: "dispatch", manifest: { dispatchedAt: null } });
  });

  it("commits nothing and sends nothing when prepare is refused", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([text("A1")]);
    const admit = () => ({ allow: false as const, reason: "no access" });

    const error = await logAgent(model, store, { contextLog: { mode: "log", store, admit } })
      .generate({ prompt: "hi", threadId: THREAD })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ContextLogRefusedError);
    expect(requests).toHaveLength(0);
    expect(await store.readHead(STREAM)).toBeNull();
  });

  it("cancels a committed call whose dispatch is refused", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([text("A1")]);
    const admit = ({ phase }: { phase: string }) =>
      phase === "dispatch"
        ? { allow: false as const, reason: "access revoked" }
        : { allow: true as const };

    await expect(
      logAgent(model, store, { contextLog: { mode: "log", store, admit } }).generate({
        prompt: "hi",
        threadId: THREAD,
      }),
    ).rejects.toThrow(ContextLogRefusedError);

    expect(requests).toHaveLength(0);
    const [manifest] = await readManifests(store);
    expect(manifest).toMatchObject({ dispatchedAt: null, outcome: { status: "cancelled" } });
  });
});

describe("log-mode failure injection", () => {
  it("recovers a crash after prepare: nothing was sent and the call is cancelled", async () => {
    const store = new FaultyStore().fail("markDispatched", "crash");
    const crashed = createScriptedModel([text("never")]);

    await expect(
      logAgent(crashed.model, store).generate({ prompt: "first", threadId: THREAD }),
    ).rejects.toSatisfy(isCrash);

    expect(crashed.requests).toHaveLength(0);
    const [stale] = await readManifests(store.inner);
    expect(stale).toMatchObject({ dispatchedAt: null, outcome: null });

    const next = createScriptedModel([text("A2")]);
    await logAgent(next.model, store.inner).generate({ prompt: "second", threadId: THREAD });

    expect((await store.inner.readManifest(stale!.id)).outcome?.status).toBe("cancelled");
    // The committed input stays in the log; no output was ever recorded for it.
    expect(next.requests[0]!.prompt).toEqual([
      { role: "system", content: "You are the core." },
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ]);
  });

  it("recovers a crash after dispatch as an unknown outcome", async () => {
    const store = new FaultyStore();
    const crashed = createScriptedModel([text("lost")], {
      onCall: () => {
        store.crashed = true;
        throw new CrashError();
      },
    });

    await expect(
      logAgent(crashed.model, store).generate({ prompt: "first", threadId: THREAD }),
    ).rejects.toSatisfy(isCrash);

    const [stale] = await readManifests(store.inner);
    expect(stale!.dispatchedAt).not.toBeNull();
    expect(stale!.outcome).toBeNull();

    const next = createScriptedModel([text("A2")]);
    await logAgent(next.model, store.inner).generate({ prompt: "second", threadId: THREAD });

    expect((await store.inner.readManifest(stale!.id)).outcome?.status).toBe("unknown");
  });

  it("never generates from output a crash kept from being committed", async () => {
    const store = new FaultyStore().fail("appendOutputs", "crash");
    const sideEffects: string[] = [];
    const tools = {
      echo: tool({
        ...echoTools.echo,
        execute: async ({ value }: { value: string }) => {
          sideEffects.push(value);
          return `echo:${value}`;
        },
      }),
    };
    const crashed = createScriptedModel([toolCalls(["c1", "echo", { value: "a" }]), text("x")]);

    await expect(
      logAgent(crashed.model, store, { tools }).generate({ prompt: "first", threadId: THREAD }),
    ).rejects.toSatisfy(isCrash);

    // The provider responded and the tool ran, but nothing after it was sent.
    expect(crashed.requests).toHaveLength(1);
    expect(sideEffects).toEqual(["a"]);
    expect((await readPath(store.inner)).map((entry) => entry.kind)).toEqual(["user"]);
    const [stale] = await readManifests(store.inner);
    expect(stale!.outcome).toBeNull();

    const next = createScriptedModel([text("A2")]);
    await logAgent(next.model, store.inner, { tools }).generate({
      prompt: "second",
      threadId: THREAD,
    });

    expect((await store.inner.readManifest(stale!.id)).outcome?.status).toBe("unknown");
    const prompt = JSON.stringify(next.requests[0]!.prompt);
    expect(prompt).not.toContain("c1");
    expect(prompt).not.toContain("echo:a");
    // The tool ledger, not the log, decides whether "a" ran: it is not replayed.
    expect(sideEffects).toEqual(["a"]);
  });

  it("fails the run when an output commit keeps failing, and closes the call as unknown", async () => {
    const store = new FaultyStore().fail("appendOutputs", "unavailable", 3);
    const { model, requests } = createScriptedModel([
      toolCalls(["c1", "echo", { value: "a" }]),
      text("x"),
    ]);

    const error = await logAgent(model, store, { tools: echoTools })
      .generate({ prompt: "first", threadId: THREAD })
      .catch((e) => e);

    expect(isContextLogError(error, "unavailable")).toBe(true);
    expect(requests).toHaveLength(1);
    const [manifest] = await readManifests(store.inner);
    expect(manifest!.outcome?.status).toBe("unknown");
    expect((await readPath(store.inner)).map((entry) => entry.kind)).toEqual(["user"]);
  });

  it("retries an uncertain output commit with the same request", async () => {
    const store = new FaultyStore().fail("appendOutputs", "unavailable-after-commit");
    const { model } = createScriptedModel([
      toolCalls(["c1", "echo", { value: "a" }]),
      text("done"),
    ]);

    await logAgent(model, store, { tools: echoTools }).generate({
      prompt: "first",
      threadId: THREAD,
    });

    const appends = store.calls.filter((call) => call.method === "appendOutputs");
    expect(appends).toHaveLength(3);
    expect(appends[1]!.request).toEqual(appends[0]!.request);
    expect((await readPath(store.inner)).map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "tool_result",
      "assistant",
    ]);
  });

  it("retries an uncertain prepare by its idempotency key without duplicating input", async () => {
    const store = new FaultyStore().fail("prepare", "unavailable-after-commit");
    const { model, requests } = createScriptedModel([text("A1")]);

    await logAgent(model, store).generate({ prompt: "first", threadId: THREAD });

    const prepares = store.calls.filter((call) => call.method === "prepare");
    expect(prepares).toHaveLength(2);
    expect(prepares[1]!.request).toEqual(prepares[0]!.request);
    expect(requests).toHaveLength(1);
    expect((await readPath(store.inner)).map((entry) => entry.kind)).toEqual(["user", "assistant"]);
    expect(await readManifests(store.inner)).toHaveLength(1);
  });

  it("dispatches nothing after losing a compare-and-swap race", async () => {
    const store = new FaultyStore();
    const { model, requests } = createScriptedModel([text("A1")]);
    const other = createScriptedModel([text("B1")]);
    let raced = false;
    store.beforePrepare = async () => {
      if (raced) return;
      raced = true;
      // Another writer commits a call between this agent's head read and prepare.
      await logAgent(other.model, store.inner).generate({ prompt: "other", threadId: THREAD });
    };

    const error = await logAgent(model, store)
      .generate({ prompt: "mine", threadId: THREAD })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ContextLogConflictError);
    expect(isContextLogError(error, "conflict") && error.reason).toBe("head_moved");
    expect(requests).toHaveLength(0);
    expect(JSON.stringify(await readPath(store.inner))).not.toContain("mine");
  });

  it("commits parallel tool results once, in call order, and refuses them after a racing write", async () => {
    const order: string[] = [];
    const tools = {
      slow: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push("slow");
          return "slow-result";
        },
      }),
      fast: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async () => {
          order.push("fast");
          return "fast-result";
        },
      }),
    };
    const parallel = () => toolCalls(["c-slow", "slow", {}], ["c-fast", "fast", {}]);

    const store = new MemoryContextLogStore();
    const ok = createScriptedModel([parallel(), text("done")]);
    await logAgent(ok.model, store, { tools }).generate({ prompt: "go", threadId: THREAD });

    expect(order).toEqual(["fast", "slow"]);
    const path = await readPath(store);
    // One entry per result (LLE-13965), in call order, not completion order.
    expect(path.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "tool_result",
      "tool_result",
      "assistant",
    ]);
    expect(JSON.stringify(path[2])).toContain("slow-result");
    expect(JSON.stringify(path[3])).toContain("fast-result");

    // Now another writer moves the head while the tools run.
    const racing = new MemoryContextLogStore();
    const racingTools = {
      ...tools,
      slow: tool({
        ...tools.slow,
        execute: async () => {
          await logAgent(createScriptedModel([text("B1")]).model, racing).generate({
            prompt: "other",
            threadId: THREAD,
          });
          return "slow-result";
        },
      }),
    };
    const lost = createScriptedModel([parallel(), text("done")]);
    const error = await logAgent(lost.model, racing, { tools: racingTools })
      .generate({ prompt: "go", threadId: THREAD })
      .catch((e) => e);

    // The racing writer's prepare closed this call as unknown, so its late
    // outputs are refused and never enter the newer call's context.
    expect(isContextLogError(error, "conflict")).toBe(true);
    expect(lost.requests).toHaveLength(1);
    expect(JSON.stringify(await readPath(racing))).not.toContain("fast-result");
    const lostCall = (await readManifests(racing)).find(
      (m) => m.model.modelId === "mock-model-id" && m.ordinal === 1 && m.toolSnapshot !== "[]",
    );
    expect(lostCall?.outcome?.status).toBe("unknown");
  });
});

describe("log-mode retries and fallbacks", () => {
  it("records an AI SDK retry as a separate attempt of the same call", async () => {
    const store = new MemoryContextLogStore();
    let failed = false;
    const { model, requests } = createScriptedModel([text("A1")], {
      onCall: () => {
        if (failed) return;
        failed = true;
        throw new APICallError({
          message: "overloaded",
          url: "https://provider.test",
          requestBodyValues: {},
          statusCode: 529,
          isRetryable: true,
        });
      },
    });

    await logAgent(model, store).generate({ prompt: "first", threadId: THREAD });

    expect(requests).toHaveLength(2);
    const manifests = await readManifests(store);
    expect(manifests.map((m) => [m.ordinal, m.attempt, m.outcome?.status])).toEqual([
      [1, 1, "failed"],
      [1, 2, "completed"],
    ]);
    expect(manifests[0]!.inputDigest).toBe(manifests[1]!.inputDigest);
    expect((await readPath(store)).map((entry) => entry.kind)).toEqual(["user", "assistant"]);
  });

  it("keeps the run's input once across an agent-level retry", async () => {
    const store = new MemoryContextLogStore();
    let failed = false;
    const { model, requests } = createScriptedModel([text("A1")], {
      onCall: () => {
        if (failed) return;
        failed = true;
        throw new Error("rate limit exceeded");
      },
    });

    await logAgent(model, store, {
      hooks: {
        PostGenerateFailure: [createRetryHooks({ maxRetries: 2, baseDelay: 1, jitter: false })],
      },
    }).generate({ prompt: "first", threadId: THREAD });

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.prompt)).toBe(JSON.stringify(requests[0]!.prompt));
    expect((await readPath(store)).map((entry) => entry.kind)).toEqual(["user", "assistant"]);
    const manifests = await readManifests(store);
    expect(manifests.map((m) => [m.ordinal, m.attempt, m.outcome?.status])).toEqual([
      [1, 1, "failed"],
      [1, 2, "completed"],
    ]);
  });

  it("declares a model_change for a fallback with a different capability contract", async () => {
    const store = new MemoryContextLogStore();
    const primary = createScriptedModel([
      () => {
        throw new Error("Request timeout exceeded");
      },
    ]);
    const fallback = createScriptedModel([text("from fallback")], { modelId: "fallback-model" });
    const agent = logAgent(primary.model, store, {
      fallbackModel: fallback.model,
      modelCapabilities: (model) =>
        model === fallback.model ? { imageInput: false } : { imageInput: true },
    });

    await agent.generate({ prompt: "first", threadId: THREAD });

    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(1);
    const manifests = await readManifests(store);
    expect(manifests.map((m) => [m.model.modelId, m.outcome?.status])).toEqual([
      ["mock-model-id", "failed"],
      ["fallback-model", "completed"],
    ]);
    const head = await store.readHead(STREAM);
    const version = await store.readVersion(head!.versionId);
    expect(version).toMatchObject({
      reason: "model_change",
      inheritedCount: 1,
      contract: { imageInput: "false" },
      core: "You are the core.",
    });
    // The fallback is sent the same history; the input was committed once.
    expect(fallback.requests[0]!.prompt).toEqual(primary.requests[0]!.prompt);
    expect((await readPath(store)).map((entry) => entry.kind)).toEqual(["user", "assistant"]);
  });

  it("attributes a tool snapshot change to a tool definition or a model change", async () => {
    const store = new MemoryContextLogStore();
    const first = createScriptedModel([text("A1")]);
    const agent = logAgent(first.model, store, { tools: echoTools });
    await agent.generate({ prompt: "first", threadId: THREAD });
    agent.addRuntimeTools({
      extra: tool({
        description: "Another tool",
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async () => "x",
      }),
    });
    await agent.generate({ prompt: "second", threadId: THREAD });
    const other = createScriptedModel([text("A3")], { modelId: "other-model" });
    await logAgent(other.model, store).generate({ prompt: "third", threadId: THREAD });

    const [m1, m2, m3] = await readManifests(store);
    expect(m1!.toolSnapshotChange).toBeUndefined();
    expect(m2!.toolSnapshotChange).toEqual({
      previousDigest: sha256Hex(m1!.toolSnapshot!),
      digest: sha256Hex(m2!.toolSnapshot!),
      cause: "tool_definition",
    });
    expect(m3!.toolSnapshotChange).toEqual({
      previousDigest: sha256Hex(m2!.toolSnapshot!),
      digest: sha256Hex(m3!.toolSnapshot!),
      cause: "model_change",
    });
  });
});

/**
 * Host request middleware that rewrites the request: it appends `tag` to the
 * system message and sets a temperature and a provider option. `seen`
 * records the model id of each request it rewrote.
 */
function rewritingMiddleware(tag: string, seen: string[] = []): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    transformParams: async ({ params, model }) => {
      seen.push(model.modelId);
      return {
        ...params,
        prompt: params.prompt.map((message) =>
          message.role === "system"
            ? { ...message, content: `${message.content} ${tag}` }
            : message,
        ),
        temperature: 0.25,
        providerOptions: { ...params.providerOptions, host: { tags: [tag] } },
      };
    },
  };
}

const failingReply = () => {
  throw new Error("Request timeout exceeded");
};

describe("log-mode request middleware", () => {
  it.each(modes)(
    "commits each tool-loop request as the middleware rewrote it in %s()",
    async (mode) => {
      const store = new MemoryContextLogStore();
      const seen: Array<{ manifest: ContextManifest; request: LanguageModelV3CallOptions }> = [];
      const { model, requests } = createScriptedModel(
        [toolCalls(["c1", "echo", { value: "a" }]), text("done")],
        {
          onCall: async (request) => {
            // The provider receives a request whose manifest is already committed.
            const head = await store.readHead(STREAM);
            seen.push({ manifest: await store.readManifest(head!.lastManifestId), request });
          },
        },
      );

      await runModes[mode](
        logAgent(model, store, {
          tools: echoTools,
          contextLog: {
            mode: "log",
            store,
            requestMiddleware: [rewritingMiddleware("[host]")],
          },
        }),
      );

      expect(requests).toHaveLength(2);
      expect(seen).toHaveLength(2);
      for (const { manifest, request } of seen) {
        expect(request.prompt[0]).toEqual({ role: "system", content: "You are the core. [host]" });
        expect(request.temperature).toBe(0.25);
        expect(request.providerOptions).toEqual({ host: { tags: ["[host]"] } });
        expect(manifest.dispatchedAt).not.toBeNull();
        expect(manifest.inputDigest).toBe(describeProviderCall(request).inputDigest);
        expect(JSON.parse(manifest.callOptions!)).toMatchObject({
          temperature: 0.25,
          providerOptions: { host: { tags: ["[host]"] } },
        });
      }
      // The log keeps the entries; the version keeps the untransformed core.
      const head = await store.readHead(STREAM);
      expect((await store.readVersion(head!.versionId)).core).toBe("You are the core.");
      expect((await readPath(store)).map((entry) => entry.kind)).toEqual([
        "user",
        "assistant",
        "tool_result",
        "assistant",
      ]);
    },
  );

  it("runs the middleware in order, the first one on the projected request", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([text("A1")]);

    await logAgent(model, store, {
      contextLog: {
        mode: "log",
        store,
        requestMiddleware: [rewritingMiddleware("first"), rewritingMiddleware("second")],
      },
    }).generate({ prompt: "go", threadId: THREAD });

    expect(requests[0]!.prompt[0]).toEqual({
      role: "system",
      content: "You are the core. first second",
    });
    expect(requests[0]!.providerOptions).toEqual({ host: { tags: ["second"] } });
    const [manifest] = await readManifests(store);
    expect(manifest!.inputDigest).toBe(describeProviderCall(requests[0]!).inputDigest);
  });

  it("applies the middleware to every retry and fallback attempt", async () => {
    const store = new MemoryContextLogStore();
    const rewritten: string[] = [];
    // The manifest each request was dispatched under, read when it arrives.
    const dispatched: string[] = [];
    const recordDispatch = async () => {
      dispatched.push((await store.readHead(STREAM))!.lastManifestId);
    };
    let failed = false;
    const primary = createScriptedModel([failingReply], {
      onCall: async () => {
        await recordDispatch();
        if (failed) return;
        failed = true;
        throw new APICallError({
          message: "overloaded",
          url: "https://provider.test",
          requestBodyValues: {},
          statusCode: 529,
          isRetryable: true,
        });
      },
    });
    const fallback = createScriptedModel([text("from fallback")], {
      modelId: "fallback-model",
      onCall: recordDispatch,
    });

    await logAgent(primary.model, store, {
      fallbackModel: fallback.model,
      contextLog: {
        mode: "log",
        store,
        requestMiddleware: [rewritingMiddleware("[host]", rewritten)],
      },
    }).generate({ prompt: "go", threadId: THREAD });

    // An AI SDK retry of the primary, its final failure, then the fallback.
    expect(primary.requests).toHaveLength(2);
    expect(fallback.requests).toHaveLength(1);
    expect(rewritten).toEqual(["mock-model-id", "mock-model-id", "fallback-model"]);
    const requests = [...primary.requests, ...fallback.requests];
    const manifests = await Promise.all(dispatched.map((id) => store.readManifest(id)));
    expect(manifests.map((m) => [m.model.modelId, m.outcome?.status])).toEqual([
      ["mock-model-id", "failed"],
      ["mock-model-id", "failed"],
      ["fallback-model", "completed"],
    ]);
    for (const [index, request] of requests.entries()) {
      expect(request.prompt[0]).toEqual({ role: "system", content: "You are the core. [host]" });
      expect(manifests[index]!.inputDigest).toBe(describeProviderCall(request).inputDigest);
    }
  });

  it("applies a middleware that rewrites the request in place once per attempt", async () => {
    const store = new MemoryContextLogStore();
    let failed = false;
    const { model, requests } = createScriptedModel(
      [failingReply, toolCalls(["c1", "echo", { value: "a" }]), text("done")],
      {
        onCall: () => {
          if (failed) return;
          failed = true;
          throw new APICallError({
            message: "overloaded",
            url: "https://provider.test",
            requestBodyValues: {},
            statusCode: 529,
            isRetryable: true,
          });
        },
      },
    );
    // Rewrites the AI SDK's request objects in place instead of copying them.
    const inPlace: LanguageModelMiddleware = {
      specificationVersion: "v4",
      transformParams: async ({ params }) => {
        const system = params.prompt[0];
        if (system?.role === "system") system.content += " [host]";
        params.providerOptions ??= {};
        params.providerOptions.host = { ...params.providerOptions.host, seen: true };
        return params;
      },
    };
    const agent = logAgent(model, store, {
      tools: echoTools,
      contextLog: { mode: "log", store, requestMiddleware: [inPlace] },
    });

    await agent.generate({ prompt: "go", threadId: THREAD });

    // The AI SDK retry, then the second tool-loop step: each request has
    // the middleware applied once to its projection.
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.prompt[0]).toEqual({ role: "system", content: "You are the core. [host]" });
    }
    expect(requests[1]!.prompt).toEqual(requests[0]!.prompt);
  });

  it("reproduces each committed digest from the store, the projection and the pinned middleware", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([
      toolCalls(["c1", "echo", { value: "a" }]),
      text("done"),
    ]);
    // Shapes the prompt from a request option it keeps, so a replay sees it.
    const pinned: LanguageModelMiddleware = {
      specificationVersion: "v4",
      transformParams: async ({ params }) => {
        const label = String(params.providerOptions?.host?.label ?? "none");
        return {
          ...params,
          prompt: params.prompt.map((message) =>
            message.role === "system"
              ? { ...message, content: `${message.content} <${label}>` }
              : message,
          ),
          maxOutputTokens: 512,
        };
      },
    };

    await logAgent(model, store, {
      tools: echoTools,
      contextLog: { mode: "log", store, requestMiddleware: [pinned] },
    }).generate({
      prompt: "go",
      threadId: THREAD,
      providerOptions: { host: { label: "pinned" } },
    });

    expect(requests[0]!.prompt[0]).toEqual({
      role: "system",
      content: "You are the core. <pinned>",
    });
    const head = await store.readHead(STREAM);
    const version = await store.readVersion(head!.versionId);
    const path = await readPath(store);
    const manifests = await readManifests(store);
    expect(manifests).toHaveLength(2);
    const adapter = createMessageProjectionAdapter();
    for (const manifest of manifests) {
      // The call's input: the path before the call's own outputs.
      const end = path.findIndex(
        (entry) =>
          entry.manifestId === manifest.id &&
          (entry.kind === "assistant" || entry.kind === "tool_result"),
      );
      const { messages } = await adapter.project({
        core: version.core,
        contract: version.contract,
        entries: path.slice(0, end),
        target: manifest.model,
      });
      const prompt = await convertToLanguageModelPrompt({
        prompt: { instructions: undefined, messages },
        supportedUrls: {},
        download: undefined,
        provider: manifest.model.provider,
      });
      const replayed = await pinned.transformParams!({
        type: "generate",
        model: model as Parameters<
          NonNullable<LanguageModelMiddleware["transformParams"]>
        >[0]["model"],
        params: {
          prompt,
          tools: JSON.parse(manifest.toolSnapshot!),
          ...JSON.parse(manifest.callOptions!),
        },
      });
      expect(describeProviderCall(replayed).inputDigest).toBe(manifest.inputDigest);
    }
  });

  it("fails the run without running tools when a middleware answers without the provider", async () => {
    const store = new MemoryContextLogStore();
    let executions = 0;
    const tools = {
      echo: tool({
        ...echoTools.echo,
        execute: async ({ value }: { value: string }) => {
          executions++;
          return `echo:${value}`;
        },
      }),
    };
    const { model, requests } = createScriptedModel([text("unused")]);
    // A cache that answers with a tool call instead of calling the model.
    const cache: LanguageModelMiddleware = {
      specificationVersion: "v4",
      wrapGenerate: async () => ({
        content: toolCalls(["c1", "echo", { value: "a" }]),
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      }),
    };

    const error = await logAgent(model, store, {
      tools,
      contextLog: { mode: "log", store, requestMiddleware: [cache] },
    })
      .generate({ prompt: "go", threadId: THREAD })
      .catch((e) => e);

    expect(isContextLogError(error, "invalid")).toBe(true);
    expect(requests).toHaveLength(0);
    expect(executions).toBe(0);
    expect(await store.readHead(STREAM)).toBeNull();
  });

  it("copies an own __proto__ key of the request data", () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"]}',
    );
    const copy = isolateCallOptions({
      prompt: [],
      tools: [{ type: "function", name: "t", inputSchema: schema }],
    });
    const tools = copy.tools as Array<{ inputSchema: Record<string, Record<string, unknown>> }>;
    expect(Object.keys(tools[0]!.inputSchema.properties!)).toEqual(["__proto__"]);
    expect(JSON.stringify(copy.tools![0])).toBe(
      JSON.stringify({ type: "function", name: "t", inputSchema: schema }),
    );
    expect(copy.tools![0]).not.toBe(schema);
  });

  it("rejects request middleware that is not an array", () => {
    const { model } = createScriptedModel([text("A1")]);
    expect(() =>
      createAgent({
        model,
        systemPrompt: "x",
        contextLog: {
          mode: "log",
          store: new MemoryContextLogStore(),
          requestMiddleware: rewritingMiddleware("x") as unknown as LanguageModelMiddleware[],
        },
      }),
    ).toThrow(ConfigurationError);
  });

  it.each(modes)("never runs request middleware outside log mode in %s()", async (mode) => {
    const rewritten: string[] = [];
    const plain = createScriptedModel([text("A1")]);
    const configured = createScriptedModel([text("A1")]);

    await runModes[mode](createAgent({ model: plain.model, systemPrompt: "Legacy." }));
    await runModes[mode](
      createAgent({
        model: configured.model,
        systemPrompt: "Legacy.",
        contextLog: {
          mode: "off",
          store: new MemoryContextLogStore(),
          requestMiddleware: [rewritingMiddleware("[host]", rewritten)],
        },
      }),
    );

    expect(rewritten).toEqual([]);
    const { abortSignal: _a, ...configuredRequest } = configured.requests[0]!;
    const { abortSignal: _b, ...plainRequest } = plain.requests[0]!;
    expect(JSON.stringify(configuredRequest)).toBe(JSON.stringify(plainRequest));
  });
});

describe("log-mode core resolution on a model change", () => {
  /** A core per model family, as a host's resolver might choose it. */
  const familyCore = vi.fn(({ target }: { target: { modelId: string } }) =>
    target.modelId.startsWith("claude") ? "Claude core" : "GPT core",
  );

  it("commits the target family's core for a fallback", async () => {
    familyCore.mockClear();
    const store = new MemoryContextLogStore();
    const primary = createScriptedModel([failingReply], {
      provider: "anthropic",
      modelId: "claude-model",
    });
    const fallback = createScriptedModel([text("from fallback")], {
      provider: "openai",
      modelId: "gpt-model",
    });
    const rewritten: string[] = [];

    await createAgent({
      model: primary.model,
      fallbackModel: fallback.model,
      contextLog: {
        mode: "log",
        store,
        resolveCore: familyCore,
        requestMiddleware: [rewritingMiddleware("[host]", rewritten)],
      },
    }).generate({ prompt: "go", threadId: THREAD });

    expect(primary.requests[0]!.prompt[0]).toEqual({
      role: "system",
      content: "Claude core [host]",
    });
    expect(fallback.requests[0]!.prompt[0]).toEqual({ role: "system", content: "GPT core [host]" });
    // The same history follows the new core.
    expect(fallback.requests[0]!.prompt.slice(1)).toEqual(primary.requests[0]!.prompt.slice(1));
    expect(rewritten).toEqual(["claude-model", "gpt-model"]);

    const head = await store.readHead(STREAM);
    const version = await store.readVersion(head!.versionId);
    expect(version).toMatchObject({ reason: "model_change", inheritedCount: 1, core: "GPT core" });
    const parent = await store.readVersion(version.parentVersionId!);
    expect(parent).toMatchObject({ reason: "initial", core: "Claude core" });
    expect(familyCore.mock.calls.map(([input]) => input)).toEqual([
      {
        stream: STREAM,
        reason: "initial",
        parent: null,
        target: { provider: "anthropic", modelId: "claude-model" },
        model: primary.model,
      },
      {
        stream: STREAM,
        reason: "model_change",
        parent: { versionId: parent.id, inheritedCount: 1 },
        target: { provider: "openai", modelId: "gpt-model" },
        model: fallback.model,
      },
    ]);
    const manifests = await readManifests(store);
    expect(manifests.at(-1)!.inputDigest).toBe(
      describeProviderCall(fallback.requests[0]!).inputDigest,
    );
    expect((await readPath(store)).map((entry) => entry.kind)).toEqual(["user", "assistant"]);
  });

  it.each(modes)(
    "commits the new family's core when the host switches models in %s()",
    async (mode) => {
      familyCore.mockClear();
      const store = new MemoryContextLogStore();
      const claude = createScriptedModel([text("A1")], {
        provider: "anthropic",
        modelId: "claude-a",
      });
      const gpt = createScriptedModel([text("A2")], { provider: "openai", modelId: "gpt-b" });
      const agentFor = (model: LanguageModel) =>
        createAgent({ model, contextLog: { mode: "log", store, resolveCore: familyCore } });

      await runModes[mode](agentFor(claude.model), "first");
      await runModes[mode](agentFor(gpt.model), "second");

      expect(gpt.requests[0]!.prompt).toEqual([
        { role: "system", content: "GPT core" },
        ...claude.requests[0]!.prompt.slice(1),
        { role: "assistant", content: [{ type: "text", text: "A1" }] },
        { role: "user", content: [{ type: "text", text: "second" }] },
      ]);
      const head = await store.readHead(STREAM);
      const version = await store.readVersion(head!.versionId);
      expect(version).toMatchObject({
        reason: "model_change",
        inheritedCount: 2,
        core: "GPT core",
      });
      const [, sent] = await readManifests(store);
      expect(sent!.inputDigest).toBe(describeProviderCall(gpt.requests[0]!).inputDigest);
    },
  );

  it("keeps the core when the resolver returns the same bytes for the new model", async () => {
    const store = new MemoryContextLogStore();
    const resolveCore = vi.fn(() => "Shared core");
    const first = createScriptedModel([text("A1")], { modelId: "claude-model" });
    await createAgent({
      model: first.model,
      contextLog: { mode: "log", store, resolveCore },
    }).generate({ prompt: "first", threadId: THREAD });
    const second = createScriptedModel([text("A2")], { modelId: "claude-other" });

    await createAgent({
      model: second.model,
      contextLog: { mode: "log", store, resolveCore },
    }).generate({ prompt: "second", threadId: THREAD });

    expect(resolveCore).toHaveBeenCalledTimes(2);
    expect(resolveCore.mock.calls.map(([input]) => input.reason)).toEqual([
      "initial",
      "model_change",
    ]);
    const head = await store.readHead(STREAM);
    const version = await store.readVersion(head!.versionId);
    expect(version).toMatchObject({ reason: "model_change", core: "Shared core" });
    expect(second.requests[0]!.prompt.slice(0, first.requests[0]!.prompt.length)).toEqual(
      first.requests[0]!.prompt,
    );
  });

  it("does not resolve a core again while the model stays the same", async () => {
    const store = new MemoryContextLogStore();
    const resolveCore = vi.fn(() => "Core");
    const { model } = createScriptedModel([text("A")]);
    const agent = createAgent({ model, contextLog: { mode: "log", store, resolveCore } });

    await agent.generate({ prompt: "first", threadId: THREAD });
    await agent.generate({ prompt: "second", threadId: THREAD });

    expect(resolveCore).toHaveBeenCalledTimes(1);
  });

  it("fails before sending when the resolver does not return a string", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([text("A")]);
    const agent = createAgent({
      model,
      contextLog: { mode: "log", store, resolveCore: () => undefined as unknown as string },
    });

    const error = await agent.generate({ prompt: "first", threadId: THREAD }).catch((e) => e);

    expect(isContextLogError(error, "invalid")).toBe(true);
    expect(requests).toHaveLength(0);
  });
});

describe("log-mode streamDataResponse() background follow-ups", () => {
  it("screens and commits each follow-up through the same boundary", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([text("initial"), text("follow-up")]);
    const [inputFilter] = createSecretsFilterHooks();
    const agent = logAgent(model, store, { hooks: { PreGenerate: [inputFilter] } });
    agent.taskManager.registerTask(
      createBackgroundTask({
        id: "task-1",
        subagentType: "researcher",
        description: "Find the key",
        status: "completed",
        completedAt: new Date().toISOString(),
        result: "The key is AKIAIOSFODNN7EXAMPLE",
      }),
    );

    const response = await agent.streamDataResponse({ prompt: "start", threadId: THREAD });
    await response.text();

    expect(requests).toHaveLength(2);
    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(path.at(-1)).toMatchObject({
      message: { content: [{ type: "text", text: "follow-up" }] },
    });
    // The follow-up prompt passed PreGenerate before it was committed or sent.
    expect(JSON.stringify(path)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(JSON.stringify(requests[1]!.prompt)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(requests[1]!.prompt.slice(0, requests[0]!.prompt.length)).toEqual(requests[0]!.prompt);
    const manifests = await readManifests(store);
    expect(manifests.map((m) => m.outcome?.status)).toEqual(["completed", "completed"]);
  });
});

describe("log-mode producers and screening", () => {
  it("appends producer output once, screened, on the call's head snapshot", async () => {
    const store = new MemoryContextLogStore();
    const seenHeads: Array<number | null> = [];
    const clock = createSlotContextProducer({
      name: "clock",
      // Deduplicates by a keyed fingerprint of the source, so redaction
      // before commit does not make the slot re-append every call.
      fingerprintSecret: "test-secret",
      load: ({ head }) => {
        seenHeads.push(head?.revision ?? null);
        return [{ slot: "today", payload: "Today is 2026-10-02. Key AKIAIOSFODNN7EXAMPLE" }];
      },
    });
    const pluginProducer = {
      name: "plugin-note",
      produce: () => [
        { kind: "runtime_context" as const, key: "note:1", producer: "plugin-note", payload: "n" },
      ],
    };
    const [inputFilter] = createSecretsFilterHooks();
    const agent = logAgent(createScriptedModel([text("A1"), text("A2")]).model, store, {
      contextLog: { mode: "log", store, producers: [clock] },
      plugins: [definePlugin({ name: "notes", contextProducers: [pluginProducer] })],
      hooks: { PreGenerate: [inputFilter] },
    });

    await agent.generate({ prompt: "first", threadId: THREAD });
    const afterFirst = await store.readHead(STREAM);
    await agent.generate({ prompt: "second", threadId: THREAD });

    const path = await readPath(store);
    expect(path.map((entry) => [entry.kind, entry.key.split(":")[0]])).toEqual([
      ["user", "user"],
      ["runtime_context", "ctx"],
      ["runtime_context", "note"],
      ["assistant", "output"],
      ["user", "user"],
      ["assistant", "output"],
    ]);
    // Producers saw the head each call was planned from; unchanged slots are
    // not appended again.
    expect(seenHeads).toEqual([null, afterFirst!.revision]);
    // Producer output passed the secrets filter before it was committed.
    expect(JSON.stringify(path)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(JSON.stringify(path[1])).toContain("[REDACTED]");
  });

  it("screens tool results and assistant output before committing them", async () => {
    const store = new MemoryContextLogStore();
    const tools = {
      leak: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async () => "the key is AKIAIOSFODNN7EXAMPLE",
      }),
    };
    const [inputFilter] = createSecretsFilterHooks();
    const { model, requests } = createScriptedModel([toolCalls(["c1", "leak", {}]), text("done")]);

    await logAgent(model, store, { tools, hooks: { PreGenerate: [inputFilter] } }).generate({
      prompt: "go",
      threadId: THREAD,
    });

    const path = await readPath(store);
    expect(JSON.stringify(path)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(JSON.stringify(path[2])).toContain("[REDACTED]");
    // The next step is projected from the screened, committed result.
    expect(JSON.stringify(requests[1]!.prompt)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("never retries a run whose outputs a guardrail blocked", async () => {
    const store = new MemoryContextLogStore();
    let executions = 0;
    const tools = {
      fetch: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async () => {
          executions++;
          return "forbidden content";
        },
      }),
    };
    const [inputFilter] = createGuardrailsHooks({ blockedInputPatterns: [/forbidden/] });
    const retryEverything = vi.fn(async () => ({
      hookSpecificOutput: {
        hookEventName: "PostGenerateFailure" as const,
        retry: true,
        retryDelayMs: 0,
      },
    }));
    const { model, requests } = createScriptedModel([toolCalls(["c1", "fetch", {}]), text("x")]);

    await expect(
      logAgent(model, store, {
        tools,
        hooks: { PreGenerate: [inputFilter], PostGenerateFailure: [retryEverything] },
      }).generate({ prompt: "go", threadId: THREAD }),
    ).rejects.toThrow();

    expect(retryEverything).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(executions).toBe(1);
  });

  it("never retries a run that failed after its reply was committed", async () => {
    const store = new MemoryContextLogStore();
    class FailingSaver extends MemorySaver {
      override async save(): Promise<void> {
        throw new Error("checkpoint store down");
      }
    }
    const retryEverything = vi.fn(async () => ({
      hookSpecificOutput: {
        hookEventName: "PostGenerateFailure" as const,
        retry: true,
        retryDelayMs: 0,
      },
    }));
    const { model, requests } = createScriptedModel([text("A1"), text("A2")]);

    await expect(
      logAgent(model, store, {
        checkpointer: new FailingSaver(),
        hooks: { PostGenerateFailure: [retryEverything] },
      }).generate({ prompt: "go", threadId: THREAD }),
    ).rejects.toThrow();

    expect(retryEverything).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect((await readPath(store)).map((entry) => entry.kind)).toEqual(["user", "assistant"]);
  });

  it("fails the run without committing outputs a guardrail blocks", async () => {
    const store = new MemoryContextLogStore();
    const tools = {
      fetch: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async () => "forbidden content",
      }),
    };
    const [inputFilter] = createGuardrailsHooks({ blockedInputPatterns: [/forbidden/] });
    const { model, requests } = createScriptedModel([toolCalls(["c1", "fetch", {}]), text("x")]);

    await expect(
      logAgent(model, store, { tools, hooks: { PreGenerate: [inputFilter] } }).generate({
        prompt: "go",
        threadId: THREAD,
      }),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof GeneratePermissionDeniedError ||
        (error as { cause?: unknown }).cause instanceof GeneratePermissionDeniedError,
    );

    expect(requests).toHaveLength(1);
    expect((await readPath(store)).map((entry) => entry.kind)).toEqual(["user"]);
    const [manifest] = await readManifests(store);
    expect(manifest!.outcome?.status).toBe("unknown");
  });
});

describe("log-mode commit edge cases", () => {
  it("refuses to continue after an uncertain output commit if another writer moved the head", async () => {
    const store = new FaultyStore();
    const other = createScriptedModel([text("B1")]);
    let raced = false;
    const original = store.appendOutputs.bind(store);
    store.appendOutputs = async (request) => {
      if (raced) return original(request);
      raced = true;
      await original(request);
      // The commit landed, its response was lost, and another writer moved on.
      await logAgent(other.model, store.inner).generate({ prompt: "other", threadId: THREAD });
      throw new ContextLogUnavailableError("injected");
    };
    const { model, requests } = createScriptedModel([
      toolCalls(["c1", "echo", { value: "a" }]),
      text("done"),
    ]);

    const error = await logAgent(model, store, { tools: echoTools })
      .generate({ prompt: "mine", threadId: THREAD })
      .catch((e) => e);

    expect(isContextLogError(error, "conflict") && error.reason).toBe("head_moved");
    expect(requests).toHaveLength(1);
  });

  it("commits a received response even when structured output fails validation", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createScriptedModel([text("not json")]);

    await expect(
      logAgent(model, store).generate({
        prompt: "answer",
        threadId: THREAD,
        output: Output.object({
          schema: jsonSchema<{ answer: number }>({
            type: "object",
            properties: { answer: { type: "number" } },
            required: ["answer"],
          }),
        }),
      }),
    ).rejects.toThrow();

    const path = await readPath(store);
    expect(path.at(-1)).toMatchObject({
      kind: "assistant",
      message: { content: [{ type: "text", text: "not json" }] },
    });
    const [manifest] = await readManifests(store);
    expect(manifest!.outcome?.status).toBe("completed");
  });

  it("commits a streamed reply when the consumer stops after the finish part", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createScriptedModel([text("A1")]);
    const agent = logAgent(model, store);

    for await (const part of agent.stream({ prompt: "go", threadId: THREAD })) {
      if (part.type === "finish") break;
    }

    expect((await readPath(store)).map((entry) => entry.kind)).toEqual(["user", "assistant"]);
    const [manifest] = await readManifests(store);
    expect(manifest!.outcome?.status).toBe("completed");
  });

  it("fails a stream whose intermediate output commit failed, even if the store recovers", async () => {
    const store = new FaultyStore().fail("appendOutputs", "unavailable", 3);
    const { model, requests } = createScriptedModel([
      toolCalls(["c1", "echo", { value: "a" }]),
      text("done"),
    ]);
    const agent = logAgent(model, store, { tools: echoTools });

    const error = await (async () => {
      for await (const _part of agent.stream({ prompt: "go", threadId: THREAD })) {
        // drain
      }
    })().catch((e) => e);

    expect(isContextLogError(error, "unavailable")).toBe(true);
    expect(requests).toHaveLength(1);
    expect((await readPath(store.inner)).map((entry) => entry.kind)).toEqual(["user"]);
  });

  it("classifies a stale call by its current lifecycle when closing it", async () => {
    const store = new FaultyStore().fail("markDispatched", "crash");
    await expect(
      logAgent(createScriptedModel([text("x")]).model, store).generate({
        prompt: "first",
        threadId: THREAD,
      }),
    ).rejects.toSatisfy(isCrash);
    const [stale] = await readManifests(store.inner);

    // The stale call is dispatched after the next agent read its snapshot.
    const recovering = new FaultyStore();
    Object.assign(recovering, { inner: store.inner });
    recovering.beforePrepare = async () => {
      recovering.beforePrepare = undefined;
      await store.inner.markDispatched(stale!.id);
    };
    await logAgent(createScriptedModel([text("A2")]).model, recovering).generate({
      prompt: "second",
      threadId: THREAD,
    });

    expect((await store.inner.readManifest(stale!.id)).outcome?.status).toBe("unknown");
  });

  it("honours a signal a PreGenerate hook supplied when the provider ignores it", async () => {
    const store = new MemoryContextLogStore();
    const controller = new AbortController();
    const { model } = createScriptedModel([text("late")], {
      // The provider ignores cancellation and answers anyway.
      onCall: () => controller.abort(),
    });
    const agent = logAgent(model, store, {
      hooks: {
        PreGenerate: [
          async (input) => ({
            hookSpecificOutput: {
              hookEventName: "PreGenerate" as const,
              updatedInput: {
                ...(input as { options: object }).options,
                signal: controller.signal,
              },
            },
          }),
        ],
      },
    });

    await expect(agent.generate({ prompt: "go", threadId: THREAD })).rejects.toThrow();

    expect((await readPath(store)).map((entry) => entry.kind)).toEqual(["user"]);
    const [manifest] = await readManifests(store);
    expect(manifest!.outcome?.status).toBe("cancelled");
  });

  it("stops background follow-ups at an interrupt and records it", async () => {
    const store = new MemoryContextLogStore();
    // A checkpointer whose saves complete later, as a remote one would.
    class SlowSaver extends MemorySaver {
      override async save(...args: Parameters<MemorySaver["save"]>) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return super.save(...args);
      }
    }
    const checkpointer = new SlowSaver();
    const tools = {
      ask: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async (_input, { toolCallId }) => {
          throw new InterruptSignal(
            createInterrupt({ type: "custom", toolCallId, toolName: "ask", request: {} }),
          );
        },
      }),
    };
    const { model, requests } = createScriptedModel([
      text("initial"),
      toolCalls(["c1", "ask", {}]),
      text("never"),
    ]);
    const agent = logAgent(model, store, { tools, checkpointer });
    for (const id of ["task-1", "task-2"]) {
      agent.taskManager.registerTask(
        createBackgroundTask({
          id,
          subagentType: "researcher",
          description: id,
          status: "completed",
          completedAt: new Date().toISOString(),
          result: `${id} done`,
        }),
      );
    }

    const response = await agent.streamDataResponse({ prompt: "start", threadId: THREAD });
    await response.text();

    expect(requests).toHaveLength(2);
    expect((await checkpointer.load(THREAD))?.pendingInterrupt?.toolName).toBe("ask");
  });
});

describe("log-mode retry safety and supersession", () => {
  const retryEverything = () =>
    vi.fn(async () => ({
      hookSpecificOutput: {
        hookEventName: "PostGenerateFailure" as const,
        retry: true,
        retryDelayMs: 0,
      },
    }));

  it("never falls back or retries after a provider's outputs were lost", async () => {
    const store = new FaultyStore().fail("appendOutputs", "unavailable", 3);
    let executions = 0;
    const tools = {
      echo: tool({
        ...echoTools.echo,
        execute: async ({ value }: { value: string }) => {
          executions++;
          return `echo:${value}`;
        },
      }),
    };
    const primary = createScriptedModel([toolCalls(["c1", "echo", { value: "a" }]), text("x")]);
    const fallback = createScriptedModel([text("from fallback")], { modelId: "fallback-model" });
    const retry = retryEverything();

    const error = await logAgent(primary.model, store, {
      tools,
      fallbackModel: fallback.model,
      hooks: { PostGenerateFailure: [retry] },
    })
      .generate({ prompt: "go", threadId: THREAD })
      .catch((e) => e);

    expect(isContextLogError(error, "unavailable")).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(fallback.requests).toHaveLength(0);
    expect(primary.requests).toHaveLength(1);
    expect(executions).toBe(1);
  });

  it("never retries after committing a reply whose structured output failed", async () => {
    const store = new MemoryContextLogStore();
    const primary = createScriptedModel([text("not json"), text("again")]);
    const fallback = createScriptedModel([text("from fallback")], { modelId: "fallback-model" });
    const retry = retryEverything();

    await expect(
      logAgent(primary.model, store, {
        fallbackModel: fallback.model,
        hooks: { PostGenerateFailure: [retry] },
      }).generate({
        prompt: "answer",
        threadId: THREAD,
        output: Output.object({
          schema: jsonSchema<{ answer: number }>({
            type: "object",
            properties: { answer: { type: "number" } },
            required: ["answer"],
          }),
        }),
      }),
    ).rejects.toThrow();

    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(0);
    expect((await readPath(store)).map((entry) => entry.kind)).toEqual(["user", "assistant"]);
  });

  it("declares a model_change for a same-capability fallback on another provider", async () => {
    const store = new MemoryContextLogStore();
    const primary = createScriptedModel([
      () => {
        throw new Error("Request timeout exceeded");
      },
    ]);
    const fallback = createScriptedModel([text("from fallback")], {
      provider: "other-provider",
      modelId: "other-provider-model",
    });

    await logAgent(primary.model, store, { fallbackModel: fallback.model }).generate({
      prompt: "first",
      threadId: THREAD,
    });

    const head = await store.readHead(STREAM);
    const version = await store.readVersion(head!.versionId);
    expect(version).toMatchObject({ reason: "model_change", inheritedCount: 1 });
    const [failed, sent] = await readManifests(store);
    expect(failed!.model).toEqual({ provider: "mock-provider", modelId: "mock-model-id" });
    expect(sent!.model).toEqual({ provider: "other-provider", modelId: "other-provider-model" });
    expect(sent!.model.provider).not.toBe(failed!.model.provider);
    expect(version.contract).toEqual((await store.readVersion(version.parentVersionId!)).contract);
    expect((await readPath(store)).map((entry) => entry.kind)).toEqual(["user", "assistant"]);
  });

  it("closes each crashed call in the next prepare, even when that one crashes too", async () => {
    const store = new MemoryContextLogStore();
    // A: crashes after dispatch.
    const first = new FaultyStore();
    Object.assign(first, { inner: store });
    const crashA = createScriptedModel([text("lost")], {
      onCall: () => {
        first.crashed = true;
        throw new CrashError();
      },
    });
    await expect(
      logAgent(crashA.model, first).generate({ prompt: "a", threadId: THREAD }),
    ).rejects.toSatisfy(isCrash);
    const [callA] = await readManifests(store);

    // B: crashes right after its prepare, before closing anything itself.
    const second = new FaultyStore().fail("markDispatched", "crash");
    Object.assign(second, { inner: store });
    await expect(
      logAgent(createScriptedModel([text("x")]).model, second).generate({
        prompt: "b",
        threadId: THREAD,
      }),
    ).rejects.toSatisfy(isCrash);
    expect((await store.readManifest(callA!.id)).outcome?.status).toBe("unknown");
    const callB = (await store.readHead(STREAM))!.lastManifestId;
    expect((await store.readManifest(callB)).outcome).toBeNull();

    // C succeeds and closes B.
    await logAgent(createScriptedModel([text("C")]).model, store).generate({
      prompt: "c",
      threadId: THREAD,
    });
    expect((await store.readManifest(callB)).outcome?.status).toBe("cancelled");
  });

  it("closes a failed call whose outcome could not be recorded in the next prepare", async () => {
    const store = new FaultyStore().fail("recordOutcome", "unavailable", 3);
    const failing = createScriptedModel([
      () => {
        throw new Error("provider exploded");
      },
    ]);
    await expect(
      logAgent(failing.model, store).generate({ prompt: "a", threadId: THREAD }),
    ).rejects.toThrow();
    const [stale] = await readManifests(store.inner);
    expect(stale!.outcome).toBeNull();

    await logAgent(createScriptedModel([text("B")]).model, store.inner).generate({
      prompt: "b",
      threadId: THREAD,
    });

    expect((await store.inner.readManifest(stale!.id)).outcome?.status).toBe("unknown");
  });
});
