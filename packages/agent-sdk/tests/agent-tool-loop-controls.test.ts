/**
 * Tests for the tool-loop controls upstreamed from the lleverage platform:
 *
 * - `transformToolError` boundary for tool execute() rejections
 * - `tool-error` / `tool-output-denied` stream parts
 * - discovered-tool-call repair (`repairToolCall` → `call_tool`)
 * - `options.stop()` for tools and `GenerateOptions.shouldStopAfterStep`
 * - mid-run streaming compaction via `prepareStep`
 * - checkpoints built from every step (not just the final step's response)
 * - pending user input delivered between steps (`pendingUserInput`)
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
  NoSuchToolError,
  type ToolSet,
  tool,
} from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent, definePlugin } from "../src/index.js";
import type { PendingUserInputCommit, PendingUserMessage, StreamPart } from "../src/types.js";
import { createMockModel, resetMocks } from "./setup.js";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
  };
});

import { generateText, streamText } from "ai";

type GenerateTextArgs = {
  tools?: ToolSet;
  stopWhen?: Array<(opts: { steps: unknown[] }) => boolean | PromiseLike<boolean>>;
  repairToolCall?: (params: {
    error: unknown;
    toolCall: { toolCallId: string; toolName: string; input: string; type: "tool-call" };
    tools: ToolSet;
  }) => Promise<unknown>;
  /** Pre-7.0.20 name; the SDK passes the same function under both. */
  experimental_repairToolCall?: GenerateTextArgs["repairToolCall"];
  prepareStep?: (opts: {
    messages: unknown[];
    stepNumber: number;
  }) => Promise<{ messages: unknown[] } | undefined>;
  onStepFinish?: (step: unknown) => void | Promise<void>;
};

const execOpts = {
  toolCallId: "call-1",
  messages: [],
  abortSignal: undefined as unknown as AbortSignal,
};

function mockGenerateOnce(overrides: Record<string, unknown> = {}) {
  vi.mocked(generateText).mockResolvedValue({
    text: "ok",
    usage: { inputTokens: 1, outputTokens: 1 },
    finishReason: "stop",
    steps: [{ text: "ok", toolCalls: [], toolResults: [], finishReason: "stop" }],
    response: { id: "r", timestamp: new Date(), modelId: "m", messages: [] },
    ...overrides,
  } as never);
}

function lastGenerateArgs(): GenerateTextArgs {
  const calls = vi.mocked(generateText).mock.calls;
  return calls[calls.length - 1]?.[0] as unknown as GenerateTextArgs;
}

async function runStopConditions(
  conditions: GenerateTextArgs["stopWhen"],
  steps: unknown[] = [],
): Promise<boolean> {
  for (const condition of conditions ?? []) {
    if (await condition({ steps })) return true;
  }
  return false;
}

describe("transformToolError", () => {
  beforeEach(() => resetMocks());

  it("wraps tool execute() rejections before the AI SDK sees them", async () => {
    mockGenerateOnce();
    const transform = vi.fn((_error: unknown, ctx: { toolName: string }) => {
      return new Error(`sanitised:${ctx.toolName}`);
    });
    const agent = createAgent({
      model: createMockModel(),
      transformToolError: transform,
      tools: {
        boom: tool({
          description: "Always fails",
          inputSchema: z.object({}),
          execute: async () => {
            throw new Error("secret internal details");
          },
        }),
      },
    });

    await agent.generate({ prompt: "go" });
    const boom = lastGenerateArgs().tools?.boom;
    expect(boom?.execute).toBeDefined();

    await expect(boom!.execute!({}, execOpts)).rejects.toThrow("sanitised:boom");
    expect(transform).toHaveBeenCalledWith(expect.any(Error), { toolName: "boom" });
    const originalError = transform.mock.calls[0]?.[0];
    expect(originalError).toBeInstanceOf(Error);
    expect((originalError as Error).message).toBe("secret internal details");
  });

  it("does not transform interrupt signals", async () => {
    mockGenerateOnce();
    const transform = vi.fn(() => new Error("should not be called"));
    const { MemorySaver } = await import("../src/checkpointer/memory-saver.js");
    const agent = createAgent({
      model: createMockModel(),
      checkpointer: new MemorySaver(),
      transformToolError: transform,
      tools: {
        ask: tool({
          description: "Interrupts",
          inputSchema: z.object({}),
          execute: async (_input, options) => {
            const extended = options as {
              interrupt?: (type: string, request: unknown) => Promise<unknown>;
            };
            return extended.interrupt!("question", { question: "why?" });
          },
        }),
      },
    });

    await agent.generate({ prompt: "go", threadId: "t-interrupt" });
    const ask = lastGenerateArgs().tools?.ask;
    await expect(ask!.execute!({}, execOpts)).resolves.toBe("[Interrupt requested]");
    expect(transform).not.toHaveBeenCalled();
  });
});

