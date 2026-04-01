import { describe, expect, it } from "vitest";
import {
  formatMcpToolName,
  formatPluginToolName,
  isMcpToolName,
  MCP_TOOL_PREFIX,
} from "../src/tool-names.js";

describe("tool name helpers", () => {
  it("formats inline plugin tool names", () => {
    expect(formatPluginToolName("github", "list_issues")).toBe("github__list_issues");
  });

  it("formats external MCP tool names", () => {
    expect(formatMcpToolName("github", "list_issues")).toBe("mcp__github__list_issues");
  });

  it("detects MCP-qualified tool names", () => {
    expect(isMcpToolName("mcp__github__list_issues")).toBe(true);
    expect(isMcpToolName("github__list_issues")).toBe(false);
  });

  it("rejects inline plugin names that would produce an MCP prefix", () => {
    expect(() => formatPluginToolName("mcp", "tool")).toThrow(/reserved/);
    expect(() => formatPluginToolName("mcp_", "tool")).toThrow(/reserved/);
    expect(() => formatPluginToolName(`${MCP_TOOL_PREFIX}shadow`, "tool")).toThrow(/reserved/);
  });
});
