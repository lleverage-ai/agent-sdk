import { generateText, tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../src/agent.js";
import { createMockModel, resetMocks } from "./setup.js";

// Mock AI SDK generateText
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

const mockedGenerateText = vi.mocked(generateText);

describe("Agent Runtime Tools", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("addRuntimeTools makes tools appear in getActiveTools()", async () => {
    const model = createMockModel();
    const agent = createAgent({
      model,
      systemPrompt: "Test",
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    const myTool = tool({
      description: "A runtime tool",
      inputSchema: z.object({ x: z.string() }),
      execute: async ({ x }) => `got: ${x}`,
    });

    agent.addRuntimeTools({ my_runtime_tool: myTool });

    const tools = agent.getActiveTools();
    expect(tools.my_runtime_tool).toBeDefined();
  });

  it("removeRuntimeTools removes them from getActiveTools()", async () => {
    const model = createMockModel();
    const agent = createAgent({
      model,
      systemPrompt: "Test",
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    const myTool = tool({
      description: "A runtime tool",
      inputSchema: z.object({ x: z.string() }),
      execute: async ({ x }) => `got: ${x}`,
    });

    agent.addRuntimeTools({ my_runtime_tool: myTool });
    expect(agent.getActiveTools().my_runtime_tool).toBeDefined();

    agent.removeRuntimeTools(["my_runtime_tool"]);
    expect(agent.getActiveTools().my_runtime_tool).toBeUndefined();
  });

  it("adding a tool with the same name overwrites", async () => {
    const model = createMockModel();
    const agent = createAgent({
      model,
      systemPrompt: "Test",
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    const tool1 = tool({
      description: "Version 1",
      inputSchema: z.object({}),
      execute: async () => "v1",
    });

    const tool2 = tool({
      description: "Version 2",
      inputSchema: z.object({}),
      execute: async () => "v2",
    });

    agent.addRuntimeTools({ my_tool: tool1 });
    expect(agent.getActiveTools().my_tool.description).toBe("Version 1");

    agent.addRuntimeTools({ my_tool: tool2 });
    expect(agent.getActiveTools().my_tool.description).toBe("Version 2");
  });

  it("removing a nonexistent name is a no-op", async () => {
    const model = createMockModel();
    const agent = createAgent({
      model,
      systemPrompt: "Test",
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    // Should not throw
    agent.removeRuntimeTools(["nonexistent_tool"]);
    expect(agent.getActiveTools().nonexistent_tool).toBeUndefined();
  });

  it("runtime tools are available during generate() calls", async () => {
    const model = createMockModel();
    const agent = createAgent({
      model,
      systemPrompt: "Test",
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    let toolsSeenDuringGenerate: string[] = [];

    const myTool = tool({
      description: "A runtime tool",
      inputSchema: z.object({ x: z.string() }),
      execute: async ({ x }) => `got: ${x}`,
    });

    agent.addRuntimeTools({ my_runtime_tool: myTool });

    // Mock generateText to capture the tools it receives
    mockedGenerateText.mockImplementationOnce(async (opts: any) => {
      toolsSeenDuringGenerate = Object.keys(opts.tools || {});
      return {
        text: "done",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        response: { id: "r1", timestamp: new Date(), modelId: "mock" },
        steps: [],
        warnings: [],
        sources: [],
        toolCalls: [],
        toolResults: [],
        request: { body: {} },
      } as any;
    });

    await agent.generate({ prompt: "test" });

    expect(toolsSeenDuringGenerate).toContain("my_runtime_tool");
  });

  it("multiple runtime tools can be added at once", async () => {
    const model = createMockModel();
    const agent = createAgent({
      model,
      systemPrompt: "Test",
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    const toolA = tool({
      description: "Tool A",
      inputSchema: z.object({}),
      execute: async () => "a",
    });

    const toolB = tool({
      description: "Tool B",
      inputSchema: z.object({}),
      execute: async () => "b",
    });

    agent.addRuntimeTools({ tool_a: toolA, tool_b: toolB });

    const tools = agent.getActiveTools();
    expect(tools.tool_a).toBeDefined();
    expect(tools.tool_b).toBeDefined();
  });

  it("multiple runtime tools can be removed at once", async () => {
    const model = createMockModel();
    const agent = createAgent({
      model,
      systemPrompt: "Test",
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    const toolA = tool({
      description: "Tool A",
      inputSchema: z.object({}),
      execute: async () => "a",
    });

    const toolB = tool({
      description: "Tool B",
      inputSchema: z.object({}),
      execute: async () => "b",
    });

    agent.addRuntimeTools({ tool_a: toolA, tool_b: toolB });
    agent.removeRuntimeTools(["tool_a", "tool_b"]);

    const tools = agent.getActiveTools();
    expect(tools.tool_a).toBeUndefined();
    expect(tools.tool_b).toBeUndefined();
  });
});
