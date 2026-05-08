import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamPart } from "../src/index.js";
import { createAgent } from "../src/index.js";
import { createMockModel, resetMocks } from "./setup.js";

// Mock the AI SDK so we can drive the underlying fullStream deterministically.
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
    createUIMessageStream: vi.fn(),
    createUIMessageStreamResponse: vi.fn(),
  };
});

import { streamText } from "ai";

describe("Stream lifecycle events", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("emits turn-start before content and turn-end with messageId after content", async () => {
    const model = createMockModel();
    const agent = createAgent({ model });

    const responseId = "msg_01ABC";
    const usage = { promptTokens: 10, completionTokens: 4, totalTokens: 14 };

    const mockStream = {
      fullStream: (async function* () {
        yield { type: "start-step" as const };
        yield { type: "text-delta" as const, text: "Hello " };
        yield { type: "text-delta" as const, text: "world" };
        yield {
          type: "finish-step" as const,
          response: { id: responseId },
          finishReason: "stop" as const,
          usage,
        };
        yield {
          type: "finish" as const,
          finishReason: "stop" as const,
          totalUsage: usage,
        };
      })(),
      text: Promise.resolve("Hello world"),
      usage: Promise.resolve(usage),
      finishReason: Promise.resolve("stop" as const),
      steps: Promise.resolve([]),
    };
    vi.mocked(streamText).mockReturnValue(mockStream as any);

    const collected: StreamPart[] = [];
    for await (const part of agent.stream({ prompt: "test" })) {
      collected.push(part);
    }

    const types = collected.map((p) => p.type);
    expect(types).toEqual(["turn-start", "text-delta", "text-delta", "turn-end", "finish"]);

    const turnStart = collected.find((p) => p.type === "turn-start");
    expect(turnStart).toBeDefined();
    if (turnStart && turnStart.type === "turn-start") {
      expect(turnStart.messageId).toBeUndefined();
    }

    const turnEnd = collected.find((p) => p.type === "turn-end");
    expect(turnEnd).toBeDefined();
    if (turnEnd && turnEnd.type === "turn-end") {
      expect(turnEnd.messageId).toBe(responseId);
      expect(turnEnd.finishReason).toBe("stop");
      expect(turnEnd.usage).toEqual(usage);
    }
  });

  it("brackets each turn in a multi-turn stream", async () => {
    const model = createMockModel();
    const agent = createAgent({ model });

    const usage = { promptTokens: 8, completionTokens: 3, totalTokens: 11 };

    const mockStream = {
      fullStream: (async function* () {
        // Turn 1: text + tool call (no result yet)
        yield { type: "start-step" as const };
        yield { type: "text-delta" as const, text: "Looking up..." };
        yield {
          type: "tool-call" as const,
          toolCallId: "call_1",
          toolName: "lookup",
          input: { q: "x" },
        };
        yield {
          type: "finish-step" as const,
          response: { id: "msg_turn1" },
          finishReason: "tool-calls" as const,
          usage,
        };
        // Tool result happens between turns at the AI SDK level
        yield {
          type: "tool-result" as const,
          toolCallId: "call_1",
          toolName: "lookup",
          output: { result: "ok" },
        };
        // Turn 2: model continuation
        yield { type: "start-step" as const };
        yield { type: "text-delta" as const, text: "Done." };
        yield {
          type: "finish-step" as const,
          response: { id: "msg_turn2" },
          finishReason: "stop" as const,
          usage,
        };
        yield {
          type: "finish" as const,
          finishReason: "stop" as const,
          totalUsage: usage,
        };
      })(),
      text: Promise.resolve("Looking up...Done."),
      usage: Promise.resolve(usage),
      finishReason: Promise.resolve("stop" as const),
      steps: Promise.resolve([]),
    };
    vi.mocked(streamText).mockReturnValue(mockStream as any);

    const collected: StreamPart[] = [];
    for await (const part of agent.stream({ prompt: "test" })) {
      collected.push(part);
    }

    const turnEnds = collected.filter((p) => p.type === "turn-end");
    expect(turnEnds).toHaveLength(2);
    if (turnEnds[0]?.type === "turn-end") {
      expect(turnEnds[0].messageId).toBe("msg_turn1");
      expect(turnEnds[0].finishReason).toBe("tool-calls");
    }
    if (turnEnds[1]?.type === "turn-end") {
      expect(turnEnds[1].messageId).toBe("msg_turn2");
      expect(turnEnds[1].finishReason).toBe("stop");
    }

    // Tool call/result must appear between turn boundaries.
    const turnStartIdx = collected.findIndex((p) => p.type === "turn-start");
    const firstTurnEndIdx = collected.findIndex((p) => p.type === "turn-end");
    const toolCallIdx = collected.findIndex((p) => p.type === "tool-call");
    const toolResultIdx = collected.findIndex((p) => p.type === "tool-result");
    expect(turnStartIdx).toBeLessThan(toolCallIdx);
    expect(toolCallIdx).toBeLessThan(firstTurnEndIdx);
    // Tool-result lands after the first turn-end (AI SDK emits it between
    // step boundaries) but before the next turn-start.
    expect(toolResultIdx).toBeGreaterThan(firstTurnEndIdx);
    const secondTurnStartIdx = collected.findIndex(
      (p, i) => i > firstTurnEndIdx && p.type === "turn-start",
    );
    expect(toolResultIdx).toBeLessThan(secondTurnStartIdx);
  });

  it("forwards streamed tool input chunks before the final tool-call", async () => {
    const model = createMockModel();
    const agent = createAgent({ model });

    const usage = { promptTokens: 4, completionTokens: 8, totalTokens: 12 };
    const mockStream = {
      fullStream: (async function* () {
        yield { type: "start-step" as const };
        yield {
          type: "tool-input-start" as const,
          toolCallId: "call_1",
          toolName: "send_user_message",
        };
        yield {
          type: "tool-input-delta" as const,
          toolCallId: "call_1",
          toolName: "send_user_message",
          inputTextDelta: '{"message":"Hel',
        };
        yield {
          type: "tool-call-delta" as const,
          toolCallId: "call_1",
          toolName: "send_user_message",
          argsTextDelta: 'lo"}',
        };
        yield {
          type: "tool-input-end" as const,
          toolCallId: "call_1",
          toolName: "send_user_message",
        };
        yield {
          type: "tool-call" as const,
          toolCallId: "call_1",
          toolName: "send_user_message",
          input: { message: "Hello" },
        };
        yield {
          type: "finish-step" as const,
          response: { id: "msg_tool" },
          finishReason: "tool-calls" as const,
          usage,
        };
        yield {
          type: "finish" as const,
          finishReason: "tool-calls" as const,
          totalUsage: usage,
        };
      })(),
      text: Promise.resolve(""),
      usage: Promise.resolve(usage),
      finishReason: Promise.resolve("tool-calls" as const),
      steps: Promise.resolve([]),
    };
    vi.mocked(streamText).mockReturnValue(mockStream as any);

    const collected: StreamPart[] = [];
    for await (const part of agent.stream({ prompt: "test" })) {
      collected.push(part);
    }

    expect(collected.map((p) => p.type)).toEqual([
      "turn-start",
      "tool-input-start",
      "tool-input-delta",
      "tool-input-delta",
      "tool-input-end",
      "tool-call",
      "turn-end",
      "finish",
    ]);
    expect(collected[1]).toEqual({
      type: "tool-input-start",
      toolCallId: "call_1",
      toolName: "send_user_message",
    });
    expect(collected[2]).toEqual({
      type: "tool-input-delta",
      toolCallId: "call_1",
      toolName: "send_user_message",
      inputTextDelta: '{"message":"Hel',
    });
    expect(collected[3]).toEqual({
      type: "tool-input-delta",
      toolCallId: "call_1",
      toolName: "send_user_message",
      inputTextDelta: 'lo"}',
    });
    expect(collected[4]).toEqual({
      type: "tool-input-end",
      toolCallId: "call_1",
      toolName: "send_user_message",
    });
    expect(collected[5]).toEqual({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "send_user_message",
      input: { message: "Hello" },
    });
  });

  it("normalizes AI SDK tool input chunks that use id and delta fields", async () => {
    const model = createMockModel();
    const agent = createAgent({ model });

    const usage = { promptTokens: 4, completionTokens: 8, totalTokens: 12 };
    const mockStream = {
      fullStream: (async function* () {
        yield { type: "start-step" as const };
        yield {
          type: "tool-input-start" as const,
          id: "call_1",
          toolName: "send_user_message",
        };
        yield {
          type: "tool-input-delta" as const,
          id: "call_1",
          delta: '{"message":"Hel',
        };
        yield {
          type: "tool-input-delta" as const,
          id: "call_1",
          delta: 'lo"}',
        };
        yield {
          type: "tool-input-end" as const,
          id: "call_1",
        };
        yield {
          type: "tool-call" as const,
          toolCallId: "call_1",
          toolName: "send_user_message",
          input: { message: "Hello" },
        };
        yield {
          type: "finish-step" as const,
          response: { id: "msg_tool" },
          finishReason: "tool-calls" as const,
          usage,
        };
        yield {
          type: "finish" as const,
          finishReason: "tool-calls" as const,
          totalUsage: usage,
        };
      })(),
      text: Promise.resolve(""),
      usage: Promise.resolve(usage),
      finishReason: Promise.resolve("tool-calls" as const),
      steps: Promise.resolve([]),
    };
    vi.mocked(streamText).mockReturnValue(mockStream as any);

    const collected: StreamPart[] = [];
    for await (const part of agent.stream({ prompt: "test" })) {
      collected.push(part);
    }

    expect(collected.slice(1, 5)).toEqual([
      {
        type: "tool-input-start",
        toolCallId: "call_1",
        toolName: "send_user_message",
      },
      {
        type: "tool-input-delta",
        toolCallId: "call_1",
        toolName: "send_user_message",
        inputTextDelta: '{"message":"Hel',
      },
      {
        type: "tool-input-delta",
        toolCallId: "call_1",
        toolName: "send_user_message",
        inputTextDelta: 'lo"}',
      },
      {
        type: "tool-input-end",
        toolCallId: "call_1",
        toolName: "send_user_message",
      },
    ]);
    expect(collected[5]).toEqual({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "send_user_message",
      input: { message: "Hello" },
    });
  });

  it("emits turn-start/turn-end without messageId when finish-step has no response id", async () => {
    const model = createMockModel();
    const agent = createAgent({ model });

    const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    const mockStream = {
      fullStream: (async function* () {
        yield { type: "start-step" as const };
        yield { type: "text-delta" as const, text: "ok" };
        // Some providers omit response metadata; we should still surface
        // turn-end and just leave messageId undefined.
        yield {
          type: "finish-step" as const,
          response: {},
          finishReason: "stop" as const,
          usage,
        };
        yield {
          type: "finish" as const,
          finishReason: "stop" as const,
          totalUsage: usage,
        };
      })(),
      text: Promise.resolve("ok"),
      usage: Promise.resolve(usage),
      finishReason: Promise.resolve("stop" as const),
      steps: Promise.resolve([]),
    };
    vi.mocked(streamText).mockReturnValue(mockStream as any);

    const collected: StreamPart[] = [];
    for await (const part of agent.stream({ prompt: "test" })) {
      collected.push(part);
    }

    const turnEnd = collected.find((p) => p.type === "turn-end");
    expect(turnEnd).toBeDefined();
    if (turnEnd && turnEnd.type === "turn-end") {
      expect(turnEnd.messageId).toBeUndefined();
      expect(turnEnd.finishReason).toBe("stop");
    }
  });
});
