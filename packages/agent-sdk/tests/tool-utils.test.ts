import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  definePlugin,
  mcpTools,
  mcpToolsFor,
  pluginTools,
  pluginToolsFor,
  toolsFrom,
  toolsFromPlugin,
} from "../src/index.js";

describe("tool DX helpers", () => {
  it("builds qualified names for inline plugin tools", () => {
    const github = pluginTools("github");

    expect(github("list_issues")).toBe("github__list_issues");
  });

  it("builds typed qualified names for inline plugin tools", () => {
    const github = pluginToolsFor("github", ["list_issues", "create_pr"] as const);

    expect(github.list_issues).toBe("github__list_issues");
    expect(github.create_pr).toBe("github__create_pr");
  });

  it("builds qualified names for external MCP tools", () => {
    const github = mcpTools("github");

    expect(github("list_issues")).toBe("mcp__github__list_issues");
  });

  it("builds typed qualified names for external MCP tools", () => {
    const github = mcpToolsFor("github", ["list_issues", "create_pr"] as const);

    expect(github.list_issues).toBe("mcp__github__list_issues");
    expect(github.create_pr).toBe("mcp__github__create_pr");
  });

  it("extracts plugin-namespaced tool names from inline plugins", () => {
    const plugin = definePlugin({
      name: "github",
      tools: {
        list_issues: tool({
          description: "List issues",
          inputSchema: z.object({}),
          execute: async () => [],
        }),
        create_pr: tool({
          description: "Create PR",
          inputSchema: z.object({}),
          execute: async () => ({ ok: true }),
        }),
      },
    });

    expect(toolsFromPlugin(plugin)).toEqual(["github__list_issues", "github__create_pr"]);
  });

  it("extracts MCP-qualified tool names from external MCP plugins", () => {
    const plugin = definePlugin({
      name: "github",
      mcpServer: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
      },
    });

    expect(toolsFromPlugin(plugin, ["list_issues", "create_pr"])).toEqual([
      "mcp__github__list_issues",
      "mcp__github__create_pr",
    ]);
  });

  it("collects names from mixed tool references", () => {
    const plugin = definePlugin({
      name: "github",
      tools: {
        list_issues: tool({
          description: "List issues",
          inputSchema: z.object({}),
          execute: async () => [],
        }),
      },
    });

    const customTool = tool({
      description: "Custom tool",
      inputSchema: z.object({}),
      execute: async () => "ok",
    });

    expect(
      toolsFrom("read", plugin, { custom_tool: customTool }, [
        pluginTools("github")("list_issues"),
      ]),
    ).toEqual(["read", "github__list_issues", "custom_tool", "github__list_issues"]);
  });

  it("rejects inline plugin names that collide with the MCP namespace", () => {
    expect(() => pluginTools("mcp")("list_issues")).toThrow(/reserved/);
    expect(() => pluginTools("mcp_")("list_issues")).toThrow(/reserved/);
    expect(() => pluginTools("mcp__shadow")("list_issues")).toThrow(/reserved/);
  });

  it("does not swallow inline plugin naming errors in toolsFrom", () => {
    const plugin = definePlugin({
      name: "mcp_",
      tools: {
        list_issues: tool({
          description: "List issues",
          inputSchema: z.object({}),
          execute: async () => [],
        }),
      },
    });

    expect(() => toolsFrom(plugin)).toThrow(/reserved/);
  });
});
