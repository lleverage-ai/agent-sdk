import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PostGenerateFailureInput,
  PostGenerateInput,
  PreGenerateInput,
} from "../src/index.js";
import { createAgent } from "../src/index.js";
import { createMockModel, resetMocks } from "./setup.js";

// Mock the AI SDK functions
vi.mock("ai", async () => {
  const actual = await import("ai");
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
    createUIMessageStream: vi.fn(),
    createUIMessageStreamResponse: vi.fn(),
  };
});

import { generateText, streamText } from "ai";

describe("Streaming Hook Parity", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("PreGenerate hook invocation", () => {
    it("fires PreGenerate hooks in generate()", async () => {
      const model = createMockModel();
      const preGenerateCallback = vi.fn(async (input: PreGenerateInput) => ({
        hookSpecificOutput: {},
      }));

      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [preGenerateCallback],
        },
      });

      // Mock generateText to return a valid response
      vi.mocked(generateText).mockResolvedValue({
        text: "Hello",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
        steps: [],
      } as any);

      await agent.generate({ prompt: "test" });

      expect(preGenerateCallback).toHaveBeenCalledTimes(1);
      expect(preGenerateCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PreGenerate",
          options: expect.objectContaining({ prompt: "test" }),
        }),
        null,
        expect.objectContaining({ agent: expect.anything() }),
      );
    });

    it("fires PreGenerate hooks in stream()", async () => {
      const model = createMockModel();
      const preGenerateCallback = vi.fn(async (input: PreGenerateInput) => ({
        hookSpecificOutput: {},
      }));

      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [preGenerateCallback],
        },
      });

      // Mock streamText to return a valid stream
      const mockStream = {
        fullStream: (async function* () {
          yield { type: "text-delta" as const, text: "Hello" };
          yield {
            type: "finish" as const,
            finishReason: "stop" as const,
            totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          };
        })(),
        text: Promise.resolve("Hello"),
        usage: Promise.resolve({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
        finishReason: Promise.resolve("stop" as const),
        steps: Promise.resolve([]),
      };
      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const stream = agent.stream({ prompt: "test" });

      // Consume the stream
      for await (const _part of stream) {
        // Just consume
      }

      expect(preGenerateCallback).toHaveBeenCalledTimes(1);
      expect(preGenerateCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PreGenerate",
          options: expect.objectContaining({ prompt: "test" }),
        }),
        null,
        expect.objectContaining({ agent: expect.anything() }),
      );
    });

    it("fires PreGenerate hooks in streamResponse()", async () => {
      const model = createMockModel();
      const preGenerateCallback = vi.fn(async (input: PreGenerateInput) => ({
        hookSpecificOutput: {},
      }));

      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [preGenerateCallback],
        },
      });

      // Mock streamText with onFinish callback
      const mockOnFinish = vi.fn();
      const mockStream = {
        toUIMessageStreamResponse: vi.fn(() => new Response()),
      };
      vi.mocked(streamText).mockImplementation((options: any) => {
        // Capture onFinish and call it immediately for testing
        if (options.onFinish) {
          mockOnFinish.mockImplementation(options.onFinish);
          setTimeout(() => {
            options.onFinish({
              text: "Hello",
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              finishReason: "stop",
              steps: [],
            });
          }, 0);
        }
        return mockStream as any;
      });

      await agent.streamResponse({ prompt: "test" });

      expect(preGenerateCallback).toHaveBeenCalledTimes(1);
      expect(preGenerateCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PreGenerate",
          options: expect.objectContaining({ prompt: "test" }),
        }),
        null,
        expect.objectContaining({ agent: expect.anything() }),
      );
    });
  });

  describe("updatedInput transformation", () => {
    it("applies updatedInput in generate()", async () => {
      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [
            async (input: PreGenerateInput) => ({
              hookSpecificOutput: {
                updatedInput: {
                  ...input.options,
                  temperature: 0.7,
                },
              },
            }),
          ],
        },
      });

      vi.mocked(generateText).mockResolvedValue({
        text: "Hello",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
        steps: [],
      } as any);

      await agent.generate({ prompt: "test", temperature: 0.5 });

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        }),
      );
    });

    it("applies updatedInput in stream()", async () => {
      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [
            async (input: PreGenerateInput) => ({
              hookSpecificOutput: {
                updatedInput: {
                  ...input.options,
                  temperature: 0.7,
                },
              },
            }),
          ],
        },
      });

      const mockStream = {
        fullStream: (async function* () {
          yield { type: "text-delta" as const, text: "Hello" };
          yield {
            type: "finish" as const,
            finishReason: "stop" as const,
            totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          };
        })(),
        text: Promise.resolve("Hello"),
        usage: Promise.resolve({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
        finishReason: Promise.resolve("stop" as const),
        steps: Promise.resolve([]),
      };
      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const stream = agent.stream({ prompt: "test", temperature: 0.5 });

      // Consume the stream
      for await (const _part of stream) {
        // Just consume
      }

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        }),
      );
    });
  });

  describe("PostGenerate hook invocation", () => {
    it("fires PostGenerate hooks in generate()", async () => {
      const model = createMockModel();
      const postGenerateCallback = vi.fn(async (input: PostGenerateInput) => ({
        hookSpecificOutput: {},
      }));

      const agent = createAgent({
        model,
        hooks: {
          PostGenerate: [postGenerateCallback],
        },
      });

      vi.mocked(generateText).mockResolvedValue({
        text: "Hello",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
        steps: [],
      } as any);

      await agent.generate({ prompt: "test" });

      expect(postGenerateCallback).toHaveBeenCalledTimes(1);
      expect(postGenerateCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PostGenerate",
          result: expect.objectContaining({
            text: "Hello",
          }),
        }),
        null,
        expect.objectContaining({ agent: expect.anything() }),
      );
    });

    it("fires PostGenerate hooks in stream()", async () => {
      const model = createMockModel();
      const postGenerateCallback = vi.fn(async (input: PostGenerateInput) => ({
        hookSpecificOutput: {},
      }));

      const agent = createAgent({
        model,
        hooks: {
          PostGenerate: [postGenerateCallback],
        },
      });

      const mockStream = {
        fullStream: (async function* () {
          yield { type: "text-delta" as const, text: "Hello" };
          yield {
            type: "finish" as const,
            finishReason: "stop" as const,
            totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          };
        })(),
        text: Promise.resolve("Hello"),
        usage: Promise.resolve({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
        finishReason: Promise.resolve("stop" as const),
        steps: Promise.resolve([]),
      };
      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const stream = agent.stream({ prompt: "test" });

      // Consume the stream to trigger PostGenerate
      for await (const _part of stream) {
        // Just consume
      }

      expect(postGenerateCallback).toHaveBeenCalledTimes(1);
      expect(postGenerateCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PostGenerate",
          result: expect.objectContaining({
            text: "Hello",
          }),
        }),
        null,
        expect.objectContaining({ agent: expect.anything() }),
      );
    });
  });

  describe("PostGenerateFailure hook invocation", () => {
    it("fires PostGenerateFailure hooks in generate() on error", async () => {
      const model = createMockModel();
      const postGenerateFailureCallback = vi.fn(async (input: PostGenerateFailureInput) => ({
        hookSpecificOutput: {},
      }));

      const agent = createAgent({
        model,
        hooks: {
          PostGenerateFailure: [postGenerateFailureCallback],
        },
      });

      const testError = new Error("Generation failed");
      vi.mocked(generateText).mockRejectedValue(testError);

      await expect(agent.generate({ prompt: "test" })).rejects.toThrow();

      expect(postGenerateFailureCallback).toHaveBeenCalledTimes(1);
      expect(postGenerateFailureCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PostGenerateFailure",
          error: expect.any(Error),
        }),
        null,
        expect.objectContaining({ agent: expect.anything() }),
      );
    });

    it("fires PostGenerateFailure hooks in stream() on error", async () => {
      const model = createMockModel();
      const postGenerateFailureCallback = vi.fn(async (input: PostGenerateFailureInput) => ({
        hookSpecificOutput: {},
      }));

      const agent = createAgent({
        model,
        hooks: {
          PostGenerateFailure: [postGenerateFailureCallback],
        },
      });

      const testError = new Error("Stream failed");
      vi.mocked(streamText).mockImplementation(() => {
        throw testError;
      });

      const stream = agent.stream({ prompt: "test" });

      await expect(async () => {
        for await (const _part of stream) {
          // Should not get here
        }
      }).rejects.toThrow();

      expect(postGenerateFailureCallback).toHaveBeenCalledTimes(1);
      expect(postGenerateFailureCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PostGenerateFailure",
          error: expect.any(Error),
        }),
        null,
        expect.objectContaining({ agent: expect.anything() }),
      );
    });
  });

  describe("respondWith cache short-circuit", () => {
    it("supports respondWith in generate()", async () => {
      const model = createMockModel();
      const cachedResult = {
        status: "complete" as const,
        text: "Cached response",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop" as const,
        steps: [],
      };

      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [
            async () => ({
              hookSpecificOutput: {
                respondWith: cachedResult,
              },
            }),
          ],
        },
      });

      const result = await agent.generate({ prompt: "test" });

      // Should return cached result without calling generateText
      expect(generateText).not.toHaveBeenCalled();
      expect(result.text).toBe("Cached response");
    });

    it("supports respondWith in stream() for cache hits", async () => {
      const model = createMockModel();
      const cachedResult = {
        status: "complete" as const,
        text: "Cached response",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop" as const,
        steps: [],
      };

      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [
            async () => ({
              hookSpecificOutput: {
                respondWith: cachedResult,
              },
            }),
          ],
        },
      });

      const mockStream = {
        fullStream: (async function* () {
          yield { type: "text-delta" as const, text: "Streamed" };
          yield {
            type: "finish" as const,
            finishReason: "stop" as const,
            totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          };
        })(),
        text: Promise.resolve("Streamed"),
        usage: Promise.resolve({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
        finishReason: Promise.resolve("stop" as const),
        steps: Promise.resolve([]),
      };
      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const stream = agent.stream({ prompt: "test" });

      let receivedText = "";
      let finishPart: any = null;
      for await (const part of stream) {
        if (part.type === "text-delta") {
          receivedText += part.text;
        }
        if (part.type === "finish") {
          finishPart = part;
        }
      }

      // Should NOT call streamText (uses cached result)
      expect(streamText).not.toHaveBeenCalled();
      expect(receivedText).toBe("Cached response");
      expect(finishPart?.finishReason).toBe("stop");
    });

    it("supports respondWith in streamResponse() for cache hits", async () => {
      const model = createMockModel();
      const cachedResult = {
        status: "complete" as const,
        text: "Cached response",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop" as const,
        steps: [],
      };

      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [
            async () => ({
              hookSpecificOutput: {
                respondWith: cachedResult,
              },
            }),
          ],
        },
      });

      const response = await agent.streamResponse({ prompt: "test" });

      // Should NOT call streamText (returns cached result as plain Response)
      expect(streamText).not.toHaveBeenCalled();

      // Response should contain the cached text
      const text = await response.text();
      expect(text).toBe("Cached response");
      expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    });

    it("supports respondWith in streamDataResponse() for cache hits", async () => {
      const model = createMockModel();
      const cachedResult = {
        status: "complete" as const,
        text: "Cached response",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop" as const,
        steps: [],
      };

      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [
            async () => ({
              hookSpecificOutput: {
                respondWith: cachedResult,
              },
            }),
          ],
        },
      });

      const response = await agent.streamDataResponse({ prompt: "test" });

      // Should NOT call streamText (returns cached result as plain Response)
      expect(streamText).not.toHaveBeenCalled();

      // Response should contain the cached text
      const text = await response.text();
      expect(text).toBe("Cached response");
      expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    });

    it("respondWith yields tool calls from cached steps in stream()", async () => {
      const model = createMockModel();
      const cachedResult = {
        status: "complete" as const,
        text: "Done",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop" as const,
        steps: [
          {
            text: "Step text",
            toolCalls: [
              {
                toolCallId: "call-1",
                toolName: "testTool",
                input: { arg: "value" },
              },
            ],
            toolResults: [
              {
                toolCallId: "call-1",
                toolName: "testTool",
                result: { success: true },
              },
            ],
            finishReason: "tool-calls" as const,
          },
        ],
      };

      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [
            async () => ({
              hookSpecificOutput: {
                respondWith: cachedResult,
              },
            }),
          ],
        },
      });

      const stream = agent.stream({ prompt: "test" });

      const parts: any[] = [];
      for await (const part of stream) {
        parts.push(part);
      }

      // Should NOT call streamText
      expect(streamText).not.toHaveBeenCalled();

      // Check that we received the expected stream parts
      expect(parts.some((p) => p.type === "text-delta" && p.text === "Done")).toBe(true);
      expect(parts.some((p) => p.type === "tool-call" && p.toolName === "testTool")).toBe(true);
      expect(parts.some((p) => p.type === "tool-result" && p.toolName === "testTool")).toBe(true);
      expect(parts.some((p) => p.type === "finish")).toBe(true);
    });
  });

  describe("updatedResult transformation", () => {
    it("applies updatedResult in generate()", async () => {
      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PostGenerate: [
            async (input: PostGenerateInput) => ({
              hookSpecificOutput: {
                updatedResult: {
                  ...input.result,
                  text: input.result.text.toUpperCase(),
                },
              },
            }),
          ],
        },
      });

      vi.mocked(generateText).mockResolvedValue({
        text: "hello",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
        steps: [],
      } as any);

      const result = await agent.generate({ prompt: "test" });

      expect(result.text).toBe("HELLO");
    });

    it("does NOT apply updatedResult in stream() (intentional limitation)", async () => {
      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PostGenerate: [
            async (input: PostGenerateInput) => ({
              hookSpecificOutput: {
                updatedResult: {
                  ...input.result,
                  text: input.result.text.toUpperCase(),
                },
              },
            }),
          ],
        },
      });

      const mockStream = {
        fullStream: (async function* () {
          yield { type: "text-delta" as const, text: "hello" };
          yield {
            type: "finish" as const,
            finishReason: "stop" as const,
            totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          };
        })(),
        text: Promise.resolve("hello"),
        usage: Promise.resolve({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
        finishReason: Promise.resolve("stop" as const),
        steps: Promise.resolve([]),
      };
      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const stream = agent.stream({ prompt: "test" });

      let receivedText = "";
      for await (const part of stream) {
        if (part.type === "text-delta") {
          receivedText += part.text;
        }
      }

      // Text should NOT be transformed (stream already sent)
      expect(receivedText).toBe("hello");
    });
  });
});
