/**
 * MCP Integration Tests
 *
 * Comprehensive tests for MCP (Model Context Protocol) integration covering:
 * - Virtual MCP servers (inline plugin tools)
 * - Tool search functionality
 * - Deferred tool loading
 * - Skill integration with MCP tools
 * - Agent options (disabledCoreTools, allowedTools, toolSearch)
 */

import { tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAgent, definePlugin, MCPManager } from "../src/index.js";
import { createSearchToolsTool } from "../src/tools/search.js";
import { SkillRegistry } from "../src/tools/skills.js";

// Mock the AI SDK generateText
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({
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
    }),
    streamText: vi.fn().mockReturnValue({
      textStream: (async function* () {
        yield "Response";
      })(),
      toUIMessageStream: vi.fn().mockReturnValue(new ReadableStream()),
      toUIMessageStreamResponse: vi.fn().mockReturnValue(new Response()),
    }),
  };
});

// Create mock model
function createMockModel() {
  return {
    provider: "mock",
    modelId: "mock-model",
    specificationVersion: "v3" as const,
    defaultObjectGenerationMode: "json" as const,
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  };
}

describe("MCP Integration", () => {
  describe("MCPManager with virtual servers", () => {
    let manager: MCPManager;

    beforeEach(() => {
      manager = new MCPManager();
    });

    it("registers plugin tools as virtual MCP server", () => {
      manager.registerPluginTools("my-plugin", {
        my_tool: tool({
          description: "A test tool",
          inputSchema: z.object({ input: z.string() }),
          execute: async ({ input }) => `Result: ${input}`,
        }),
      });

      const tools = manager.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("mcp__my-plugin__my_tool");
    });

    it("supports deferred loading with autoLoad: false", () => {
      manager.registerPluginTools(
        "deferred",
        {
          tool_a: tool({
            description: "Tool A",
            inputSchema: z.object({}),
            execute: async () => "A",
          }),
        },
        { autoLoad: false },
      );

      // Tool should be listed but not in getToolSet
      expect(manager.listTools()).toHaveLength(1);
      expect(Object.keys(manager.getToolSet())).toHaveLength(0);

      // Load the tool
      const result = manager.loadTools(["mcp__deferred__tool_a"]);
      expect(result.loaded).toContain("mcp__deferred__tool_a");

      // Now it should be in getToolSet
      expect(Object.keys(manager.getToolSet())).toHaveLength(1);
    });

    it("searchTools finds tools by name or description", () => {
      manager.registerPluginTools("search-test", {
        create_issue: tool({
          description: "Create a GitHub issue",
          inputSchema: z.object({ title: z.string() }),
          execute: async () => "created",
        }),
        list_prs: tool({
          description: "List pull requests",
          inputSchema: z.object({}),
          execute: async () => "listed",
        }),
      });

      // Search by name
      const byName = manager.searchTools("issue");
      expect(byName).toHaveLength(1);
      expect(byName[0].name).toBe("mcp__search-test__create_issue");

      // Search by description
      const byDesc = manager.searchTools("pull request");
      expect(byDesc).toHaveLength(1);
      expect(byDesc[0].name).toBe("mcp__search-test__list_prs");
    });

    it("loadTools returns alreadyLoaded for auto-loaded tools", () => {
      manager.registerPluginTools("auto-load", {
        tool: tool({
          description: "Auto-loaded tool",
          inputSchema: z.object({}),
          execute: async () => "done",
        }),
      });

      const result = manager.loadTools(["mcp__auto-load__tool"]);
      expect(result.alreadyLoaded).toContain("mcp__auto-load__tool");
      expect(result.loaded).toHaveLength(0);
    });
  });

  describe("search_tools meta-tool", () => {
    it("searches tools and returns formatted results", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("test-plugin", {
        search_docs: tool({
          description: "Search documentation",
          inputSchema: z.object({ query: z.string() }),
          execute: async () => "results",
        }),
      });

      const searchTool = createSearchToolsTool({ manager, maxResults: 5 });
      const result = await searchTool.execute!(
        { query: "search" },
        {
          toolCallId: "test",
          messages: [],
          abortSignal: undefined as unknown as AbortSignal,
        },
      );

      expect(result).toContain("mcp__test-plugin__search_docs");
      expect(result).toContain("Search documentation");
    });

    it("supports load option when enabled", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools(
        "loadable",
        {
          loadable_tool: tool({
            description: "A loadable tool",
            inputSchema: z.object({}),
            execute: async () => "done",
          }),
        },
        { autoLoad: false },
      );

      const onToolsLoaded = vi.fn();
      const searchTool = createSearchToolsTool({
        manager,
        enableLoad: true,
        onToolsLoaded,
      });

      // Initially not loaded
      expect(Object.keys(manager.getToolSet())).toHaveLength(0);

      // Search and load
      await searchTool.execute!(
        { query: "loadable", load: true },
        {
          toolCallId: "test",
          messages: [],
          abortSignal: undefined as unknown as AbortSignal,
        },
      );

      // Now loaded
      expect(Object.keys(manager.getToolSet())).toHaveLength(1);
      expect(onToolsLoaded).toHaveBeenCalledWith(["mcp__loadable__loadable_tool"]);
    });
  });

  describe("SkillRegistry with MCP tools", () => {
    it("loads MCP tools when skill is activated", () => {
      const manager = new MCPManager();
      manager.registerPluginTools(
        "github",
        {
          list_issues: tool({
            description: "List GitHub issues",
            inputSchema: z.object({}),
            execute: async () => "issues",
          }),
        },
        { autoLoad: false },
      );

      const registry = new SkillRegistry({
        mcpManager: manager,
        skills: [
          {
            name: "github-skill",
            description: "GitHub operations",
            tools: {},
            mcpTools: ["mcp__github__list_issues"],
            prompt: "You can now work with GitHub.",
          },
        ],
      });

      // Initially not loaded
      expect(Object.keys(manager.getToolSet())).toHaveLength(0);

      // Load the skill
      const result = registry.load("github-skill");

      // MCP tool should now be loaded
      expect(result.success).toBe(true);
      expect(result.loadedMcpTools).toContain("mcp__github__list_issues");
      expect(Object.keys(manager.getToolSet())).toHaveLength(1);
    });

    it("reports notFoundMcpTools for missing MCP tools", () => {
      const manager = new MCPManager();
      const registry = new SkillRegistry({
        mcpManager: manager,
        skills: [
          {
            name: "missing-tools",
            description: "Skill with missing tools",
            tools: {},
            mcpTools: ["mcp__nonexistent__tool"],
            prompt: "Tools not found.",
          },
        ],
      });

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = registry.load("missing-tools");

      expect(result.success).toBe(true); // Still succeeds, just with warnings
      expect(result.notFoundMcpTools).toContain("mcp__nonexistent__tool");
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe("Agent with MCP integration", () => {
    it("auto-creates core tools", async () => {
      const model = createMockModel();
      const agent = createAgent({ model });

      const tools = agent.getActiveTools();

      // Should have core tools
      expect(tools.read).toBeDefined();
      expect(tools.write).toBeDefined();
      expect(tools.edit).toBeDefined();
      expect(tools.glob).toBeDefined();
      expect(tools.grep).toBeDefined();
      expect(tools.todo_write).toBeDefined();
    });

    it("respects disabledCoreTools option", async () => {
      const model = createMockModel();
      const agent = createAgent({
        model,
        disabledCoreTools: ["bash", "write"],
      });

      const tools = agent.getActiveTools();

      expect(tools.read).toBeDefined();
      expect(tools.bash).toBeUndefined();
      expect(tools.write).toBeUndefined();
    });

    it("plugin tools are exposed with MCP naming", async () => {
      const model = createMockModel();
      const plugin = definePlugin({
        name: "test-plugin",
        tools: {
          plugin_tool: tool({
            description: "Plugin tool",
            inputSchema: z.object({}),
            execute: async () => "result",
          }),
        },
      });

      const agent = createAgent({
        model,
        plugins: [plugin],
      });

      const tools = agent.getActiveTools();

      // Plugin tool should have MCP naming
      expect(tools["mcp__test-plugin__plugin_tool"]).toBeDefined();
    });

    it("user-provided tools override auto-created tools", async () => {
      const customRead = tool({
        description: "Custom read implementation",
        inputSchema: z.object({ path: z.string() }),
        execute: async () => "custom",
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        tools: { read: customRead },
      });

      const tools = agent.getActiveTools();

      // Should use custom read tool
      expect((tools.read as { description?: string }).description).toBe(
        "Custom read implementation",
      );
    });

    it("respects allowedTools filtering", async () => {
      const model = createMockModel();
      const agent = createAgent({
        model,
        allowedTools: ["read", "glob"],
      });

      const tools = agent.getActiveTools();

      expect(tools.read).toBeDefined();
      expect(tools.glob).toBeDefined();
      expect(tools.write).toBeUndefined();
      expect(tools.edit).toBeUndefined();
    });
  });

  describe("Tool search threshold (deferred loading)", () => {
    it("defers plugin tools when toolSearch is enabled", async () => {
      const model = createMockModel();

      // Create plugins with many tools
      const plugins = Array.from({ length: 5 }, (_, i) =>
        definePlugin({
          name: `plugin-${i}`,
          tools: Object.fromEntries(
            Array.from({ length: 5 }, (_, j) => [
              `tool_${j}`,
              tool({
                description: `Tool ${j} from plugin ${i}`,
                inputSchema: z.object({}),
                execute: async () => `result-${i}-${j}`,
              }),
            ]),
          ),
        }),
      );

      const agent = createAgent({
        model,
        plugins,
        toolSearch: {
          enabled: "always", // Force deferred loading
        },
      });

      const tools = agent.getActiveTools();

      // search_tools should be available
      expect(tools.search_tools).toBeDefined();

      // Core tools should still be available
      expect(tools.read).toBeDefined();
    });
  });
});
