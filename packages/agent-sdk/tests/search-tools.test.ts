import { tool } from "ai";
// tests/search-tools.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MCPManager } from "../src/mcp/manager.js";
import { createSearchToolsTool } from "../src/tools/search.js";

describe("createSearchToolsTool", () => {
  const createTestManager = () => {
    const manager = new MCPManager();
    manager.registerPluginTools("github", {
      list_issues: tool({
        description: "List GitHub issues in a repository",
        inputSchema: z.object({}),
        execute: async () => "issues",
      }),
      create_pr: tool({
        description: "Create a pull request on GitHub",
        inputSchema: z.object({}),
        execute: async () => "pr",
      }),
    });
    manager.registerPluginTools("db", {
      query: tool({
        description: "Execute a database query",
        inputSchema: z.object({}),
        execute: async () => "results",
      }),
    });
    return manager;
  };

  it("creates a valid AI SDK tool", () => {
    const manager = createTestManager();
    const searchTool = createSearchToolsTool({ manager });

    expect(searchTool.description).toContain("Search");
    expect(searchTool.inputSchema).toBeDefined();
    expect(searchTool.execute).toBeDefined();
  });

  it("searches tools by query", async () => {
    const manager = createTestManager();
    const searchTool = createSearchToolsTool({ manager });

    const result = await searchTool.execute!(
      { query: "github" },
      { toolCallId: "test", messages: [], abortSignal: undefined as unknown as AbortSignal },
    );

    expect(result).toContain("mcp__github__list_issues");
    expect(result).toContain("mcp__github__create_pr");
  });

  it("returns formatted results with descriptions", async () => {
    const manager = createTestManager();
    const searchTool = createSearchToolsTool({ manager });

    const result = await searchTool.execute!(
      { query: "query" },
      { toolCallId: "test", messages: [], abortSignal: undefined as unknown as AbortSignal },
    );

    expect(result).toContain("mcp__db__query");
    expect(result).toContain("Execute a database query");
  });

  it("respects maxResults option", async () => {
    const manager = createTestManager();
    const searchTool = createSearchToolsTool({ manager, maxResults: 1 });

    const result = await searchTool.execute!(
      { query: "" },
      { toolCallId: "test", messages: [], abortSignal: undefined as unknown as AbortSignal },
    );

    // Should only have one tool in results
    const toolMatches = (result as string).match(/mcp__/g) || [];
    expect(toolMatches.length).toBe(1);
  });

  it("returns helpful message when no matches", async () => {
    const manager = createTestManager();
    const searchTool = createSearchToolsTool({ manager });

    const result = await searchTool.execute!(
      { query: "nonexistent-xyz" },
      { toolCallId: "test", messages: [], abortSignal: undefined as unknown as AbortSignal },
    );

    expect(result).toContain("No tools found");
  });
});
