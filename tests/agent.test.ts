import { tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AgentError,
  CheckpointError,
  ModelError,
  ToolExecutionError,
} from "../src/errors/index.js";
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

import { generateText, streamText } from "ai";

describe("createAgent", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("creates an agent with required options", () => {
    const model = createMockModel();
    const agent = createAgent({ model });

    expect(agent).toBeDefined();
    expect(agent.id).toMatch(/^agent-\d+$/);
    expect(agent.options.model).toBe(model);
  });

  it("creates an agent with system prompt", () => {
    const model = createMockModel();
    const agent = createAgent({
      model,
      systemPrompt: "You are a helpful assistant.",
    });

    expect(agent.options.systemPrompt).toBe("You are a helpful assistant.");
  });

  it("accepts tools as a ToolSet object", () => {
    const model = createMockModel();
    const testTool = tool({
      description: "A test tool",
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => `Processed: ${input}`,
    });

    // Should not throw
    const agent = createAgent({
      model,
      tools: { testTool },
    });

    expect(agent).toBeDefined();
  });

  it("returns empty skills when none provided", () => {
    const model = createMockModel();
    const agent = createAgent({ model });

    expect(agent.getSkills()).toEqual([]);
  });
});

describe("agent.generate", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("generates a response", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Hello, world!",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();
    const agent = createAgent({ model });

    const result = await agent.generate({ prompt: "Say hello" });

    expect(result.text).toBe("Hello, world!");
    expect(result.finishReason).toBe("stop");
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Say hello" }),
        ]),
      }),
    );
  });

  it("includes usage information when available", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Test response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();
    const agent = createAgent({ model });

    const result = await agent.generate({ prompt: "Test" });

    expect(result.usage).toBeDefined();
    // AI SDK v6 uses inputTokens/outputTokens
    expect(result.usage?.inputTokens).toBe(10);
    expect(result.usage?.outputTokens).toBe(20);
  });

  it("passes tools to generateText", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();
    const testTool = tool({
      description: "A test tool",
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => `Processed: ${input}`,
    });

    const agent = createAgent({
      model,
      tools: { testTool },
    });

    await agent.generate({ prompt: "Test" });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          testTool: expect.any(Object),
        }),
      }),
    );
  });
});

describe("agent.stream", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("streams text deltas", async () => {
    const mockStreamText = vi.mocked(streamText);

    // Create mock async iterable for fullStream
    const mockFullStream = (async function* () {
      yield { type: "text-delta" as const, text: "Streamed " };
      yield { type: "text-delta" as const, text: "response" };
      yield {
        type: "finish" as const,
        finishReason: "stop" as const,
        totalUsage: {
          inputTokens: 10,
          outputTokens: 20,
          inputTokenDetails: {},
          outputTokenDetails: {},
        },
      };
    })();

    mockStreamText.mockReturnValue({
      fullStream: mockFullStream,
      usage: Promise.resolve({
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      }),
      finishReason: Promise.resolve("stop" as const),
      text: Promise.resolve("Streamed response"),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      output: Promise.resolve(undefined), // No output schema provided
      response: Promise.resolve({
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      }),
      warnings: Promise.resolve([]),
    } as never);

    const model = createMockModel();
    const agent = createAgent({ model });

    const chunks: string[] = [];
    for await (const chunk of agent.stream({ prompt: "Stream test" })) {
      if (chunk.type === "text-delta" && chunk.text) {
        chunks.push(chunk.text);
      }
    }

    expect(chunks.join("")).toBe("Streamed response");
  });

  it("yields a finish chunk with usage", async () => {
    const mockStreamText = vi.mocked(streamText);

    // Create mock async iterable for fullStream
    const mockFullStream = (async function* () {
      yield { type: "text-delta" as const, text: "Final" };
      yield {
        type: "finish" as const,
        finishReason: "stop" as const,
        totalUsage: {
          inputTokens: 5,
          outputTokens: 10,
          inputTokenDetails: {},
          outputTokenDetails: {},
        },
      };
    })();

    mockStreamText.mockReturnValue({
      fullStream: mockFullStream,
      usage: Promise.resolve({
        inputTokens: 5,
        outputTokens: 10,
        inputTokenDetails: {},
        outputTokenDetails: {},
      }),
      finishReason: Promise.resolve("stop" as const),
      text: Promise.resolve("Final"),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      output: Promise.resolve(undefined),
      response: Promise.resolve({
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      }),
      warnings: Promise.resolve([]),
    } as never);

    const model = createMockModel();
    const agent = createAgent({ model });

    let finishChunk = null;
    for await (const chunk of agent.stream({ prompt: "Test" })) {
      if (chunk.type === "finish") {
        finishChunk = chunk;
      }
    }

    expect(finishChunk).toBeDefined();
    expect(finishChunk?.finishReason).toBe("stop");
    expect(finishChunk?.usage?.inputTokens).toBe(5);
    expect(finishChunk?.usage?.outputTokens).toBe(10);
  });

  it("forwards reasoning chunks in order with other stream events", async () => {
    const mockStreamText = vi.mocked(streamText);

    const mockFullStream = (async function* () {
      yield { type: "reasoning-start" as const, id: "reasoning-1" };
      yield {
        type: "reasoning-delta" as const,
        id: "reasoning-1",
        text: "Thinking...",
      };
      yield { type: "text-delta" as const, text: "Answer: " };
      yield {
        type: "tool-call" as const,
        toolCallId: "tool-1",
        toolName: "lookup",
        input: { query: "x" },
      };
      yield {
        type: "tool-result" as const,
        toolCallId: "tool-1",
        toolName: "lookup",
        output: { value: 42 },
      };
      yield { type: "reasoning-end" as const, id: "reasoning-1" };
      yield {
        type: "finish" as const,
        finishReason: "stop" as const,
        totalUsage: {
          inputTokens: 5,
          outputTokens: 7,
          inputTokenDetails: {},
          outputTokenDetails: {},
        },
      };
    })();

    mockStreamText.mockReturnValue({
      fullStream: mockFullStream,
      usage: Promise.resolve({
        inputTokens: 5,
        outputTokens: 7,
        inputTokenDetails: {},
        outputTokenDetails: {},
      }),
      finishReason: Promise.resolve("stop" as const),
      text: Promise.resolve("Answer: 42"),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      output: Promise.resolve(undefined),
      response: Promise.resolve({
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      }),
      warnings: Promise.resolve([]),
    } as never);

    const model = createMockModel();
    const agent = createAgent({ model });

    const parts: string[] = [];
    let reasoningText = "";

    for await (const part of agent.stream({ prompt: "Test reasoning stream" })) {
      parts.push(part.type);
      if (part.type === "reasoning-delta") {
        reasoningText += part.text;
      }
    }

    expect(parts).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "text-delta",
      "tool-call",
      "tool-result",
      "reasoning-end",
      "finish",
    ]);
    expect(reasoningText).toBe("Thinking...");
  });

  it("normalizes reasoning delta chunks that use legacy delta field", async () => {
    const mockStreamText = vi.mocked(streamText);

    const mockFullStream = (async function* () {
      yield { type: "reasoning-start" as const, id: "reasoning-1" };
      yield {
        type: "reasoning-delta" as const,
        id: "reasoning-1",
        delta: "Legacy shape",
      } as unknown as { type: "reasoning-delta"; id: string; text: string };
      yield { type: "reasoning-end" as const, id: "reasoning-1" };
      yield {
        type: "finish" as const,
        finishReason: "stop" as const,
        totalUsage: {
          inputTokens: 1,
          outputTokens: 1,
          inputTokenDetails: {},
          outputTokenDetails: {},
        },
      };
    })();

    mockStreamText.mockReturnValue({
      fullStream: mockFullStream,
      usage: Promise.resolve({
        inputTokens: 1,
        outputTokens: 1,
        inputTokenDetails: {},
        outputTokenDetails: {},
      }),
      finishReason: Promise.resolve("stop" as const),
      text: Promise.resolve(""),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      output: Promise.resolve(undefined),
      response: Promise.resolve({
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      }),
      warnings: Promise.resolve([]),
    } as never);

    const model = createMockModel();
    const agent = createAgent({ model });

    const chunks: Array<{ type: string; text?: string }> = [];
    for await (const part of agent.stream({ prompt: "Legacy reasoning" })) {
      chunks.push({
        type: part.type,
        text: part.type === "reasoning-delta" ? part.text : undefined,
      });
    }

    expect(chunks).toContainEqual({ type: "reasoning-delta", text: "Legacy shape" });
  });
});

