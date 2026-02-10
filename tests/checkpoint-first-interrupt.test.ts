/**
 * Regression test: interrupt on first generation fails to save checkpoint.
 *
 * When an interrupt occurs during the very first generation for a thread,
 * the interrupt path in generate() only tries to load+update an existing
 * checkpoint. Since no checkpoint exists yet (first generation), it silently
 * skips saving, causing resume() to fail with "no checkpoint found".
 *
 * The normal completion path calls saveCheckpoint() which handles both
 * create (new) and update (existing). The interrupt path does not.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import { createAgent } from "../src/index.js";
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

/**
 * Helper: creates a tool whose execute calls interrupt(), triggering
 * the InterruptSignal mechanism through the agent's tool wrapping layers.
 */
function createInterruptingTool() {
  return {
    description: "A tool that requests an interrupt",
    execute: async (
      _input: unknown,
      options: { interrupt?: (req: unknown) => Promise<unknown> },
    ) => {
      if (options.interrupt) {
        return await options.interrupt({ reason: "needs user approval" });
      }
      return "no interrupt available";
    },
  };
}

/**
 * Helper: mocks generateText to invoke a named tool from the wrapped toolset,
 * triggering the InterruptSignal → signalState flow. Returns a response that
 * reflects the tool call step.
 */
function mockGenerateTextWithToolInterrupt(toolName: string, toolCallId: string) {
  return async (params: Record<string, unknown>) => {
    const tools = params.tools as Record<
      string,
      { execute?: (input: unknown, opts: unknown) => Promise<unknown> }
    >;
    if (tools?.[toolName]?.execute) {
      await tools[toolName].execute({ input: "test" }, { toolCallId });
    }

    return {
      text: "[Interrupt requested]",
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "stop",
      steps: [
        {
          text: "",
          toolCalls: [{ toolCallId, toolName, input: { input: "test" } }],
          toolResults: [{ toolCallId, toolName, output: "[Interrupt requested]" }],
          finishReason: "tool-calls",
        },
      ],
    } as never;
  };
}

describe("Checkpoint: interrupt on first generation", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("should persist checkpoint with pendingInterrupt when interrupt occurs on first generation", async () => {
    const checkpointer = new MemorySaver();
    const threadId = "first-gen-interrupt";
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockImplementation(
      mockGenerateTextWithToolInterrupt("interruptingTool", "call_first_gen"),
    );

    const agent = createAgent({
      model: createMockModel(),
      checkpointer,
      tools: { interruptingTool: createInterruptingTool() },
    });

    const result = await agent.generate({
      prompt: "Use the tool",
      threadId,
    });

    expect(result.status).toBe("interrupted");

    // The checkpoint MUST be saved even on first generation so resume() can work
    const checkpoint = await checkpointer.load(threadId);
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.threadId).toBe(threadId);
    expect(checkpoint?.pendingInterrupt).toBeDefined();
    expect(checkpoint?.pendingInterrupt?.id).toBe("int_call_first_gen");
  });

  it("should allow resume() after interrupt on first generation", async () => {
    const checkpointer = new MemorySaver();
    const threadId = "first-gen-resume";
    const toolExecuted = vi.fn().mockResolvedValue({ result: "success" });
    const mockGenerateText = vi.mocked(generateText);

    // The tool calls interrupt() on first invocation.
    // After resume, the agent re-executes the tool via the resume path
    // (deterministic re-execution with stored args), so toolExecuted tracks that.
    const interruptOnceTool = {
      description: "A tool that interrupts on first call",
      execute: async (
        input: unknown,
        options: { interrupt?: (req: unknown) => Promise<unknown> },
      ) => {
        if (options.interrupt) {
          return await options.interrupt({ reason: "needs user approval" });
        }
        // Fallback: called during resume's deterministic re-execution
        return toolExecuted(input, options);
      },
    };

    // First call: triggers interrupt via tool
    // Second call (after resume injects tool result and calls generate): normal completion
    let callCount = 0;
    mockGenerateText.mockImplementation(async (params: Record<string, unknown>) => {
      callCount++;

      if (callCount === 1) {
        return mockGenerateTextWithToolInterrupt("myTool", "call_resume_test")(params);
      }

      // After resume: normal completion
      return {
        text: "Resumed successfully",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as never;
    });

    const agent = createAgent({
      model: createMockModel(),
      checkpointer,
      tools: { myTool: interruptOnceTool },
    });

    // First generation: interrupt on first message
    const result = await agent.generate({
      prompt: "Use the tool",
      threadId,
    });

    expect(result.status).toBe("interrupted");
    if (result.status !== "interrupted") return;

    // resume() must succeed — the checkpoint must have been persisted
    const resumed = await agent.resume(threadId, result.interrupt.id, { approved: true });

    expect(resumed.status).toBe("complete");
    if (resumed.status === "complete") {
      expect(resumed.text).toBe("Resumed successfully");
    }
  });

  it("should persist checkpoint with pendingInterrupt when interrupt occurs on subsequent generation", async () => {
    const checkpointer = new MemorySaver();
    const threadId = "second-gen-interrupt";
    const mockGenerateText = vi.mocked(generateText);

    // First call: normal completion (creates checkpoint)
    // Second call: triggers interrupt (updates existing checkpoint)
    let callCount = 0;
    mockGenerateText.mockImplementation(async (params: Record<string, unknown>) => {
      callCount++;

      if (callCount === 1) {
        return {
          text: "First response",
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "stop",
          steps: [
            {
              text: "First response",
              toolCalls: [],
              toolResults: [],
              finishReason: "stop",
            },
          ],
        } as never;
      }

      // Second generation: trigger interrupt via tool
      return mockGenerateTextWithToolInterrupt("interruptingTool", "call_second_gen")(params);
    });

    const agent = createAgent({
      model: createMockModel(),
      checkpointer,
      tools: { interruptingTool: createInterruptingTool() },
    });

    // First generation: normal completion creates checkpoint
    const firstResult = await agent.generate({ prompt: "Hello", threadId });
    expect(firstResult.status).toBe("complete");

    const checkpointAfterFirst = await checkpointer.load(threadId);
    expect(checkpointAfterFirst).toBeDefined();

    // Second generation: interrupt updates existing checkpoint
    const secondResult = await agent.generate({ prompt: "Use the tool", threadId });
    expect(secondResult.status).toBe("interrupted");

    const checkpointAfterInterrupt = await checkpointer.load(threadId);
    expect(checkpointAfterInterrupt).toBeDefined();
    expect(checkpointAfterInterrupt?.pendingInterrupt).toBeDefined();
  });
});
