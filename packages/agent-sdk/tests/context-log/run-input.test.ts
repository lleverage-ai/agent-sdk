/**
 * A prepare names the run's new input among the entries it appends
 * (`ContextPrepareRequest.runInput`), so a host can map each input message to
 * its own record without depending on key formats. Entries a compaction
 * re-appends, and input an earlier prepare committed, are never listed.
 */

import type { LanguageModelV3CallOptions, LanguageModelV3Content } from "@ai-sdk/provider";
import { jsonSchema, type LanguageModel, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { MemorySaver } from "../../src/checkpointer/memory-saver.js";
import {
  type AgentOptions,
  ContextLogUnavailableError,
  type ContextPrepareRequest,
  type ContextPrepareResult,
  type ContextProducer,
  createAgent,
  createContextManager,
  createRetryHooks,
  MemoryContextLogStore,
} from "../../src/index.js";

const THREAD = "thread-1";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

type Reply = LanguageModelV3Content[] | (() => never);

const text = (value: string): LanguageModelV3Content[] => [{ type: "text", text: value }];
const echoCall = (id: string): LanguageModelV3Content[] => [
  { type: "tool-call", toolCallId: id, toolName: "echo", input: '{"value":"x"}' },
];

function createScriptedModel(replies: Reply[]) {
  const requests: LanguageModelV3CallOptions[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (request) => {
      const index = requests.length;
      requests.push(request);
      const reply = replies[Math.min(index, replies.length - 1)]!;
      if (typeof reply === "function") reply();
      const content = reply as LanguageModelV3Content[];
      const finishReason = content.some((part) => part.type === "tool-call")
        ? { unified: "tool-calls" as const, raw: "tool_calls" }
        : { unified: "stop" as const, raw: "stop" };
      return { content, finishReason, usage, warnings: [] };
    },
  });
  return { model: model as LanguageModel, requests };
}

/** A store that records every prepare request it receives, and can fail some uncertainly. */
class RecordingStore extends MemoryContextLogStore {
  readonly prepares: ContextPrepareRequest[] = [];
  /** Prepare attempts (1-based) that fail as `unavailable` after committing. */
  failAfterCommit = new Set<number>();

  override async prepare(request: ContextPrepareRequest): Promise<ContextPrepareResult> {
    this.prepares.push(structuredClone(request));
    const result = await super.prepare(request);
    if (this.failAfterCommit.has(this.prepares.length)) {
      throw new ContextLogUnavailableError("injected after commit");
    }
    return result;
  }
}

const settings: ContextProducer = {
  name: "settings",
  produce: () => [
    { kind: "runtime_context", key: "settings:v1", producer: "settings", payload: { tz: "UTC" } },
  ],
};

const echoTools = {
  echo: tool({
    inputSchema: jsonSchema<{ value: string }>({
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    }),
    execute: async ({ value }) => `echo:${value}`,
  }),
};

function logAgent(model: LanguageModel, store: RecordingStore, overrides: Partial<AgentOptions>) {
  return createAgent({
    model,
    systemPrompt: "You are the core.",
    contextLog: { mode: "log", store, producers: [settings] },
    ...overrides,
  });
}

/** Compacts whenever `control.compact` is set, keeping the last `keep` messages. */
function compactingManager(control: { compact: boolean }, keep: number) {
  return createContextManager({
    maxTokens: 1_000_000,
    policy: {
      shouldCompact: () =>
        control.compact ? { trigger: true, reason: "token_threshold" } : { trigger: false },
    },
    summarization: { keepMessageCount: keep, keepToolResultCount: 0 },
    summarizer: async () => ({ text: "summary" }),
  });
}

/** Keys of the user entries a prepare appends. */
const userAppends = (request: ContextPrepareRequest) =>
  request.append.filter((entry) => entry.kind === "user").map((entry) => entry.key);