describe("agent.allowedTools", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("returns all tools when allowedTools is not specified", () => {
    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });
    const writeTool = tool({
      description: "Write files",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "success",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool, write: writeTool },
    });

    const activeTools = agent.getActiveTools();
    expect(Object.keys(activeTools)).toContain("read");
    expect(Object.keys(activeTools)).toContain("write");
  });

  it("filters tools based on allowedTools list", () => {
    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });
    const writeTool = tool({
      description: "Write files",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "success",
    });
    const bashTool = tool({
      description: "Execute commands",
      parameters: z.object({ command: z.string() }),
      execute: async () => "output",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool, write: writeTool, bash: bashTool },
      allowedTools: ["read"],
    });

    const activeTools = agent.getActiveTools();
    expect(Object.keys(activeTools)).toContain("read");
    expect(Object.keys(activeTools)).not.toContain("write");
    expect(Object.keys(activeTools)).not.toContain("bash");
  });

  it("allows multiple tools in allowedTools", () => {
    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });
    const writeTool = tool({
      description: "Write files",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "success",
    });
    const bashTool = tool({
      description: "Execute commands",
      parameters: z.object({ command: z.string() }),
      execute: async () => "output",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool, write: writeTool, bash: bashTool },
      allowedTools: ["read", "write"],
    });

    const activeTools = agent.getActiveTools();
    expect(Object.keys(activeTools)).toContain("read");
    expect(Object.keys(activeTools)).toContain("write");
    expect(Object.keys(activeTools)).not.toContain("bash");
  });

  it("returns empty tools if allowedTools contains no matches", () => {
    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool },
      allowedTools: ["nonexistent"],
    });

    const activeTools = agent.getActiveTools();
    expect(Object.keys(activeTools).length).toBe(0);
  });

  it("passes filtered tools to generateText", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });
    const writeTool = tool({
      description: "Write files",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "success",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool, write: writeTool },
      allowedTools: ["read"],
    });

    await agent.generate({ prompt: "Test" });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          read: expect.any(Object),
        }),
      }),
    );

    // Verify write tool is NOT in the call
    const callArgs = mockGenerateText.mock.calls[0][0] as { tools?: Record<string, unknown> };
    expect(callArgs.tools).not.toHaveProperty("write");
  });
});

describe("agent.disallowedTools", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("returns all tools when disallowedTools is not specified", () => {
    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });
    const writeTool = tool({
      description: "Write files",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "success",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool, write: writeTool },
    });

    const activeTools = agent.getActiveTools();
    expect(Object.keys(activeTools)).toContain("read");
    expect(Object.keys(activeTools)).toContain("write");
  });

  it("filters out tools in disallowedTools list", () => {
    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });
    const writeTool = tool({
      description: "Write files",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "success",
    });
    const bashTool = tool({
      description: "Execute commands",
      parameters: z.object({ command: z.string() }),
      execute: async () => "output",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool, write: writeTool, bash: bashTool },
      disallowedTools: ["bash"],
    });

    const activeTools = agent.getActiveTools();
    expect(Object.keys(activeTools)).toContain("read");
    expect(Object.keys(activeTools)).toContain("write");
    expect(Object.keys(activeTools)).not.toContain("bash");
  });

  it("blocks multiple tools in disallowedTools", () => {
    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });
    const writeTool = tool({
      description: "Write files",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "success",
    });
    const bashTool = tool({
      description: "Execute commands",
      parameters: z.object({ command: z.string() }),
      execute: async () => "output",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool, write: writeTool, bash: bashTool },
      disallowedTools: ["bash", "write"],
    });

    const activeTools = agent.getActiveTools();
    expect(Object.keys(activeTools)).toContain("read");
    expect(Object.keys(activeTools)).not.toContain("write");
    expect(Object.keys(activeTools)).not.toContain("bash");
  });

  it("returns all tools if disallowedTools contains no matches", () => {
    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });
    const writeTool = tool({
      description: "Write files",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "success",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool, write: writeTool },
      disallowedTools: ["nonexistent"],
    });

    const activeTools = agent.getActiveTools();
    expect(Object.keys(activeTools)).toContain("read");
    expect(Object.keys(activeTools)).toContain("write");
  });

  it("disallowedTools takes precedence over allowedTools", () => {
    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });
    const writeTool = tool({
      description: "Write files",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "success",
    });
    const bashTool = tool({
      description: "Execute commands",
      parameters: z.object({ command: z.string() }),
      execute: async () => "output",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool, write: writeTool, bash: bashTool },
      allowedTools: ["read", "write", "bash"],
      disallowedTools: ["bash"], // Bash is both allowed and disallowed
    });

    const activeTools = agent.getActiveTools();
    expect(Object.keys(activeTools)).toContain("read");
    expect(Object.keys(activeTools)).toContain("write");
    expect(Object.keys(activeTools)).not.toContain("bash"); // Disallow wins
  });

  it("works with allowedTools to create combined filtering", () => {
    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });
    const writeTool = tool({
      description: "Write files",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "success",
    });
    const bashTool = tool({
      description: "Execute commands",
      parameters: z.object({ command: z.string() }),
      execute: async () => "output",
    });
    const rmTool = tool({
      description: "Remove files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "deleted",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool, write: writeTool, bash: bashTool, rm: rmTool },
      allowedTools: ["read", "write"], // Only allow read and write
      disallowedTools: ["write"], // But block write
    });

    const activeTools = agent.getActiveTools();
    expect(Object.keys(activeTools)).toContain("read"); // In allowedTools and not disallowed
    expect(Object.keys(activeTools)).not.toContain("write"); // In both, disallow wins
    expect(Object.keys(activeTools)).not.toContain("bash"); // Not in allowedTools
    expect(Object.keys(activeTools)).not.toContain("rm"); // Not in allowedTools
  });

  it("passes filtered tools to generateText", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();
    const readTool = tool({
      description: "Read files",
      parameters: z.object({ path: z.string() }),
      execute: async () => "content",
    });
    const writeTool = tool({
      description: "Write files",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "success",
    });
    const bashTool = tool({
      description: "Execute commands",
      parameters: z.object({ command: z.string() }),
      execute: async () => "output",
    });

    const agent = createAgent({
      model,
      tools: { read: readTool, write: writeTool, bash: bashTool },
      disallowedTools: ["bash"],
    });

    await agent.generate({ prompt: "Test" });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          read: expect.any(Object),
          write: expect.any(Object),
        }),
      }),
    );

    // Verify bash tool is NOT in the call
    const callArgs = mockGenerateText.mock.calls[0][0] as { tools?: Record<string, unknown> };
    expect(callArgs.tools).not.toHaveProperty("bash");
  });
});

