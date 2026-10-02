/**
 * Log-mode interrupts and resume.
 *
 * An interrupt leaves the model's tool call on the log without a result.
 * Resuming appends a resolution and the tool's result as outputs of the
 * interrupted call and continues as an ordinary log-mode generation, so the
 * provider receives the same input as a run that was never interrupted.
 * Each resume runs on a freshly created agent, as after a restart.
 */

import type { LanguageModelV3CallOptions, LanguageModelV3Content } from "@ai-sdk/provider";
import {
  type AssistantModelMessage,
  jsonSchema,
  type LanguageModel,
  type ModelMessage,
  type ToolExecutionOptions,
  tool,
} from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { describeProviderCall } from "../../src/agent/log-boundary.js";
import { MemorySaver } from "../../src/checkpointer/memory-saver.js";
import {
  type Agent,
  type AgentOptions,
  type ContextAppendOutputsRequest,
  type ContextAppendOutputsResult,
  type ContextEntry,
  type ContextLogStore,
  type ContextStreamRef,
  createAgent,
  createSecretsFilterHooks,
  type GenerateResult,
  isContextLogError,
  MemoryContextLogStore,
  type StreamPart,
} from "../../src/index.js";
import { AgentSession } from "../../src/session.js";
import { createBackgroundTask } from "../../src/task-store/types.js";

const THREAD = "thread-1";
const STREAM: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

type Reply = LanguageModelV3Content[];

const text = (value: string): Reply => [{ type: "text", text: value }];
const toolCalls = (...calls: Array<[id: string, name: string, input: object]>): Reply =>
  calls.map(([toolCallId, toolName, input]) => ({
    type: "tool-call",
    toolCallId,
    toolName,
    input: JSON.stringify(input),
  }));

/** A model that answers each call with the next scripted reply and records every request. */
function scriptedModel(replies: Array<Reply | Error>) {
  const requests: LanguageModelV3CallOptions[] = [];
  const respond = (request: LanguageModelV3CallOptions) => {
    requests.push(request);
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)]!;
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const finishFor = (content: Reply) =>
    content.some((part) => part.type === "tool-call")
      ? { unified: "tool-calls" as const, raw: "tool_calls" }
      : { unified: "stop" as const, raw: "stop" };
  const model = new MockLanguageModelV3({
    modelId: "mock-model-id",
    provider: "mock-provider",
    doGenerate: async (request) => {
      const content = respond(request);
      return { content, finishReason: finishFor(content), usage, warnings: [] };
    },
    doStream: async (request) => {
      const content = respond(request);
      const parts = [
        { type: "stream-start" as const, warnings: [] },
        ...content.flatMap((part) =>
          part.type === "text"
            ? [
                { type: "text-start" as const, id: "t" },
                { type: "text-delta" as const, id: "t", delta: part.text },
                { type: "text-end" as const, id: "t" },
              ]
            : [part],
        ),
        { type: "finish" as const, finishReason: finishFor(content), usage },
      ];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part as never);
            controller.close();
          },
        }),
      };
    },
  });
  return { model: model as LanguageModel, requests };
}

type InterruptFn = (request: unknown, options?: { type?: string }) => Promise<unknown>;
const interruptOf = (options: ToolExecutionOptions<unknown>) =>
  (options as unknown as { interrupt: InterruptFn }).interrupt;

const deployInput = jsonSchema<{ env: string }>({
  type: "object",
  properties: { env: { type: "string" } },
  required: ["env"],
});

/** A tool that asks for approval before it deploys. */
const approvalTools = (runs: string[] = []) => ({
  deploy: tool({
    description: "Deploys",
    inputSchema: deployInput,
    execute: async (input, options) => {
      const decision = (await interruptOf(options)(
        { toolName: "deploy", args: input },
        { type: "approval" },
      )) as { approved: boolean };
      runs.push(`${options.toolCallId}:${decision.approved}`);
      return `deployed:${input.env}`;
    },
  }),
});

const askInput = jsonSchema<{ question: string }>({
  type: "object",
  properties: { question: { type: "string" } },
  required: ["question"],
});

/** A tool that asks the user a question. */
const askTools = (runs: string[] = []) => ({
  ask: tool({
    description: "Asks the user",
    inputSchema: askInput,
    execute: async (input, options) => {
      const answer = await interruptOf(options)(input);
      runs.push(String(answer));
      return { answer };
    },
  }),
});

function logAgent(model: LanguageModel, store: ContextLogStore, overrides: Partial<AgentOptions>) {
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

/**
 * A path's messages without the interrupt records: approval parts are
 * dropped, and so are tool messages left empty. This is what the provider
 * is sent once the AI SDK merges adjacent tool messages.
 */
function withoutInterruptRecords(path: ContextEntry[]): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const entry of path) {
    if (entry.kind === "runtime_context") continue;
    const message = entry.message;
    if (typeof message.content === "string") {
      messages.push(message);
      continue;
    }
    const content = (message.content as Array<{ type: string }>).filter(
      (part) => part.type !== "tool-approval-request" && part.type !== "tool-approval-response",
    );
    if (content.length === 0) continue;
    const previous = messages.at(-1);
    if (message.role === "tool" && previous?.role === "tool") {
      previous.content.push(...(content as typeof previous.content));
    } else {
      messages.push({ ...message, content } as ModelMessage);
    }
  }
  return messages;
}

