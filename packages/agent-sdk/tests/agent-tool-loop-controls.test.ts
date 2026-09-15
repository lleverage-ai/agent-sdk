/**
 * Tests for the tool-loop controls upstreamed from the lleverage platform:
 *
 * - `transformToolError` boundary for tool execute() rejections
 * - `tool-error` / `tool-output-denied` stream parts
 * - discovered-tool-call repair (`experimental_repairToolCall` → `call_tool`)
 * - `options.stop()` for tools and `GenerateOptions.shouldStopAfterStep`
 * - mid-run streaming compaction via `prepareStep`
 * - checkpoints built from every step (not just the final step's response)
 */

import { NoSuchToolError, type ToolSet, tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent, definePlugin } from "../src/index.js";
import type { StreamPart } from "../src/types.js";
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
  experimental_repairToolCall?: (params: {
    error: unknown;
    toolCall: { toolCallId: string; toolName: string; input: string; type: "tool-call" };
    tools: ToolSet;
  }) => Promise<unknown>;
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
    expect(args.experimental_repairToolCall).toBeDefined();
    expect(args.tools).toHaveProperty("call_tool");

    const repaired = await args.experimental_repairToolCall!({
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

    const repaired = (await args.experimental_repairToolCall!({
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
    const repair = args.experimental_repairToolCall!;

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
      args.experimental_repairToolCall!({
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
      args.experimental_repairToolCall!({
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
      args.experimental_repairToolCall!({
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
      args.experimental_repairToolCall!({
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
      args.experimental_repairToolCall!({
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