describe("Error Normalization", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("Model/Provider Error Normalization", () => {
    it("wraps model errors as AgentError in generate()", async () => {
      const mockGenerateText = vi.mocked(generateText);
      const originalError = new Error("Model API request failed");
      mockGenerateText.mockRejectedValue(originalError);

      const model = createMockModel();
      const agent = createAgent({ model });

      try {
        await agent.generate({ prompt: "Test" });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(AgentError.is(error)).toBe(true);
        if (AgentError.is(error)) {
          // Error code will be inferred from the message
          expect(error.code).toBeDefined();
          expect(error.cause).toBe(originalError);
        }
      }
    });

    it("preserves existing AgentErrors in generate()", async () => {
      const mockGenerateText = vi.mocked(generateText);
      const existingError = new ModelError("Already normalized", {
        modelId: "test-model",
      });
      mockGenerateText.mockRejectedValue(existingError);

      const model = createMockModel();
      const agent = createAgent({ model });

      await expect(agent.generate({ prompt: "Test" })).rejects.toThrow(existingError);
    });

    it("wraps stream errors as AgentError", async () => {
      const mockStreamText = vi.mocked(streamText);
      const originalError = new Error("Stream failed");

      // Mock a stream that throws during iteration (correct way to mock stream failure)
      const textPromise = Promise.reject(originalError);
      const usagePromise = Promise.reject(originalError);
      const finishReasonPromise = Promise.reject(originalError);
      const stepsPromise = Promise.reject(originalError);
      const outputPromise = Promise.reject(originalError);

      // Suppress unhandled rejection warnings
      textPromise.catch(() => {});
      usagePromise.catch(() => {});
      finishReasonPromise.catch(() => {});
      stepsPromise.catch(() => {});
      outputPromise.catch(() => {});

      const mockStream = {
        fullStream: (async function* () {
          throw originalError;
        })(),
        text: textPromise,
        usage: usagePromise,
        finishReason: finishReasonPromise,
        steps: stepsPromise,
        output: outputPromise,
      };

      mockStreamText.mockReturnValue(mockStream as ReturnType<typeof streamText>);

      const model = createMockModel();
      const agent = createAgent({ model });

      const generator = agent.stream({ prompt: "Test" });

      try {
        for await (const _chunk of generator) {
          // consume stream
        }
        expect.fail("Should have thrown");
      } catch (error) {
        expect(AgentError.is(error)).toBe(true);
        if (AgentError.is(error)) {
          // Error code will be inferred from the message
          expect(error.code).toBeDefined();
          expect(error.cause).toBe(originalError);
        }
      }
    });

    it("includes threadId in error metadata", async () => {
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockRejectedValue(new Error("Test error"));

      const model = createMockModel();
      const agent = createAgent({ model });

      try {
        await agent.generate({ prompt: "Test", threadId: "test-thread-123" });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(AgentError.is(error)).toBe(true);
        if (AgentError.is(error)) {
          expect(error.metadata.threadId).toBe("test-thread-123");
        }
      }
    });

    it("passes normalized errors to PostGenerateFailure hooks", async () => {
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockRejectedValue(new Error("Model error"));

      const model = createMockModel();
      const hookCalled = vi.fn();

      const agent = createAgent({
        model,
        hooks: {
          PostGenerateFailure: [
            async (input) => {
              hookCalled(input.error);
              return {};
            },
          ],
        },
      });

      await expect(agent.generate({ prompt: "Test" })).rejects.toThrow();

      expect(hookCalled).toHaveBeenCalled();
      const passedError = hookCalled.mock.calls[0][0];
      expect(AgentError.is(passedError)).toBe(true);
    });
  });

  describe("Checkpoint Error Normalization", () => {
    it("wraps checkpoint load errors as CheckpointError", async () => {
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Response",
        steps: [],
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: "stop",
        experimental_providerMetadata: {},
        response: {
          id: "test-id",
          timestamp: new Date(),
          modelId: "test-model",
          messages: [],
        },
        request: {},
        warnings: [],
        providerMetadata: undefined,
        files: [],
        sources: [],
        reasoning: [],
        reasoningText: undefined,
        content: [],
      } as never);

      const model = createMockModel();
      const failingCheckpointer = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockRejectedValue(new Error("Database connection failed")),
      };

      const agent = createAgent({
        model,
        checkpointer: failingCheckpointer,
      });

      await expect(
        agent.generate({
          prompt: "Test",
          threadId: "test-thread",
        }),
      ).rejects.toThrow(CheckpointError);
    });

    it("wraps checkpoint save errors as CheckpointError", async () => {
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Response",
        steps: [],
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: "stop",
        experimental_providerMetadata: {},
        response: {
          id: "test-id",
          timestamp: new Date(),
          modelId: "test-model",
          messages: [],
        },
        request: {},
        warnings: [],
        providerMetadata: undefined,
        files: [],
        sources: [],
        reasoning: [],
        reasoningText: undefined,
        content: [],
      } as never);

      const model = createMockModel();
      const failingCheckpointer = {
        save: vi.fn().mockRejectedValue(new Error("Disk full")),
        load: vi.fn().mockResolvedValue(undefined),
      };

      const agent = createAgent({
        model,
        checkpointer: failingCheckpointer,
      });

      await expect(
        agent.generate({
          prompt: "Test",
          threadId: "test-thread",
        }),
      ).rejects.toThrow(CheckpointError);
    });

    it("includes operation and threadId in CheckpointError metadata", async () => {
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockResolvedValue({
        text: "Response",
        steps: [],
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: "stop",
        experimental_providerMetadata: {},
        response: {
          id: "test-id",
          timestamp: new Date(),
          modelId: "test-model",
          messages: [],
        },
        request: {},
        warnings: [],
        providerMetadata: undefined,
        files: [],
        sources: [],
        reasoning: [],
        reasoningText: undefined,
        content: [],
      } as never);

      const model = createMockModel();
      const failingCheckpointer = {
        save: vi.fn().mockRejectedValue(new Error("Save failed")),
        load: vi.fn().mockResolvedValue(undefined),
      };

      const agent = createAgent({
        model,
        checkpointer: failingCheckpointer,
      });

      try {
        await agent.generate({ prompt: "Test", threadId: "my-thread" });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CheckpointError);
        if (error instanceof CheckpointError) {
          expect(error.operation).toBe("save");
          expect(error.threadId).toBe("my-thread");
          expect(error.metadata.threadId).toBe("my-thread");
        }
      }
    });
  });

  describe("Error Properties", () => {
    it("normalized errors have retryable flag", async () => {
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockRejectedValue(new Error("Rate limit exceeded"));

      const model = createMockModel();
      const agent = createAgent({ model });

      try {
        await agent.generate({ prompt: "Test" });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(AgentError.is(error)).toBe(true);
        if (AgentError.is(error)) {
          expect(error.retryable).toBe(true);
        }
      }
    });

    it("normalized errors have user-friendly messages", async () => {
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockRejectedValue(new Error("Rate limit exceeded"));

      const model = createMockModel();
      const agent = createAgent({ model });

      try {
        await agent.generate({ prompt: "Test" });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(AgentError.is(error)).toBe(true);
        if (AgentError.is(error)) {
          expect(error.userMessage).toBeDefined();
          expect(error.userMessage.length).toBeGreaterThan(0);
          // Verify it's a RATE_LIMIT_ERROR with correct properties
          expect(error.code).toBe("RATE_LIMIT_ERROR");
          expect(error.retryable).toBe(true);
        }
      }
    });

    it("normalized errors include original error as cause", async () => {
      const mockGenerateText = vi.mocked(generateText);
      const originalError = new Error("Original error message");
      mockGenerateText.mockRejectedValue(originalError);

      const model = createMockModel();
      const agent = createAgent({ model });

      try {
        await agent.generate({ prompt: "Test" });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(AgentError.is(error)).toBe(true);
        if (AgentError.is(error)) {
          expect(error.cause).toBe(originalError);
        }
      }
    });
  });
});

