/**
 * Tests for resumeDataResponse() — the streaming variant of resume().
 *
 * These tests mirror the resume() tests in interrupt-resume-bugs.test.ts
 * and checkpointer-integration.test.ts to verify that resumeDataResponse()
 * follows the same behavior but returns a web Response instead of
 * GenerateResult.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import type { Checkpoint } from "../src/checkpointer/types.js";
import { createAgent, createApprovalInterrupt, createInterrupt } from "../src/index.js";
import { createMockModel, resetMocks } from "./setup.js";

// Mock the AI SDK functions
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
    createUIMessageStream: vi.fn(),
    createUIMessageStreamResponse: vi.fn(),
  };
});

import { createUIMessageStream, createUIMessageStreamResponse, streamText } from "ai";

/**
 * Helper to set up streaming mocks for streamDataResponse.
 * Must be called in each test or beforeEach that uses resumeDataResponse.
 */
function setupStreamingMocks() {
  const mockStream = new ReadableStream();
  vi.mocked(createUIMessageStream).mockReturnValue(mockStream);
  vi.mocked(createUIMessageStreamResponse).mockReturnValue(
    new Response("mock stream", {
      headers: { "Content-Type": "text/event-stream" },
    }),
  );
  vi.mocked(streamText).mockReturnValue({
    toUIMessageStream: () => new ReadableStream(),
    text: Promise.resolve("Continued after resume"),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
    finishReason: Promise.resolve("stop"),
    steps: Promise.resolve([]),
    fullStream: (async function* () {
      yield { type: "text-delta" as const, text: "Continued after resume", id: "1" };
    })(),
  } as ReturnType<typeof streamText>);
}