async function expectInterrupted(result: Promise<GenerateResult>) {
  const settled = await result;
  expect(settled.status).toBe("interrupted");
  if (settled.status !== "interrupted") throw new Error("not interrupted");
  return settled.interrupt;
}

describe("log-mode interrupts", () => {
  it("leaves the interrupted call on the log without its placeholder result", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const { model } = scriptedModel([toolCalls(["c1", "deploy", { env: "prod" }])]);

    const interrupt = await expectInterrupted(
      logAgent(model, store, { tools: approvalTools(), checkpointer }).generate({
        prompt: "deploy it",
        threadId: THREAD,
      }),
    );

    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual(["user", "assistant"]);
    expect((path[1]!.message as AssistantModelMessage).content).toEqual([
      { type: "tool-call", toolCallId: "c1", toolName: "deploy", input: { env: "prod" } },
      { type: "tool-approval-request", approvalId: interrupt.id, toolCallId: "c1" },
    ]);
    expect(JSON.stringify(path)).not.toContain("[Interrupt requested]");
    // The pending interrupt stays control state.
    const checkpoint = await checkpointer.load(THREAD);
    expect(checkpoint?.pendingInterrupt?.id).toBe(interrupt.id);
    expect(checkpoint?.messages).toEqual([]);
  });

  it.each(["stream", "streamRaw", "streamDataResponse"] as const)(
    "records the interrupt the same way in %s()",
    async (mode) => {
      const store = new MemoryContextLogStore();
      const checkpointer = new MemorySaver();
      const { model } = scriptedModel([toolCalls(["c1", "deploy", { env: "prod" }])]);
      const agent = logAgent(model, store, { tools: approvalTools(), checkpointer });
      const options = { prompt: "deploy it", threadId: THREAD };
      if (mode === "stream") {
        for await (const _part of agent.stream(options)) {
          // drain
        }
      } else if (mode === "streamRaw") {
        const result = await agent.streamRaw(options);
        await result.consumeStream();
        await result.text;
      } else {
        await (await agent.streamDataResponse(options)).text();
      }

      const path = await readPath(store);
      expect(path.map((entry) => entry.kind)).toEqual(["user", "assistant"]);
      expect((path[1]!.message as AssistantModelMessage).content).toContainEqual({
        type: "tool-approval-request",
        approvalId: "int_c1",
        toolCallId: "c1",
      });
      expect(JSON.stringify(path)).not.toContain("[Interrupt requested]");
    },
  );

  it("commits the other results of the interrupted step", async () => {
    const store = new MemoryContextLogStore();
    const tools = {
      ...approvalTools(),
      echo: tool({
        inputSchema: jsonSchema<{ value: string }>({
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        }),
        execute: async ({ value }) => `echo:${value}`,
      }),
    };
    const { model } = scriptedModel([
      toolCalls(["c1", "deploy", { env: "prod" }], ["c2", "echo", { value: "x" }]),
    ]);

    await expectInterrupted(
      logAgent(model, store, { tools, checkpointer: new MemorySaver() }).generate({
        prompt: "go",
        threadId: THREAD,
      }),
    );

    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual(["user", "assistant", "tool_result"]);
    expect(path[2]!.message.content).toEqual([
      expect.objectContaining({ type: "tool-result", toolCallId: "c2" }),
    ]);
  });

  it("refuses to generate on a stream with an unresolved interrupt", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const { model, requests } = scriptedModel([toolCalls(["c1", "deploy", { env: "prod" }])]);
    const agent = logAgent(model, store, { tools: approvalTools(), checkpointer });
    await expectInterrupted(agent.generate({ prompt: "deploy it", threadId: THREAD }));
    const before = await store.readHead(STREAM);

    const error = await agent.generate({ prompt: "never mind", threadId: THREAD }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(isContextLogError(error, "conflict")).toBe(true);
    expect((error as { reason: string }).reason).toBe("interrupt_pending");
    expect(requests).toHaveLength(1);
    expect(await store.readHead(STREAM)).toEqual(before);
  });
});

