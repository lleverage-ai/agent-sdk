/**
 * LLE-14269: a `context: "fork"` subagent starts from the committed request
 * of the parent step that issued the `task` call. Its first provider request
 * is that request byte for byte (system prompt, tool schemas in order,
 * settings and messages), with the brief as the only extra, trailing,
 * message.
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
  type ContextEntry,
  type ContextEntryInput,
  type ContextLogStore,
  type ContextManifest,
  type ContextStreamRef,
  createAgent,
  createContextManager,
  createTaskTool,
  deriveSubagentContextStream,
  isContextLogError,
  MemoryContextLogStore,
  readSubagentDelegation,
  type SubagentCreateContext,
  type SubagentDefinition,
} from "../../src/index.js";

const THREAD = "thread-1";
const MAIN: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };
const BRIEF = "Investigate the failing build and report the cause";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

const text = (value: string): LanguageModelV3Content[] => [{ type: "text", text: value }];
const call = (toolCallId: string, toolName: string, input: object): LanguageModelV3Content[] => [
  { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
];
const fork = (toolCallId: string, description = BRIEF) =>
  call(toolCallId, "task", { description, subagent_type: "forker" });

/**
 * A model that answers each call with the reply its handler picks and
 * records every request. The parent and the fork share it, as a fork runs
 * on the parent's model.
 */