describe("stop() and shouldStopAfterStep", () => {
  beforeEach(() => resetMocks());

  it("stops the tool loop after the step when a tool calls options.stop()", async () => {
    mockGenerateOnce();
    const agent = createAgent({
      model: createMockModel(),
      tools: {
        render: tool({
          description: "Renders and ends the turn",
          inputSchema: z.object({}),
          execute: async (_input, options) => {
            (options as { stop?: () => void }).stop?.();
            return "rendered";
          },
        }),
      },
    });

    await agent.generate({ prompt: "go" });
    const args = lastGenerateArgs();
    expect(await runStopConditions(args.stopWhen)).toBe(false);

    await args.tools!.render!.execute!({}, execOpts);
    expect(await runStopConditions(args.stopWhen)).toBe(true);
  });

  it("stops when GenerateOptions.shouldStopAfterStep returns true", async () => {
    mockGenerateOnce();
    let shouldStop = false;
    const agent = createAgent({ model: createMockModel() });

    await agent.generate({ prompt: "go", shouldStopAfterStep: () => shouldStop });
    const args = lastGenerateArgs();
    expect(await runStopConditions(args.stopWhen)).toBe(false);
    shouldStop = true;
    expect(await runStopConditions(args.stopWhen)).toBe(true);
  });

  it("still stops at maxSteps", async () => {
    mockGenerateOnce();
    const agent = createAgent({ model: createMockModel(), maxSteps: 2 });
    await agent.generate({ prompt: "go" });
    const args = lastGenerateArgs();
    expect(await runStopConditions(args.stopWhen, [{}, {}])).toBe(true);
    expect(await runStopConditions(args.stopWhen, [{}])).toBe(false);
  });
});