describe("log-mode resume", () => {
  /**
   * Interrupts a run on one agent, resumes it on a fresh one, and runs the
   * same conversation without an interrupt on a third. Returns both paths
   * and the provider requests of the resumed continuation and the reference
   * run's second step.
   */
  async function resumeAndCompare(params: {
    tools: () => AgentOptions["tools"];
    referenceTools: AgentOptions["tools"];
    call: [string, string, object];
    response: unknown;
  }) {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const interrupted = scriptedModel([toolCalls(params.call)]);
    const interrupt = await expectInterrupted(
      logAgent(interrupted.model, store, { tools: params.tools(), checkpointer }).generate({
        prompt: "go",
        threadId: THREAD,
      }),
    );

    const resumed = scriptedModel([text("done")]);
    const result = await logAgent(resumed.model, store, {
      tools: params.tools(),
      checkpointer,
    }).resume(THREAD, interrupt.id, params.response);
    expect(result.status).toBe("complete");

    const referenceStore = new MemoryContextLogStore();
    const reference = scriptedModel([toolCalls(params.call), text("done")]);
    await logAgent(reference.model, referenceStore, {
      tools: params.referenceTools,
      checkpointer: new MemorySaver(),
    }).generate({ prompt: "go", threadId: THREAD });

    return {
      interrupt,
      checkpointer,
      path: await readPath(store),
      referencePath: await readPath(referenceStore),
      continuation: resumed.requests,
      referenceStep: reference.requests[1]!,
    };
  }

  const resumeCases = [
    {
      name: "an approved",
      tools: () => approvalTools(),
      referenceTools: {
        deploy: tool({
          description: "Deploys",
          inputSchema: deployInput,
          execute: async ({ env }) => `deployed:${env}`,
        }),
      },
      call: ["c1", "deploy", { env: "prod" }] as [string, string, object],
      response: { approved: true },
      resolution: { approved: true },
    },
    {
      name: "a rejected",
      tools: () => approvalTools(),
      referenceTools: {
        deploy: tool({
          description: "Deploys",
          inputSchema: deployInput,
          execute: async () => 'Tool "deploy" was denied by user: not today',
        }),
      },
      call: ["c1", "deploy", { env: "prod" }] as [string, string, object],
      response: { approved: false, reason: "not today" },
      resolution: { approved: false, reason: "not today" },
    },
    {
      name: "a custom-answer",
      tools: () => askTools(),
      referenceTools: {
        ask: tool({
          description: "Asks the user",
          inputSchema: askInput,
          execute: async () => ({ answer: "Alice" }),
        }),
      },
      call: ["c1", "ask", { question: "Name?" }] as [string, string, object],
      response: "Alice",
      // The answer is recorded as canonical JSON.
      resolution: { approved: true, reason: '{"answer":"Alice"}' },
    },
  ];

  it.each(resumeCases)(
    "sends the continuation of $name resume the input of a run never interrupted",
    async (scenario) => {
      const { interrupt, checkpointer, path, referencePath, continuation, referenceStep } =
        await resumeAndCompare(scenario);

      // The same provider input, byte for byte.
      expect(continuation).toHaveLength(1);
      expect(continuation[0]!.prompt).toEqual(referenceStep.prompt);
      expect(describeProviderCall(continuation[0]!).inputDigest).toBe(
        describeProviderCall(referenceStep).inputDigest,
      );

      // The same log, plus the interrupt and its resolution.
      expect(withoutInterruptRecords(path)).toEqual(withoutInterruptRecords(referencePath));
      expect(path.map((entry) => entry.kind)).toEqual([
        "user",
        "assistant",
        "tool_result",
        "tool_result",
        "assistant",
      ]);
      const resolutionKey = `interrupt:${interrupt.id}:${interrupt.createdAt}:resolution`;
      expect(path[2]!.key).toBe(resolutionKey);
      expect(path[2]!.message.content).toEqual([
        { type: "tool-approval-response", approvalId: interrupt.id, ...scenario.resolution },
      ]);
      expect(path[3]!.key).toBe(`interrupt:${interrupt.id}:${interrupt.createdAt}:result`);
      // Both are outputs of the interrupted call.
      expect(path[2]!.manifestId).toBe(path[1]!.manifestId);
      expect(path[3]!.manifestId).toBe(path[1]!.manifestId);

      const checkpoint = await checkpointer.load(THREAD);
      expect(checkpoint?.pendingInterrupt).toBeUndefined();
      expect(checkpoint?.messages).toEqual([]);
    },
  );

  it("runs the approved tool through the tool pipeline and its hooks", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const interrupt = await expectInterrupted(
      logAgent(scriptedModel([toolCalls(["c1", "deploy", { env: "prod" }])]).model, store, {
        tools: approvalTools(),
        checkpointer,
      }).generate({ prompt: "go", threadId: THREAD }),
    );

    const runs: string[] = [];
    const events: string[] = [];
    const agent = logAgent(scriptedModel([text("done")]).model, store, {
      tools: approvalTools(runs),
      checkpointer,
      hooks: {
        InterruptResolved: [
          async (input) => {
            events.push(`resolved:${(input as { approved?: boolean }).approved}`);
            return {};
          },
        ],
        PreToolUse: [
          {
            hooks: [
              async (_input, toolUseId) => {
                events.push(`pre:${toolUseId}`);
                return {};
              },
            ],
          },
        ],
        PostToolUse: [
          {
            hooks: [
              async (input) => {
                events.push(`post:${(input as { tool_response: unknown }).tool_response}`);
                return {
                  hookSpecificOutput: {
                    hookEventName: "PostToolUse" as const,
                    updatedResult: "deployed (shaped)",
                  },
                };
              },
            ],
          },
        ],
      },
    });
    await agent.resume(THREAD, interrupt.id, { approved: true });

    expect(runs).toEqual(["c1:true"]);
    expect(events).toEqual(["resolved:true", "pre:c1", "post:deployed:prod"]);
    const path = await readPath(store);
    expect(path[3]!.message.content).toEqual([
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "deploy",
        output: { type: "text", value: "deployed (shaped)" },
      },
    ]);
  });

  it("screens the resumed result with the PreGenerate hooks before commit", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const leakTools = () => ({
      ask: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async (_input, options) => {
          const answer = await interruptOf(options)({});
          return `key for ${answer}: AKIAIOSFODNN7EXAMPLE`;
        },
      }),
    });
    const [inputFilter] = createSecretsFilterHooks();
    const hooks = { PreGenerate: [inputFilter] };
    const interrupt = await expectInterrupted(
      logAgent(scriptedModel([toolCalls(["c1", "ask", {}])]).model, store, {
        tools: leakTools(),
        checkpointer,
        hooks,
      }).generate({ prompt: "go", threadId: THREAD }),
    );

    const resumed = scriptedModel([text("done")]);
    await logAgent(resumed.model, store, { tools: leakTools(), checkpointer, hooks }).resume(
      THREAD,
      interrupt.id,
      "prod",
    );

    expect(JSON.stringify(await readPath(store))).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(JSON.stringify(resumed.requests[0]!.prompt)).toContain("[REDACTED]");
  });

  it("commits a tool error during resume as a normal step would", async () => {
    const failing = () => ({
      ask: tool({
        description: "Asks the user",
        inputSchema: askInput,
        execute: async (input, options) => {
          await interruptOf(options)(input);
          throw new Error("boom");
        },
      }),
    });
    const { continuation, referenceStep, path } = await resumeAndCompare({
      tools: failing,
      referenceTools: {
        ask: tool({
          description: "Asks the user",
          inputSchema: askInput,
          execute: async () => {
            throw new Error("boom");
          },
        }),
      },
      call: ["c1", "ask", { question: "Name?" }],
      response: "Alice",
    });

    expect(continuation[0]!.prompt).toEqual(referenceStep.prompt);
    expect(path[3]!.message.content).toEqual([
      expect.objectContaining({ output: { type: "error-text", value: "Error: boom" } }),
    ]);
  });

  it("restores the thread's todos and files before the resumed tool runs, and keeps its changes", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const holder: { agent?: Agent } = {};
    const notesTools = () => ({
      notes: tool({
        description: "Reads the notes",
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async (_input, options) => {
          await interruptOf(options)({});
          const state = holder.agent!.state;
          state.todos = [
            ...state.todos,
            {
              id: "t2",
              content: "follow up",
              status: "pending",
              createdAt: "2026-10-02T00:00:00Z",
            },
          ];
          return `notes:${state.files["/notes.md"]?.content.join("\n") ?? "missing"}`;
        },
      }),
    });
    const first = logAgent(scriptedModel([toolCalls(["c1", "notes", {}])]).model, store, {
      tools: notesTools(),
      checkpointer,
    });
    first.state.todos = [
      { id: "t1", content: "draft", status: "in_progress", createdAt: "2026-10-01T00:00:00Z" },
    ];
    first.state.files = {
      "/notes.md": { content: ["remember"], created_at: "x", modified_at: "x" },
    };
    const interrupt = await expectInterrupted(first.generate({ prompt: "go", threadId: THREAD }));

    // A fresh agent, as after a restart, starts with empty live state.
    const resumed = logAgent(scriptedModel([text("done")]).model, store, {
      tools: notesTools(),
      checkpointer,
    });
    holder.agent = resumed;
    await resumed.resume(THREAD, interrupt.id, "ok");

    const path = await readPath(store);
    expect(path[3]!.message.content).toEqual([
      expect.objectContaining({ output: { type: "text", value: "notes:remember" } }),
    ]);
    const saved = await checkpointer.load(THREAD);
    expect(saved?.state.files["/notes.md"]?.content).toEqual(["remember"]);
    expect(saved?.state.todos.map((todo) => todo.id)).toEqual(["t1", "t2"]);
  });

  it("gives the resumed tool the stream's delegation scope, as in a normal step", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const scopes: unknown[] = [];
    const scopeTools = () => ({
      ask: tool({
        description: "Asks the user",
        inputSchema: askInput,
        execute: async (input, options) => {
          await interruptOf(options)(input);
          const context = options.experimental_context as {
            agentSdk?: { contextLog?: { stream: ContextStreamRef } };
          };
          scopes.push(context.agentSdk?.contextLog?.stream);
          return "noted";
        },
      }),
    });
    const interrupt = await expectInterrupted(
      logAgent(scriptedModel([toolCalls(["c1", "ask", { question: "Go?" }])]).model, store, {
        tools: scopeTools(),
        checkpointer,
      }).generate({ prompt: "go", threadId: THREAD }),
    );

    await logAgent(scriptedModel([text("done")]).model, store, {
      tools: scopeTools(),
      checkpointer,
    }).resume(THREAD, interrupt.id, "yes");

    expect(scopes).toEqual([STREAM]);
  });

  it("records a custom answer the tool does not echo", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const ackTools = () => ({
      ask: tool({
        description: "Asks the user",
        inputSchema: askInput,
        execute: async (input, options) => {
          await interruptOf(options)(input);
          return "noted";
        },
      }),
    });
    const interrupt = await expectInterrupted(
      logAgent(scriptedModel([toolCalls(["c1", "ask", { question: "Pin?" }])]).model, store, {
        tools: ackTools(),
        checkpointer,
      }).generate({ prompt: "go", threadId: THREAD }),
    );

    await logAgent(scriptedModel([text("done")]).model, store, {
      tools: ackTools(),
      checkpointer,
    }).resume(THREAD, interrupt.id, { choice: "blue", count: 2 });

    const path = await readPath(store);
    expect(path[2]!.message.content).toEqual([
      {
        type: "tool-approval-response",
        approvalId: interrupt.id,
        approved: true,
        reason: '{"answer":{"choice":"blue","count":2}}',
      },
    ]);
    expect(path[3]!.message.content).toEqual([
      expect.objectContaining({ output: { type: "text", value: "noted" } }),
    ]);
  });

  it("continues through resumeDataResponse() as an ordinary streamed generation", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const interrupt = await expectInterrupted(
      logAgent(scriptedModel([toolCalls(["c1", "ask", { question: "Name?" }])]).model, store, {
        tools: askTools(),
        checkpointer,
      }).generate({ prompt: "go", threadId: THREAD }),
    );

    const resumed = scriptedModel([text("streamed")]);
    const response = await logAgent(resumed.model, store, {
      tools: askTools(),
      checkpointer,
    }).resumeDataResponse(THREAD, interrupt.id, "Alice");
    await response.text();

    expect(resumed.requests).toHaveLength(1);
    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "tool_result",
      "tool_result",
      "assistant",
    ]);
    expect(path[4]!.message.content).toEqual([{ type: "text", text: "streamed" }]);
  });

  it("records each round of a tool that interrupts again, even within one millisecond", async () => {
    // Every interrupt is created at the same instant.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-02T00:00:00.000Z") });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    let round = 0;
    const formTools = () => ({
      form: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async (_input, options) => {
          const ask = interruptOf(options);
          round += 1;
          // Each execution replays the answered question, then asks the next.
          if (round === 1) return ask({ step: 1 });
          if (round === 2) {
            await ask({ step: 1 });
            return ask({ step: 2 });
          }
          return `done: ${await ask({ step: 2 })}`;
        },
      }),
    });
    const first = await expectInterrupted(
      logAgent(scriptedModel([toolCalls(["c1", "form", {}])]).model, store, {
        tools: formTools(),
        checkpointer,
      }).generate({ prompt: "go", threadId: THREAD }),
    );
    // The second round interrupts again, with the same id but a new request.
    const second = await expectInterrupted(
      logAgent(scriptedModel([text("never")]).model, store, {
        tools: formTools(),
        checkpointer,
      }).resume(THREAD, first.id, "one"),
    );
    expect(second.request).toEqual({ step: 2 });

    const resumed = scriptedModel([text("done")]);
    const result = await logAgent(resumed.model, store, {
      tools: formTools(),
      checkpointer,
    }).resume(THREAD, second.id, "two");

    expect(result.status).toBe("complete");
    const path = await readPath(store);
    expect(path.map((entry) => entry.key.split(":").slice(-1)[0])).toEqual([
      "0",
      "0",
      "resolution",
      "resolution",
      "result",
      "0",
    ]);
    expect(path[4]!.message.content).toEqual([
      expect.objectContaining({ output: { type: "text", value: "done: two" } }),
    ]);
  });
});

