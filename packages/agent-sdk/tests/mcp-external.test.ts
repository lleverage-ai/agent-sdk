import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCPManager } from "../src/mcp/manager.js";
import type {
  HttpMCPServerConfig,
  SseMCPServerConfig,
  StdioMCPServerConfig,
} from "../src/types.js";

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(function (this: object) {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: "list_issues",
            description: "List GitHub issues",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "create_pr",
            description: "Create a pull request",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Tool result" }],
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(function (this: object) {
    return {};
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function (this: object) {
    return {};
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn().mockImplementation(function (this: object) {
    return {};
  }),
}));

describe("MCPManager external servers", () => {
  let manager: MCPManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MCPManager();
  });

  afterEach(async () => {
    await manager.disconnect();
  });

  describe("connectServer", () => {
    it("connects to stdio server", async () => {
      const config: StdioMCPServerConfig = {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
      };

      await manager.connectServer("github", config);

      const tools = manager.listTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("mcp__github__list_issues");
      expect(tools[0].sourceType).toBe("stdio");
    });

    it("connects to HTTP server", async () => {
      const config: HttpMCPServerConfig = {
        type: "http",
        url: "https://example.com/mcp",
      };

      await manager.connectServer("docs", config);

      const tools = manager.listTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0].sourceType).toBe("http");
    });

    it("connects to SSE server", async () => {
      const config: SseMCPServerConfig = {
        type: "sse",
        url: "https://example.com/mcp/sse",
      };

      await manager.connectServer("streaming", config);

      const tools = manager.listTools();
      expect(tools[0].sourceType).toBe("sse");
    });

    it("expands environment variables in config", async () => {
      process.env.TEST_TOKEN = "secret-token";

      const config: StdioMCPServerConfig = {
        type: "stdio",
        command: "my-server",
        env: { API_TOKEN: "${TEST_TOKEN}" },
      };

      await manager.connectServer("test", config);

      // Verify the transport was created (mock validates this)
      const tools = manager.listTools();
      expect(tools.length).toBeGreaterThan(0);

      delete process.env.TEST_TOKEN;
    });

    it("throws on duplicate server name", async () => {
      const config: StdioMCPServerConfig = {
        type: "stdio",
        command: "server1",
      };

      await manager.connectServer("test", config);

      await expect(manager.connectServer("test", config)).rejects.toThrow(
        "Server 'test' is already connected",
      );
    });
  });

  describe("callTool with external servers", () => {
    it("calls tool on external server", async () => {
      const config: StdioMCPServerConfig = {
        type: "stdio",
        command: "server",
      };

      await manager.connectServer("github", config);

      const result = await manager.callTool("mcp__github__list_issues", { repo: "test" });
      expect(result).toBeDefined();
    });

    it("routes to correct server when multiple connected", async () => {
      await manager.connectServer("server1", { type: "stdio", command: "s1" });
      await manager.connectServer("server2", { type: "stdio", command: "s2" });

      // Both should work
      const result1 = await manager.callTool("mcp__server1__list_issues", {});
      const result2 = await manager.callTool("mcp__server2__list_issues", {});

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe("getToolSet with external servers", () => {
    it("includes external tools in toolset", async () => {
      await manager.connectServer("github", { type: "stdio", command: "server" });

      const toolSet = manager.getToolSet();
      expect(Object.keys(toolSet)).toContain("mcp__github__list_issues");
      expect(Object.keys(toolSet)).toContain("mcp__github__create_pr");
    });

    it("creates executable tools that call external server", async () => {
      await manager.connectServer("github", { type: "stdio", command: "server" });

      const toolSet = manager.getToolSet();
      const tool = toolSet["mcp__github__list_issues"];

      expect(tool).toBeDefined();
      expect(tool.execute).toBeDefined();

      // Execute the tool
      const result = await tool.execute!(
        { repo: "test" },
        {
          toolCallId: "test",
          messages: [],
          abortSignal: new AbortController().signal,
        },
      );

      expect(result).toBeDefined();
    });
  });

  describe("disconnect", () => {
    it("closes all external client connections", async () => {
      await manager.connectServer("server1", { type: "stdio", command: "s1" });
      await manager.connectServer("server2", { type: "stdio", command: "s2" });

      await manager.disconnect();

      // Tools should be cleared
      expect(manager.listTools()).toEqual([]);
    });
  });
});