function scriptedModel(
  pick: (request: LanguageModelV3CallOptions, index: number) => LanguageModelV3Content[],
) {
  const requests: LanguageModelV3CallOptions[] = [];
  const reply = (request: LanguageModelV3CallOptions) => {
    const index = requests.length;
    requests.push(request);
    return pick(request, index);
  };
  const finishReason = (content: LanguageModelV3Content[]) =>
    content.some((part) => part.type === "tool-call")
      ? { unified: "tool-calls" as const, raw: "tool_calls" }
      : { unified: "stop" as const, raw: "stop" };
  const model = new MockLanguageModelV3({
    modelId: "shared-model",
    provider: "mock-provider",
    doGenerate: async (request) => {
      const content = reply(request);
      return { content, finishReason: finishReason(content), usage, warnings: [] };
    },
    doStream: async (request) => {
      const content = reply(request);
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
      parts.push({ type: "finish", finishReason: finishReason(content), usage });
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

/** Whether a request is the fork child's: its last message is the brief. */
const isChildRequest = (request: LanguageModelV3CallOptions) =>
  JSON.stringify(request.prompt.at(-1)).includes(BRIEF) && request.prompt.at(-1)?.role === "user";

const echo = tool({
  description: "Echoes its input",
  inputSchema: jsonSchema<{ value: string }>({
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  }),
  execute: async ({ value }) => `echo:${value}`,
});

/** The request's settings: everything but the prompt, tools and transport. */
function settingsOf(request: LanguageModelV3CallOptions): Record<string, unknown> {
  const {
    prompt: _prompt,
    tools: _tools,
    abortSignal: _signal,
    headers: _headers,
    includeRawChunks: _raw,
    ...settings
  } = request;
  return settings;
}

/** Entry content, without the store's record fields. */
const content = (entries: ContextEntry[]) =>
  entries.map(({ position: _p, versionId: _v, manifestId: _m, createdAt: _c, ...input }) => input);

/** The manifest the store committed for a request, by its tool snapshot and step order. */
async function manifestFor(
  store: ContextLogStore,
  request: LanguageModelV3CallOptions,
): Promise<ContextManifest> {
  // Walk the main stream's manifests back from its head.
  const head = await store.readHead(MAIN);
  let manifest = await store.readManifest(head!.lastManifestId);
  const snapshot = JSON.stringify(request.tools ?? []);
  for (;;) {
    const path = (await store.readPath(manifest, { limit: 1000 })).entries;
    const promptMessages = request.prompt.length - (request.prompt[0]?.role === "system" ? 1 : 0);
    if (manifest.toolSnapshot === snapshot && path.length === promptMessages) return manifest;
    const earlier = path.findLast((entry) => entry.manifestId !== manifest.id);
    if (!earlier) throw new Error("no manifest for the request");
    manifest = await store.readManifest(earlier.manifestId);
  }
}

async function readPath(store: ContextLogStore, stream: ContextStreamRef): Promise<ContextEntry[]> {
  const head = await store.readHead(stream);
  if (!head) return [];
  return (await store.readPath(head, { limit: 1000 })).entries;
}

/** A fork definition whose factory builds a log-mode child with its own tools. */
function forker(overrides: Partial<AgentOptions> = {}) {
  const contexts: SubagentCreateContext[] = [];
  const definition: SubagentDefinition = {
    type: "forker",
    description: "A background copy of this conversation",
    context: "fork",
    create: (ctx) => {
      contexts.push(ctx);
      return createAgent({
        model: ctx.model,
        // Ignored for a fork: the child projects the source version's core.
        systemPrompt: "You are a different agent.",
        tools: { echo },
        ...(ctx.contextLog && {
          contextLog: { mode: "log" as const, store: ctx.contextLog.store },
        }),
        ...overrides,
      });
    },
  };
  return { definition, contexts };
}

function parentAgent(
  model: LanguageModel,
  store: ContextLogStore,
  subagents: SubagentDefinition[],
  overrides: Partial<AgentOptions> = {},
) {
  return createAgent({
    model,
    systemPrompt: "You are the parent.",
    tools: { echo },
    contextLog: { mode: "log", store },
    subagents,
    includeGeneralPurposeSubagent: false,
    ...overrides,
  });
}

const childStreamFor = (toolCallId: string) =>
  deriveSubagentContextStream({ parent: MAIN, toolCallId, subagentType: "forker" });

describe("fork subagents (LLE-14269)", () => {
  it("sends the delegating step's request byte for byte, with the brief appended last", async () => {
    const store = new MemoryContextLogStore();
    // Parent: echo first, so the delegating step's input carries a tool
    // round, then fork, then finish. The child answers at once.
    const shared = scriptedModel((request, index) => {
      if (isChildRequest(request)) return text("Fork result");
      return [call("echo-1", "echo", { value: "a" }), fork("fork-1"), text("All done")][
        Math.min(index, 2)
      ]!;
    });
    const { definition } = forker();

    const result = await parentAgent(shared.model, store, [definition]).generate({
      prompt: "Look into the build",
      threadId: THREAD,
      temperature: 0.3,
      maxTokens: 777,
      providerOptions: { mock: { effort: "high" } },
    });

    expect(result.status).toBe("complete");
    expect(shared.requests).toHaveLength(4);
    const delegating = shared.requests[1]!;
    const child = shared.requests[2]!;
    expect(isChildRequest(child)).toBe(true);

    // Tool schemas: the same tools, in the same order, with the same bytes.
    expect(JSON.stringify(child.tools)).toBe(JSON.stringify(delegating.tools));
    expect(child.tools?.map((definition) => definition.name)).toContain("task");
    // Settings: identical, including the parent's temperature, output limit
    // and provider options (not the task tool's own output limit).
    expect(JSON.stringify(settingsOf(child))).toBe(JSON.stringify(settingsOf(delegating)));
    expect(settingsOf(child)).toMatchObject({
      temperature: 0.3,
      maxOutputTokens: 777,
      providerOptions: { mock: { effort: "high" } },
    });
    // Messages: the delegating step's prompt (with its system prompt) is the
    // exact prefix, and the brief is the only extra, trailing, message.
    expect(child.prompt).toHaveLength(delegating.prompt.length + 1);
    expect(JSON.stringify(child.prompt.slice(0, -1))).toBe(JSON.stringify(delegating.prompt));
    expect(child.prompt[0]).toEqual({ role: "system", content: "You are the parent." });
    expect(child.prompt.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: BRIEF }],
    });

    // The fork's reply is the task's result.
    const parentPath = await readPath(store, MAIN);
    expect(JSON.stringify(parentPath)).toContain("Fork result");
    // The child's path is the source prefix, then the brief and the reply.
    const childStream = childStreamFor("fork-1");
    const childPath = await readPath(store, childStream);
    expect(childPath.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "tool_result",
      "user",
      "assistant",
    ]);
    expect(content(childPath.slice(0, 3))).toEqual(content(parentPath.slice(0, 3)));
    expect(content(childPath.slice(3, 4))).toEqual([
      expect.objectContaining({ kind: "user", message: { role: "user", content: BRIEF } }),
    ]);

    // The child's first version is the declared fork of the delegating step.
    const delegatingManifest = await manifestFor(store, delegating);
    const childHead = await store.readHead(childStream);
    const version = await store.readVersion(childHead!.versionId);
    const source = await store.readVersion(delegatingManifest.versionId);
    expect(version).toMatchObject({
      reason: "fork",
      parentVersionId: delegatingManifest.versionId,
      inheritedCount: delegatingManifest.entryCount,
      core: source.core,
      contract: source.contract,
      fork: {
        sourceManifestId: delegatingManifest.id,
        toolCallId: "fork-1",
        subagentType: "forker",
      },
    });
    expect(delegatingManifest.entryCount).toBe(3);
    // The child's first manifest records the same tool and settings bytes.
    const childManifest = await store.readManifest(version.createdByManifestId);
    expect(childManifest.toolSnapshot).toBe(delegatingManifest.toolSnapshot);
    expect(childManifest.callOptions).toBe(delegatingManifest.callOptions);
  });

  it("keeps brief children as they were", async () => {
    const store = new MemoryContextLogStore();
    const shared = scriptedModel((request, index) => {
      if (isChildRequest(request)) return text("Brief result");
      return [fork("brief-1"), text("All done")][Math.min(index, 1)]!;
    });
    const { definition } = forker();

    await parentAgent(shared.model, store, [{ ...definition, context: "brief" }]).generate({
      prompt: "Look into the build",
      threadId: THREAD,
    });

    const child = shared.requests[1]!;
    expect(child.prompt).toEqual([
      { role: "system", content: "You are a different agent." },
      { role: "user", content: [{ type: "text", text: BRIEF }] },
    ]);
    const head = await store.readHead(childStreamFor("brief-1"));
    const version = await store.readVersion(head!.versionId);
    expect(version).toMatchObject({ reason: "initial", parentVersionId: null });
    expect(version.fork).toBeUndefined();
  });

  it("refuses a tool the child cannot run, without removing it from the request", async () => {
    const store = new MemoryContextLogStore();
    let secretRuns = 0;
    const secret = tool({
      description: "Only the parent can run this",
      inputSchema: jsonSchema<{ value: string }>({
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      }),
      execute: async () => {
        secretRuns += 1;
        return "secret";
      },
    });
    let childCalls = 0;
    const shared = scriptedModel((request, index) => {
      if (isChildRequest(request) || childCalls > 0) {
        childCalls += 1;
        return childCalls === 1
          ? call("secret-1", "secret", { value: "x" })
          : childCalls === 2
            ? text("Done without it")
            : text("All done");
      }
      return [fork("fork-1"), text("All done")][Math.min(index, 1)]!;
    });
    const { definition } = forker();

    const result = await parentAgent(shared.model, store, [definition], {
      tools: { echo, secret },
    }).generate({ prompt: "Look into the build", threadId: THREAD });

    expect(result.status).toBe("complete");
    expect(secretRuns).toBe(0);
    const [delegating, first, second] = shared.requests;
    expect(first!.tools?.map((definition) => definition.name)).toContain("secret");
    expect(JSON.stringify(second!.tools)).toBe(JSON.stringify(delegating!.tools));
    const childPath = await readPath(store, childStreamFor("fork-1"));
    const refusal = childPath.find((entry) => entry.kind === "tool_result");
    expect(JSON.stringify(refusal)).toContain("not available to this forked subagent");
    expect(childPath.at(-1)).toMatchObject({ kind: "assistant" });
  });

  it("starts a background fork from the step that issued it", async () => {
    const store = new MemoryContextLogStore();
    const shared = scriptedModel((request, index) => {
      if (isChildRequest(request)) return text("Background result");
      return [
        call("fork-bg", "task", {
          description: BRIEF,
          subagent_type: "forker",
          run_in_background: true,
        }),
        call("echo-1", "echo", { value: "after" }),
        text("All done"),
      ][Math.min(index, 2)]!;
    });
    const { definition } = forker();

    await parentAgent(shared.model, store, [definition]).generate({
      prompt: "Look into the build",
      threadId: THREAD,
    });
    const childStream = childStreamFor("fork-bg");
    for (let i = 0; i < 100; i++) {
      if ((await readSubagentDelegation(store, childStream)).status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect((await readSubagentDelegation(store, childStream)).status).toBe("completed");
    const delegating = shared.requests[0]!;
    const child = shared.requests.find(isChildRequest)!;
    expect(JSON.stringify(child.prompt.slice(0, -1))).toBe(JSON.stringify(delegating.prompt));
    const head = await store.readHead(childStream);
    const version = await store.readVersion(head!.versionId);
    expect(version.inheritedCount).toBe(1);
  });

  it("fails a fork outside context log mode", async () => {
    const shared = scriptedModel(
      (_request, index) => [fork("fork-1"), text("All done")][Math.min(index, 1)]!,
    );
    const { definition, contexts } = forker();

    await parentAgent(shared.model, new MemoryContextLogStore(), [definition], {
      contextLog: undefined,
    }).generate({ prompt: "Look into the build", threadId: THREAD });

    expect(contexts).toHaveLength(0);
    expect(JSON.stringify(shared.requests[1]!.prompt)).toContain("is a fork, which needs");
  });

  it("refuses a fork definition with an explicit model", () => {
    const shared = scriptedModel(() => text("unused"));
    const { definition } = forker();
    const parentAgentForTool = parentAgent(shared.model, new MemoryContextLogStore(), []);
    expect(() =>
      createTaskTool({
        subagents: [{ ...definition, model: shared.model }],
        defaultModel: shared.model,
        parentAgent: parentAgentForTool,
      }),
    ).toThrow(/fork with an explicit model/);
  });
});

describe("fork planning (LLE-14269)", () => {
  /** Runs a parent turn and returns the manifest of its only step. */
  async function sourceManifest(store: MemoryContextLogStore, model: LanguageModel) {
    await parentAgent(model, store, []).generate({ prompt: "Hello", threadId: THREAD });
    const head = await store.readHead(MAIN);
    return store.readManifest(head!.lastManifestId);
  }

  /** Commits entries on the main stream as a new call, returning its manifest. */
  async function commitOnMain(
    store: MemoryContextLogStore,
    append: ContextEntryInput[],
  ): Promise<ContextManifest> {
    const head = await store.readHead(MAIN);
    const { manifest } = await store.prepare({
      stream: MAIN,
      expectedRevision: head!.revision,
      idempotencyKey: `seed-${append[0]!.key}`,
      append,
      closeSuperseded: head!.lastManifestId,
      manifest: {
        projection: { adapter: "agent-sdk/messages", version: "2" },
        model: { provider: "mock-provider", modelId: "shared-model" },
        inputDigest: "0".repeat(64),
        toolSnapshot: "[]",
        callOptions: "{}",
      },
    });
    return manifest;
  }

  function forkChild(
    model: LanguageModel,
    store: ContextLogStore,
    sourceManifestId: string,
    overrides: Partial<AgentOptions> = {},
    streamId = "main/subagent/forker-x",
  ) {
    const agent = createAgent({
      model,
      systemPrompt: "Ignored for a fork.",
      contextLog: { mode: "log", store },
      ...overrides,
    });
    const options = {
      prompt: BRIEF,
      threadId: THREAD,
      contextStream: {
        streamId,
        forkFrom: { sourceManifestId, toolCallId: "call-x", subagentType: "forker" },
      },
    };
    return { agent, options, stream: { ...MAIN, streamId } };
  }

  async function expectRefused(
    promise: Promise<unknown>,
    kind: "conflict" | "invalid",
    reason: string,
  ) {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(isContextLogError(error, kind) && error.reason === reason, String(error)).toBe(true);
  }

  it.each([
    [
      "an unanswered tool call",
      {
        kind: "assistant",
        key: "pending-call",
        message: {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "open-1", toolName: "echo", input: {} }],
        },
      },
    ],
    [
      "an unresolved interrupt",
      {
        kind: "assistant",
        key: "pending-interrupt",
        message: {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "open-2", toolName: "echo", input: {} },
            { type: "tool-approval-request", approvalId: "interrupt-2", toolCallId: "open-2" },
          ],
        },
      },
    ],
  ] as Array<[string, ContextEntryInput]>)(
    "refuses a source with %s before anything is committed",
    async (_label, entry) => {
      const store = new MemoryContextLogStore();
      const shared = scriptedModel(() => text("Hi"));
      await sourceManifest(store, shared.model);
      const source = await commitOnMain(store, [entry]);
      const { agent, options, stream } = forkChild(shared.model, store, source.id);

      await expectRefused(agent.generate(options), "conflict", "fork_source_incomplete");
      expect(await store.readHead(stream)).toBeNull();
    },
  );

  it("refuses a first request over the context policy's hard limit", async () => {
    const store = new MemoryContextLogStore();
    const shared = scriptedModel(() => text("A long enough reply to fill a tiny budget."));
    const source = await sourceManifest(store, shared.model);
    const contextManager = createContextManager({
      maxTokens: 20,
      summarizer: async () => ({ text: "summary" }),
    });
    const { agent, options, stream } = forkChild(shared.model, store, source.id, {
      contextManager,
    });

    await expectRefused(agent.generate(options), "conflict", "fork_over_budget");
    expect(await store.readHead(stream)).toBeNull();
    expect(shared.requests).toHaveLength(1);
  });

  it("runs only on its source call's model", async () => {
    const store = new MemoryContextLogStore();
    const shared = scriptedModel(() => text("Hi"));
    const source = await sourceManifest(store, shared.model);
    const other = new MockLanguageModelV3({ modelId: "other-model", provider: "mock-provider" });
    const { agent, options, stream } = forkChild(other as LanguageModel, store, source.id);

    await expectRefused(agent.generate(options), "conflict", "fork_model_mismatch");
    expect(await store.readHead(stream)).toBeNull();
  });

  it("refuses a stream that is not a child of the source stream", async () => {
    const store = new MemoryContextLogStore();
    const shared = scriptedModel(() => text("Hi"));
    const source = await sourceManifest(store, shared.model);
    const { agent, options } = forkChild(shared.model, store, source.id, {}, "elsewhere");

    await expectRefused(agent.generate(options), "invalid", "invalid_fork_source");
  });

  it("refuses context producers on a fork", async () => {
    const store = new MemoryContextLogStore();
    const shared = scriptedModel(() => text("Hi"));
    const source = await sourceManifest(store, shared.model);
    const { agent, options } = forkChild(shared.model, store, source.id, {
      contextLog: {
        mode: "log",
        store,
        producers: [{ name: "clock", produce: () => [] }],
      },
    });

    await expect(agent.generate(options)).rejects.toThrow(/cannot have context producers/);
  });

  it("continues a fork only from the fork it declared", async () => {
    const store = new MemoryContextLogStore();
    const shared = scriptedModel(() => text("Hi"));
    const first = await sourceManifest(store, shared.model);
    await parentAgent(shared.model, store, []).generate({ prompt: "Again", threadId: THREAD });
    const second = await store.readManifest((await store.readHead(MAIN))!.lastManifestId);
    const { agent, options, stream } = forkChild(shared.model, store, first.id);

    expect((await agent.generate(options)).status).toBe("complete");
    // A host continuing the child keeps declaring the same fork.
    expect((await agent.generate({ ...options, prompt: "Continue" })).status).toBe("complete");
    const continued = shared.requests.at(-1)!;
    expect(continued.prompt.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "Continue" }],
    });
    const head = await store.readHead(stream);

    await expectRefused(
      agent.generate({
        ...options,
        prompt: "Continue",
        contextStream: {
          ...options.contextStream,
          forkFrom: { ...options.contextStream.forkFrom, sourceManifestId: second.id },
        },
      }),
      "conflict",
      "fork_source_mismatch",
    );
    expect(await store.readHead(stream)).toEqual(head);
  });
});