/** Drains a stream of parts. */
async function drain(parts: AsyncIterable<StreamPart>): Promise<StreamPart[]> {
  const seen: StreamPart[] = [];
  for await (const part of parts) seen.push(part);
  return seen;
}

describe("log-mode resumeStream", () => {
  /** Interrupts a deploy on one agent and returns what a fresh agent needs to resume it. */
  async function interrupted(tools: () => AgentOptions["tools"] = () => approvalTools()) {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const interrupt = await expectInterrupted(
      logAgent(scriptedModel([toolCalls(["c1", "deploy", { env: "prod" }])]).model, store, {
        tools: tools(),
        checkpointer,
      }).generate({ prompt: "go", threadId: THREAD }),
    );
    return { store, checkpointer, interrupt };
  }

  it("streams the continuation with the parts and provider input of resume()", async () => {
    const streamed = await interrupted();
    const resumed = scriptedModel([text("done")]);
    const parts = await drain(
      logAgent(resumed.model, streamed.store, {
        tools: approvalTools(),
        checkpointer: streamed.checkpointer,
      }).resumeStream(THREAD, streamed.interrupt.id, { approved: true }),
    );

    const generated = await interrupted();
    const reference = scriptedModel([text("done")]);
    const result = await logAgent(reference.model, generated.store, {
      tools: approvalTools(),
      checkpointer: generated.checkpointer,
    }).resume(THREAD, generated.interrupt.id, { approved: true });
    expect(result.status).toBe("complete");

    expect(parts.map((part) => part.type)).toEqual([
      "turn-start",
      "text-delta",
      "turn-end",
      "finish",
    ]);
    expect(parts[1]).toEqual({ type: "text-delta", text: "done" });
    // The same provider input and the same log as resume().
    expect(resumed.requests).toHaveLength(1);
    expect(describeProviderCall(resumed.requests[0]!).inputDigest).toBe(
      describeProviderCall(reference.requests[0]!).inputDigest,
    );
    // Keys carry each run's own id; everything else matches.
    const strip = (path: ContextEntry[]) =>
      path.map(({ kind, message }) => ({ kind, message }) as Partial<ContextEntry>);
    expect(strip(await readPath(streamed.store))).toEqual(strip(await readPath(generated.store)));
    expect((await streamed.checkpointer.load(THREAD))?.pendingInterrupt).toBeUndefined();
  });

  it("does nothing until it is iterated", async () => {
    const { store, checkpointer, interrupt } = await interrupted();
    const before = await store.readHead(STREAM);
    const resumed = scriptedModel([text("done")]);

    logAgent(resumed.model, store, { tools: approvalTools(), checkpointer }).resumeStream(
      THREAD,
      interrupt.id,
      { approved: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await store.readHead(STREAM)).toEqual(before);
    expect((await checkpointer.load(THREAD))?.pendingInterrupt?.id).toBe(interrupt.id);
    expect(resumed.requests).toHaveLength(0);
  });

  it("throws a refused resume from its first iteration, before any part", async () => {
    const { store, checkpointer } = await interrupted();
    const iterator = logAgent(scriptedModel([text("never")]).model, store, {
      tools: approvalTools(),
      checkpointer,
    }).resumeStream(THREAD, "int_other", { approved: true });

    await expect(iterator.next()).rejects.toThrow(/interrupt ID mismatch/);
  });

  it("never appends new input to the continuation", async () => {
    const { store, checkpointer, interrupt } = await interrupted();
    const resumed = scriptedModel([text("done")]);
    await drain(
      logAgent(resumed.model, store, { tools: approvalTools(), checkpointer }).resumeStream(
        THREAD,
        interrupt.id,
        { approved: true },
        { prompt: "sneaky", input: [{ role: "user", content: "also sneaky" }] },
      ),
    );

    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "tool_result",
      "tool_result",
      "assistant",
    ]);
    expect(JSON.stringify(resumed.requests[0]!.prompt)).not.toContain("sneaky");
  });

  it("ends without parts when the tool interrupts again", async () => {
    let round = 0;
    const formTools = () => ({
      deploy: tool({
        inputSchema: deployInput,
        execute: async (_input, options) => {
          const ask = interruptOf(options);
          round += 1;
          await ask({ step: 1 });
          return ask({ step: 2 });
        },
      }),
    });
    const { store, checkpointer, interrupt } = await interrupted(formTools);
    const resumed = scriptedModel([text("never")]);
    const agent = logAgent(resumed.model, store, { tools: formTools(), checkpointer });

    const parts = await drain(agent.resumeStream(THREAD, interrupt.id, "one"));

    expect(parts).toEqual([]);
    expect(resumed.requests).toHaveLength(0);
    expect((await agent.getInterrupt(THREAD))?.request).toEqual({ step: 2 });
    expect(round).toBe(2);
  });

  it("commits the resumed result once when the continuation fails, and a plain stream() continues", async () => {
    const { store, checkpointer, interrupt } = await interrupted();
    const runs: string[] = [];
    const failing = scriptedModel([new Error("provider down")]);
    await expect(
      drain(
        logAgent(failing.model, store, {
          tools: approvalTools(runs),
          checkpointer,
        }).resumeStream(THREAD, interrupt.id, { approved: true }),
      ),
    ).rejects.toThrow();
    expect(runs).toEqual(["c1:true"]);
    expect((await checkpointer.load(THREAD))?.pendingInterrupt).toBeUndefined();

    // The resolution and the result stay committed; continuing needs no resume.
    const recovered = scriptedModel([text("done")]);
    const parts = await drain(
      logAgent(recovered.model, store, { tools: approvalTools(runs), checkpointer }).stream({
        threadId: THREAD,
      }),
    );
    expect(parts.at(-1)?.type).toBe("finish");
    expect(runs).toEqual(["c1:true"]);
    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "tool_result",
      "tool_result",
      "assistant",
    ]);
  });
});

