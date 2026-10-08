/**
 * Log mode takes a run's new input as `prompt` or as `input`, an array of
 * user messages. Each message is screened by the PreGenerate hooks and
 * committed as its own `user` entry, in order, before anything is sent.
 * Input a host queues while the run works (`pendingUserInput`) is committed
 * the same way between tool-loop steps.
 */

import type { LanguageModelV3CallOptions, LanguageModelV3Content } from "@ai-sdk/provider";
import { APICallError, jsonSchema, type LanguageModel, tool, type UserModelMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { projectMessagesForModel } from "../../src/agent/model-capabilities.js";
import {
  type AgentOptions,
  ConfigurationError,
  type ContextEntry,
  type ContextLogStore,
  type ContextStreamRef,
  createAgent,
  createGuardrailsHooks,
  createMessageProjectionAdapter,
  createRetryHooks,
  createSecretsFilterHooks,
  GeneratePermissionDeniedError,
  type HookCallback,
  isContextLogError,
  MemoryContextLogStore,
  type PendingUserInputCommit,
  type PendingUserMessage,
  type PreGenerateInput,
  ValidationError,
} from "../../src/index.js";

const THREAD = "thread-1";
const STREAM: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const PDF = "JVBERi0xLjQK";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

type Reply = LanguageModelV3Content[] | (() => never);

const text = (value: string): LanguageModelV3Content[] => [{ type: "text", text: value }];

/** A model that answers each call with the next scripted reply and records every request. */
function createScriptedModel(replies: Reply[], onCall?: (index: number) => Promise<void> | void) {
  const requests: LanguageModelV3CallOptions[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (request) => {
      const index = requests.length;
      requests.push(request);
      await onCall?.(index);
      const reply = replies[Math.min(index, replies.length - 1)]!;
      if (typeof reply === "function") reply();
      const content = reply as LanguageModelV3Content[];
      const finishReason = content.some((part) => part.type === "tool-call")
        ? { unified: "tool-calls" as const, raw: "tool_calls" }
        : { unified: "stop" as const, raw: "stop" };
      return { content, finishReason, usage, warnings: [] };
    },
  });
  const inputs = () => requests.map((request) => JSON.stringify(request.prompt));
  return { model: model as LanguageModel, requests, inputs };
}

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

async function readPath(store: ContextLogStore): Promise<ContextEntry[]> {
  const head = await store.readHead(STREAM);
  if (!head) return [];
  return (await store.readPath(head, { limit: 1000 })).entries;
}

/** Two queued drafts, the second with a report and an internal text part. */
function queuedInput(): UserModelMessage[] {
  return [
    { role: "user", content: "first draft" },
    {
      role: "user",
      content: [
        { type: "text", text: "second draft" },
        { type: "file", data: PDF, mediaType: "application/pdf", filename: "q3.pdf" },
        {
          type: "text",
          text: "Referenced file: notes.md",
          providerOptions: { lleverage: { internal: true } },
        },
      ],
    },
  ];
}

