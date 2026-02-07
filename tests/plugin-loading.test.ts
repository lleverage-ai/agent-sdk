/**
 * Tests for plugin loading modes and tool availability.
 *
 * These tests verify that plugins are loaded correctly based on:
 * - pluginLoading mode (eager, lazy, explicit)
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
      expect(activeTools).toHaveProperty("mcp__test-plugin__tool1");
      expect(activeTools).toHaveProperty("mcp__test-plugin__tool2");
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
      expect(activeTools).toHaveProperty("mcp__large-plugin__tool0");

      // search_tools is created for auto-discovery (>20 tools)
      expect(activeTools).toHaveProperty("search_tools");
    });
  });

  describe("Explicit eager mode", () => {
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
      expect(activeTools).toHaveProperty("mcp__large-plugin__tool0");
      expect(activeTools).toHaveProperty("mcp__large-plugin__tool24");
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
      expect(activeTools).toHaveProperty("mcp__test-plugin__tool1");
      // search_tools should NOT be present
      expect(activeTools).not.toHaveProperty("search_tools");
    });
  });

  describe("Lazy mode", () => {
    it("registers tools in registry but doesn't load them", () => {
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
        pluginLoading: "lazy",
      });

      // Tools should NOT be immediately available
      const activeTools = agent.getActiveTools();
      expect(activeTools).not.toHaveProperty("mcp__test-plugin__tool1");

      // But use_tools should be available for loading them
      expect(activeTools).toHaveProperty("use_tools");
    });

    it("loads tools on demand via loadTools()", () => {
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
        pluginLoading: "lazy",
      });

      // Load the tool
      const result = agent.loadTools(["tool1"]);
      expect(result.loaded).toContain("tool1");
      expect(result.notFound).toEqual([]);

      // Now it should be available
      const activeTools = agent.getActiveTools();
      expect(activeTools).toHaveProperty("tool1");
    });
  });

  describe("Explicit mode", () => {
    it("does not auto-register plugin tools", () => {
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
        pluginLoading: "explicit",
      });

      // Tools should NOT be available
      const activeTools = agent.getActiveTools();
      expect(activeTools).not.toHaveProperty("mcp__test-plugin__tool1");
      expect(activeTools).not.toHaveProperty("use_tools");
      expect(activeTools).not.toHaveProperty("search_tools");
    });
  });

  describe("Preload plugins", () => {
    it("loads preloaded plugins even in lazy mode", () => {
      const plugin1 = definePlugin({
        name: "lazy-plugin",
        tools: {
          tool1: tool({
            description: "Lazy tool",
            parameters: z.object({}),
            execute: async () => "lazy",
          }),
        },
      });

      const plugin2 = definePlugin({
        name: "eager-plugin",
        tools: {
          tool2: tool({
            description: "Eager tool",
            parameters: z.object({}),
            execute: async () => "eager",
          }),
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin1, plugin2],
        pluginLoading: "lazy",
        preloadPlugins: ["eager-plugin"],
      });

      const activeTools = agent.getActiveTools();

      // Preloaded plugin should be available
      expect(activeTools).toHaveProperty("mcp__eager-plugin__tool2");

      // Non-preloaded plugin should NOT be available
      expect(activeTools).not.toHaveProperty("mcp__lazy-plugin__tool1");
    });

    it("loads preloaded plugins with explicit deferred loading", () => {
      // Create many tools
      const tools: Record<string, ReturnType<typeof tool>> = {};
      for (let i = 0; i < 25; i++) {
        tools[`tool${i}`] = tool({
          description: `Tool ${i}`,
          parameters: z.object({}),
          execute: async () => `result${i}`,
        });
      }

      const largePlugin = definePlugin({
        name: "large-plugin",
        tools,
      });

      const criticalPlugin = definePlugin({
        name: "critical-plugin",
        tools: {
          criticalTool: tool({
            description: "Critical tool",
            parameters: z.object({}),
            execute: async () => "critical",
          }),
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [largePlugin, criticalPlugin],
        preloadPlugins: ["critical-plugin"],
        toolSearch: { enabled: "always" }, // Explicitly enable deferred loading
      });

      const activeTools = agent.getActiveTools();

      // Critical plugin should be loaded (preloaded)
      expect(activeTools).toHaveProperty("mcp__critical-plugin__criticalTool");

      // Large plugin tools should NOT be loaded (deferred)
      expect(activeTools).not.toHaveProperty("mcp__large-plugin__tool0");
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
      expect(activeTools).toHaveProperty("mcp__large-plugin__tool0");
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
      expect(activeTools).not.toHaveProperty("mcp__small-plugin__tool1");
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
      expect(activeTools).toHaveProperty("mcp__medium-plugin__tool0");

      // search_tools is created because count > custom threshold
      expect(activeTools).toHaveProperty("search_tools");
    });
  });

  describe("Mixed configurations", () => {
    it("handles multiple plugins with different loading strategies", () => {
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
        preloadPlugins: ["plugin1"],
        pluginLoading: "lazy",
      });

      const activeTools = agent.getActiveTools();

      // Preloaded plugin should be available
      expect(activeTools).toHaveProperty("mcp__plugin1__tool1");

      // Non-preloaded plugin should NOT be available
      expect(activeTools).not.toHaveProperty("mcp__plugin2__tool2");

      // use_tools should be available for lazy loading
      expect(activeTools).toHaveProperty("use_tools");
    });
  });
});