describe("Permission Modes", () => {
  it("should default to 'default' mode", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Using write tool",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, inputTokenDetails: {}, outputTokenDetails: {} },
      response: { id: "test-id", timestamp: new Date(), modelId: "test", messages: [] },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();
    const agent = createAgent({ model });

    // Should not throw in default mode (tools execute normally)
    const result = await agent.generate({ prompt: "Write test" });
    expect(result.text).toContain("Using write tool");
  });

  it("should block all tools in 'plan' mode", async () => {
    const agent = createAgent({ model: createMockModel(), permissionMode: "plan" });

    // Try to call write tool directly - it should be blocked
    const tools = agent.getActiveTools();
    try {
      await tools.write.execute({ file_path: "/test.txt", content: "test" });
      expect.fail("Should have thrown ToolExecutionError");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolExecutionError);
      if (error instanceof ToolExecutionError) {
        expect(error.message).toContain("blocked in plan mode");
        expect(error.toolName).toBe("write");
      }
    }
  });

  it("should auto-approve file edit tools in 'acceptEdits' mode", async () => {
    const agent = createAgent({ model: createMockModel(), permissionMode: "acceptEdits" });

    // Write tool should be auto-approved (no throw)
    const tools = agent.getActiveTools();
    const result = await tools.write.execute({ file_path: "/test.txt", content: "test" });
    // Tool returns result without throwing
    expect(result).toBeDefined();
  });

  it("should block non-edit tools in 'acceptEdits' mode when canUseTool returns ask", async () => {
    // In acceptEdits mode, non-edit tools defer to canUseTool callback
    // Without a callback, they would execute normally (like default mode)
    const agent = createAgent({
      model: createMockModel(),
      permissionMode: "acceptEdits",
      canUseTool: (toolName) => {
        // Only file edit tools should be auto-approved
        // Return 'ask' for other tools to require approval
        return toolName === "write" || toolName === "edit" ? "allow" : "ask";
      },
    });

    // Read tool should be blocked with 'ask' requiring approval
    const tools = agent.getActiveTools();
    try {
      await tools.read.execute({ file_path: "/test.txt" });
      expect.fail("Should have thrown ToolExecutionError");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolExecutionError);
      if (error instanceof ToolExecutionError) {
        expect(error.message).toContain("requires user approval");
        expect(error.toolName).toBe("read");
      }
    }
  });

  it("should auto-approve all tools in 'bypassPermissions' mode", async () => {
    const agent = createAgent({ model: createMockModel(), permissionMode: "bypassPermissions" });

    // All tools should be auto-approved
    const tools = agent.getActiveTools();

    // First write a file so read will work
    const writeResult = await tools.write.execute({
      file_path: "/test.txt",
      content: "test content",
    });
    expect(writeResult).toBeDefined();

    // Now read should work
    const readResult = await tools.read.execute({ file_path: "/test.txt" });
    expect(readResult).toBeDefined();
  });

  it("should support setPermissionMode() for dynamic mode changes", async () => {
    const agent = createAgent({ model: createMockModel(), permissionMode: "plan" });

    const tools = agent.getActiveTools();

    // Initially in plan mode - tools should be blocked
    try {
      await tools.write.execute({ file_path: "/test.txt", content: "test" });
      expect.fail("Should have thrown in plan mode");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolExecutionError);
    }

    // Switch to acceptEdits mode
    agent.setPermissionMode("acceptEdits");

    // Now write should work (note: need to get tools again after mode change)
    const toolsAfter = agent.getActiveTools();
    const result = await toolsAfter.write.execute({ file_path: "/test.txt", content: "test" });
    expect(result).toBeDefined();
  });

  it("should apply permission mode to edit tool", async () => {
    const agent = createAgent({ model: createMockModel(), permissionMode: "acceptEdits" });

    // Edit tool should be auto-approved in acceptEdits mode
    const tools = agent.getActiveTools();
    const result = await tools.edit.execute({
      file_path: "/test.txt",
      old_string: "old",
      new_string: "new",
    });

    expect(result).toBeDefined();
  });

  it("should apply permission mode consistently", async () => {
    const agent = createAgent({ model: createMockModel(), permissionMode: "acceptEdits" });

    const tools = agent.getActiveTools();

    // Write and edit should work
    const result1 = await tools.write.execute({ file_path: "/file1.txt", content: "test1" });
    const result2 = await tools.write.execute({ file_path: "/file2.txt", content: "test2" });
    const result3 = await tools.edit.execute({
      file_path: "/file3.txt",
      old_string: "old",
      new_string: "new",
    });

    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    expect(result3).toBeDefined();
  });

  it("should throw ToolExecutionError with proper metadata in plan mode", async () => {
    const agent = createAgent({ model: createMockModel(), permissionMode: "plan" });

    const tools = agent.getActiveTools();
    try {
      await tools.write.execute({ file_path: "/test.txt", content: "test" });
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolExecutionError);
      if (error instanceof ToolExecutionError) {
        expect(error.toolName).toBe("write");
        expect(error.toolInput).toEqual({ file_path: "/test.txt", content: "test" });
        expect(error.metadata?.permissionMode).toBe("plan");
      }
    }
  });

  it("should work with allowedTools filtering", async () => {
    // Combine allowedTools with acceptEdits mode
    const agent = createAgent({
      model: createMockModel(),
      permissionMode: "acceptEdits",
      allowedTools: ["write", "edit"], // Only these tools available
    });

    const tools = agent.getActiveTools();

    // Write tool should be available and approved
    expect(tools.write).toBeDefined();
    const result = await tools.write.execute({ file_path: "/test.txt", content: "test" });
    expect(result).toBeDefined();

    // Bash tool should not be available (not in allowedTools)
    expect(tools.bash).toBeUndefined();
  });
});