describe("legacy resumeStream", () => {
  it("streams the continuation of a legacy resume", async () => {
    const checkpointer = new MemorySaver();
    const agent = createAgent({
      model: scriptedModel([toolCalls(["c1", "deploy", { env: "prod" }]), text("done")]).model,
      tools: approvalTools(),
      checkpointer,
    });
    const interrupt = await expectInterrupted(agent.generate({ prompt: "go", threadId: THREAD }));

    const parts = await drain(agent.resumeStream(THREAD, interrupt.id, { approved: true }));

    expect(parts.filter((part) => part.type === "text-delta")).toEqual([
      { type: "text-delta", text: "done" },
    ]);
    expect(parts.at(-1)?.type).toBe("finish");
    expect(await agent.getInterrupt(THREAD)).toBeUndefined();
  });
});

/** A store that crashes on a chosen appendOutputs call, as if the process had died there. */
class CrashingStore extends MemoryContextLogStore {
  appendCalls = 0;
  crashOnAppend: number | undefined;

  override async appendOutputs(
    request: ContextAppendOutputsRequest,
  ): Promise<ContextAppendOutputsResult> {
    this.appendCalls += 1;
    if (this.appendCalls === this.crashOnAppend) {
      throw new Error("process crashed");
    }
    return super.appendOutputs(request);
  }
}

