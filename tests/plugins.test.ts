import { tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent, definePlugin, defineSkill } from "../src/index.js";
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

describe("definePlugin", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("creates a plugin with name only", () => {
    const plugin = definePlugin({ name: "test-plugin" });

    expect(plugin.name).toBe("test-plugin");
    expect(plugin.tools).toBeUndefined();
    expect(plugin.skills).toBeUndefined();
  });

  it("creates a plugin with description", () => {
    const plugin = definePlugin({
      name: "test-plugin",
      description: "A test plugin",
    });

    expect(plugin.description).toBe("A test plugin");
  });

  it("creates a plugin with tools as ToolSet", () => {
    const pluginTool = tool({
      description: "A tool from plugin",
      parameters: z.object({}),
      execute: async () => "result",
    });

    const plugin = definePlugin({
      name: "test-plugin",
      tools: { pluginTool },
    });

    expect(plugin.tools).toBeDefined();
    expect(plugin.tools?.pluginTool).toBeDefined();
  });

  it("creates a plugin with skills", () => {
    const skill = defineSkill({
      name: "plugin-skill",
      description: "A skill from plugin",
      prompt: "Do the thing",
    });

    const plugin = definePlugin({
      name: "test-plugin",
      skills: [skill],
    });

    expect(plugin.skills).toHaveLength(1);
    expect(plugin.skills?.[0]?.name).toBe("plugin-skill");
  });

  it("creates a plugin with setup function", () => {
    const setupFn = vi.fn();
    const plugin = definePlugin({
      name: "test-plugin",
      setup: setupFn,
    });

    expect(plugin.setup).toBe(setupFn);
  });
});

describe("plugin integration with agent", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("agent registers skills from plugins", () => {
    const skill = defineSkill({
      name: "commit",
      description: "Create a git commit",
      prompt: "Create a commit with the staged changes",
    });

    const plugin = definePlugin({
      name: "git-plugin",
      skills: [skill],
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [plugin],
    });

    const skills = agent.getSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("commit");
  });

  it("plugin tools are passed to generateText", async () => {
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

    const pluginTool = tool({
      description: "A tool from plugin",
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => input,
    });

    const plugin = definePlugin({
      name: "test-plugin",
      tools: { pluginTool },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [plugin],
    });

    await agent.generate({ prompt: "Test" });

    // Plugin tools are now exposed with MCP naming: mcp__<plugin>__<tool>
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          "mcp__test-plugin__pluginTool": expect.any(Object),
        }),
      }),
    );
  });

  it("agent combines tools from options and plugins", async () => {
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

    const directTool = tool({
      description: "Direct tool",
      parameters: z.object({}),
      execute: async () => "direct",
    });

    const pluginTool = tool({
      description: "Plugin tool",
      parameters: z.object({}),
      execute: async () => "plugin",
    });

    const plugin = definePlugin({
      name: "test-plugin",
      tools: { pluginTool },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      tools: { directTool },
      plugins: [plugin],
    });

    await agent.generate({ prompt: "Test" });

    // directTool is passed directly, pluginTool is exposed via MCP naming
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          directTool: expect.any(Object),
          // Plugin tools are now exposed with MCP naming: mcp__<plugin>__<tool>
          "mcp__test-plugin__pluginTool": expect.any(Object),
        }),
      }),
    );
  });

  it("multiple plugins can be loaded", async () => {
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

    const tool1 = tool({
      description: "Tool 1",
      parameters: z.object({}),
      execute: async () => "1",
    });

    const tool2 = tool({
      description: "Tool 2",
      parameters: z.object({}),
      execute: async () => "2",
    });

    const plugin1 = definePlugin({
      name: "plugin-1",
      tools: { tool1 },
    });

    const plugin2 = definePlugin({
      name: "plugin-2",
      tools: { tool2 },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [plugin1, plugin2],
    });

    await agent.generate({ prompt: "Test" });

    // Plugin tools are now exposed with MCP naming: mcp__<plugin>__<tool>
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          "mcp__plugin-1__tool1": expect.any(Object),
          "mcp__plugin-2__tool2": expect.any(Object),
        }),
      }),
    );
  });
});

describe("definePlugin with mcpServer", () => {
  it("includes mcpServer in returned plugin", () => {
    const plugin = definePlugin({
      name: "github",
      description: "GitHub integration",
      mcpServer: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
      },
    });

    expect(plugin.mcpServer).toBeDefined();
    expect(plugin.mcpServer?.type).toBe("stdio");
    expect((plugin.mcpServer as { command: string }).command).toBe("npx");
  });

  it("allows both tools and mcpServer", () => {
    const plugin = definePlugin({
      name: "hybrid",
      tools: {
        localTool: tool({
          description: "Local tool",
          parameters: z.object({}),
          execute: async () => "local",
        }),
      },
      mcpServer: {
        type: "http",
        url: "https://example.com/mcp",
      },
    });

    expect(plugin.tools).toBeDefined();
    expect(plugin.mcpServer).toBeDefined();
  });
});

describe("defineSkill", () => {
  it("creates a skill with string instructions", () => {
    const skill = defineSkill({
      name: "review",
      description: "Review code",
      instructions: "Review the following code for issues",
    });

    expect(skill.name).toBe("review");
    expect(skill.description).toBe("Review code");
    expect(skill.instructions).toBe("Review the following code for issues");
  });

  it("creates a skill with function instructions", () => {
    const skill = defineSkill({
      name: "search",
      description: "Search for code",
      instructions: (args) => `Search for: ${args ?? "nothing"}`,
    });

    expect(skill.name).toBe("search");
    expect(typeof skill.instructions).toBe("function");
    if (typeof skill.instructions === "function") {
      expect(skill.instructions("foo")).toBe("Search for: foo");
    }
  });

  it("creates a skill with tools as ToolSet", () => {
    const skillTool = tool({
      description: "Tool for skill",
      parameters: z.object({}),
      execute: async () => "done",
    });

    const skill = defineSkill({
      name: "complex-skill",
      description: "A skill with tools",
      prompt: "Do the thing",
      tools: { skillTool },
    });

    expect(skill.tools).toBeDefined();
    expect(skill.tools?.skillTool).toBeDefined();
  });
});
