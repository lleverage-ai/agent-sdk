/**
 * Regression tests for interrupt resume flow bugs.
 *
 * Bug 1: pendingResponses key mismatch — resume() stores responses keyed by
 * raw toolCallId, but interrupt() looks them up by "int_" + toolCallId
 * (interrupt.id). The response is never found.
 *
 * Bug 2: Custom interrupt resume unreliable — resume() re-runs generate(),
 * relying on the model re-calling the same tool. But tool call IDs change
 * each generation, so the pending response is never matched.
 *
 * Bug 3: ToolResultOutput format — checkpoint messages use raw objects for
 * tool result output, but the AI SDK's modelMessageSchema requires the
 * discriminated union format ({ type: 'text', value } or { type: 'json', value }).
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
  };
});

import { generateText } from "ai";

describe("Interrupt resume flow bugs", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("Bug 1+2: Custom interrupt resume", () => {
    it("should deliver the user response to the tool's interrupt() call on resume", async () => {
      const checkpointer = new MemorySaver();
      const threadId = "custom-interrupt-thread";
      const toolCallId = "call_ask_user";
      const interruptId = `int_${toolCallId}`;

      // Simulate: a tool called interrupt() on a previous generation,
      // and the checkpoint was saved with a pending custom interrupt.
      const checkpoint: Checkpoint = {
        threadId,
        step: 1,
        messages: [{ role: "user", content: "Ask the user something" }],
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

      // Track what the tool's interrupt() call receives
      let receivedResponse: unknown;

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Thanks for telling me your name!",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

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

      // Resume with the user's answer
      const result = await agent.resume(threadId, interruptId, "Alice");

      // The tool must have received the user's response via interrupt()
      expect(receivedResponse).toBe("Alice");

      // The generation should have completed
      expect(result.status).toBe("complete");
      if (result.status === "complete") {
        expect(result.text).toBe("Thanks for telling me your name!");
      }

      // The checkpoint should have the tool call and result in messages
      const updatedCheckpoint = await checkpointer.load(threadId);
      expect(updatedCheckpoint?.pendingInterrupt).toBeUndefined();
      expect(updatedCheckpoint?.messages.length).toBeGreaterThan(1);
    });

    it("should handle a tool that throws another interrupt on resume", async () => {
      const checkpointer = new MemorySaver();
      const threadId = "re-interrupt-thread";
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

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Continuing...",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never);

      let interruptCallCount = 0;
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
              interruptCallCount++;

              // First call: receives response, then asks another question
              const response = await options.interrupt(input);
              // Second call: ask the next question (throws another InterruptSignal)
              await options.interrupt({ step: 2, question: "What is step 2?" });
              return `Completed: ${response}`;
            },
          },
        },
      });

      // Resume step 1
      const result = await agent.resume(threadId, interruptId, "Answer to step 1");

      // Should return a new interrupt (step 2), not complete
      expect(result.status).toBe("interrupted");
      if (result.status === "interrupted") {
        expect(result.interrupt.request).toMatchObject({
          step: 2,
          question: "What is step 2?",
        });
      }

      // Checkpoint should have the new pending interrupt
      const updatedCheckpoint = await checkpointer.load(threadId);
      expect(updatedCheckpoint?.pendingInterrupt).toBeDefined();
    });
  });

  describe("Bug 3: ToolResultOutput format", () => {
    it("should use { type, value } format for tool result output after approval resume", async () => {
      const checkpointer = new MemorySaver();
      const toolExecuted = vi.fn().mockResolvedValue({ result: "success" });
      const threadId = "approval-format-thread";
      const toolCallId = "call_format_test";

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

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Done",
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

      const interrupt = await agent.getInterrupt(threadId);
      await agent.resume(threadId, interrupt!.id, { approved: true });

      // Check the tool result message in the checkpoint
      const updatedCheckpoint = await checkpointer.load(threadId);
      const toolMsg = updatedCheckpoint?.messages.find((m) => m.role === "tool");
      expect(toolMsg).toBeDefined();

      const toolContent = toolMsg?.content as Array<{
        type: string;
        output: unknown;
      }>;
      const output = toolContent[0].output;

      // The output must use the AI SDK ToolResultOutput discriminated union,
      // not a raw object like { result: "success" }
      expect(output).toMatchObject({
        type: expect.stringMatching(/^(text|json)$/),
        value: expect.anything(),
      });
    });

    it("should use { type, value } format for denial result output", async () => {
      const checkpointer = new MemorySaver();
      const threadId = "denial-format-thread";
      const toolCallId = "call_denial_test";

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

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Understood",
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
            execute: vi.fn(),
          },
        },
      });

      const interrupt = await agent.getInterrupt(threadId);
      await agent.resume(threadId, interrupt!.id, { approved: false });

      const updatedCheckpoint = await checkpointer.load(threadId);
      const toolMsg = updatedCheckpoint?.messages.find((m) => m.role === "tool");
      expect(toolMsg).toBeDefined();

      const toolContent = toolMsg?.content as Array<{
        type: string;
        output: unknown;
      }>;
      const output = toolContent[0].output;

      // Must be { type: 'text', value: '...' }, not { denied: true, message: '...' }
      expect(output).toMatchObject({
        type: "text",
        value: expect.stringContaining("denied"),
      });
    });

    it("should use { type, value } format for tool execution error output", async () => {
      const checkpointer = new MemorySaver();
      const threadId = "error-format-thread";
      const toolCallId = "call_error_test";

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

      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Handled error",
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
            execute: vi.fn().mockRejectedValue(new Error("Tool execution failed")),
          },
        },
      });

      const interrupt = await agent.getInterrupt(threadId);
      await agent.resume(threadId, interrupt!.id, { approved: true });

      const updatedCheckpoint = await checkpointer.load(threadId);
      const toolMsg = updatedCheckpoint?.messages.find((m) => m.role === "tool");
      expect(toolMsg).toBeDefined();

      const toolContent = toolMsg?.content as Array<{
        type: string;
        output: unknown;
      }>;
      const output = toolContent[0].output;

      // Must be { type: 'text', value: '...' }, not { error: true, message: '...' }
      expect(output).toMatchObject({
        type: "text",
        value: expect.stringContaining("Tool execution failed"),
      });
    });
  });
});
