/**
 * E2E tests for proxy tool loading flow.
 *
 * Verifies the full agent-level search → call_tool flow:
 * - Agent's own search_tools discovers deferred tools with schema info
 * - Agent's own call_tool invokes deferred tools and returns results
 * - Tool set remains stable before and after tool invocations
 * - Multiple plugins with different tools all work through the proxy
 * - Per-plugin deferred: true works the same way in eager mode
 */

import { tool } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
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

  describe("agent-level search → call_tool flow", () => {
    it("searches and invokes a deferred tool through the agent's own tools", async () => {
      const plugin = definePlugin({
        name: "stripe",
        tools: {
          create_payment: tool({
            description: "Create a payment intent",
            inputSchema: z.object({
              amount: z.number(),
              currency: z.string(),
            }),
            execute: async ({ amount, currency }) => `Payment created: ${amount} ${currency}`,
          }),
          refund: tool({
            description: "Refund a payment",
            inputSchema: z.object({ id: z.string() }),
            execute: async ({ id }) => `Refunded: ${id}`,
          }),
        },
      });

      const agent = createAgent({
        model: createMockModel(),
        plugins: [plugin],
        pluginLoading: "proxy",
      });

      const activeTools = agent.getActiveTools();

      // Step 1: Search for payment tools using the agent's search_tools
      const searchResult = await activeTools.search_tools.execute!({ query: "payment" }, execOpts);
      expect(searchResult).toContain("create_payment");
      expect(searchResult).toContain("Parameters:");
      expect(searchResult).toContain("amount");

      // Step 2: Invoke via the agent's call_tool
      const callResult = await activeTools.call_tool.execute!(
        {
          tool_name: "mcp__stripe__create_payment",
          arguments: { amount: 42, currency: "usd" },
        },
        execOpts,
      );
      expect(callResult).toContain("Payment created: 42 usd");
    });

    it("invokes multiple tools from different plugins", async () => {
      const stripe = definePlugin({
        name: "stripe",
        tools: {
          charge: tool({
            description: "Charge a card",
            inputSchema: z.object({ amount: z.number() }),
            execute: async ({ amount }) => `Charged $${amount}`,
          }),
        },
      });

      const github = definePlugin({
        name: "github",
        tools: {
          create_issue: tool({
            description: "Create a GitHub issue",
            inputSchema: z.object({ title: z.string() }),
            execute: async ({ title }) => `Issue created: ${title}`,
          }),
        },
      });

      const agent = createAgent({
        model: createMockModel(),
        plugins: [stripe, github],
        pluginLoading: "proxy",
      });

      const activeTools = agent.getActiveTools();

      // Invoke stripe tool
      const chargeResult = await activeTools.call_tool.execute!(
        { tool_name: "mcp__stripe__charge", arguments: { amount: 99 } },
        execOpts,
      );
      expect(chargeResult).toContain("Charged $99");

      // Invoke github tool
      const issueResult = await activeTools.call_tool.execute!(
        { tool_name: "mcp__github__create_issue", arguments: { title: "Fix bug" } },
        execOpts,
      );
      expect(issueResult).toContain("Issue created: Fix bug");
    });

    it("works with per-plugin deferred: true in eager mode", async () => {
      const eagerPlugin = definePlugin({
        name: "core-utils",
        tools: {
          ping: tool({
            description: "Ping",
            inputSchema: z.object({}),
            execute: async () => "pong",
          }),
        },
      });

      const deferredPlugin = definePlugin({
        name: "stripe",
        deferred: true,
        tools: {
          create_payment: tool({
            description: "Create a payment",
            inputSchema: z.object({ amount: z.number() }),
            execute: async ({ amount }) => `Paid ${amount}`,
          }),
        },
      });

      const agent = createAgent({
        model: createMockModel(),
        plugins: [eagerPlugin, deferredPlugin],
        // Default eager mode — only stripe is deferred
      });

      const activeTools = agent.getActiveTools();

      // Eager plugin tool is directly available
      expect(activeTools).toHaveProperty("mcp__core-utils__ping");

      // Deferred tool is NOT in active set but IS callable via proxy
      expect(activeTools).not.toHaveProperty("mcp__stripe__create_payment");
      const result = await activeTools.call_tool.execute!(
        { tool_name: "mcp__stripe__create_payment", arguments: { amount: 100 } },
        execOpts,
      );
      expect(result).toContain("Paid 100");
    });
  });

  describe("tool set stability across invocations", () => {
    it("active tool set is identical before and after call_tool invocations", async () => {
      const plugin = definePlugin({
        name: "stripe",
        tools: {
          create_payment: tool({
            description: "Create a payment",
            inputSchema: z.object({ amount: z.number() }),
            execute: async ({ amount }) => `Paid ${amount}`,
          }),
          refund: tool({
            description: "Refund a payment",
            inputSchema: z.object({ id: z.string() }),
            execute: async ({ id }) => `Refunded ${id}`,
          }),
        },
      });

      const agent = createAgent({
        model: createMockModel(),
        plugins: [plugin],
        pluginLoading: "proxy",
      });

      // Snapshot tool names BEFORE any proxy calls
      const toolNamesBefore = Object.keys(agent.getActiveTools()).sort();

      // Invoke both tools through call_tool
      const activeTools = agent.getActiveTools();
      await activeTools.call_tool.execute!(
        { tool_name: "mcp__stripe__create_payment", arguments: { amount: 1 } },
        execOpts,
      );
      await activeTools.call_tool.execute!(
        { tool_name: "mcp__stripe__refund", arguments: { id: "pi_123" } },
        execOpts,
      );

      // Snapshot tool names AFTER proxy calls
      const toolNamesAfter = Object.keys(agent.getActiveTools()).sort();

      // Tool set must be identical — this is the core value of proxy mode
      expect(toolNamesAfter).toEqual(toolNamesBefore);

      // Plugin tools must still NOT be in the active set
      expect(toolNamesAfter).not.toContain("mcp__stripe__create_payment");
      expect(toolNamesAfter).not.toContain("mcp__stripe__refund");
    });

    it("search_tools does not load tools into the active set", async () => {
      const plugin = definePlugin({
        name: "stripe",
        tools: {
          charge: tool({
            description: "Charge a card",
            inputSchema: z.object({ amount: z.number() }),
            execute: async ({ amount }) => `Charged ${amount}`,
          }),
        },
      });

      const agent = createAgent({
        model: createMockModel(),
        plugins: [plugin],
        pluginLoading: "proxy",
      });

      const toolNamesBefore = Object.keys(agent.getActiveTools()).sort();

      // Search for the tool
      await agent.getActiveTools().search_tools.execute!({ query: "charge" }, execOpts);

      const toolNamesAfter = Object.keys(agent.getActiveTools()).sort();
      expect(toolNamesAfter).toEqual(toolNamesBefore);
      expect(toolNamesAfter).not.toContain("mcp__stripe__charge");
    });
  });

  describe("error handling through agent tools", () => {
    it("call_tool returns error for non-existent tool", async () => {
      const plugin = definePlugin({
        name: "stripe",
        tools: {
          charge: tool({
            description: "Charge",
            inputSchema: z.object({}),
            execute: async () => "ok",
          }),
        },
      });

      const agent = createAgent({
        model: createMockModel(),
        plugins: [plugin],
        pluginLoading: "proxy",
      });

      const result = await agent.getActiveTools().call_tool.execute!(
        { tool_name: "mcp__stripe__nonexistent", arguments: {} },
        execOpts,
      );

      expect(result).toContain("not found");
    });

    it("call_tool surfaces execution errors", async () => {
      const plugin = definePlugin({
        name: "test",
        tools: {
          fail: tool({
            description: "Always fails",
            inputSchema: z.object({}),
            execute: async () => {
              throw new Error("Boom");
            },
          }),
        },
      });

      const agent = createAgent({
        model: createMockModel(),
        plugins: [plugin],
        pluginLoading: "proxy",
      });

      const result = await agent.getActiveTools().call_tool.execute!(
        { tool_name: "mcp__test__fail", arguments: {} },
        execOpts,
      );

      expect(result).toContain("Error executing");
      expect(result).toContain("Boom");
    });
  });
});