describe("discovered tool call repair", () => {
  beforeEach(() => resetMocks());
  afterEach(() => vi.unstubAllEnvs());

  const createProxyAgent = (options: Record<string, unknown> = {}) =>
    createAgent({
      model: createMockModel(),
      pluginLoading: "proxy",
      plugins: [
        definePlugin({
          name: "stripe",
          tools: {
            create_payment: tool({
              description: "Create a payment",
              inputSchema: z.object({ amount: z.number() }),
              execute: async ({ amount }) => `Paid ${amount}`,
            }),
          },
        }),
      ],
      ...options,
    });

  const noSuchTool = (toolName: string) =>
    new NoSuchToolError({ toolName, availableTools: ["call_tool", "search_tools"] });

  it("routes an exact discoverable tool name through call_tool", async () => {
    mockGenerateOnce();
    const agent = createProxyAgent();
    await agent.generate({ prompt: "pay" });

    const args = lastGenerateArgs();
    expect(args.repairToolCall).toBeDefined();
    // ai < 7.0.20 only reads the experimental_ name; both must be wired.
    expect(args.experimental_repairToolCall).toBe(args.repairToolCall);
    expect(args.tools).toHaveProperty("call_tool");

    const repaired = await args.repairToolCall!({
      error: noSuchTool("stripe__create_payment"),
      toolCall: {
        type: "tool-call",
        toolCallId: "call-42",
        toolName: "stripe__create_payment",
        input: JSON.stringify({ amount: 10 }),
      },
      tools: args.tools!,
    });

    expect(repaired).toEqual({
      type: "tool-call",
      toolCallId: "call-42",
      toolName: "call_tool",
      input: JSON.stringify({ tool_name: "stripe__create_payment", arguments: { amount: 10 } }),
    });
  });

  it("treats empty input as an empty argument object", async () => {
    mockGenerateOnce();
    const agent = createProxyAgent();
    await agent.generate({ prompt: "pay" });
    const args = lastGenerateArgs();

    const repaired = (await args.repairToolCall!({
      error: noSuchTool("stripe__create_payment"),
      toolCall: {
        type: "tool-call",
        toolCallId: "call-42",
        toolName: "stripe__create_payment",
        input: "  ",
      },
      tools: args.tools!,
    })) as { input: string };

    expect(JSON.parse(repaired.input)).toEqual({
      tool_name: "stripe__create_payment",
      arguments: {},
    });
  });

  it("returns null for unknown tools, malformed input, or non-object input", async () => {
    mockGenerateOnce();
    const agent = createProxyAgent();
    await agent.generate({ prompt: "pay" });
    const args = lastGenerateArgs();
    const repair = args.repairToolCall!;

    await expect(
      repair({
        error: noSuchTool("stripe__nonexistent"),
        toolCall: {
          type: "tool-call",
          toolCallId: "c",
          toolName: "stripe__nonexistent",
          input: "{}",
        },
        tools: args.tools!,
      }),
    ).resolves.toBeNull();

    await expect(
      repair({
        error: noSuchTool("stripe__create_payment"),
        toolCall: {
          type: "tool-call",
          toolCallId: "c",
          toolName: "stripe__create_payment",
          input: "{not json",
        },
        tools: args.tools!,
      }),
    ).resolves.toBeNull();

    await expect(
      repair({
        error: noSuchTool("stripe__create_payment"),
        toolCall: {
          type: "tool-call",
          toolCallId: "c",
          toolName: "stripe__create_payment",
          input: "[1,2]",
        },
        tools: args.tools!,
      }),
    ).resolves.toBeNull();
  });

  it("does not repair when call_tool is not active", async () => {
    mockGenerateOnce();
    const agent = createProxyAgent({ disabledCoreTools: ["call_tool"] });
    await agent.generate({ prompt: "pay" });
    const args = lastGenerateArgs();

    await expect(
      args.repairToolCall!({
        error: noSuchTool("stripe__create_payment"),
        toolCall: {
          type: "tool-call",
          toolCallId: "c",
          toolName: "stripe__create_payment",
          input: "{}",
        },
        tools: args.tools!,
      }),
    ).resolves.toBeNull();
  });

  it("can be disabled via repairDiscoveredToolCalls: false", async () => {
    mockGenerateOnce();
    const agent = createProxyAgent({ repairDiscoveredToolCalls: false });
    await agent.generate({ prompt: "pay" });
    const args = lastGenerateArgs();

    await expect(
      args.repairToolCall!({
        error: noSuchTool("stripe__create_payment"),
        toolCall: {
          type: "tool-call",
          toolCallId: "c",
          toolName: "stripe__create_payment",
          input: "{}",
        },
        tools: args.tools!,
      }),
    ).resolves.toBeNull();
  });

  it("can be disabled via AGENT_SDK_DISABLE_TOOL_CALL_REPAIR, and the option wins", async () => {
    vi.stubEnv("AGENT_SDK_DISABLE_TOOL_CALL_REPAIR", "true");
    const toolCall = {
      type: "tool-call" as const,
      toolCallId: "c",
      toolName: "stripe__create_payment",
      input: "{}",
    };

    mockGenerateOnce();
    const disabledByEnv = createProxyAgent();
    await disabledByEnv.generate({ prompt: "pay" });
    let args = lastGenerateArgs();
    await expect(
      args.repairToolCall!({
        error: noSuchTool(toolCall.toolName),
        toolCall,
        tools: args.tools!,
      }),
    ).resolves.toBeNull();

    mockGenerateOnce();
    const forcedOn = createProxyAgent({ repairDiscoveredToolCalls: true });
    await forcedOn.generate({ prompt: "pay" });
    args = lastGenerateArgs();
    await expect(
      args.repairToolCall!({
        error: noSuchTool(toolCall.toolName),
        toolCall,
        tools: args.tools!,
      }),
    ).resolves.toMatchObject({ toolName: "call_tool" });
  });

  it("throws the transformed error for unrepairable invalid calls when transformToolError is set", async () => {
    mockGenerateOnce();
    const agent = createProxyAgent({
      transformToolError: (_error: unknown, ctx: { toolName: string }) =>
        new Error(`safe:${ctx.toolName}`),
    });
    await agent.generate({ prompt: "pay" });
    const args = lastGenerateArgs();

    await expect(
      args.repairToolCall!({
        error: noSuchTool("totally_unknown"),
        toolCall: {
          type: "tool-call",
          toolCallId: "c",
          toolName: "totally_unknown",
          input: "{}",
        },
        tools: args.tools!,
      }),
    ).rejects.toThrow("safe:totally_unknown");
  });
});