describe("log-mode resume crash safety", () => {
  async function interruptedStore() {
    const store = new CrashingStore();
    const checkpointer = new MemorySaver();
    const interrupt = await expectInterrupted(
      logAgent(scriptedModel([toolCalls(["c1", "deploy", { env: "prod" }])]).model, store, {
        tools: approvalTools(),
        checkpointer,
      }).generate({ prompt: "go", threadId: THREAD }),
    );
    return { store, checkpointer, interrupt };
  }

  it("never runs the tool again after a resume crashed before committing its result", async () => {
    const { store, checkpointer, interrupt } = await interruptedStore();
    const runs: string[] = [];
    // The resolution commits, the tool runs, then the result commit crashes.
    store.crashOnAppend = store.appendCalls + 2;
    await expect(
      logAgent(scriptedModel([text("never")]).model, store, {
        tools: approvalTools(runs),
        checkpointer,
      }).resume(THREAD, interrupt.id, { approved: true }),
    ).rejects.toThrow("process crashed");
    expect(runs).toEqual(["c1:true"]);

    const restarted = scriptedModel([text("never")]);
    const error = await logAgent(restarted.model, store, {
      tools: approvalTools(runs),
      checkpointer,
    })
      .resume(THREAD, interrupt.id, { approved: true })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isContextLogError(error, "conflict")).toBe(true);
    expect((error as { reason: string }).reason).toBe("resume_in_doubt");
    expect(runs).toEqual(["c1:true"]);
    expect(restarted.requests).toHaveLength(0);
    // The stream stays blocked rather than generating from a missing result.
    await expect(
      logAgent(restarted.model, store, { tools: approvalTools(), checkpointer }).generate({
        prompt: "next",
        threadId: THREAD,
      }),
    ).rejects.toMatchObject({ reason: "interrupt_pending" });
  });

  it("runs it again through the pipeline when the host's ledger makes that safe", async () => {
    const { store, checkpointer, interrupt } = await interruptedStore();
    store.crashOnAppend = store.appendCalls + 2;
    await expect(
      logAgent(scriptedModel([text("never")]).model, store, {
        tools: approvalTools(),
        checkpointer,
      }).resume(THREAD, interrupt.id, { approved: true }),
    ).rejects.toThrow("process crashed");

    // The host's ledger answers a recorded tool call id with its recorded result.
    const ledger = vi.fn(async (_input: unknown, toolUseId: string | null) => ({
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        respondWith: `recorded result of ${toolUseId}`,
      },
    }));
    const runs: string[] = [];
    const resumed = scriptedModel([text("done")]);
    const result = await logAgent(resumed.model, store, {
      tools: approvalTools(runs),
      checkpointer,
      contextLog: { mode: "log", store, inDoubtResume: "reexecute" },
      hooks: { PreToolUse: [{ hooks: [ledger] }] },
    }).resume(THREAD, interrupt.id, { approved: true });

    expect(result.status).toBe("complete");
    expect(runs).toEqual([]);
    expect(ledger).toHaveBeenCalledWith(expect.anything(), "c1", expect.anything());
    const path = await readPath(store);
    expect(path.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "tool_result",
      "tool_result",
      "assistant",
    ]);
    expect(path[3]!.message.content).toEqual([
      expect.objectContaining({ output: { type: "text", value: "recorded result of c1" } }),
    ]);
  });

  it("re-runs an in-doubt custom answer with the answer the log recorded", async () => {
    const store = new CrashingStore();
    const checkpointer = new MemorySaver();
    const answers: unknown[] = [];
    const ackTools = () => ({
      ask: tool({
        description: "Asks the user",
        inputSchema: askInput,
        execute: async (input, options) => {
          answers.push(await interruptOf(options)(input));
          return "noted";
        },
      }),
    });
    const interrupt = await expectInterrupted(
      logAgent(scriptedModel([toolCalls(["c1", "ask", { question: "Colour?" }])]).model, store, {
        tools: ackTools(),
        checkpointer,
      }).generate({ prompt: "go", threadId: THREAD }),
    );
    store.crashOnAppend = store.appendCalls + 2;
    await expect(
      logAgent(scriptedModel([text("never")]).model, store, {
        tools: ackTools(),
        checkpointer,
      }).resume(THREAD, interrupt.id, "blue"),
    ).rejects.toThrow("process crashed");

    const result = await logAgent(scriptedModel([text("done")]).model, store, {
      tools: ackTools(),
      checkpointer,
      contextLog: { mode: "log", store, inDoubtResume: "reexecute" },
    }).resume(THREAD, interrupt.id, "a different answer");

    expect(result.status).toBe("complete");
    expect(answers).toEqual(["blue", "blue"]);
  });

  it("runs a screened answer the same way on the first run and on recovery", async () => {
    const store = new CrashingStore();
    const checkpointer = new MemorySaver();
    const [inputFilter] = createSecretsFilterHooks();
    const hooks = { PreGenerate: [inputFilter] };
    const answers: unknown[] = [];
    const ackTools = () => ({
      ask: tool({
        description: "Asks the user",
        inputSchema: askInput,
        execute: async (input, options) => {
          answers.push(await interruptOf(options)(input));
          return "noted";
        },
      }),
    });
    const interrupt = await expectInterrupted(
      logAgent(scriptedModel([toolCalls(["c1", "ask", { question: "Key?" }])]).model, store, {
        tools: ackTools(),
        checkpointer,
        hooks,
      }).generate({ prompt: "go", threadId: THREAD }),
    );
    store.crashOnAppend = store.appendCalls + 2;
    await expect(
      logAgent(scriptedModel([text("never")]).model, store, {
        tools: ackTools(),
        checkpointer,
        hooks,
      }).resume(THREAD, interrupt.id, "use AKIAIOSFODNN7EXAMPLE"),
    ).rejects.toThrow("process crashed");

    await logAgent(scriptedModel([text("done")]).model, store, {
      tools: ackTools(),
      checkpointer,
      hooks,
      contextLog: { mode: "log", store, inDoubtResume: "reexecute" },
    }).resume(THREAD, interrupt.id, "use AKIAIOSFODNN7EXAMPLE");

    expect(answers).toHaveLength(2);
    expect(answers[0]).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(answers[0]).toContain("[REDACTED]");
    expect(answers[1]).toEqual(answers[0]);
  });

  it("fails closed when screening leaves an answer that no longer decodes", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    // Redacts every number, which breaks the JSON of a numeric answer.
    const [digits] = createSecretsFilterHooks({ patterns: [/\d+/g], redactionText: "#" });
    const hooks = { PreGenerate: [digits] };
    const answers: unknown[] = [];
    const ackTools = () => ({
      ask: tool({
        description: "Asks the user",
        inputSchema: askInput,
        execute: async (input, options) => {
          answers.push(await interruptOf(options)(input));
          return "noted";
        },
      }),
    });
    const interrupt = await expectInterrupted(
      logAgent(scriptedModel([toolCalls(["c1", "ask", { question: "Pin?" }])]).model, store, {
        tools: ackTools(),
        checkpointer,
        hooks,
      }).generate({ prompt: "go", threadId: THREAD }),
    );

    const error = await logAgent(scriptedModel([text("never")]).model, store, {
      tools: ackTools(),
      checkpointer,
      hooks,
    })
      .resume(THREAD, interrupt.id, 1234)
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(isContextLogError(error, "invalid")).toBe(true);
    expect((error as { reason: string }).reason).toBe("invalid_resolution");
    expect(answers).toEqual([]);
  });

  it("does not run the tool again when only clearing the interrupt was lost", async () => {
    const { store, checkpointer, interrupt } = await interruptedStore();
    const runs: string[] = [];
    // A checkpointer that loses the save clearing the interrupt.
    class LosingSaver extends MemorySaver {
      losing = true;
      override async save(...args: Parameters<MemorySaver["save"]>) {
        if (this.losing && args[0].pendingInterrupt === undefined) {
          throw new Error("process crashed");
        }
        return super.save(...args);
      }
    }
    const losing = new LosingSaver();
    await losing.save((await checkpointer.load(THREAD))!);
    await expect(
      logAgent(scriptedModel([text("never")]).model, store, {
        tools: approvalTools(runs),
        checkpointer: losing,
      }).resume(THREAD, interrupt.id, { approved: true }),
    ).rejects.toThrow("process crashed");
    expect(runs).toEqual(["c1:true"]);

    losing.losing = false;
    const resumed = scriptedModel([text("done")]);
    const result = await logAgent(resumed.model, store, {
      tools: approvalTools(runs),
      checkpointer: losing,
    }).resume(THREAD, interrupt.id, { approved: true });

    expect(result.status).toBe("complete");
    expect(runs).toEqual(["c1:true"]);
    expect(resumed.requests).toHaveLength(1);
  });

  it("refuses an interrupt that is not on the stream's path", async () => {
    const { store, checkpointer, interrupt } = await interruptedStore();
    const error = await logAgent(scriptedModel([text("never")]).model, store, {
      tools: approvalTools(),
      checkpointer,
    })
      .resume(
        THREAD,
        interrupt.id,
        { approved: true },
        { contextStream: { branchId: "other", streamId: "main" } },
      )
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(isContextLogError(error, "not_found")).toBe(true);
  });
});