describe("ContextPrepareRequest.runInput", () => {
  it("lists every input message with its index, and nothing on later steps", async () => {
    const store = new RecordingStore();
    const { model } = createScriptedModel([echoCall("c1"), text("done")]);

    await logAgent(model, store, { tools: echoTools }).generate({
      threadId: THREAD,
      input: [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ],
    });

    expect(store.prepares).toHaveLength(2);
    const [first, second] = store.prepares;
    const keys = userAppends(first!);
    expect(keys).toHaveLength(2);
    expect(first!.runInput).toEqual([
      { key: keys[0], index: 0 },
      { key: keys[1], index: 1 },
    ]);
    // The producer's runtime context is appended too, but is not input.
    expect(first!.append.some((entry) => entry.kind === "runtime_context")).toBe(true);
    expect(second!).not.toHaveProperty("runInput");
  });

  it("lists a prompt as index 0", async () => {
    const store = new RecordingStore();
    const { model } = createScriptedModel([text("done")]);

    await logAgent(model, store, {}).generate({ threadId: THREAD, prompt: "hello" });

    expect(store.prepares[0]!.runInput).toEqual([
      { key: userAppends(store.prepares[0]!)[0], index: 0 },
    ]);
  });

  it("is absent when a run has no new input", async () => {
    const store = new RecordingStore();
    const agent = logAgent(createScriptedModel([text("a1"), text("a2")]).model, store, {});
    await agent.generate({ threadId: THREAD, prompt: "hello" });

    await agent.generate({ threadId: THREAD });

    expect(store.prepares).toHaveLength(2);
    expect(store.prepares[1]!).not.toHaveProperty("runInput");
  });

  it("never lists an earlier run's input that a compaction re-appends", async () => {
    const store = new RecordingStore();
    const control = { compact: false };
    const agent = logAgent(createScriptedModel([text("a1"), text("a2"), text("a3")]).model, store, {
      contextManager: compactingManager(control, 3),
    });
    await agent.generate({ threadId: THREAD, prompt: "q1" });
    await agent.generate({ threadId: THREAD, prompt: "q2" });
    control.compact = true;

    await agent.generate({ threadId: THREAD, prompt: "q3" });

    const prepare = store.prepares.at(-1)!;
    expect(prepare.transition?.reason).toBe("compaction");
    const q2Key = store.prepares[1]!.runInput![0]!.key;
    const [q3Ref] = prepare.runInput!;
    // q2 is re-appended in the retained tail, q3 is the new input.
    expect(userAppends(prepare)).toEqual([q2Key, q3Ref!.key]);
    expect(prepare.runInput).toEqual([{ key: q3Ref!.key, index: 0 }]);
  });

  it("never lists the run's own input when a later step's compaction re-appends it", async () => {
    const store = new RecordingStore();
    const control = { compact: false };
    const tools = {
      echo: tool({
        inputSchema: jsonSchema<{ value: string }>({
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        }),
        execute: async ({ value }) => {
          // The next step compacts.
          control.compact = true;
          return `echo:${value}`;
        },
      }),
    };
    const agent = logAgent(
      createScriptedModel([text("a1"), text("a2"), echoCall("c1"), text("done")]).model,
      store,
      { tools, contextManager: compactingManager(control, 3) },
    );
    await agent.generate({ threadId: THREAD, prompt: "q1" });
    await agent.generate({ threadId: THREAD, prompt: "q2" });
    const before = store.prepares.length;

    await agent.generate({ threadId: THREAD, prompt: "q3" });

    const [first, second] = store.prepares.slice(before);
    expect(first!.transition).toBeUndefined();
    const [q3Ref] = first!.runInput!;
    expect(first!.runInput).toEqual([{ key: q3Ref!.key, index: 0 }]);
    // The second step's compaction keeps q3 and its tool call.
    expect(second!.transition?.reason).toBe("compaction");
    expect(userAppends(second!)).toEqual([q3Ref!.key]);
    expect(second!).not.toHaveProperty("runInput");
  });

  it("carries the same list on a retried prepare, and none once the input is committed", async () => {
    const store = new RecordingStore();
    // The first prepare commits but reports unavailable: the boundary retries
    // the identical request, which the store answers from its idempotency
    // record.
    store.failAfterCommit.add(1);
    const { model } = createScriptedModel([
      () => {
        throw new Error("rate limit exceeded");
      },
      text("done"),
    ]);

    await logAgent(model, store, {
      hooks: {
        PostGenerateFailure: [createRetryHooks({ maxRetries: 2, baseDelay: 1, jitter: false })],
      },
    }).generate({ threadId: THREAD, prompt: "hello" });

    const [first, replay, retry] = store.prepares;
    expect(first!.runInput).toHaveLength(1);
    expect(replay).toEqual(first);
    // The provider failed; the retry attempt finds the input committed.
    expect(retry!).not.toHaveProperty("runInput");
    expect(userAppends(retry!)).toEqual([]);
  });

  it("is absent on the continuation of a resume", async () => {
    const store = new RecordingStore();
    const checkpointer = new MemorySaver();
    const approvalTools = {
      deploy: tool({
        inputSchema: jsonSchema<{ env: string }>({
          type: "object",
          properties: { env: { type: "string" } },
          required: ["env"],
        }),
        execute: async (input, options) => {
          await (
            options as unknown as {
              interrupt: (request: unknown, options?: { type?: string }) => Promise<unknown>;
            }
          ).interrupt({ toolName: "deploy", args: input }, { type: "approval" });
          return "deployed";
        },
      }),
    };
    const first = await logAgent(
      createScriptedModel([
        [{ type: "tool-call", toolCallId: "c1", toolName: "deploy", input: '{"env":"prod"}' }],
      ]).model,
      store,
      { tools: approvalTools, checkpointer },
    ).generate({ threadId: THREAD, prompt: "deploy" });
    if (first.status !== "interrupted") throw new Error("expected an interrupt");
    const before = store.prepares.length;

    await logAgent(createScriptedModel([text("done")]).model, store, {
      tools: approvalTools,
      checkpointer,
    }).resume(THREAD, first.interrupt.id, { approved: true });

    const continuation = store.prepares.slice(before);
    expect(continuation).toHaveLength(1);
    expect(continuation[0]!).not.toHaveProperty("runInput");
  });
});