describe("canUseTool Callback", () => {
  it("should allow tool when callback returns 'allow'", async () => {
    const agent = createAgent({
      model: createMockModel(),
      canUseTool: async (toolName) => {
        return toolName === "write" ? "allow" : "deny";
      },
    });

    const tools = agent.getActiveTools();
    const result = await tools.write.execute({ file_path: "/test.txt", content: "test" });
    expect(result).toBeDefined();
  });

  it("should deny tool when callback returns 'deny'", async () => {
    const agent = createAgent({
      model: createMockModel(),
      canUseTool: async (toolName) => {
        return toolName === "read" ? "deny" : "allow";
      },
    });

    const tools = agent.getActiveTools();
    try {
      await tools.read.execute({ file_path: "/test.txt" });
      expect.fail("Should have thrown ToolExecutionError");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolExecutionError);
      if (error instanceof ToolExecutionError) {
        expect(error.message).toContain("denied by canUseTool callback");
        expect(error.toolName).toBe("read");
      }
    }
  });

  it("should block tool when callback returns 'ask'", async () => {
    const agent = createAgent({
      model: createMockModel(),
      canUseTool: async (toolName) => {
        return toolName === "write" ? "ask" : "allow";
      },
    });

    const tools = agent.getActiveTools();
    try {
      await tools.write.execute({ file_path: "/test.txt", content: "test" });
      expect.fail("Should have thrown ToolExecutionError");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolExecutionError);
      if (error instanceof ToolExecutionError) {
        expect(error.message).toContain("requires user approval");
        expect(error.toolName).toBe("write");
      }
    }
  });

  it("should pass tool name and input to callback", async () => {
    let capturedToolName: string | undefined;
    let capturedInput: unknown;

    const agent = createAgent({
      model: createMockModel(),
      canUseTool: async (toolName, input) => {
        capturedToolName = toolName;
        capturedInput = input;
        return "allow";
      },
    });

    const tools = agent.getActiveTools();
    await tools.write.execute({ file_path: "/test.txt", content: "test" });

    expect(capturedToolName).toBe("write");
    expect(capturedInput).toEqual({ file_path: "/test.txt", content: "test" });
  });

  it("should work with sync callback", async () => {
    const agent = createAgent({
      model: createMockModel(),
      canUseTool: (toolName) => {
        // Sync callback
        return toolName === "write" ? "allow" : "deny";
      },
    });

    const tools = agent.getActiveTools();
    const result = await tools.write.execute({ file_path: "/test.txt", content: "test" });
    expect(result).toBeDefined();
  });

  it("should be called after permission mode checks", async () => {
    const callbackCalls: string[] = [];

    const agent = createAgent({
      model: createMockModel(),
      permissionMode: "bypassPermissions",
      canUseTool: async (toolName) => {
        callbackCalls.push(toolName);
        return "deny"; // This should not be reached because bypassPermissions allows all
      },
    });

    const tools = agent.getActiveTools();
    await tools.write.execute({ file_path: "/test.txt", content: "test" });

    // Callback should not have been called because bypassPermissions already allowed it
    expect(callbackCalls).toHaveLength(0);
  });

  it("should be called for tools not handled by acceptEdits mode", async () => {
    const callbackCalls: string[] = [];

    const agent = createAgent({
      model: createMockModel(),
      permissionMode: "acceptEdits",
      canUseTool: async (toolName) => {
        callbackCalls.push(toolName);
        return "allow";
      },
    });

    const tools = agent.getActiveTools();

    // Write tool should not call callback (handled by acceptEdits)
    await tools.write.execute({ file_path: "/test.txt", content: "test" });
    expect(callbackCalls).toHaveLength(0);

    // Read tool should call callback (not an edit tool)
    await tools.read.execute({ file_path: "/test.txt" });
    expect(callbackCalls).toHaveLength(1);
    expect(callbackCalls[0]).toBe("read");
  });

  it("should use canUseTool callback in default mode", async () => {
    const callbackCalls: string[] = [];

    const agent = createAgent({
      model: createMockModel(),
      permissionMode: "default",
      canUseTool: async (toolName) => {
        callbackCalls.push(toolName);
        return "allow";
      },
    });

    const tools = agent.getActiveTools();
    await tools.write.execute({ file_path: "/test.txt", content: "test" });

    // Callback should be called in default mode
    expect(callbackCalls).toHaveLength(1);
    expect(callbackCalls[0]).toBe("write");
  });

  it("should allow custom approval logic based on tool input", async () => {
    const agent = createAgent({
      model: createMockModel(),
      canUseTool: async (toolName, input) => {
        if (toolName === "write") {
          const filePath = (input as { file_path?: string }).file_path;
          // Block writes to /etc directory
          if (filePath?.startsWith("/etc/")) {
            return "deny";
          }
        }
        return "allow";
      },
    });

    const tools = agent.getActiveTools();

    // Should allow writes to normal paths
    const result1 = await tools.write.execute({ file_path: "/tmp/test.txt", content: "test" });
    expect(result1).toBeDefined();

    // Should deny writes to /etc
    try {
      await tools.write.execute({ file_path: "/etc/passwd", content: "malicious" });
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolExecutionError);
    }
  });

  it("should default to allow when no callback provided in default mode", async () => {
    const agent = createAgent({
      model: createMockModel(),
      permissionMode: "default",
      // No canUseTool callback
    });

    const tools = agent.getActiveTools();
    // Should allow by default for backward compatibility
    const result = await tools.write.execute({ file_path: "/test.txt", content: "test" });
    expect(result).toBeDefined();
  });

  it("should respect plan mode even with callback", async () => {
    const agent = createAgent({
      model: createMockModel(),
      permissionMode: "plan",
      canUseTool: async () => "allow", // This should be overridden by plan mode
    });

    const tools = agent.getActiveTools();
    try {
      await tools.write.execute({ file_path: "/test.txt", content: "test" });
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolExecutionError);
      if (error instanceof ToolExecutionError) {
        expect(error.message).toContain("blocked in plan mode");
      }
    }
  });
});