describe("AgentSession with a pending log-mode interrupt", () => {
  /**
   * Runs a session: the first turn interrupts, a background task completes
   * while the interrupt is pending, and the interrupt is answered. Stops
   * once the session is idle after the resume.
   */
  async function runSession(replies: Reply[] | Array<Reply | Error>) {
    const store = new MemoryContextLogStore();
    const { model, requests } = scriptedModel(replies as Reply[]);
    const agent = logAgent(model, store, { tools: askTools(), checkpointer: new MemorySaver() });
    const session = new AgentSession({ agent, threadId: THREAD });
    const outputs: string[] = [];
    let waits = 0;
    let resumed = false;
    for await (const output of session.run()) {
      if (output.type === "waiting_for_input") {
        waits += 1;
        if (waits === 1) session.sendMessage("go");
        // Idle twice after the resume: every queued event has been handled.
        if (resumed && waits >= 4) session.stop();
      } else if (output.type === "interrupt") {
        agent.taskManager.registerTask(
          createBackgroundTask({
            id: "task-1",
            subagentType: "researcher",
            description: "research",
          }),
        );
        agent.taskManager.updateTask("task-1", { status: "completed", result: "found it" });
        session.respondToInterrupt(output.interrupt.id, "Alice");
        resumed = true;
      } else if (output.type === "generation_complete") {
        outputs.push(output.fullText);
      } else if (output.type === "error") {
        outputs.push(`error:${output.error.message}`);
      }
    }
    await agent.dispose();
    const taskPrompts = requests.filter((request) =>
      JSON.stringify(request.prompt.at(-1)).includes("found it"),
    );
    return { outputs, requests, taskPrompts, agent };
  }

  it("leaves task results queued until the interrupt is resumed, then sends them once", async () => {
    const { outputs, requests, taskPrompts, agent } = await runSession([
      toolCalls(["c1", "ask", { question: "Name?" }]),
      text("resumed"),
      text("task handled"),
      text("duplicate"),
    ]);

    // Default background draining picks the task up after the continuation;
    // the queued session event then finds it consumed.
    expect(requests).toHaveLength(3);
    expect(taskPrompts).toHaveLength(1);
    expect(outputs).toEqual(["task handled"]);
    expect(agent.taskManager.getTask("task-1")).toBeUndefined();
  });

  it("releases queued task results when the resumed continuation fails", async () => {
    const { outputs, requests, taskPrompts } = await runSession([
      toolCalls(["c1", "ask", { question: "Name?" }]),
      new Error("provider down"),
      text("task handled"),
      text("duplicate"),
    ]);

    expect(outputs[0]).toMatch(/^error:/);
    expect(outputs.slice(1)).toEqual(["task handled"]);
    expect(requests).toHaveLength(3);
    expect(taskPrompts).toHaveLength(1);
  });
});
