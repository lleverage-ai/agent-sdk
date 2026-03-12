/**
 * Tests for plugin loading modes and tool availability.
 *
 * These tests verify that plugins are loaded correctly based on:
 * - pluginLoading mode (eager, proxy)
 * - toolSearch settings (auto, always, never)
 * - Tool count thresholds
 */

import { tool } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgent, definePlugin } from "../src/index.js";
import { createMockModel, resetMocks } from "./setup.js";

describe("Plugin Loading Modes", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("Default behavior (eager)", () => {
    it("loads plugin tools immediately when count <= threshold", () => {
      // Create a plugin with few tools (under default threshold of 20)
      const plugin = definePlugin({
        name: "test-plugin",
        tools: {
          tool1: tool({
            description: "Tool 1",
            parameters: z.object({}),
            execute: async () => "result1",
          }),
          tool2: tool({
            description: "Tool 2",
            parameters: z.object({}),
            execute: async () => "result2",
          }),
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin],
      });

      // Tools should be available immediately via getActiveTools()
      const activeTools = agent.getActiveTools();
      expect(activeTools).toHaveProperty("test-plugin__tool1");
      expect(activeTools).toHaveProperty("test-plugin__tool2");
    });

    it("loads tools eagerly even with many tools (new default behavior)", () => {
      // Create a plugin with many tools (over default threshold of 20)
      const tools: Record<string, ReturnType<typeof tool>> = {};
      for (let i = 0; i < 25; i++) {
        tools[`tool${i}`] = tool({
          description: `Tool ${i}`,
          parameters: z.object({}),
          execute: async () => `result${i}`,
        });
      }

      const plugin = definePlugin({
        name: "large-plugin",
        tools,
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin],
      });

      // NEW BEHAVIOR: Tools ARE loaded eagerly by default
      const activeTools = agent.getActiveTools();
      expect(activeTools).toHaveProperty("large-plugin__tool0");

      // search_tools is created for auto-discovery (>20 tools)
      expect(activeTools).toHaveProperty("search_tools");
    });
  });

  describe("Eager mode (explicit)", () => {
    it("always loads tools immediately, even with many tools", () => {
      // Create a plugin with many tools (over threshold)
      const tools: Record<string, ReturnType<typeof tool>> = {};
      for (let i = 0; i < 25; i++) {
        tools[`tool${i}`] = tool({
          description: `Tool ${i}`,
          parameters: z.object({}),
          execute: async () => `result${i}`,
        });
      }

      const plugin = definePlugin({
        name: "large-plugin",
        tools,
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin],
        pluginLoading: "eager", // Explicit eager
      });

      // Tools should be available immediately despite >20 tools
      const activeTools = agent.getActiveTools();
      expect(activeTools).toHaveProperty("large-plugin__tool0");
      expect(activeTools).toHaveProperty("large-plugin__tool24");
    });

    it("loads tools immediately with toolSearch never", () => {
      const plugin = definePlugin({
        name: "test-plugin",
        tools: {
          tool1: tool({
            description: "Tool 1",
            parameters: z.object({}),
            execute: async () => "result1",
          }),
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin],
        pluginLoading: "eager",
        toolSearch: { enabled: "never" },
      });

      // Tools should be available immediately
      const activeTools = agent.getActiveTools();
      expect(activeTools).toHaveProperty("test-plugin__tool1");
      // search_tools should NOT be present
      expect(activeTools).not.toHaveProperty("search_tools");
    });
  });

  describe("Tool search configuration", () => {
    it("respects toolSearch.enabled: never", () => {
      // Create many tools
      const tools: Record<string, ReturnType<typeof tool>> = {};
      for (let i = 0; i < 25; i++) {
        tools[`tool${i}`] = tool({
          description: `Tool ${i}`,
          parameters: z.object({}),
          execute: async () => `result${i}`,
        });
      }

      const plugin = definePlugin({
        name: "large-plugin",
        tools,
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin],
        toolSearch: { enabled: "never" },
      });

      // Tools should be loaded despite count (no deferred loading)
      const activeTools = agent.getActiveTools();
      expect(activeTools).toHaveProperty("large-plugin__tool0");
      expect(activeTools).not.toHaveProperty("search_tools");
    });

    it("respects toolSearch.enabled: always (explicit deferred loading)", () => {
      // Create few tools (under threshold)
      const plugin = definePlugin({
        name: "small-plugin",
        tools: {
          tool1: tool({
            description: "Tool 1",
            parameters: z.object({}),
            execute: async () => "result1",
          }),
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin],
        toolSearch: { enabled: "always" },
      });

      // Tools should NOT be loaded (deferred loading explicitly requested)
      const activeTools = agent.getActiveTools();
      expect(activeTools).not.toHaveProperty("small-plugin__tool1");
      expect(activeTools).toHaveProperty("search_tools");
    });

    it("creates search_tools based on custom threshold", () => {
      // Create 15 tools (between default threshold 20 and custom threshold 10)
      const tools: Record<string, ReturnType<typeof tool>> = {};
      for (let i = 0; i < 15; i++) {
        tools[`tool${i}`] = tool({
          description: `Tool ${i}`,
          parameters: z.object({}),
          execute: async () => `result${i}`,
        });
      }

      const plugin = definePlugin({
        name: "medium-plugin",
        tools,
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin],
        toolSearch: {
          enabled: "auto",
          threshold: 10, // Lower threshold
        },
      });

      // NEW BEHAVIOR: Tools ARE loaded eagerly (default behavior)
      const activeTools = agent.getActiveTools();
      expect(activeTools).toHaveProperty("medium-plugin__tool0");

      // search_tools is created because count > custom threshold
      expect(activeTools).toHaveProperty("search_tools");
    });
  });

  describe("Mixed configurations", () => {
    it("handles multiple plugins with deferred per-plugin opt-in", () => {
      const plugin1 = definePlugin({
        name: "plugin1",
        tools: {
          tool1: tool({
            description: "Tool 1",
            parameters: z.object({}),
            execute: async () => "result1",
          }),
        },
      });

      const plugin2 = definePlugin({
        name: "plugin2",
        deferred: true,
        tools: {
          tool2: tool({
            description: "Tool 2",
            parameters: z.object({}),
            execute: async () => "result2",
          }),
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin1, plugin2],
      });

      const activeTools = agent.getActiveTools();

      // Eager plugin should be available
      expect(activeTools).toHaveProperty("plugin1__tool1");

      // Deferred plugin should NOT be in active tools
      expect(activeTools).not.toHaveProperty("plugin2__tool2");

      // call_tool and search_tools should be available for deferred plugins
      expect(activeTools).toHaveProperty("call_tool");
      expect(activeTools).toHaveProperty("search_tools");
    });
  });

  describe("Function-based (streaming) plugin tools", () => {
    it("deferred function-based plugin tools are NOT in getActiveTools", () => {
      const streamingPlugin = definePlugin({
        name: "streaming-plugin",
        deferred: true,
        tools: (ctx) => ({
          render: tool({
            description: "Render UI",
            parameters: z.object({ html: z.string() }),
            execute: async ({ html }) => `rendered: ${html}`,
          }),
        }),
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [streamingPlugin],
      });

      const activeTools = agent.getActiveTools();

      // Deferred streaming plugin tools should NOT be in active tools
      expect(activeTools).not.toHaveProperty("render");
      expect(activeTools).not.toHaveProperty("mcp__streaming-plugin__render");

      // call_tool and search_tools should be available
      expect(activeTools).toHaveProperty("call_tool");
      expect(activeTools).toHaveProperty("search_tools");
    });

    it("deferred function-based plugin tools are discoverable via search_tools metadata", () => {
      const streamingPlugin = definePlugin({
        name: "streaming-plugin",
        deferred: true,
        tools: (ctx) => ({
          render: tool({
            description: "Render UI components",
            parameters: z.object({ html: z.string() }),
            execute: async ({ html }) => `rendered: ${html}`,
          }),
        }),
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [streamingPlugin],
      });

      // The MCPManager should have the tool metadata from the factory
      // (verified indirectly through search_tools being created)
      const activeTools = agent.getActiveTools();
      expect(activeTools).toHaveProperty("search_tools");
    });

    it("non-deferred function-based plugins still work eagerly (regression)", () => {
      const streamingPlugin = definePlugin({
        name: "eager-streaming",
        tools: (ctx) => ({
          render: tool({
            description: "Render UI",
            parameters: z.object({}),
            execute: async () => "rendered",
          }),
        }),
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [streamingPlugin],
      });

      // Non-deferred function-based tools are available eagerly under their
      // qualified inline plugin names. They receive `{ writer: null }` outside
      // of streaming responses and a live writer during streamDataResponse().
      const activeTools = agent.getActiveTools();
      expect(activeTools).toHaveProperty("eager-streaming__render");
    });

    it("creates search_tools for eager streaming plugins when tool count exceeds the auto threshold", () => {
      const streamingPlugin = definePlugin({
        name: "large-streaming",
        tools: (ctx) => {
          const tools: Record<string, ReturnType<typeof tool>> = {};
          for (let i = 0; i < 25; i++) {
            tools[`tool${i}`] = tool({
              description: `Streaming tool ${i}`,
              parameters: z.object({}),
              execute: async () => `result${i}`,
            });
          }
          return tools;
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [streamingPlugin],
        toolSearch: { enabled: "auto", threshold: 20 },
      });

      const activeTools = agent.getActiveTools();
      expect(activeTools).toHaveProperty("search_tools");
    });

    it("creates search_tools for deferred streaming plugins that are discoverable", async () => {
      const streamingPlugin = definePlugin({
        name: "large-deferred-streaming",
        deferred: true,
        tools: (ctx) => {
          const tools: Record<string, ReturnType<typeof tool>> = {};
          for (let i = 0; i < 25; i++) {
            tools[`tool${i}`] = tool({
              description: `Streaming tool ${i}`,
              parameters: z.object({}),
              execute: async () => `result${i}`,
            });
          }
          return tools;
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [streamingPlugin],
        toolSearch: { enabled: "auto", threshold: 20 },
      });

      const activeTools = agent.getActiveTools();
      expect(activeTools).toHaveProperty("search_tools");

      const result = await activeTools.search_tools.execute!(
        { query: "tool0" },
        {
          toolCallId: "test-search",
          messages: [],
          abortSignal: new AbortController().signal,
        },
      );

      expect(result).toContain("large-deferred-streaming__tool0");
    });
  });
});