describe("Fork Session", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("forks an existing session to a new thread", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
    });

    const { MemorySaver } = await import("../src/checkpointer/memory-saver.js");
    const checkpointer = new MemorySaver();

    const agent = createAgent({
      model: createMockModel(),
      checkpointer,
    });

    // Create original session
    const result1 = await agent.generate({
      threadId: "session-1",
      prompt: "Hello",
    });
    expect(result1.text).toBe("Response");

    // Fork the session
    const result2 = await agent.generate({
      threadId: "session-1",
      forkSession: "session-1-fork",
      prompt: "Continue in fork",
    });
    expect(result2.forkedSessionId).toBe("session-1-fork");

    // Verify both sessions exist
    const checkpoint1 = await checkpointer.load("session-1");
    const checkpointFork = await checkpointer.load("session-1-fork");

    expect(checkpoint1).toBeDefined();
    expect(checkpointFork).toBeDefined();
    expect(checkpointFork?.threadId).toBe("session-1-fork");
  });

  it("forked session has copy of original messages", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
    });

    const { MemorySaver } = await import("../src/checkpointer/memory-saver.js");
    const checkpointer = new MemorySaver();

    const agent = createAgent({
      model: createMockModel(),
      checkpointer,
    });

    // Create original session with multiple turns
    await agent.generate({
      threadId: "session-original",
      prompt: "First message",
    });

    await agent.generate({
      threadId: "session-original",
      prompt: "Second message",
    });

    // Fork the session
    await agent.generate({
      threadId: "session-original",
      forkSession: "session-fork",
      prompt: "Forked message",
    });

    const originalCheckpoint = await checkpointer.load("session-original");
    const forkedCheckpoint = await checkpointer.load("session-fork");

    expect(forkedCheckpoint).toBeDefined();
    expect(forkedCheckpoint?.messages.length).toBeGreaterThan(0);

    // Forked session should have the same messages as original at fork time
    // (original had 2 turns + fork prompt = 3 user messages + 2 responses)
    // Fork should have original's 4 messages (2 user + 2 assistant) + 1 fork prompt + 1 response
    expect(forkedCheckpoint?.messages.length).toBeGreaterThan(
      originalCheckpoint?.messages.length ?? 0,
    );
  });

  it("forked session has copy of original state", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
    });

    const { MemorySaver } = await import("../src/checkpointer/memory-saver.js");
    const checkpointer = new MemorySaver();

    const agent = createAgent({
      model: createMockModel(),
      checkpointer,
    });

    // Add some state to original session
    agent.state.todos.push({
      content: "Test todo",
      status: "pending",
      activeForm: "Testing todo",
    });

    await agent.generate({
      threadId: "session-with-state",
      prompt: "Hello",
    });

    // Fork the session
    await agent.generate({
      threadId: "session-with-state",
      forkSession: "session-fork-state",
      prompt: "Fork",
    });

    const forkedCheckpoint = await checkpointer.load("session-fork-state");
    expect(forkedCheckpoint?.state.todos).toHaveLength(1);
    expect(forkedCheckpoint?.state.todos[0].content).toBe("Test todo");
  });

  it("returns undefined forkedSessionId when not forking", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
    });

    const { MemorySaver } = await import("../src/checkpointer/memory-saver.js");
    const checkpointer = new MemorySaver();

    const agent = createAgent({
      model: createMockModel(),
      checkpointer,
    });

    const result = await agent.generate({
      threadId: "session-normal",
      prompt: "Hello",
    });

    expect(result.forkedSessionId).toBeUndefined();
  });

  it("handles fork when source session does not exist", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
    });

    const { MemorySaver } = await import("../src/checkpointer/memory-saver.js");
    const checkpointer = new MemorySaver();

    const agent = createAgent({
      model: createMockModel(),
      checkpointer,
    });

    // Try to fork non-existent session
    const result = await agent.generate({
      threadId: "non-existent",
      forkSession: "forked-from-nothing",
      prompt: "Hello",
    });

    // Should still work, just creates new session with fork ID
    expect(result.forkedSessionId).toBe("forked-from-nothing");

    const forkedCheckpoint = await checkpointer.load("forked-from-nothing");
    expect(forkedCheckpoint).toBeDefined();
  });
});

describe("Context Compaction Integration", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("should compact messages when context manager is configured and threshold exceeded", async () => {
    const model = createMockModel();

    // Create a context manager with a very low token limit to trigger compaction
    const onCompactSpy = vi.fn();
    const { createContextManager } = await import("../src/context-manager.js");
    const contextManager = createContextManager({
      maxTokens: 100, // Very low to trigger compaction easily
      summarization: {
        tokenThreshold: 0.1, // Compact at 10%
        keepMessageCount: 2, // Keep only last 2 messages
      },
      onCompact: onCompactSpy,
    });

    const agent = createAgent({
      model,
      contextManager,
    });

    // Create messages that exceed the token limit
    const longMessage = "x".repeat(500); // Long message to exceed budget
    const result = await agent.generate({
      messages: [
        { role: "user", content: longMessage },
        { role: "assistant", content: longMessage },
        { role: "user", content: longMessage },
        { role: "assistant", content: longMessage },
      ],
      prompt: "Final message",
    });

    expect(result).toBeDefined();
    // Compaction should have been triggered
    expect(onCompactSpy).toHaveBeenCalled();

    const compactionResult = onCompactSpy.mock.calls[0]?.[0];
    expect(compactionResult).toBeDefined();
    expect(compactionResult.messagesBefore).toBeGreaterThan(compactionResult.messagesAfter);
  });

  it("should not compact when under token threshold", async () => {
    const model = createMockModel();

    const onCompactSpy = vi.fn();
    const { createContextManager } = await import("../src/context-manager.js");
    const contextManager = createContextManager({
      maxTokens: 100000, // Very high limit
      summarization: {
        tokenThreshold: 0.8,
        keepMessageCount: 10,
      },
      onCompact: onCompactSpy,
    });

    const agent = createAgent({
      model,
      contextManager,
    });

    // Small message set that won't exceed budget
    const result = await agent.generate({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
      prompt: "How are you?",
    });

    expect(result).toBeDefined();
    // Compaction should not have been triggered
    expect(onCompactSpy).not.toHaveBeenCalled();
  });

  it("should work with checkpointer and context compaction together", async () => {
    const model = createMockModel();
    const { MemorySaver } = await import("../src/checkpointer/memory-saver.js");
    const { createContextManager } = await import("../src/context-manager.js");

    const checkpointer = new MemorySaver();
    const contextManager = createContextManager({
      maxTokens: 100,
      summarization: {
        tokenThreshold: 0.1,
        keepMessageCount: 2,
      },
    });

    const agent = createAgent({
      model,
      checkpointer,
      contextManager,
    });

    // First generation - will be checkpointed
    await agent.generate({
      threadId: "test-thread",
      prompt: "x".repeat(300),
    });

    // Second generation - should compact previous messages
    await agent.generate({
      threadId: "test-thread",
      prompt: "x".repeat(300),
    });

    // Checkpoint should exist
    const checkpoint = await checkpointer.load("test-thread");
    expect(checkpoint).toBeDefined();
  });

  it("should preserve system messages during compaction", async () => {
    const model = createMockModel();
    const { createContextManager } = await import("../src/context-manager.js");

    const onCompactSpy = vi.fn();
    const contextManager = createContextManager({
      maxTokens: 100,
      summarization: {
        tokenThreshold: 0.1,
        keepMessageCount: 1,
      },
      onCompact: onCompactSpy,
    });

    const agent = createAgent({
      model,
      contextManager,
    });

    const longMessage = "x".repeat(500);
    // Explicitly include a system message in messages array
    await agent.generate({
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: longMessage },
        { role: "assistant", content: longMessage },
      ],
      prompt: "Final",
    });

    expect(onCompactSpy).toHaveBeenCalled();
    const compactionResult = onCompactSpy.mock.calls[0]?.[0];

    // Check that system message is preserved in new messages
    const systemMessages = compactionResult.newMessages.filter(
      (m: { role: string }) => m.role === "system",
    );
    expect(systemMessages.length).toBeGreaterThan(0);
  });
});