describe("resumeDataResponse", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("Approval flow", () => {
    it("should return a Response instance when approval is granted", async () => {
      setupStreamingMocks();
      const checkpointer = new MemorySaver();
      const toolExecuted = vi.fn().mockResolvedValue({ result: "success" });
      const threadId = "approval-stream-thread";
      const toolCallId = "call_stream_test";

      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createApprovalInterrupt({
          id: `int_${toolCallId}`,
          threadId,
          toolCallId,
          toolName: "myTool",
          args: { foo: "bar" },
          step: 1,
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
        tools: {
          myTool: {
            description: "A test tool",
            execute: toolExecuted,
          },
        },
      });

      const interrupt = await agent.getInterrupt(threadId);
      const response = await agent.resumeDataResponse(threadId, interrupt!.id, {
        approved: true,
      });

      expect(response).toBeInstanceOf(Response);
      expect(toolExecuted).toHaveBeenCalledWith(
        { foo: "bar" },
        expect.objectContaining({ toolCallId }),
      );
    });

    it("should return a Response and NOT execute the tool when denied", async () => {
      setupStreamingMocks();
      const checkpointer = new MemorySaver();
      const toolExecuted = vi.fn();
      const threadId = "denial-stream-thread";
      const toolCallId = "call_denial_stream";

      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createApprovalInterrupt({
          id: `int_${toolCallId}`,
          threadId,
          toolCallId,
          toolName: "dangerousTool",
          args: { path: "/etc/passwd" },
          step: 1,
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
        tools: {
          dangerousTool: {
            description: "A dangerous tool",
            execute: toolExecuted,
          },
        },
      });

      const interrupt = await agent.getInterrupt(threadId);
      const response = await agent.resumeDataResponse(threadId, interrupt!.id, {
        approved: false,
      });

      expect(response).toBeInstanceOf(Response);
      expect(toolExecuted).not.toHaveBeenCalled();

      // Denial message should be in checkpoint
      const updatedCheckpoint = await checkpointer.load(threadId);
      const toolMsg = updatedCheckpoint?.messages.find((m) => m.role === "tool");
      expect(toolMsg).toBeDefined();
      const toolContent = toolMsg?.content as Array<{
        type: string;
        output: unknown;
      }>;
      const output = toolContent[0].output as { type: string; value: string };
      expect(output.type).toBe("text");
      expect(output.value).toContain("denied");
    });

    it("should return a Response when tool execution throws an error", async () => {
      setupStreamingMocks();
      const checkpointer = new MemorySaver();
      const threadId = "error-stream-thread";
      const toolCallId = "call_error_stream";

      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createApprovalInterrupt({
          id: `int_${toolCallId}`,
          threadId,
          toolCallId,
          toolName: "failingTool",
          args: {},
          step: 1,
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
        tools: {
          failingTool: {
            description: "A tool that fails",
            execute: vi.fn().mockRejectedValue(new Error("Boom")),
          },
        },
      });

      const interrupt = await agent.getInterrupt(threadId);
      const response = await agent.resumeDataResponse(threadId, interrupt!.id, {
        approved: true,
      });

      expect(response).toBeInstanceOf(Response);

      // Error message should be in checkpoint
      const updatedCheckpoint = await checkpointer.load(threadId);
      const toolMsg = updatedCheckpoint?.messages.find((m) => m.role === "tool");
      const toolContent = toolMsg?.content as Array<{
        type: string;
        output: unknown;
      }>;
      const output = toolContent[0].output as { type: string; value: string };
      expect(output.type).toBe("text");
      expect(output.value).toContain("Boom");
    });

    it("should use { type, value } format for ToolResultOutput", async () => {
      setupStreamingMocks();
      const checkpointer = new MemorySaver();
      const toolExecuted = vi.fn().mockResolvedValue({ result: "success" });
      const threadId = "format-stream-thread";
      const toolCallId = "call_format_stream";

      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createApprovalInterrupt({
          id: `int_${toolCallId}`,
          threadId,
          toolCallId,
          toolName: "myTool",
          args: { foo: "bar" },
          step: 1,
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
        tools: {
          myTool: {
            description: "A test tool",
            execute: toolExecuted,
          },
        },
      });

      const interrupt = await agent.getInterrupt(threadId);
      await agent.resumeDataResponse(threadId, interrupt!.id, { approved: true });

      const updatedCheckpoint = await checkpointer.load(threadId);
      const toolMsg = updatedCheckpoint?.messages.find((m) => m.role === "tool");
      const toolContent = toolMsg?.content as Array<{
        type: string;
        output: unknown;
      }>;
      const output = toolContent[0].output;
      expect(output).toMatchObject({
        type: expect.stringMatching(/^(text|json)$/),
        value: expect.anything(),
      });
    });

    it("should throw when tool is not found", async () => {
      const checkpointer = new MemorySaver();
      const threadId = "missing-tool-thread";
      const toolCallId = "call_missing";

      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createApprovalInterrupt({
          id: `int_${toolCallId}`,
          threadId,
          toolCallId,
          toolName: "nonExistentTool",
          args: {},
          step: 1,
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await expect(
        agent.resumeDataResponse(threadId, `int_${toolCallId}`, { approved: true }),
      ).rejects.toThrow("not found");
    });
  });

  describe("Custom interrupt flow", () => {
    it("should deliver user response to interrupt() callback and return a Response", async () => {
      setupStreamingMocks();
      const checkpointer = new MemorySaver();
      const threadId = "custom-stream-thread";
      const toolCallId = "call_ask_user";
      const interruptId = `int_${toolCallId}`;

      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Ask something" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createInterrupt({
          id: interruptId,
          threadId,
          type: "custom",
          toolCallId,
          toolName: "ask_user",
          request: { question: "What is your name?" },
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      let receivedResponse: unknown;

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
        tools: {
          ask_user: {
            description: "Ask the user a question",
            execute: async (
              input: unknown,
              options: { interrupt?: (req: unknown) => Promise<unknown> },
            ) => {
              if (options.interrupt) {
                receivedResponse = await options.interrupt(input);
                return `User said: ${receivedResponse}`;
              }
              return "no interrupt";
            },
          },
        },
      });

      const response = await agent.resumeDataResponse(threadId, interruptId, "Alice");

      expect(response).toBeInstanceOf(Response);
      expect(receivedResponse).toBe("Alice");

      // Checkpoint should have the tool result and no pending interrupt
      const updatedCheckpoint = await checkpointer.load(threadId);
      expect(updatedCheckpoint?.pendingInterrupt).toBeUndefined();
      expect(updatedCheckpoint?.messages.length).toBeGreaterThan(1);
    });

    it("should return 204 Response when tool throws a re-interrupt", async () => {
      const checkpointer = new MemorySaver();
      const threadId = "re-interrupt-stream-thread";
      const toolCallId = "call_wizard";
      const interruptId = `int_${toolCallId}`;

      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Start a wizard" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createInterrupt({
          id: interruptId,
          threadId,
          type: "custom",
          toolCallId,
          toolName: "wizard",
          request: { step: 1, question: "What is step 1?" },
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
        tools: {
          wizard: {
            description: "Multi-step wizard",
            execute: async (
              input: unknown,
              options: { interrupt?: (req: unknown) => Promise<unknown> },
            ) => {
              if (!options.interrupt) return "no interrupt";
              // First call: receives response, then asks another question
              const response = await options.interrupt(input);
              // Second call: throws another InterruptSignal
              await options.interrupt({ step: 2, question: "What is step 2?" });
              return `Completed: ${response}`;
            },
          },
        },
      });

      const response = await agent.resumeDataResponse(threadId, interruptId, "Answer to step 1");

      // Should return 204 (re-interrupt)
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();

      // New interrupt should be persisted in checkpoint
      const updatedCheckpoint = await checkpointer.load(threadId);
      expect(updatedCheckpoint?.pendingInterrupt).toBeDefined();
      expect(updatedCheckpoint?.pendingInterrupt?.request).toMatchObject({
        step: 2,
        question: "What is step 2?",
      });

      // getInterrupt should return the new interrupt
      const newInterrupt = await agent.getInterrupt(threadId);
      expect(newInterrupt).toBeDefined();
      expect(newInterrupt?.request).toMatchObject({
        step: 2,
        question: "What is step 2?",
      });
    });
  });

  describe("Validation errors", () => {
    it("should throw when no checkpointer is configured", async () => {
      const agent = createAgent({
        model: createMockModel(),
      });

      await expect(agent.resumeDataResponse("any-thread", "any-id", {})).rejects.toThrow(
        "checkpointer is required",
      );
    });

    it("should throw when no checkpoint exists for threadId", async () => {
      const checkpointer = new MemorySaver();
      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await expect(agent.resumeDataResponse("nonexistent-thread", "any-id", {})).rejects.toThrow(
        "no checkpoint found",
      );
    });

    it("should throw when no pending interrupt exists", async () => {
      const checkpointer = new MemorySaver();
      const threadId = "no-interrupt-thread";

      // Save a checkpoint without a pending interrupt
      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await expect(agent.resumeDataResponse(threadId, "any-id", {})).rejects.toThrow(
        "no pending interrupt",
      );
    });

    it("should throw when interrupt ID does not match", async () => {
      const checkpointer = new MemorySaver();
      const threadId = "mismatch-thread";
      const toolCallId = "call_mismatch";

      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createInterrupt({
          id: `int_${toolCallId}`,
          threadId,
          type: "custom",
          toolCallId,
          toolName: "someTool",
          request: {},
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await expect(agent.resumeDataResponse(threadId, "wrong-interrupt-id", {})).rejects.toThrow(
        "interrupt ID mismatch",
      );
    });
  });
});
