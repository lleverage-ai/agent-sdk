import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MCPManager } from "../src/mcp/manager.js";
import { createCallToolTool } from "../src/tools/call-tool.js";

const execOpts = {
  toolCallId: "test",
  messages: [],
  abortSignal: undefined as unknown as AbortSignal,
};

describe("createCallToolTool", () => {
  describe("with MCPManager", () => {
    const createTestManager = () => {
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
            execute: async ({ amount, currency }) => `Payment created: ${amount} ${currency}`,
          }),
          refund: tool({
            description: "Refund a payment",
            inputSchema: z.object({ id: z.string() }),
            execute: async ({ id }) => `Refunded: ${id}`,
          }),
        },
        { autoLoad: false },
      );
      return manager;
    };

    it("invokes an MCP tool by name", async () => {
      const manager = createTestManager();
      const callTool = createCallToolTool({ mcpManager: manager });

      const result = await callTool.execute!(
        {
          tool_name: "mcp__stripe__create_payment",
          arguments: { amount: 100, currency: "usd" },
        },
        execOpts,
      );

      expect(result).toContain("Payment created: 100 usd");
    });

    it("returns error for non-existent tool", async () => {
      const manager = createTestManager();
      const callTool = createCallToolTool({ mcpManager: manager });

      const result = await callTool.execute!(
        {
          tool_name: "mcp__stripe__nonexistent",
          arguments: {},
        },
        execOpts,
      );

      expect(result).toContain("not found");
    });

    it("handles tool execution errors gracefully", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools(
        "failing",
        {
          fail_tool: tool({
            description: "Always fails",
            inputSchema: z.object({}),
            execute: async () => {
              throw new Error("Intentional failure");
            },
          }),
        },
        { autoLoad: false },
      );

      const callTool = createCallToolTool({ mcpManager: manager });
      const result = await callTool.execute!(
        { tool_name: "mcp__failing__fail_tool", arguments: {} },
        execOpts,
      );

      expect(result).toContain("Error executing");
      expect(result).toContain("Intentional failure");
    });
  });

  describe("hook callbacks", () => {
    it("fires onBeforeCall with proxied tool name", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools(
        "test",
        {
          my_tool: tool({
            description: "Test",
            inputSchema: z.object({}),
            execute: async () => "ok",
          }),
        },
        { autoLoad: false },
      );

      const onBeforeCall = vi.fn();
      const callTool = createCallToolTool({
        mcpManager: manager,
        onBeforeCall,
      });

      await callTool.execute!({ tool_name: "mcp__test__my_tool", arguments: {} }, execOpts);

      expect(onBeforeCall).toHaveBeenCalledWith("mcp__test__my_tool", {});
    });

    it("fires onAfterCall with result", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools(
        "test",
        {
          my_tool: tool({
            description: "Test",
            inputSchema: z.object({}),
            execute: async () => "result-value",
          }),
        },
        { autoLoad: false },
      );

      const onAfterCall = vi.fn();
      const callTool = createCallToolTool({
        mcpManager: manager,
        onAfterCall,
      });

      await callTool.execute!({ tool_name: "mcp__test__my_tool", arguments: {} }, execOpts);

      expect(onAfterCall).toHaveBeenCalledWith("mcp__test__my_tool", {}, "result-value");
    });
  });

  describe("with streaming factory-backed deferred tools", () => {
    it("executes a streaming-factory-backed deferred tool successfully", async () => {
      const manager = new MCPManager();
      const factory = (ctx: { writer: unknown }) => ({
        render: tool({
          description: "Render UI",
          inputSchema: z.object({ html: z.string() }),
          execute: async ({ html }: { html: string }) =>
            `rendered(writer=${ctx.writer !== null}): ${html}`,
        }),
      });

      manager.registerStreamingPluginTools("ui", factory, { autoLoad: false });

      const callTool = createCallToolTool({ mcpManager: manager });

      // Call without streaming context — factory gets { writer: null }
      const result = await callTool.execute!(
        {
          tool_name: "mcp__ui__render",
          arguments: { html: "<p>hello</p>" },
        },
        execOpts,
      );

      expect(result).toContain("rendered(writer=false): <p>hello</p>");
    });

    it("passes streaming context to factory when available", async () => {
      const manager = new MCPManager();
      const factory = (ctx: { writer: unknown }) => ({
        render: tool({
          description: "Render UI",
          inputSchema: z.object({ html: z.string() }),
          execute: async ({ html }: { html: string }) =>
            `rendered(writer=${ctx.writer !== null}): ${html}`,
        }),
      });

      manager.registerStreamingPluginTools("ui", factory, { autoLoad: false });

      const fakeWriter = { write: () => {} };
      const callTool = createCallToolTool({ mcpManager: manager });

      const result = await callTool.execute!(
        {
          tool_name: "mcp__ui__render",
          arguments: { html: "<p>world</p>" },
        },
        {
          ...execOpts,
          streamingContext: { writer: fakeWriter as never },
        } as typeof execOpts & { streamingContext: { writer: unknown } },
      );

      expect(result).toContain("rendered(writer=true): <p>world</p>");
    });

    it("keeps streaming contexts isolated per execution", async () => {
      const manager = new MCPManager();
      const factory = (ctx: { writer: unknown }) => ({
        render: tool({
          description: "Render UI",
          inputSchema: z.object({}),
          execute: async () => (ctx.writer as { id: string } | null)?.id ?? "null",
        }),
      });

      manager.registerStreamingPluginTools("ui", factory, { autoLoad: false });

      const callTool = createCallToolTool({ mcpManager: manager });

      const requestA = callTool.execute!({ tool_name: "mcp__ui__render", arguments: {} }, {
        ...execOpts,
        streamingContext: { writer: { id: "A" } as never },
      } as typeof execOpts & { streamingContext: { writer: unknown } });
      const requestB = callTool.execute!({ tool_name: "mcp__ui__render", arguments: {} }, {
        ...execOpts,
        streamingContext: { writer: { id: "B" } as never },
      } as typeof execOpts & { streamingContext: { writer: unknown } });

      await expect(requestA).resolves.toBe("A");
      await expect(requestB).resolves.toBe("B");
    });
  });

  it("has correct description and schema", () => {
    const callTool = createCallToolTool({});

    expect(callTool.description).toContain("Call a tool by name");
    expect(callTool.inputSchema).toBeDefined();
  });
});