describe("log-mode input as user messages", () => {
  it("commits two queued messages as two user entries, in order, before dispatch", async () => {
    const store = new MemoryContextLogStore();
    const tools = {
      echo: tool({
        inputSchema: jsonSchema<{ value: string }>({
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        }),
        execute: async ({ value }) => `echo:${value}`,
      }),
    };
    let pathAtFirstCall: ContextEntry[] = [];
    const { model, requests } = createScriptedModel(
      [
        [{ type: "tool-call", toolCallId: "c1", toolName: "echo", input: '{"value":"a"}' }],
        text("done"),
      ],
      async (index) => {
        if (index === 0) pathAtFirstCall = await readPath(store);
      },
    );
    const input = queuedInput();

    await logAgent(model, store, { tools }).generate({ input, threadId: THREAD });

    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual([
      "user",
      "user",
      "assistant",
      "tool_result",
      "assistant",
    ]);
    expect(path.slice(0, 2).map((entry) => entry.key.split(":").at(-1))).toEqual(["0", "1"]);
    expect(path.slice(0, 2).map((entry) => (entry.kind === "user" ? entry.message : null))).toEqual(
      input,
    );
    // The input was committed before the provider received the first call.
    expect(pathAtFirstCall.filter((entry) => entry.kind === "user")).toHaveLength(2);

    // Every step sends the two messages, in order, exactly as committed.
    for (const request of requests) {
      const users = request.prompt.filter((message) => message.role === "user");
      expect(users).toHaveLength(2);
      expect(JSON.stringify(users[0])).toContain("first draft");
      expect(JSON.stringify(users[1])).toContain("second draft");
      expect(JSON.stringify(users[1])).toContain("application/pdf");
      expect(JSON.stringify(users[1])).toContain("Referenced file: notes.md");
    }
    expect(
      JSON.stringify(requests[1]!.prompt).startsWith(
        JSON.stringify(requests[0]!.prompt).slice(0, -1),
      ),
    ).toBe(true);
  });

  it("shows each message to PreGenerate hooks as its own new message", async () => {
    const store = new MemoryContextLogStore();
    const seen: unknown[] = [];
    const recorder: HookCallback = async (hookInput) => {
      seen.push(structuredClone((hookInput as PreGenerateInput).options.messages));
      return {};
    };
    const { model } = createScriptedModel([text("ok")]);

    await logAgent(model, store, { hooks: { PreGenerate: [recorder] } }).generate({
      input: queuedInput(),
      threadId: THREAD,
    });

    // The first screening is the call's input; later ones are its outputs.
    expect(seen[0]).toEqual([
      { role: "user", content: "first draft" },
      {
        role: "user",
        content: [
          { type: "text", text: "second draft" },
          { type: "text", text: "q3.pdf" },
          { type: "text", text: "Referenced file: notes.md" },
          { type: "text", text: "lleverage" },
          { type: "text", text: "internal" },
        ],
      },
    ]);
  });

  it("screens text, file names and provider options of every message before commit", async () => {
    const store = new MemoryContextLogStore();
    const [inputFilter] = createSecretsFilterHooks();
    const { model, inputs } = createScriptedModel([text("ok")]);

    await logAgent(model, store, { hooks: { PreGenerate: [inputFilter] } }).generate({
      input: [
        { role: "user", content: `first ${AWS_KEY}` },
        {
          role: "user",
          content: [
            { type: "text", text: "see file" },
            { type: "file", data: PDF, mediaType: "application/pdf", filename: `${AWS_KEY}.pdf` },
          ],
          providerOptions: { anthropic: { context: `key ${AWS_KEY}` } },
        },
      ],
      threadId: THREAD,
    });

    const path = await readPath(store);
    expect(JSON.stringify(path)).not.toContain(AWS_KEY);
    expect(inputs()[0]).not.toContain(AWS_KEY);
    const second = path[1]!;
    expect(second.kind === "user" && second.message).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "see file" },
        { type: "file", data: PDF, mediaType: "application/pdf", filename: "[REDACTED].pdf" },
      ],
      providerOptions: { anthropic: { context: "key [REDACTED]" } },
    });
  });

  it("lets guardrails deny a blocked file part, committing and sending nothing", async () => {
    const store = new MemoryContextLogStore();
    const [inputFilter] = createGuardrailsHooks({ blockedInputPatterns: [/forbidden/] });
    const { model, requests } = createScriptedModel([text("ok")]);

    await expect(
      logAgent(model, store, { hooks: { PreGenerate: [inputFilter] } }).generate({
        input: [
          { role: "user", content: "fine" },
          {
            role: "user",
            content: [
              { type: "file", data: PDF, mediaType: "application/pdf", filename: "forbidden.pdf" },
            ],
          },
        ],
        threadId: THREAD,
      }),
    ).rejects.toThrow(GeneratePermissionDeniedError);
    expect(requests).toHaveLength(0);
    expect(await store.readHead(STREAM)).toBeNull();
  });

  it("never appends the input again on a retry", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createScriptedModel([
      () => {
        throw new Error("rate limit exceeded");
      },
      text("A1"),
    ]);

    await logAgent(model, store, {
      hooks: {
        PostGenerateFailure: [createRetryHooks({ maxRetries: 2, baseDelay: 1, jitter: false })],
      },
    }).generate({ input: queuedInput(), threadId: THREAD });

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.prompt)).toBe(JSON.stringify(requests[0]!.prompt));
    expect((await readPath(store)).map((entry) => entry.kind)).toEqual([
      "user",
      "user",
      "assistant",
    ]);
  });

  it("is not changed by a caller that mutates its input while the run is in flight", async () => {
    const store = new MemoryContextLogStore();
    const input = queuedInput();
    const { model, requests } = createScriptedModel(
      [
        () => {
          throw new Error("rate limit exceeded");
        },
        text("A1"),
      ],
      (index) => {
        if (index === 0) {
          input.push({ role: "user", content: "late" });
          (input[0] as { content: string }).content = "changed";
        }
      },
    );

    await logAgent(model, store, {
      hooks: {
        PostGenerateFailure: [createRetryHooks({ maxRetries: 2, baseDelay: 1, jitter: false })],
      },
    }).generate({ input, threadId: THREAD });

    expect(JSON.stringify(requests[1]!.prompt)).toBe(JSON.stringify(requests[0]!.prompt));
    const path = await readPath(store);
    expect(JSON.stringify(path)).not.toContain("changed");
    expect(JSON.stringify(path)).not.toContain("late");
  });

  it("reproduces identical input from the store alone after a restart", async () => {
    const store = new MemoryContextLogStore();
    const before = createScriptedModel([text("A1")]);
    await logAgent(before.model, store).generate({ input: queuedInput(), threadId: THREAD });

    // A new agent object with no in-memory state.
    const after = createScriptedModel([text("A2")]);
    await logAgent(after.model, store).generate({
      input: [{ role: "user", content: "and then?" }],
      threadId: THREAD,
    });

    expect(after.inputs()[0]!.startsWith(before.inputs()[0]!.slice(0, -1))).toBe(true);
    expect(after.inputs()[0]).toContain("and then?");
    expect((await readPath(store)).map((entry) => entry.kind)).toEqual([
      "user",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("projects user files the version's contract excludes as placeholders, and commits them whole", async () => {
    const store = new MemoryContextLogStore();
    const { model, inputs } = createScriptedModel([text("ok")]);

    await logAgent(model, store, {
      modelCapabilities: { fileInput: false, imageInput: false },
    }).generate({
      input: [
        {
          role: "user",
          content: [
            { type: "text", text: "two attachments" },
            { type: "file", data: PDF, mediaType: "application/pdf", filename: "q3.pdf" },
            { type: "file", data: "iVBORw0KGgo=", mediaType: "image/png" },
          ],
        },
      ],
      threadId: THREAD,
    });

    expect(inputs()[0]).toContain("[File omitted: active model does not support file input.]");
    expect(inputs()[0]).toContain("[Image omitted: active model does not support image input.]");
    expect(inputs()[0]).not.toContain(PDF);
    const [entry] = await readPath(store);
    expect(JSON.stringify(entry)).toContain(PDF);
  });
});

describe("log-mode input validation", () => {
  it("rejects input combined with prompt, non-user messages, unknown parts and bytes", async () => {
    const { model, requests } = createScriptedModel([text("ok")]);
    const agent = logAgent(model, new MemoryContextLogStore());
    const generate = (options: object) =>
      agent.generate({ threadId: THREAD, ...options }).catch((error: unknown) => error);

    expect(
      await generate({ prompt: "hi", input: [{ role: "user", content: "also" }] }),
    ).toBeInstanceOf(ValidationError);
    expect(await generate({ input: [{ role: "assistant", content: "history" }] })).toBeInstanceOf(
      ValidationError,
    );
    expect(await generate({ input: { role: "user", content: "not an array" } })).toBeInstanceOf(
      ValidationError,
    );
    expect(
      await generate({
        input: [
          { role: "user", content: [{ type: "tool-result", toolCallId: "c", toolName: "t" }] },
        ],
      }),
    ).toBeInstanceOf(ValidationError);
    const bytes = await generate({
      input: [
        {
          role: "user",
          content: [{ type: "file", data: new Uint8Array([1, 2]), mediaType: "application/pdf" }],
        },
      ],
    });
    expect(bytes).toBeInstanceOf(ValidationError);
    // Media data that is JSON but not a string would skip screening.
    for (const part of [
      { type: "file", data: { secret: "x" }, mediaType: "application/pdf" },
      { type: "file", data: "AAAA" },
      { type: "image", image: ["x"] },
      { type: "text", text: 1 },
    ]) {
      expect(await generate({ input: [{ role: "user", content: [part] }] })).toBeInstanceOf(
        ValidationError,
      );
    }
    // The error never names a key inside unscreened input.
    const secretKey = await generate({
      input: [{ role: "user", content: "hi", providerOptions: { p: { [AWS_KEY]: new Date(0) } } }],
    });
    expect(isContextLogError(secretKey, "invalid") && secretKey.reason).toBe("not_json");
    expect((secretKey as Error).message).not.toContain(AWS_KEY);
    expect(requests).toHaveLength(0);
  });

  it("treats an empty input like no prompt", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createScriptedModel([text("ok")]);
    await logAgent(model, store).generate({ input: [], threadId: THREAD });
    expect((await readPath(store)).map((entry) => entry.kind)).toEqual(["assistant"]);
  });

  it("rejects input outside log mode", async () => {
    const { model, requests } = createScriptedModel([text("ok")]);
    const agent = createAgent({ model, systemPrompt: "legacy" });

    await expect(agent.generate({ input: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      ConfigurationError,
    );
    expect(requests).toHaveLength(0);
  });

  it("rejects a PreGenerate hook that sets input", async () => {
    const { model, requests } = createScriptedModel([text("ok")]);
    const agent = logAgent(model, new MemoryContextLogStore(), {
      hooks: {
        PreGenerate: [
          async (hookInput) => ({
            hookSpecificOutput: {
              hookEventName: "PreGenerate",
              updatedInput: {
                ...(hookInput as PreGenerateInput).options,
                input: [{ role: "user", content: "injected" }],
              },
            },
          }),
        ],
      },
    });

    const error = await agent
      .generate({ prompt: "hi", threadId: THREAD })
      .catch((caught: unknown) => caught);

    expect(isContextLogError(error, "invalid") && error.reason).toBe("log_mode_hook_violation");
    expect(requests).toHaveLength(0);
  });
});

describe("user media projection", () => {
  const adapter = createMessageProjectionAdapter();
  const target = { provider: "p", modelId: "m" };
  const contract = {
    adapter: "agent-sdk/messages",
    adapterVersion: "1",
    imageInput: "true",
    fileInput: "true",
    userMedia: "placeholder",
  };
  const message: UserModelMessage = {
    role: "user",
    content: [
      { type: "text", text: "look" },
      { type: "image", image: "iVBORw0KGgo=", mediaType: "image/png" },
      { type: "file", data: PDF, mediaType: "application/pdf" },
    ],
  };
  const entries = [{ kind: "user" as const, key: "u", message }];

  it("keeps user media the contract allows and replaces only what it excludes", async () => {
    const keep = await adapter.project({ core: "", contract, entries, target });
    const noFiles = await adapter.project({
      core: "",
      contract: { ...contract, fileInput: "false" },
      entries,
      target,
    });
    const noImages = await adapter.project({
      core: "",
      contract: { ...contract, imageInput: "false" },
      entries,
      target,
    });

    expect(keep.messages).toEqual([message]);
    expect(noFiles.messages[0]!.content).toEqual([
      { type: "text", text: "look" },
      { type: "image", image: "iVBORw0KGgo=", mediaType: "image/png" },
      { type: "text", text: "[File omitted: active model does not support file input.]" },
    ]);
    expect(noImages.messages[0]!.content).toEqual([
      { type: "text", text: "look" },
      { type: "text", text: "[Image omitted: active model does not support image input.]" },
      { type: "file", data: PDF, mediaType: "application/pdf" },
    ]);
  });

  it("projects user media as stored on a version created before the userMedia contract key", async () => {
    const { userMedia: _userMedia, ...older } = contract;
    const result = await adapter.project({
      core: "",
      contract: { ...older, fileInput: "false", imageInput: "false" },
      entries,
      target,
    });
    expect(result.messages).toEqual([message]);
  });

  it("keeps projecting an older version's committed user media unchanged, without a transition", async () => {
    const store = new MemoryContextLogStore();
    const older = {
      adapter: "agent-sdk/messages",
      adapterVersion: "2",
      imageInput: "true",
      fileInput: "false",
    };
    const prepared = await store.prepare({
      stream: STREAM,
      expectedRevision: 0,
      idempotencyKey: "seed",
      transition: { reason: "initial", parent: null, core: "You are the core.", contract: older },
      append: entries,
      manifest: {
        projection: { adapter: "agent-sdk/messages", version: "2" },
        model: { provider: "mock-provider", modelId: "mock-model-id" },
        inputDigest: "0".repeat(64),
      },
    });
    await store.markDispatched(prepared.manifest.id);
    await store.recordOutcome(prepared.manifest.id, { status: "completed" });
    const { model, inputs } = createScriptedModel([text("ok")]);

    await logAgent(model, store, { modelCapabilities: { fileInput: false } }).generate({
      prompt: "next",
      threadId: THREAD,
    });

    expect(inputs()[0]).toContain(PDF);
    expect(inputs()[0]).not.toContain("[File omitted");
    const head = await store.readHead(STREAM);
    expect(head?.versionId).toBe(prepared.head.versionId);
  });

  it("leaves legacy capability projection of user parts unchanged", () => {
    const messages = [message];
    expect(projectMessagesForModel(messages, { fileInput: false, imageInput: false })).toEqual(
      messages,
    );
  });
});

describe("log-mode pending user input between steps", () => {
  const echo = (onExecute?: (value: string) => void) => ({
    echo: tool({
      inputSchema: jsonSchema<{ value: string }>({
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      }),
      execute: async ({ value }) => {
        onExecute?.(value);
        return `echo:${value}`;
      },
    }),
  });
  const echoCall = (id: string): LanguageModelV3Content => ({
    type: "tool-call",
    toolCallId: id,
    toolName: "echo",
    input: JSON.stringify({ value: id }),
  });
  const steer: PendingUserMessage = {
    id: "d1",
    message: {
      role: "user",
      content: [
        { type: "text", text: "also check Q3" },
        { type: "file", data: PDF, mediaType: "application/pdf", filename: "q3.pdf" },
      ],
    },
  };
  /** A host queue that keeps every message until told it was committed. */
  function hostQueue(store: ContextLogStore) {
    const pending: PendingUserMessage[] = [];
    const commits: Array<{ ids: string[]; alreadyCommitted: string[]; onPath: boolean }> = [];
    return {
      pending,
      commits,
      read: async () => [...pending],
      // The host only drops what it was told about; it may lag behind.
      onCommitted: async (ids: string[], { alreadyCommitted }: PendingUserInputCommit) => {
        const path = await readPath(store);
        commits.push({
          ids,
          alreadyCommitted,
          onPath: [...ids, ...alreadyCommitted].every((id) =>
            path.some((entry) => entry.key === `steer:${id}`),
          ),
        });
      },
    };
  }

  it("delivers input queued while tools run after all their results, committed before dispatch", async () => {
    const store = new MemoryContextLogStore();
    const queue = hostQueue(store);
    const read = vi.fn(queue.read);
    let requestsAtCommit = -1;
    const { model, requests } = createScriptedModel([
      [echoCall("c1"), echoCall("c2")],
      [echoCall("c3")],
      text("done"),
    ]);
    // The message arrives while the first step's tools run.
    const tools = echo((value) => {
      if (value === "c1") queue.pending.push(steer);
    });

    await logAgent(model, store, { tools }).generate({
      prompt: "go",
      threadId: THREAD,
      pendingUserInput: read,
      onPendingUserInputCommitted: async (ids, commit) => {
        requestsAtCommit = requests.length;
        await queue.onCommitted(ids, commit);
      },
    });

    // Read before each step after the first, never for the first.
    expect(read).toHaveBeenCalledTimes(2);
    // The next request carries it after both tool results, with its file.
    const second = requests[1]!.prompt;
    expect(second.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "user",
    ]);
    const tool = second[3]!;
    expect(tool.role === "tool" && tool.content.map((part) => part.toolCallId)).toEqual([
      "c1",
      "c2",
    ]);
    expect(JSON.stringify(second[4])).toContain("also check Q3");
    expect(JSON.stringify(second[4])).toContain("application/pdf");
    // It stays in every later step, once.
    expect(requests[2]!.prompt.slice(0, 5)).toEqual(second);
    expect(JSON.stringify(requests[2]!.prompt).split("also check Q3")).toHaveLength(2);
    // Committed as a user entry before the request carrying it was sent.
    const path = await readPath(store);
    expect(path.map((entry) => `${entry.kind}:${entry.key.split(":")[0]}`)).toEqual([
      "user:user",
      "assistant:output",
      "tool_result:output",
      "tool_result:output",
      "user:steer",
      "assistant:output",
      "tool_result:output",
      "assistant:output",
    ]);
    expect(path[4]!.kind === "user" && path[4]!.message).toEqual(steer.message);
    // Reported once, after the commit, before the request was dispatched,
    // although the host kept returning it.
    expect(queue.commits).toEqual([{ ids: ["d1"], alreadyCommitted: [], onPath: true }]);
    expect(requestsAtCommit).toBe(1);
  });

  it("never takes new input for a provider retry of the same call", async () => {
    const store = new MemoryContextLogStore();
    const queue = hostQueue(store);
    const read = vi.fn(queue.read);
    let failed = false;
    const { model, requests } = createScriptedModel([[echoCall("c1")], text("done")], (index) => {
      if (index !== 1 || failed) return;
      failed = true;
      // A message arrives while the call is in flight, and the call fails.
      queue.pending.push({ id: "late", message: { role: "user", content: "late" } });
      throw new APICallError({
        message: "overloaded",
        url: "https://provider.test",
        requestBodyValues: {},
        statusCode: 529,
        // Retry at once instead of after the AI SDK's real-time backoff.
        responseHeaders: { "retry-after-ms": "0" },
        isRetryable: true,
      });
    });
    queue.pending.push(steer);

    await logAgent(model, store, { tools: echo() }).generate({
      prompt: "go",
      threadId: THREAD,
      pendingUserInput: read,
      onPendingUserInputCommitted: queue.onCommitted,
    });

    expect(requests).toHaveLength(3);
    expect(read).toHaveBeenCalledTimes(1);
    expect(requests[2]!.prompt).toEqual(requests[1]!.prompt);
    expect(JSON.stringify(requests[2]!.prompt)).not.toContain("late");
    expect(queue.commits).toEqual([{ ids: ["d1"], alreadyCommitted: [], onPath: true }]);
  });

  it("does not deliver an id a resumed run already committed, and reports it", async () => {
    const store = new MemoryContextLogStore();
    const queue = hostQueue(store);
    queue.pending.push(steer);
    const first = createScriptedModel([[echoCall("c1")], text("done")]);
    await logAgent(first.model, store, { tools: echo() }).generate({
      prompt: "go",
      threadId: THREAD,
      pendingUserInput: queue.read,
    });

    // The host never heard of the commit and offers the message again.
    const second = createScriptedModel([[echoCall("c2")], text("done again")]);
    await logAgent(second.model, store, { tools: echo() }).generate({
      prompt: "and then?",
      threadId: THREAD,
      pendingUserInput: queue.read,
      onPendingUserInputCommitted: queue.onCommitted,
    });

    const path = await readPath(store);
    expect(path.filter((entry) => entry.key === "steer:d1")).toHaveLength(1);
    expect(JSON.stringify(second.requests[1]!.prompt).split("also check Q3")).toHaveLength(2);
    expect(queue.commits).toEqual([{ ids: [], alreadyCommitted: ["d1"], onPath: true }]);
  });

  it("screens pending input with the PreGenerate hooks before commit", async () => {
    const store = new MemoryContextLogStore();
    const [inputFilter] = createSecretsFilterHooks();
    const { model, inputs } = createScriptedModel([[echoCall("c1")], text("done")]);

    await logAgent(model, store, {
      tools: echo(),
      hooks: { PreGenerate: [inputFilter] },
    }).generate({
      prompt: "go",
      threadId: THREAD,
      pendingUserInput: async () => [
        { id: "s1", message: { role: "user", content: `key ${AWS_KEY}` } },
      ],
    });

    expect(inputs()[1]).not.toContain(AWS_KEY);
    expect(JSON.stringify(await readPath(store))).not.toContain(AWS_KEY);
  });
});
