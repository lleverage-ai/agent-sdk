// tests/mcp-types.test.ts
import { describe, expect, it } from "vitest";
import type { MCPToolMetadata } from "../src/mcp/types.js";
import type {
  AgentPlugin,
  HttpMCPServerConfig,
  MCPServerConfig,
  SseMCPServerConfig,
  StdioMCPServerConfig,
} from "../src/types.js";

describe("MCP Server Config Types", () => {
  it("accepts stdio server config", () => {
    const config: StdioMCPServerConfig = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
    };
    expect(config.type).toBe("stdio");
    expect(config.command).toBe("npx");
  });

  it("accepts http server config", () => {
    const config: HttpMCPServerConfig = {
      type: "http",
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer ${TOKEN}" },
    };
    expect(config.type).toBe("http");
    expect(config.url).toBe("https://api.example.com/mcp");
  });

  it("accepts sse server config", () => {
    const config: SseMCPServerConfig = {
      type: "sse",
      url: "https://api.example.com/mcp/sse",
    };
    expect(config.type).toBe("sse");
  });

  it("MCPServerConfig is a union of all types", () => {
    const configs: MCPServerConfig[] = [
      { type: "stdio", command: "npx", args: [] },
      { type: "http", url: "https://example.com" },
      { type: "sse", url: "https://example.com/sse" },
    ];
    expect(configs).toHaveLength(3);
  });
});

describe("Plugin MCP Server Config", () => {
  it("plugin accepts mcpServer config", () => {
    const plugin: AgentPlugin = {
      name: "github",
      description: "GitHub integration",
      mcpServer: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
      },
    };
    expect(plugin.mcpServer?.type).toBe("stdio");
  });

  it("plugin can have both tools and mcpServer", () => {
    const plugin: AgentPlugin = {
      name: "hybrid",
      tools: {},
      mcpServer: {
        type: "http",
        url: "https://example.com/mcp",
      },
    };
    expect(plugin.tools).toBeDefined();
    expect(plugin.mcpServer).toBeDefined();
  });
});

describe("MCP Tool Metadata", () => {
  it("represents tool metadata correctly", () => {
    const metadata: MCPToolMetadata = {
      name: "mcp__github__list_issues",
      description: "List issues in a repository",
      inputSchema: {
        type: "object",
        properties: {
          repo: { type: "string" },
        },
        required: ["repo"],
      },
      source: "github",
      sourceType: "stdio",
    };
    expect(metadata.name).toBe("mcp__github__list_issues");
    expect(metadata.sourceType).toBe("stdio");
  });

  it("supports inline source type", () => {
    const metadata: MCPToolMetadata = {
      name: "mcp__my-plugin__my_tool",
      description: "A custom tool",
      inputSchema: { type: "object", properties: {} },
      source: "my-plugin",
      sourceType: "inline",
    };
    expect(metadata.sourceType).toBe("inline");
  });
});
