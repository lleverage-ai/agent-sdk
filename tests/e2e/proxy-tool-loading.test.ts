/**
 * E2E tests for proxy tool loading flow.
 *
 * Verifies the full search → call_tool flow:
 * - Tool set stability across agent operations
 * - search_tools discovers deferred tools with schema info
 * - call_tool invokes deferred tools correctly
 */

import { tool } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MCPManager } from "../../src/mcp/manager.js";
import { createCallToolTool } from "../../src/tools/call-tool.js";
import { createSearchToolsTool } from "../../src/tools/search.js";
import { createAgent, definePlugin } from "../../src/index.js";
import { createMockModel, resetMocks } from "../setup.js";

const execOpts = {
  toolCallId: "test",
  messages: [],
  abortSignal: undefined as unknown as AbortSignal,
};

describe("E2E: Proxy Tool Loading", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("search → call_tool flow", () => {
    it("discovers tools via search_tools and invokes via call_tool", async () => {
      // Set up MCP manager with deferred tools
      const manager = new MCPManager();
      manager.registerPluginTools(
        "stripe",
        {
          create_payment: tool({
            description: "Create a payment intent",
            inputSchema: z.object({
              amount: z.number(),
              currency: z.string(),
            }),
            execute: async ({ amount, currency }) =>
              `Payment created: ${amount} ${currency}`,
          }),
          refund: tool({
            description: "Refund a payment",
            inputSchema: z.object({ id: z.string() }),
            execute: async ({ id }) => `Refunded: ${id}`,
          }),
        },
        { autoLoad: false },
      );

      // Create search_tools with schema disclosure (proxy mode config)
      const searchTool = createSearchToolsTool({
        manager,
        autoLoad: false,
        includeSchema: true,
      });

      // Create call_tool
      const callTool = createCallToolTool({ mcpManager: manager });

      // Step 1: Search for payment tools
      const searchResult = await searchTool.execute!(
        { query: "payment" },
        execOpts,
      );
      expect(searchResult).toContain("create_payment");
      expect(searchResult).toContain("[loaded: false]");
      // Schema info should be included
      expect(searchResult).toContain("Parameters:");
      expect(searchResult).toContain("amount");

      // Step 2: Invoke via call_tool
      const callResult = await callTool.execute!(
        {
          tool_name: "mcp__stripe__create_payment",
          arguments: { amount: 42, currency: "usd" },
        },
        execOpts,
      );
      expect(callResult).toContain("Payment created: 42 usd");
    });

    it("search_tools does not auto-load tools in proxy mode config", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools(
        "stripe",
        {
          charge: tool({
            description: "Charge a card",
            inputSchema: z.object({ amount: z.number() }),
            execute: async ({ amount }) => `Charged ${amount}`,
          }),
        },
        { autoLoad: false },
      );

      const searchTool = createSearchToolsTool({
        manager,
        autoLoad: false,
        includeSchema: true,
      });

      // Search should find the tool but NOT load it
      await searchTool.execute!({ query: "charge" }, execOpts);

      // Tool should still not be loaded
      expect(manager.isToolLoaded("mcp__stripe__charge")).toBe(false);
    });
  });

  describe("tool set stability", () => {
    it("active tools do not change after proxy mode setup", () => {
      const plugin = definePlugin({
        name: "stripe",
        tools: {
          create_payment: tool({
            description: "Create a payment",
            parameters: z.object({ amount: z.number() }),
            execute: async ({ amount }) => `Paid ${amount}`,
          }),
          refund: tool({
            description: "Refund",
            parameters: z.object({ id: z.string() }),
            execute: async ({ id }) => `Refunded ${id}`,
          }),
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin],
        pluginLoading: "proxy",
      });

      // Capture tool names
      const toolNames1 = Object.keys(agent.getActiveTools()).sort();

      // Get active tools again — should be identical
      const toolNames2 = Object.keys(agent.getActiveTools()).sort();

      expect(toolNames1).toEqual(toolNames2);

      // Should contain meta tools but no plugin tools
      expect(toolNames1).toContain("call_tool");
      expect(toolNames1).toContain("search_tools");
      expect(toolNames1).not.toContain("mcp__stripe__create_payment");
    });
  });

  describe("call_tool error handling", () => {
    it("returns error for non-existent tool", async () => {
      const manager = new MCPManager();
      const callTool = createCallToolTool({ mcpManager: manager });

      const result = await callTool.execute!(
        { tool_name: "nonexistent", arguments: {} },
        execOpts,
      );

      expect(result).toContain("not found");
    });

    it("handles execution errors gracefully", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools(
        "test",
        {
          fail: tool({
            description: "Always fails",
            inputSchema: z.object({}),
            execute: async () => {
              throw new Error("Boom");
            },
          }),
        },
        { autoLoad: false },
      );

      const callTool = createCallToolTool({ mcpManager: manager });

      const result = await callTool.execute!(
        { tool_name: "mcp__test__fail", arguments: {} },
        execOpts,
      );

      expect(result).toContain("Error executing");
      expect(result).toContain("Boom");
    });
  });
});