describe("Fallback Model", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("uses fallback model on rate limit error", async () => {
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // First call with primary model fails with rate limit
    vi.mocked(generateText)
      .mockImplementationOnce(() => {
        throw new Error("rate limit exceeded");
      })
      .mockResolvedValueOnce({
        text: "Fallback response",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
        steps: [],
      } as never);

    const result = await agent.generate({ prompt: "Hello" });

    expect(result.text).toBe("Fallback response");
    expect(generateText).toHaveBeenCalledTimes(2);

    // Check that second call used fallback model
    expect(vi.mocked(generateText).mock.calls[1][0].model).toBe(fallbackModel);
  });

  it("uses fallback model on timeout error", async () => {
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // First call times out
    vi.mocked(generateText)
      .mockImplementationOnce(() => {
        throw new Error("Request timed out");
      })
      .mockResolvedValueOnce({
        text: "Fallback response",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
        steps: [],
      } as never);

    const result = await agent.generate({ prompt: "Hello" });

    expect(result.text).toBe("Fallback response");
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateText).mock.calls[1][0].model).toBe(fallbackModel);
  });

  it("uses fallback model on service unavailable error", async () => {
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // First call returns 503
    vi.mocked(generateText)
      .mockImplementationOnce(() => {
        throw new Error("Service unavailable (503)");
      })
      .mockResolvedValueOnce({
        text: "Fallback response",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
        steps: [],
      } as never);

    const result = await agent.generate({ prompt: "Hello" });

    expect(result.text).toBe("Fallback response");
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateText).mock.calls[1][0].model).toBe(fallbackModel);
  });

  it("does not use fallback for non-retryable errors", async () => {
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // First call fails with non-retryable error (authentication error)
    const authError = new Error("Invalid API key");
    vi.mocked(generateText).mockRejectedValue(authError);

    await expect(agent.generate({ prompt: "Hello" })).rejects.toThrow();

    // Should only call once (no fallback)
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("only uses fallback once per request", async () => {
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // Both primary and fallback fail with rate limit
    const rateLimitError = new Error("rate limit exceeded");
    vi.mocked(generateText)
      .mockImplementationOnce(() => {
        throw rateLimitError;
      })
      .mockImplementationOnce(() => {
        throw rateLimitError;
      });

    await expect(agent.generate({ prompt: "Hello" })).rejects.toThrow("rate limit");

    // Should call twice (primary + one fallback attempt)
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("works without fallback model configured", async () => {
    const primaryModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
    });

    // First call fails with rate limit
    vi.mocked(generateText).mockImplementationOnce(() => {
      throw new Error("rate limit exceeded");
    });

    await expect(agent.generate({ prompt: "Hello" })).rejects.toThrow();

    // Should only call once (no fallback configured)
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});

describe("Fallback Model - Streaming", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  // Helper to create a mock stream response
  function createMockStreamResult(text: string) {
    const chunks = [
      { type: "text-delta" as const, id: "chunk-1", text },
      {
        type: "finish" as const,
        finishReason: "stop" as const,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: { reasoningTokens: 0 },
        },
        providerMetadata: undefined,
      },
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    return {
      fullStream: {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
      },
      text: Promise.resolve(text),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
      finishReason: Promise.resolve("stop" as const),
      steps: Promise.resolve([]),
      output: Promise.resolve(undefined),
      rawResponse: { headers: {} },
      toUIMessageStream: () => stream,
      toUIMessageStreamResponse: () => new Response(stream),
    };
  }

  it("stream() uses fallback model on rate limit error", async () => {
    vi.clearAllMocks();
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // First call with primary model fails with rate limit, second succeeds
    vi.mocked(streamText)
      .mockImplementationOnce(() => {
        throw new Error("rate limit exceeded");
      })
      .mockReturnValueOnce(createMockStreamResult("Fallback response") as never);

    const parts: string[] = [];
    for await (const part of agent.stream({
      messages: [{ role: "user", content: "Hello" }],
    })) {
      if (part.type === "text-delta") {
        parts.push(part.text);
      }
    }

    expect(parts.join("")).toBe("Fallback response");
    expect(streamText).toHaveBeenCalledTimes(2);

    // Check that second call used fallback model
    expect(vi.mocked(streamText).mock.calls[1][0].model).toBe(fallbackModel);
  });

  it("streamResponse() uses fallback model on rate limit error", async () => {
    vi.clearAllMocks();
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // First call with primary model fails with rate limit, second succeeds
    vi.mocked(streamText)
      .mockImplementationOnce(() => {
        throw new Error("rate limit exceeded");
      })
      .mockReturnValueOnce(createMockStreamResult("Fallback response") as never);

    const response = await agent.streamResponse({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(response.status).toBe(200);
    expect(streamText).toHaveBeenCalledTimes(2);

    // Check that second call used fallback model
    expect(vi.mocked(streamText).mock.calls[1][0].model).toBe(fallbackModel);
  });

  it("streamRaw() uses fallback model on rate limit error", async () => {
    vi.clearAllMocks();
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // First call with primary model fails with rate limit, second succeeds
    vi.mocked(streamText)
      .mockImplementationOnce(() => {
        throw new Error("rate limit exceeded");
      })
      .mockReturnValueOnce(createMockStreamResult("Fallback response") as never);

    const result = await agent.streamRaw({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result).toBeDefined();
    expect(streamText).toHaveBeenCalledTimes(2);

    // Check that second call used fallback model
    expect(vi.mocked(streamText).mock.calls[1][0].model).toBe(fallbackModel);
  });

  // Note: streamDataResponse() fallback is not tested because errors thrown inside
  // createUIMessageStream's execute callback don't propagate to the retry loop.
  // This is a known architectural limitation that would require refactoring to fix.

  it("stream() uses fallback model on timeout error", async () => {
    vi.clearAllMocks();
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // First call times out - use "timeout" which gets detected by inferErrorCode
    vi.mocked(streamText)
      .mockImplementationOnce(() => {
        throw new Error("Request timeout exceeded");
      })
      .mockReturnValueOnce(createMockStreamResult("Fallback response") as never);

    const parts: string[] = [];
    for await (const part of agent.stream({
      messages: [{ role: "user", content: "Hello" }],
    })) {
      if (part.type === "text-delta") {
        parts.push(part.text);
      }
    }

    expect(parts.join("")).toBe("Fallback response");
    expect(streamText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(streamText).mock.calls[1][0].model).toBe(fallbackModel);
  });

  it("stream() uses fallback model on service unavailable error", async () => {
    vi.clearAllMocks();
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // First call returns 503
    vi.mocked(streamText)
      .mockImplementationOnce(() => {
        throw new Error("Service unavailable (503)");
      })
      .mockReturnValueOnce(createMockStreamResult("Fallback response") as never);

    const parts: string[] = [];
    for await (const part of agent.stream({
      messages: [{ role: "user", content: "Hello" }],
    })) {
      if (part.type === "text-delta") {
        parts.push(part.text);
      }
    }

    expect(parts.join("")).toBe("Fallback response");
    expect(streamText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(streamText).mock.calls[1][0].model).toBe(fallbackModel);
  });

  it("stream() does not use fallback for non-retryable errors", async () => {
    vi.clearAllMocks();
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // First call fails with non-retryable error (authentication error)
    const authError = new Error("Invalid API key");
    vi.mocked(streamText).mockImplementationOnce(() => {
      throw authError;
    });

    let errorThrown = false;
    try {
      for await (const _part of agent.stream({
        messages: [{ role: "user", content: "Hello" }],
      })) {
        // Consume stream
      }
    } catch {
      errorThrown = true;
    }

    expect(errorThrown).toBe(true);
    // Should only call once (no fallback)
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("stream() only uses fallback once per request", async () => {
    vi.clearAllMocks();
    const primaryModel = createMockModel();
    const fallbackModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
      fallbackModel,
    });

    // Both primary and fallback fail with rate limit
    const rateLimitError = new Error("rate limit exceeded");
    vi.mocked(streamText)
      .mockImplementationOnce(() => {
        throw rateLimitError;
      })
      .mockImplementationOnce(() => {
        throw rateLimitError;
      });

    let errorThrown = false;
    try {
      for await (const _part of agent.stream({
        messages: [{ role: "user", content: "Hello" }],
      })) {
        // Consume stream
      }
    } catch (e) {
      errorThrown = true;
      expect((e as Error).message).toContain("rate limit");
    }

    expect(errorThrown).toBe(true);
    // Should call twice (primary + one fallback attempt)
    expect(streamText).toHaveBeenCalledTimes(2);
  });

  it("stream() works without fallback model configured", async () => {
    vi.clearAllMocks();
    const primaryModel = createMockModel();

    const agent = createAgent({
      model: primaryModel,
    });

    // First call fails with rate limit
    vi.mocked(streamText).mockImplementationOnce(() => {
      throw new Error("rate limit exceeded");
    });

    let errorThrown = false;
    try {
      for await (const _part of agent.stream({
        messages: [{ role: "user", content: "Hello" }],
      })) {
        // Consume stream
      }
    } catch {
      errorThrown = true;
    }

    expect(errorThrown).toBe(true);
    // Should only call once (no fallback configured)
    expect(streamText).toHaveBeenCalledTimes(1);
  });
});

describe("agent.subagents - task tool availability", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  // Helper to create a mock subagent definition
  function createMockSubagent(type: string, description: string) {
    return {
      type,
      description,
      create: vi.fn().mockResolvedValue({
        id: `mock-${type}-agent`,
        options: { model: {} },
        backend: {},
        state: { todos: [], files: {} },
        ready: Promise.resolve(),
        generate: vi.fn().mockResolvedValue({
          status: "complete",
          text: `Response from ${type}`,
          steps: [],
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
        stream: vi.fn(),
        streamResponse: vi.fn(),
        streamRaw: vi.fn().mockReturnValue({
          textStream: (async function* () {
            yield `Stream from ${type}`;
          })(),
        }),
        getSkills: vi.fn().mockReturnValue([]),
      }),
    };
  }

  it("includes task tool in generate when subagents configured", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();
    const agent = createAgent({
      model,
      subagents: [
        createMockSubagent("researcher", "Researches topics"),
        createMockSubagent("coder", "Writes code"),
      ],
    });

    await agent.generate({ prompt: "Test with subagents" });

    const callArgs = mockGenerateText.mock.calls[0][0] as { tools?: Record<string, unknown> };
    expect(callArgs.tools).toHaveProperty("task");
  });

  it("includes task tool in stream when subagents configured", async () => {
    const mockStreamText = vi.mocked(streamText);

    const mockFullStream = (async function* () {
      yield { type: "text-delta" as const, text: "Streamed" };
      yield {
        type: "finish" as const,
        finishReason: "stop" as const,
        totalUsage: { inputTokens: 10, outputTokens: 20 },
      };
    })();

    mockStreamText.mockReturnValue({
      fullStream: mockFullStream,
      usage: Promise.resolve({
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      }),
      finishReason: Promise.resolve("stop" as const),
      text: Promise.resolve("Streamed"),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      output: Promise.resolve(undefined),
      response: Promise.resolve({
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      }),
      warnings: Promise.resolve([]),
    } as never);

    const model = createMockModel();
    const agent = createAgent({
      model,
      subagents: [createMockSubagent("researcher", "Researches topics")],
    });

    // Consume the stream to trigger the call
    for await (const _ of agent.stream({ prompt: "Test streaming" })) {
      // consume
    }

    const callArgs = mockStreamText.mock.calls[0][0] as { tools?: Record<string, unknown> };
    expect(callArgs.tools).toHaveProperty("task");
  });

  it("includes task tool in streamResponse when subagents configured", async () => {
    const mockStreamText = vi.mocked(streamText);

    mockStreamText.mockReturnValue({
      toUIMessageStreamResponse: vi.fn().mockReturnValue(new Response("mock stream")),
      fullStream: (async function* () {})(),
      usage: Promise.resolve({
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      }),
      finishReason: Promise.resolve("stop" as const),
      text: Promise.resolve("Response"),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      output: Promise.resolve(undefined),
      response: Promise.resolve({
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      }),
      warnings: Promise.resolve([]),
    } as never);

    const model = createMockModel();
    const agent = createAgent({
      model,
      subagents: [createMockSubagent("coder", "Writes code")],
    });

    await agent.streamResponse({ prompt: "Test streamResponse" });

    const callArgs = mockStreamText.mock.calls[0][0] as { tools?: Record<string, unknown> };
    expect(callArgs.tools).toHaveProperty("task");
  });

  it("includes task tool in streamRaw when subagents configured", async () => {
    const mockStreamText = vi.mocked(streamText);

    mockStreamText.mockReturnValue({
      fullStream: (async function* () {})(),
      usage: Promise.resolve({
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      }),
      finishReason: Promise.resolve("stop" as const),
      text: Promise.resolve("Raw response"),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      output: Promise.resolve(undefined),
      response: Promise.resolve({
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      }),
      warnings: Promise.resolve([]),
    } as never);

    const model = createMockModel();
    const agent = createAgent({
      model,
      subagents: [createMockSubagent("explorer", "Explores codebase")],
    });

    await agent.streamRaw({ prompt: "Test streamRaw" });

    const callArgs = mockStreamText.mock.calls[0][0] as { tools?: Record<string, unknown> };
    expect(callArgs.tools).toHaveProperty("task");
  });

  it("includes task tool with general-purpose subagent even when no subagents configured", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();
    const agent = createAgent({ model });

    await agent.generate({ prompt: "Test without subagents" });

    // Task tool is always included with general-purpose subagent
    const callArgs = mockGenerateText.mock.calls[0][0] as { tools?: Record<string, unknown> };
    expect(callArgs.tools).toHaveProperty("task");
    expect(callArgs.tools).toHaveProperty("task_output");
  });

  it("includes task tool with general-purpose subagent even when subagents array is empty", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();
    const agent = createAgent({
      model,
      subagents: [],
    });

    await agent.generate({ prompt: "Test with empty subagents" });

    // Task tool is always included with general-purpose subagent
    const callArgs = mockGenerateText.mock.calls[0][0] as { tools?: Record<string, unknown> };
    expect(callArgs.tools).toHaveProperty("task");
    expect(callArgs.tools).toHaveProperty("task_output");
  });

  it("respects disabledCoreTools for task tool", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();
    const agent = createAgent({
      model,
      subagents: [createMockSubagent("researcher", "Researches topics")],
      disabledCoreTools: ["task"],
    });

    await agent.generate({ prompt: "Test with disabled task" });

    const callArgs = mockGenerateText.mock.calls[0][0] as { tools?: Record<string, unknown> };
    expect(callArgs.tools).not.toHaveProperty("task");
  });

  it("task tool has subagent descriptions in generateText call", async () => {
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      response: {
        id: "test-id",
        timestamp: new Date(),
        modelId: "test-model",
        messages: [],
      },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();
    const agent = createAgent({
      model,
      subagents: [
        createMockSubagent("researcher", "Researches topics and gathers information"),
        createMockSubagent("coder", "Writes and reviews code"),
      ],
    });

    await agent.generate({ prompt: "Test" });

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      tools?: Record<string, { description?: string }>;
    };
    expect(callArgs.tools).toHaveProperty("task");
    const taskTool = callArgs.tools!.task;
    expect(taskTool.description).toContain("researcher");
    expect(taskTool.description).toContain("Researches topics");
    expect(taskTool.description).toContain("coder");
    expect(taskTool.description).toContain("Writes and reviews code");
  });
});
