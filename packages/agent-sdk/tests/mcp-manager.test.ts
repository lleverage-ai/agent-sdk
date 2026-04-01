import { tool } from "ai";
// tests/mcp-manager.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MCPManager } from "../src/mcp/manager.js";

describe("MCPManager", () => {
  let manager: MCPManager;

  beforeEach(() => {
    manager = new MCPManager();
  });

  describe("registerPluginTools", () => {
    it("registers plugin tools with plugin-namespaced names", () => {
      const tools = {
        greet: tool({
          description: "Greet someone",
          inputSchema: z.object({ name: z.string() }),
          execute: async ({ name }) => `Hello, ${name}!`,
        }),
      };

      manager.registerPluginTools("test-plugin", tools);

      const metadata = manager.listTools();
      expect(metadata).toHaveLength(1);
      expect(metadata[0].name).toBe("test-plugin__greet");
    });

    it("registers multiple plugins", () => {
      manager.registerPluginTools("plugin-a", {
        tool1: tool({
          description: "Tool 1",
          inputSchema: z.object({}),
          execute: async () => "result1",
        }),
      });

      manager.registerPluginTools("plugin-b", {
        tool2: tool({
          description: "Tool 2",
          inputSchema: z.object({}),
          execute: async () => "result2",
        }),
      });

      const metadata = manager.listTools();
      expect(metadata).toHaveLength(2);
    });
  });

  describe("listTools", () => {
    it("returns empty array when no tools registered", () => {
      expect(manager.listTools()).toEqual([]);
    });
  });

  describe("searchTools", () => {
    beforeEach(() => {
      manager.registerPluginTools("github", {
        list_issues: tool({
          description: "List GitHub issues",
          inputSchema: z.object({}),
          execute: async () => "issues",
        }),
        create_pr: tool({
          description: "Create a pull request",
          inputSchema: z.object({}),
          execute: async () => "pr",
        }),
      });
      manager.registerPluginTools("db", {
        query: tool({
          description: "Query the database",
          inputSchema: z.object({}),
          execute: async () => "results",
        }),
      });
    });

    it("searches by description", () => {
      const results = manager.searchTools("issues");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("github__list_issues");
    });

    it("searches by tool name", () => {
      const results = manager.searchTools("query");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("db__query");
    });

    it("returns multiple matches", () => {
      const results = manager.searchTools("github");
      expect(results).toHaveLength(2);
    });

    it("respects limit parameter", () => {
      const results = manager.searchTools("", 1);
      expect(results).toHaveLength(1);
    });

    it("returns empty array for negative limit", () => {
      const noQueryResults = manager.searchTools("", -1);
      const queryResults = manager.searchTools("github", -1);

      expect(noQueryResults).toEqual([]);
      expect(queryResults).toEqual([]);
    });

    it("ranks tool-name intent higher than description-only matches", () => {
      const localManager = new MCPManager();
      localManager.registerPluginTools("payments", {
        create_payment: tool({
          description: "Create a payment intent",
          inputSchema: z.object({ amount: z.number() }),
          execute: async () => "ok",
        }),
      });
      localManager.registerPluginTools("audit", {
        write_log: tool({
          description: "Write audit entries for create payment operations",
          inputSchema: z.object({ message: z.string() }),
          execute: async () => "ok",
        }),
      });

      const [top] = localManager.searchTools("create payment", 2);
      expect(top?.name).toBe("payments__create_payment");
    });

    it("searches by schema property names", () => {
      const localManager = new MCPManager();
      localManager.registerPluginTools("repos", {
        mirror: tool({
          description: "Mirror data",
          inputSchema: z.object({
            owner: z.string(),
            repository: z.string(),
          }),
          execute: async () => "ok",
        }),
      });

      const results = localManager.searchTools("repository");
      expect(results[0]?.name).toBe("repos__mirror");
    });

    it("matches typo queries with fuzzy fallback", () => {
      const localManager = new MCPManager();
      localManager.registerPluginTools("payments", {
        create_payment: tool({
          description: "Create a payment intent",
          inputSchema: z.object({ amount: z.number() }),
          execute: async () => "ok",
        }),
      });

      const results = localManager.searchTools("paymnt");
      expect(results[0]?.name).toBe("payments__create_payment");
    });
  });

  describe("getToolSet", () => {
    it("returns AI SDK compatible tool set", () => {
      manager.registerPluginTools("test", {
        my_tool: tool({
          description: "Test tool",
          inputSchema: z.object({}),
          execute: async () => "result",
        }),
      });

      const toolSet = manager.getToolSet();
      expect(Object.keys(toolSet)).toContain("test__my_tool");
    });

    it("filters by tool names", () => {
      manager.registerPluginTools("test", {
        tool_a: tool({
          description: "Tool A",
          inputSchema: z.object({}),
          execute: async () => "a",
        }),
        tool_b: tool({
          description: "Tool B",
          inputSchema: z.object({}),
          execute: async () => "b",
        }),
      });

      const toolSet = manager.getToolSet(["test__tool_a"]);
      expect(Object.keys(toolSet)).toEqual(["test__tool_a"]);
    });
  });

  describe("callTool", () => {
    it("calls tool and returns result", async () => {
      manager.registerPluginTools("test", {
        greet: tool({
          description: "Greet",
          inputSchema: z.object({ name: z.string() }),
          execute: async ({ name }) => `Hello, ${name}!`,
        }),
      });

      const result = await manager.callTool("test__greet", { name: "World" });
      expect(result).toBe("Hello, World!");
    });

    it("routes inline plugin tools to virtual servers only", async () => {
      const externalCall = vi.fn();
      manager.registerPluginTools("test", {
        greet: tool({
          description: "Greet",
          inputSchema: z.object({ name: z.string() }),
          execute: async ({ name }) => `Hello, ${name}!`,
        }),
      });

      manager["externalClients"].set("test", {
        client: { callTool: externalCall },
        tools: [{ name: "mcp__test__greet" }],
        config: {},
      } as never);

      const result = await manager.callTool("test__greet", { name: "World" });
      expect(result).toBe("Hello, World!");
      expect(externalCall).not.toHaveBeenCalled();
    });

    it("routes external MCP tools to connected clients only", async () => {
      const externalCall = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "remote ok" }],
      });

      manager.registerPluginTools("test", {
        greet: tool({
          description: "Greet",
          inputSchema: z.object({}),
          execute: async () => "local ok",
        }),
      });

      manager["externalClients"].set("test", {
        client: { callTool: externalCall },
        tools: [{ name: "mcp__test__greet" }],
        config: {},
      } as never);

      const result = await manager.callTool("mcp__test__greet", {});
      expect(result).toBe("remote ok");
      expect(externalCall).toHaveBeenCalledWith({
        name: "greet",
        arguments: {},
      });
    });

    it("throws for unknown tool", async () => {
      await expect(manager.callTool("unknown__tool", {})).rejects.toThrow();
    });
  });

  describe("loadTools", () => {
    it("returns loaded tools when they exist (deferred loading)", () => {
      // Register with autoLoad: false to test deferred loading
      manager.registerPluginTools(
        "test",
        {
          tool_a: tool({
            description: "A",
            inputSchema: z.object({}),
            execute: async () => "a",
          }),
        },
        { autoLoad: false },
      );
      const result = manager.loadTools(["test__tool_a"]);
      expect(result.loaded).toEqual(["test__tool_a"]);
      expect(result.alreadyLoaded).toEqual([]);
      expect(result.notFound).toEqual([]);
    });

    it("returns alreadyLoaded for auto-loaded tools", () => {
      // Register with default autoLoad: true
      manager.registerPluginTools("test", {
        tool_a: tool({
          description: "A",
          inputSchema: z.object({}),
          execute: async () => "a",
        }),
      });
      const result = manager.loadTools(["test__tool_a"]);
      // Tool was auto-loaded, so it should be in alreadyLoaded
      expect(result.loaded).toEqual([]);
      expect(result.alreadyLoaded).toEqual(["test__tool_a"]);
      expect(result.notFound).toEqual([]);
    });

    it("returns notFound for missing tools", () => {
      const result = manager.loadTools(["unknown__tool"]);
      expect(result.loaded).toEqual([]);
      expect(result.alreadyLoaded).toEqual([]);
      expect(result.notFound).toEqual(["unknown__tool"]);
    });
  });

  describe("registerStreamingPluginTools", () => {
    it("stores factory and creates virtual server for metadata", () => {
      const factory = (ctx: { writer: unknown }) => ({
        render: tool({
          description: "Render UI",
          inputSchema: z.object({ html: z.string() }),
          execute: async ({ html }: { html: string }) => {
            if (ctx.writer) {
              // Would stream to writer
            }
            return `rendered: ${html}`;
          },
        }),
      });

      manager.registerStreamingPluginTools("ui", factory);

      // Metadata should be available for search
      const metadata = manager.listTools();
      expect(metadata).toHaveLength(1);
      expect(metadata[0].name).toBe("ui__render");
      expect(metadata[0].description).toBe("Render UI");

      // Factory should be tracked
      expect(manager.hasStreamingFactory("ui")).toBe(true);
      expect(manager.hasStreamingFactory("nonexistent")).toBe(false);
    });

    it("deferred streaming tools are not in getToolSet by default", () => {
      const factory = () => ({
        render: tool({
          description: "Render",
          inputSchema: z.object({}),
          execute: async () => "ok",
        }),
      });

      manager.registerStreamingPluginTools("ui", factory, { autoLoad: false });

      const toolSet = manager.getToolSet();
      expect(Object.keys(toolSet)).not.toContain("mcp__ui__render");
    });

    it("eager streaming tools appear in getToolSet", () => {
      const factory = () => ({
        render: tool({
          description: "Render",
          inputSchema: z.object({}),
          execute: async () => "ok",
        }),
      });

      manager.registerStreamingPluginTools("ui", factory, { autoLoad: true });

      const toolSet = manager.getToolSet();
      expect(Object.keys(toolSet)).toContain("ui__render");
    });
  });

  describe("callTool with streaming factory", () => {
    it("uses the request-local streaming context", async () => {
      const factory = (ctx: { writer: unknown }) => {
        return {
          render: tool({
            description: "Render",
            inputSchema: z.object({ html: z.string() }),
            execute: async ({ html }: { html: string }) =>
              `rendered(writer=${ctx.writer !== null}): ${html}`,
          }),
        };
      };

      manager.registerStreamingPluginTools("ui", factory);

      // Without streaming context: callTool uses { writer: null }
      const result1 = await manager.callTool("ui__render", { html: "<p>hello</p>" });
      expect(result1).toBe("rendered(writer=false): <p>hello</p>");

      // With streaming context: callTool uses the explicit request-local context
      const fakeWriter = { write: () => {} };
      const result2 = await manager.callTool(
        "ui__render",
        { html: "<p>world</p>" },
        {
          streamingContext: { writer: fakeWriter as never },
        },
      );
      expect(result2).toBe("rendered(writer=true): <p>world</p>");
    });

    it("does not leak streaming context between requests", async () => {
      const factory = (ctx: { writer: unknown }) => ({
        render: tool({
          description: "Render",
          inputSchema: z.object({}),
          execute: async () => (ctx.writer as { id: string } | null)?.id ?? "null",
        }),
      });

      manager.registerStreamingPluginTools("ui", factory);

      const requestA = manager.callTool(
        "ui__render",
        {},
        {
          streamingContext: { writer: { id: "A" } as never },
        },
      );
      const requestB = manager.callTool(
        "ui__render",
        {},
        {
          streamingContext: { writer: { id: "B" } as never },
        },
      );

      await expect(requestA).resolves.toBe("A");
      await expect(requestB).resolves.toBe("B");
    });
  });

  describe("getToolSet with streaming factory and context", () => {
    it("returns live factory tools when a request-local context is provided", async () => {
      let factoryCallCount = 0;
      const factory = (ctx: { writer: unknown }) => {
        factoryCallCount++;
        return {
          render: tool({
            description: "Render",
            inputSchema: z.object({}),
            execute: async () => `writer=${(ctx.writer as { id?: string } | null)?.id ?? "null"}`,
          }),
        };
      };

      manager.registerStreamingPluginTools("ui", factory, { autoLoad: true });

      // Reset count (registration called factory once with null)
      factoryCallCount = 0;

      // Without context: uses schema tools from virtual server
      const toolSet1 = manager.getToolSet();
      expect(toolSet1).toHaveProperty("ui__render");

      // With context: invokes factory with live context
      const toolSet2 = manager.getToolSet(undefined, { writer: { id: "ctx" } as never });
      expect(toolSet2).toHaveProperty("ui__render");
      expect(factoryCallCount).toBeGreaterThanOrEqual(1);
      await expect(toolSet2.ui__render.execute?.({}, undefined as never)).resolves.toBe(
        "writer=ctx",
      );
    });
  });

  describe("disconnect", () => {
    it("clears all virtual servers", async () => {
      manager.registerPluginTools("test", {
        my_tool: tool({
          description: "Test",
          inputSchema: z.object({}),
          execute: async () => "r",
        }),
      });
      expect(manager.listTools()).toHaveLength(1);
      await manager.disconnect();
      expect(manager.listTools()).toEqual([]);
    });

    it("clears streaming factories", async () => {
      const factory = () => ({
        render: tool({
          description: "Render",
          inputSchema: z.object({}),
          execute: async () => "ok",
        }),
      });

      manager.registerStreamingPluginTools("ui", factory);

      expect(manager.hasStreamingFactory("ui")).toBe(true);

      await manager.disconnect();

      expect(manager.hasStreamingFactory("ui")).toBe(false);
      expect(manager.listTools()).toEqual([]);
    });
  });
});
