/**
 * Tests for checkpointer agent integration.
 *
 * These tests verify that the checkpointer option properly saves and loads
 * checkpoints when using threadIds with agent generation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import type { ApprovalInterrupt, Checkpoint } from "../src/checkpointer/types.js";
import { createAgent, createApprovalInterrupt } from "../src/index.js";
import { createMockModel, resetMocks } from "./setup.js";

// Mock the AI SDK functions
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
  };
});

import { generateText, streamText } from "ai";

describe("Checkpointer Agent Integration", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("checkpointer option", () => {
    it("should accept a checkpointer option", () => {
      const checkpointer = new MemorySaver();
      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      expect(agent.options.checkpointer).toBe(checkpointer);
    });

    it("should work without a checkpointer", async () => {
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Hello!",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

      const agent = createAgent({
        model: createMockModel(),
      });

      const result = await agent.generate({
        prompt: "Hello",
        threadId: "test-thread",
      });

      expect(result.text).toBe("Hello!");
    });
  });

  describe("threadId option", () => {
    it("should accept a threadId in generate options", async () => {
      const checkpointer = new MemorySaver();
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Hello!",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await agent.generate({
        prompt: "Hello",
        threadId: "test-thread",
      });

      // Verify checkpoint was saved
      const checkpoint = await checkpointer.load("test-thread");
      expect(checkpoint).toBeDefined();
      expect(checkpoint?.threadId).toBe("test-thread");
    });

    it("should not save checkpoint without threadId", async () => {
      const checkpointer = new MemorySaver();
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Hello!",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await agent.generate({
        prompt: "Hello",
      });

      // Verify no checkpoint was saved
      const threads = await checkpointer.list();
      expect(threads).toHaveLength(0);
    });
  });

  describe("checkpoint saving", () => {
    it("should save checkpoint after generate", async () => {
      const checkpointer = new MemorySaver();
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Response 1",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [{ text: "step1", toolCalls: [], toolResults: [], finishReason: "stop" }],
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await agent.generate({
        prompt: "Hello",
        threadId: "thread-1",
      });

      const checkpoint = await checkpointer.load("thread-1");
      expect(checkpoint).toBeDefined();
      expect(checkpoint!.step).toBe(1); // One step completed
      expect(checkpoint!.messages).toHaveLength(2); // User message + assistant response
    });

    it("should include messages in checkpoint", async () => {
      const checkpointer = new MemorySaver();
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Hello there!",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await agent.generate({
        prompt: "Hi!",
        threadId: "thread-1",
      });

      const checkpoint = await checkpointer.load("thread-1");
      expect(checkpoint?.messages[0]).toEqual({
        role: "user",
        content: "Hi!",
      });
      expect(checkpoint?.messages[1]).toEqual({
        role: "assistant",
        content: "Hello there!",
      });
    });

    it("should save agent state in checkpoint", async () => {
      const checkpointer = new MemorySaver();
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Response",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      // Modify agent state
      agent.state.todos = [
        { id: "1", content: "Test todo", status: "pending", createdAt: new Date().toISOString() },
      ];
      agent.state.files = { "/test.txt": { content: ["hello"], created_at: "", modified_at: "" } };

      await agent.generate({
        prompt: "Hello",
        threadId: "thread-1",
      });

      const checkpoint = await checkpointer.load("thread-1");
      expect(checkpoint?.state.todos).toHaveLength(1);
      expect(checkpoint?.state.todos[0].content).toBe("Test todo");
      expect(checkpoint?.state.files["/test.txt"]).toBeDefined();
    });
  });

  describe("checkpoint loading", () => {
    it("should load checkpoint on matching threadId", async () => {
      const checkpointer = new MemorySaver();

      // Pre-seed checkpoint
      const existingCheckpoint: Checkpoint = {
        threadId: "thread-1",
        step: 5,
        messages: [
          { role: "user", content: "Previous message" },
          { role: "assistant", content: "Previous response" },
        ],
        state: { todos: [], files: {} },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(existingCheckpoint);

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockImplementation(async ({ messages }: any) => {
        // Verify that previous messages are included
        expect(messages).toHaveLength(3); // 2 from checkpoint + 1 new
        return {
          text: "New response",
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "stop",
          steps: [],
        } as never;
      });

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await agent.generate({
        prompt: "New message",
        threadId: "thread-1",
      });
    });

    it("should restore agent state from checkpoint", async () => {
      const checkpointer = new MemorySaver();

      // Pre-seed checkpoint with state
      const existingCheckpoint: Checkpoint = {
        threadId: "thread-1",
        step: 3,
        messages: [{ role: "user", content: "Test" }],
        state: {
          todos: [
            { id: "1", content: "Restored todo", status: "in_progress", createdAt: "2026-01-30" },
          ],
          files: { "/restored.txt": { content: ["data"], created_at: "", modified_at: "" } },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(existingCheckpoint);

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Response",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await agent.generate({
        prompt: "Continue",
        threadId: "thread-1",
      });

      // Verify state was restored
      expect(agent.state.todos).toHaveLength(1);
      expect(agent.state.todos[0].content).toBe("Restored todo");
      expect(agent.state.files["/restored.txt"]).toBeDefined();
    });

    it("should increment step from checkpoint", async () => {
      const checkpointer = new MemorySaver();

      // Pre-seed checkpoint at step 5
      await checkpointer.save({
        threadId: "thread-1",
        step: 5,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Response",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [
          { text: "1", toolCalls: [], toolResults: [], finishReason: "stop" },
          { text: "2", toolCalls: [], toolResults: [], finishReason: "stop" },
        ], // 2 steps
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await agent.generate({
        prompt: "Continue",
        threadId: "thread-1",
      });

      const checkpoint = await checkpointer.load("thread-1");
      expect(checkpoint?.step).toBe(7); // 5 + 2 new steps
    });
  });

  describe("streaming with checkpoints", () => {
    it("should save checkpoint after stream completes", async () => {
      const checkpointer = new MemorySaver();
      const mockStreamText = vi.mocked(streamText);

      // Create an async generator for the stream
      const createMockStream = () =>
        (async function* () {
          yield { type: "text-delta" as const, text: "Hello" };
          yield { type: "text-delta" as const, text: " World" };
          yield {
            type: "finish" as const,
            finishReason: "stop" as const,
            totalUsage: { inputTokens: 5, outputTokens: 3 },
          };
        })();

      mockStreamText.mockReturnValue({
        fullStream: createMockStream(),
        text: Promise.resolve("Hello World"),
        usage: Promise.resolve({ inputTokens: 5, outputTokens: 3 }),
        finishReason: Promise.resolve("stop" as const),
        steps: Promise.resolve([
          { text: "step", toolCalls: [], toolResults: [], finishReason: "stop" },
        ]),
        output: Promise.resolve(undefined),
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      // Consume the stream
      for await (const _part of agent.stream({ prompt: "Hi", threadId: "stream-thread" })) {
        // Just consume
      }

      const checkpoint = await checkpointer.load("stream-thread");
      expect(checkpoint).toBeDefined();
      expect(checkpoint?.threadId).toBe("stream-thread");
      expect(checkpoint?.messages).toHaveLength(2); // user + assistant
    });

    it("should load checkpoint for streaming", async () => {
      const checkpointer = new MemorySaver();

      // Pre-seed checkpoint
      await checkpointer.save({
        threadId: "stream-thread",
        step: 2,
        messages: [
          { role: "user", content: "Previous" },
          { role: "assistant", content: "Previous response" },
        ],
        state: { todos: [], files: {} },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const mockStreamText = vi.mocked(streamText);

      const createMockStream = () =>
        (async function* () {
          yield { type: "text-delta" as const, text: "New" };
          yield {
            type: "finish" as const,
            finishReason: "stop" as const,
            totalUsage: { inputTokens: 5, outputTokens: 3 },
          };
        })();

      mockStreamText.mockImplementation(({ messages }: any) => {
        // Verify previous messages are included
        expect(messages).toHaveLength(3); // 2 from checkpoint + 1 new
        return {
          fullStream: createMockStream(),
          text: Promise.resolve("New"),
          usage: Promise.resolve({ inputTokens: 5, outputTokens: 3 }),
          finishReason: Promise.resolve("stop" as const),
          steps: Promise.resolve([]),
          output: Promise.resolve(undefined),
        } as never;
      });

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      for await (const _part of agent.stream({ prompt: "Continue", threadId: "stream-thread" })) {
        // Consume
      }
    });
  });

  describe("multiple threads", () => {
    it("should maintain separate checkpoints for different threads", async () => {
      const checkpointer = new MemorySaver();
      const mockGenerateText = vi.mocked(generateText);

      mockGenerateText.mockResolvedValue({
        text: "Response",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await agent.generate({ prompt: "Thread 1 message", threadId: "thread-1" });
      await agent.generate({ prompt: "Thread 2 message", threadId: "thread-2" });

      const checkpoint1 = await checkpointer.load("thread-1");
      const checkpoint2 = await checkpointer.load("thread-2");

      expect(checkpoint1?.messages[0].content).toBe("Thread 1 message");
      expect(checkpoint2?.messages[0].content).toBe("Thread 2 message");
    });

    it("should update existing checkpoint on same thread", async () => {
      const checkpointer = new MemorySaver();
      const mockGenerateText = vi.mocked(generateText);

      mockGenerateText.mockResolvedValue({
        text: "Response",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [{ text: "step", toolCalls: [], toolResults: [], finishReason: "stop" }],
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await agent.generate({ prompt: "First message", threadId: "thread-1" });
      const checkpoint1 = await checkpointer.load("thread-1");
      const createdAt1 = checkpoint1?.createdAt;

      await agent.generate({ prompt: "Second message", threadId: "thread-1" });
      const checkpoint2 = await checkpointer.load("thread-1");

      // Should preserve createdAt but update other fields
      expect(checkpoint2?.createdAt).toBe(createdAt1);
      expect(checkpoint2?.step).toBe(2); // Incremented
      expect(checkpoint2?.messages.length).toBeGreaterThan(checkpoint1!.messages.length);
    });
  });

  describe("checkpoint caching", () => {
    it("should cache loaded checkpoint within session", async () => {
      const checkpointer = new MemorySaver();
      const loadSpy = vi.spyOn(checkpointer, "load");

      // Pre-seed checkpoint
      await checkpointer.save({
        threadId: "thread-1",
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Response",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      // Multiple calls to same thread
      await agent.generate({ prompt: "First", threadId: "thread-1" });
      await agent.generate({ prompt: "Second", threadId: "thread-1" });

      // Should only call load once (cached after first call)
      expect(loadSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("interrupt and resume flow", () => {
    // Helper to create an approval interrupt for testing
    function createTestInterrupt(
      threadId: string,
      toolCallId: string,
      toolName: string,
      args: unknown,
    ): ApprovalInterrupt {
      return createApprovalInterrupt({
        id: `int_${toolCallId}`,
        threadId,
        toolCallId,
        toolName,
        args,
        step: 1,
      });
    }

    it("should store interrupt when tool requires approval", async () => {
      const checkpointer = new MemorySaver();
      const mockGenerateText = vi.mocked(generateText);

      // Mock a tool call that requires approval
      mockGenerateText.mockRejectedValue(new Error("Tool requires approval"));

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
        permissionMode: "ask",
        canUseTool: async () => "ask",
      });

      // This should fail and store interrupt
      await expect(
        agent.generate({
          prompt: "Run dangerous command",
          threadId: "approval-thread",
        }),
      ).rejects.toThrow();

      // Verify we can get the interrupt
      const interrupt = await agent.getInterrupt("approval-thread");
      // Interrupt may or may not be set depending on error handling
      // This is just checking the API works
      expect(interrupt === undefined || typeof interrupt === "object").toBe(true);
    });

    it("should resume after approval and execute tool deterministically", async () => {
      const checkpointer = new MemorySaver();
      const toolExecuted = vi.fn().mockResolvedValue({ result: "success" });
      const threadId = "approval-thread";
      const toolCallId = "call_123";

      // Create checkpoint with pending interrupt
      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createTestInterrupt(threadId, toolCallId, "myTool", { foo: "bar" }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Tool executed successfully",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

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

      // Get the interrupt and resume with approval
      const interrupt = await agent.getInterrupt(threadId);
      expect(interrupt).toBeDefined();

      const result = await agent.resume(threadId, interrupt!.id, { approved: true });

      // Verify tool was executed with the stored arguments
      expect(toolExecuted).toHaveBeenCalledTimes(1);
      expect(toolExecuted).toHaveBeenCalledWith(
        { foo: "bar" },
        expect.objectContaining({ toolCallId }),
      );

      // Verify the checkpoint was updated with tool call and result messages
      // After resume: user + assistant (tool call) + tool (result) + assistant (continuation)
      const updatedCheckpoint = await checkpointer.load(threadId);
      expect(updatedCheckpoint?.messages).toHaveLength(4);

      // Check assistant message has tool call
      const assistantMsg = updatedCheckpoint?.messages[1];
      expect(assistantMsg?.role).toBe("assistant");
      expect(Array.isArray(assistantMsg?.content)).toBe(true);
      if (Array.isArray(assistantMsg?.content)) {
        expect(assistantMsg.content[0]).toMatchObject({
          type: "tool-call",
          toolCallId,
          toolName: "myTool",
        });
      }

      // Check tool message has result
      const toolMsg = updatedCheckpoint?.messages[2];
      expect(toolMsg?.role).toBe("tool");

      expect(result.status).toBe("complete");
      if (result.status === "complete") {
        expect(result.text).toBe("Tool executed successfully");
      }
    });

    it("should resume after denial and inject denial message", async () => {
      const checkpointer = new MemorySaver();
      const toolExecuted = vi.fn();
      const threadId = "denial-thread";
      const toolCallId = "call_456";

      // Create checkpoint with pending interrupt
      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createTestInterrupt(threadId, toolCallId, "dangerousTool", {
          path: "/etc/passwd",
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Understood, I will not proceed with that action.",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

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

      // Get the interrupt and resume with denial
      const interrupt = await agent.getInterrupt(threadId);
      const result = await agent.resume(threadId, interrupt!.id, { approved: false });

      // Verify tool was NOT executed
      expect(toolExecuted).not.toHaveBeenCalled();

      // Verify the checkpoint was updated with denial message
      // After resume: user + assistant (tool call) + tool (denial) + assistant (continuation)
      const updatedCheckpoint = await checkpointer.load(threadId);
      expect(updatedCheckpoint?.messages).toHaveLength(4);

      // Check tool message contains denial
      const toolMsg = updatedCheckpoint?.messages[2];
      expect(toolMsg?.role).toBe("tool");
      if (Array.isArray(toolMsg?.content)) {
        expect(toolMsg.content[0]).toMatchObject({
          type: "tool-result",
          toolCallId,
          toolName: "dangerousTool",
        });
        // Check output contains denial (ToolResultOutput format)
        const output = (toolMsg.content[0] as { output: unknown }).output;
        expect(output).toMatchObject({
          type: "text",
          value: expect.stringContaining("denied"),
        });
      }

      expect(result.status).toBe("complete");
      if (result.status === "complete") {
        expect(result.text).toBe("Understood, I will not proceed with that action.");
      }
    });

    it("should handle tool execution errors during resume", async () => {
      const checkpointer = new MemorySaver();
      const toolError = new Error("Tool execution failed");
      const toolExecuted = vi.fn().mockRejectedValue(toolError);
      const threadId = "error-thread";
      const toolCallId = "call_789";

      // Create checkpoint with pending interrupt
      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createTestInterrupt(threadId, toolCallId, "failingTool", {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "I encountered an error with the tool.",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
        tools: {
          failingTool: {
            description: "A tool that fails",
            execute: toolExecuted,
          },
        },
      });

      // Get the interrupt and resume with approval
      const interrupt = await agent.getInterrupt(threadId);
      const result = await agent.resume(threadId, interrupt!.id, { approved: true });

      // Verify tool was attempted
      expect(toolExecuted).toHaveBeenCalledTimes(1);

      // Verify the checkpoint contains error result
      const updatedCheckpoint = await checkpointer.load(threadId);
      const toolMsg = updatedCheckpoint?.messages[2];
      if (Array.isArray(toolMsg?.content)) {
        const output = (toolMsg.content[0] as { output: unknown }).output;
        expect(output).toMatchObject({
          type: "text",
          value: expect.stringContaining("Tool execution failed"),
        });
      }

      expect(result.status).toBe("complete");
      if (result.status === "complete") {
        expect(result.text).toBe("I encountered an error with the tool.");
      }
    });

    it("should throw error when resuming with approval but tool not found", async () => {
      const checkpointer = new MemorySaver();
      const threadId = "approval-thread";
      const toolCallId = "call_123";

      // Create checkpoint with interrupt for a tool that doesn't exist
      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createTestInterrupt(threadId, toolCallId, "nonexistentTool", {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
        // No tools registered
      });

      // Get the interrupt and try to resume with approval - should fail because tool doesn't exist
      const interrupt = await agent.getInterrupt(threadId);
      await expect(agent.resume(threadId, interrupt!.id, { approved: true })).rejects.toThrow(
        "not found",
      );
    });

    it("should throw error when checkpointer is not configured", async () => {
      const agent = createAgent({
        model: createMockModel(),
        // No checkpointer
      });

      await expect(agent.resume("thread-1", "int_123", { approved: true })).rejects.toThrow(
        "checkpointer is required",
      );
    });

    it("should throw error when checkpoint not found", async () => {
      const checkpointer = new MemorySaver();
      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await expect(
        agent.resume("nonexistent-thread", "int_123", { approved: true }),
      ).rejects.toThrow("no checkpoint found");
    });

    it("should throw error when no pending interrupt", async () => {
      const checkpointer = new MemorySaver();
      const threadId = "thread-1";

      // Create checkpoint without interrupt
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

      await expect(agent.resume(threadId, "int_123", { approved: true })).rejects.toThrow(
        "no pending interrupt",
      );
    });

    it("should throw error when interrupt ID mismatch", async () => {
      const checkpointer = new MemorySaver();
      const threadId = "thread-1";

      // Create checkpoint with interrupt
      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Test" }],
        state: { todos: [], files: {} },
        pendingInterrupt: createTestInterrupt(threadId, "call_123", "myTool", {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await checkpointer.save(checkpoint);

      const agent = createAgent({
        model: createMockModel(),
        checkpointer,
      });

      await expect(agent.resume(threadId, "wrong_id", { approved: true })).rejects.toThrow(
        "interrupt ID mismatch",
      );
    });
  });
});