describe("stream() tool failure parts", () => {
  beforeEach(() => resetMocks());

  function mockStreamWith(parts: unknown[]) {
    const fullStream = (async function* () {
      for (const part of parts) yield part;
    })();
    vi.mocked(streamText).mockReturnValue({
      fullStream,
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      finishReason: Promise.resolve("stop" as const),
      text: Promise.resolve(""),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      output: Promise.resolve(undefined),
      response: Promise.resolve({ id: "r", timestamp: new Date(), modelId: "m", messages: [] }),
      warnings: Promise.resolve([]),
    } as never);
  }

  it("forwards tool-error parts instead of dropping them", async () => {
    const error = new Error("tool exploded");
    mockStreamWith([
      { type: "tool-call", toolCallId: "c1", toolName: "boom", input: { x: 1 } },
      { type: "tool-error", toolCallId: "c1", toolName: "boom", input: { x: 1 }, error },
      { type: "finish", finishReason: "stop", totalUsage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    const agent = createAgent({ model: createMockModel() });
    const parts: StreamPart[] = [];
    for await (const part of agent.stream({ prompt: "go" })) parts.push(part);

    expect(parts).toContainEqual({
      type: "tool-error",
      toolCallId: "c1",
      toolName: "boom",
      input: { x: 1 },
      error,
    });
  });

  it("forwards tool-output-denied parts", async () => {
    mockStreamWith([
      { type: "tool-output-denied", toolCallId: "c1", toolName: "bash" },
      { type: "finish", finishReason: "stop", totalUsage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    const agent = createAgent({ model: createMockModel() });
    const parts: StreamPart[] = [];
    for await (const part of agent.stream({ prompt: "go" })) parts.push(part);

    expect(parts).toContainEqual({
      type: "tool-output-denied",
      toolCallId: "c1",
      toolName: "bash",
    });
  });
});

describe("streaming compaction via prepareStep", () => {
  beforeEach(() => resetMocks());

  function mockStreamText() {
    const fullStream = (async function* () {
      yield { type: "text-delta", text: "hi" };
      yield {
        type: "finish",
        finishReason: "stop",
        totalUsage: { inputTokens: 1, outputTokens: 1 },
      };
    })();
    vi.mocked(streamText).mockReturnValue({
      fullStream,
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      finishReason: Promise.resolve("stop" as const),
      text: Promise.resolve("hi"),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      output: Promise.resolve(undefined),
      response: Promise.resolve({ id: "r", timestamp: new Date(), modelId: "m", messages: [] }),
      warnings: Promise.resolve([]),
    } as never);
  }

  function lastStreamArgs(): GenerateTextArgs {
    const calls = vi.mocked(streamText).mock.calls;
    return calls[calls.length - 1]?.[0] as unknown as GenerateTextArgs;
  }

  it("passes prepareStep and skips step 0 (already compacted by buildMessages)", async () => {
    mockStreamText();
    const { createContextManager } = await import("../src/context-manager.js");
    const onCompact = vi.fn();
    const contextManager = createContextManager({
      maxTokens: 100,
      summarization: { tokenThreshold: 0.1, keepMessageCount: 2 },
      onCompact,
    });
    const agent = createAgent({ model: createMockModel(), contextManager });

    for await (const _ of agent.stream({ prompt: "short" })) {
      // consume
    }

    const args = lastStreamArgs();
    expect(args.prepareStep).toBeDefined();
    onCompact.mockClear();

    const big = "x".repeat(500);
    const longHistory = [
      { role: "user", content: big },
      { role: "assistant", content: big },
      { role: "user", content: big },
      { role: "assistant", content: big },
    ];

    await expect(
      args.prepareStep!({ messages: longHistory, stepNumber: 0 }),
    ).resolves.toBeUndefined();
    expect(onCompact).not.toHaveBeenCalled();
  });

  it("compacts mid-run on later steps when over budget", async () => {
    mockStreamText();
    const { createContextManager } = await import("../src/context-manager.js");
    const onCompact = vi.fn();
    const contextManager = createContextManager({
      maxTokens: 100,
      summarization: { tokenThreshold: 0.1, keepMessageCount: 2 },
      onCompact,
    });
    const agent = createAgent({ model: createMockModel(), contextManager });

    for await (const _ of agent.stream({ prompt: "short" })) {
      // consume
    }
    const args = lastStreamArgs();
    onCompact.mockClear();

    const big = "x".repeat(500);
    const longHistory = [
      { role: "user", content: big },
      { role: "assistant", content: big },
      { role: "user", content: big },
      { role: "assistant", content: big },
      { role: "user", content: big },
    ];

    const result = await args.prepareStep!({ messages: longHistory, stepNumber: 1 });
    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(result?.messages).toBeDefined();
    expect(result!.messages.length).toBeLessThan(longHistory.length);
  });

  it("returns undefined on later steps when under budget", async () => {
    mockStreamText();
    const { createContextManager } = await import("../src/context-manager.js");
    const contextManager = createContextManager({
      maxTokens: 100000,
      summarization: { tokenThreshold: 0.8, keepMessageCount: 10 },
    });
    const agent = createAgent({ model: createMockModel(), contextManager });
    for await (const _ of agent.stream({ prompt: "short" })) {
      // consume
    }
    const args = lastStreamArgs();
    await expect(
      args.prepareStep!({ messages: [{ role: "user", content: "hi" }], stepNumber: 3 }),
    ).resolves.toBeUndefined();
  });
});

describe("checkpoint transcript from every step", () => {
  beforeEach(() => resetMocks());

  it("generate() persists tool calls/results from earlier steps, not only the final step", async () => {
    const { MemorySaver } = await import("../src/checkpointer/memory-saver.js");
    const checkpointer = new MemorySaver();

    const step1Assistant = {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "c1", toolName: "read", input: { path: "a" } }],
    };
    const step1Tool = {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "c1", toolName: "read", output: "A" }],
    };
    const step2Assistant = { role: "assistant", content: [{ type: "text", text: "done" }] };

    vi.mocked(generateText).mockResolvedValue({
      text: "done",
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
      steps: [
        {
          text: "",
          toolCalls: [],
          toolResults: [],
          finishReason: "tool-calls",
          response: { messages: [step1Assistant, step1Tool] },
        },
        {
          text: "done",
          toolCalls: [],
          toolResults: [],
          finishReason: "stop",
          response: { messages: [step2Assistant] },
        },
      ],
      // The AI SDK's top-level response only carries the FINAL step's messages.
      response: { id: "r", timestamp: new Date(), modelId: "m", messages: [step2Assistant] },
    } as never);

    const agent = createAgent({ model: createMockModel(), checkpointer });
    await agent.generate({ prompt: "read a", threadId: "t1" });

    const checkpoint = await checkpointer.load("t1");
    expect(checkpoint?.messages).toEqual([
      { role: "user", content: "read a" },
      step1Assistant,
      step1Tool,
      step2Assistant,
    ]);
  });
});

describe("pending user input between steps (outside log mode)", () => {
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
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
        { type: "image", image: "aGVsbG8=", mediaType: "image/png" },
      ],
    },
  };
  const tagged = {
    ...steer.message,
    providerOptions: { agentSdk: { pendingUserInputId: "d1" } },
  };

  /** A model that answers each call with the next reply, by generate or stream. */
  function scriptedModel(replies: LanguageModelV3Content[][]) {
    const requests: LanguageModelV3CallOptions[] = [];
    const next = (request: LanguageModelV3CallOptions) => {
      requests.push(request);
      const content = replies[Math.min(requests.length - 1, replies.length - 1)]!;
      const finishReason = content.some((part) => part.type === "tool-call")
        ? { unified: "tool-calls" as const, raw: "tool_calls" }
        : { unified: "stop" as const, raw: "stop" };
      return { content, finishReason };
    };
    const model = new MockLanguageModelV3({
      doGenerate: async (request) => ({ ...next(request), usage, warnings: [] }),
      doStream: async (request) => {
        const { content, finishReason } = next(request);
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
        parts.push({ type: "finish", finishReason, usage });
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

  async function setup() {
    const actual = await vi.importActual<typeof import("ai")>("ai");
    vi.mocked(generateText).mockImplementation(actual.generateText);
    vi.mocked(streamText).mockImplementation(actual.streamText);
    const { MemorySaver } = await import("../src/checkpointer/memory-saver.js");
    const pending: PendingUserMessage[] = [];
    const committed = vi.fn();
    const tools = {
      echo: tool({
        inputSchema: jsonSchema<{ value: string }>({
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        }),
        // The message arrives while the first step's tools run.
        execute: async ({ value }: { value: string }) => {
          if (value === "c1") pending.push(steer);
          return `echo:${value}`;
        },
      }),
    };
    return {
      checkpointer: new MemorySaver(),
      tools,
      pending,
      committed,
      // The host keeps returning the message; the SDK delivers it once.
      options: {
        pendingUserInput: async () => [...pending],
        onPendingUserInputCommitted: committed,
      },
    };
  }

  beforeEach(() => resetMocks());
  afterEach(() => {
    vi.mocked(generateText).mockReset();
    vi.mocked(streamText).mockReset();
  });

  for (const mode of ["generate", "stream"] as const) {
    it(`${mode}() sends it after every tool result and keeps it in later steps and the checkpoint`, async () => {
      const { checkpointer, tools, options, committed } = await setup();
      const { model, requests } = scriptedModel([
        [echoCall("c1"), echoCall("c2")],
        [echoCall("c3")],
        [{ type: "text", text: "done" }],
      ]);
      const agent = createAgent({ model, tools, checkpointer });

      const genOptions = { prompt: "go", threadId: "t1", ...options };
      if (mode === "generate") {
        await agent.generate(genOptions);
      } else {
        for await (const _ of agent.stream(genOptions)) {
          // consume
        }
      }

      const roles = (index: number) => requests[index]!.prompt.map((message) => message.role);
      expect(roles(0)).toEqual(["system", "user"]);
      expect(roles(1)).toEqual(["system", "user", "assistant", "tool", "user"]);
      const second = requests[1]!.prompt;
      const toolMessage = second[3]!;
      expect(toolMessage.role === "tool" && toolMessage.content.length).toBe(2);
      expect(JSON.stringify(second[4])).toContain("also check Q3");
      expect(JSON.stringify(second[4])).toContain("image/png");
      expect(requests[2]!.prompt.slice(0, 5)).toEqual(second);
      expect(JSON.stringify(requests[2]!.prompt).split("also check Q3")).toHaveLength(2);

      const checkpoint = await checkpointer.load("t1");
      expect(checkpoint?.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "user",
        "assistant",
        "tool",
        "assistant",
      ]);
      expect(checkpoint?.messages[3]).toEqual(tagged);
      expect(committed).toHaveBeenCalledTimes(1);
      expect(committed).toHaveBeenCalledWith(["d1"], { alreadyCommitted: [] });
    });
  }

  it("does not deliver an id the checkpoint already holds, and reports it", async () => {
    const { checkpointer, tools, options, committed } = await setup();
    const first = scriptedModel([[echoCall("c1")], [{ type: "text", text: "done" }]]);
    const agent = createAgent({ model: first.model, tools, checkpointer });
    await agent.generate({ prompt: "go", threadId: "t1", ...options });
    expect(committed).toHaveBeenCalledTimes(1);

    // A resumed run: the host never processed the commit and offers it again.
    const second = scriptedModel([[echoCall("c2")], [{ type: "text", text: "done" }]]);
    await createAgent({ model: second.model, tools, checkpointer }).generate({
      prompt: "and then?",
      threadId: "t1",
      ...options,
    });

    expect(JSON.stringify(second.requests[1]!.prompt).split("also check Q3")).toHaveLength(2);
    const checkpoint = await checkpointer.load("t1");
    expect(checkpoint?.messages.filter((message) => message.role === "user")).toHaveLength(3);
    expect(committed).toHaveBeenCalledTimes(2);
    expect(committed).toHaveBeenLastCalledWith([], { alreadyCommitted: ["d1"] });
  });

  it("keeps delivered input in a fallback attempt after the host dropped it", async () => {
    const { checkpointer, tools, pending, committed } = await setup();
    const primary = scriptedModel([[echoCall("c1")]]);
    const fail = () => {
      throw new APICallError({
        message: "overloaded",
        url: "https://provider.test",
        requestBodyValues: {},
        statusCode: 529,
        // Retry at once instead of after the AI SDK's real-time backoff.
        responseHeaders: { "retry-after-ms": "0" },
        isRetryable: true,
      });
    };
    let calls = 0;
    const failing = new MockLanguageModelV3({
      doGenerate: async (request) => {
        calls += 1;
        if (calls > 1) fail();
        return primary.model.doGenerate(request);
      },
    });
    const fallback = scriptedModel([[{ type: "text", text: "done" }]]);

    await createAgent({
      model: failing as LanguageModel,
      fallbackModel: fallback.model,
      tools,
      checkpointer,
    }).generate({
      prompt: "go",
      threadId: "t1",
      pendingUserInput: async () => [...pending],
      // The host drops what it was told about.
      onPendingUserInputCommitted: async (ids, commit) => {
        committed(ids, commit);
        pending.splice(0, pending.length, ...pending.filter((item) => !ids.includes(item.id)));
      },
    });

    expect(committed).toHaveBeenCalledTimes(1);
    expect(fallback.requests[0]!.prompt.map((message) => message.role)).toEqual([
      "system",
      "user",
      "user",
    ]);
    expect(JSON.stringify(fallback.requests[0]!.prompt[2])).toContain("also check Q3");
    const checkpoint = await checkpointer.load("t1");
    expect(checkpoint?.messages).toEqual([
      { role: "user", content: "go" },
      tagged,
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ]);
  });

  it("keeps delivered input when a failure hook retries with fresh options", async () => {
    const { checkpointer, tools, pending, committed } = await setup();
    let calls = 0;
    const replies = scriptedModel([[echoCall("c1")], [{ type: "text", text: "done" }]]);
    const model = new MockLanguageModelV3({
      doGenerate: async (request) => {
        calls += 1;
        if (calls === 2) throw new Error("socket hang up");
        return replies.model.doGenerate(request);
      },
    });
    const pendingOptions = {
      pendingUserInput: async () => [...pending],
      // The host drops what it was told about.
      onPendingUserInputCommitted: async (ids: string[], commit: PendingUserInputCommit) => {
        committed(ids, commit);
        pending.splice(0, pending.length, ...pending.filter((item) => !ids.includes(item.id)));
      },
    };
    // Rebuilt from the host's own request, without the SDK's internal fields.
    const retryWithFreshOptions = vi.fn(async () => ({
      hookSpecificOutput: {
        hookEventName: "PostGenerateFailure" as const,
        retry: true,
        retryDelayMs: 0,
        updatedInput: { prompt: "go", threadId: "t1", ...pendingOptions },
      },
    }));

    await createAgent({
      model: model as LanguageModel,
      tools,
      checkpointer,
      hooks: { PostGenerateFailure: [retryWithFreshOptions] },
    }).generate({ prompt: "go", threadId: "t1", ...pendingOptions });

    expect(retryWithFreshOptions).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledTimes(1);
    const checkpoint = await checkpointer.load("t1");
    expect(checkpoint?.messages).toEqual([
      { role: "user", content: "go" },
      tagged,
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ]);
  });

  it("streamDataResponse() delivers it in a background follow-up turn", async () => {
    const { tools, options, committed } = await setup();
    const { createBackgroundTask } = await import("../src/task-store/types.js");
    const { model, requests } = scriptedModel([
      [{ type: "text", text: "initial" }],
      [echoCall("c1")],
      [{ type: "text", text: "done" }],
    ]);
    const agent = createAgent({ model, tools });
    agent.taskManager.registerTask(
      createBackgroundTask({
        id: "task-follow-up",
        subagentType: "researcher",
        description: "Summarise findings",
        status: "completed",
        completedAt: new Date().toISOString(),
        result: "Task complete",
      }),
    );

    const response = await agent.streamDataResponse({ prompt: "go", ...options });
    await response.text();

    expect(requests).toHaveLength(3);
    expect(requests[2]!.prompt.at(-1)?.role).toBe("user");
    expect(JSON.stringify(requests[2]!.prompt.at(-1))).toContain("also check Q3");
    expect(committed).toHaveBeenCalledWith(["d1"], { alreadyCommitted: [] });
  });

  it("changes nothing when the options are absent", async () => {
    mockGenerateOnce();
    await createAgent({ model: createMockModel() }).generate({ prompt: "go" });
    expect(lastGenerateArgs().prepareStep).toBeUndefined();
  });
});
