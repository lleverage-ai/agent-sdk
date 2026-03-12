import { tool } from "ai";
// tests/mcp-virtual-server.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { VirtualMCPServer } from "../src/mcp/virtual-server.js";

describe("VirtualMCPServer", () => {
  const testTools = {
    greet: tool({
      description: "Greet someone",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => `Hello, ${name}!`,
    }),
    add: tool({
      description: "Add two numbers",
      inputSchema: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: async ({ a, b }) => `${a + b}`,
    }),
  };

  it("creates server with correct name", () => {
    const server = new VirtualMCPServer("my-plugin", testTools);
    expect(server.name).toBe("my-plugin");
  });

  it("generates plugin-namespaced tool names", () => {
    const server = new VirtualMCPServer("my-plugin", testTools);
    const metadata = server.getToolMetadata();

    expect(metadata).toHaveLength(2);
    expect(metadata[0].name).toBe("my-plugin__greet");
    expect(metadata[1].name).toBe("my-plugin__add");
  });

  it("includes descriptions in metadata", () => {
    const server = new VirtualMCPServer("my-plugin", testTools);
    const metadata = server.getToolMetadata();

    const greetMeta = metadata.find((m) => m.name === "my-plugin__greet");
    expect(greetMeta?.description).toBe("Greet someone");
  });

  it("marks source type as inline", () => {
    const server = new VirtualMCPServer("my-plugin", testTools);
    const metadata = server.getToolMetadata();

    expect(metadata[0].sourceType).toBe("inline");
  });

  it("executes tools correctly", async () => {
    const server = new VirtualMCPServer("my-plugin", testTools);
    const result = await server.callTool("greet", { name: "World" });
    expect(result).toBe("Hello, World!");
  });

  it("throws for unknown tool", async () => {
    const server = new VirtualMCPServer("my-plugin", testTools);
    await expect(server.callTool("unknown", {})).rejects.toThrow("Tool 'unknown' not found");
  });

  it("returns AI SDK compatible tools with plugin-namespaced names", () => {
    const server = new VirtualMCPServer("my-plugin", testTools);
    const tools = server.getToolSet();

    expect(Object.keys(tools)).toEqual(["my-plugin__greet", "my-plugin__add"]);
  });

  it("checks if tool exists", () => {
    const server = new VirtualMCPServer("my-plugin", testTools);
    expect(server.hasTool("greet")).toBe(true);
    expect(server.hasTool("unknown")).toBe(false);
  });

  it("returns list of tool names", () => {
    const server = new VirtualMCPServer("my-plugin", testTools);
    expect(server.getToolNames()).toEqual(["greet", "add"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns and falls back to an empty schema when schema conversion fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = new VirtualMCPServer("my-plugin", {
      broken: {
        description: "Broken tool",
        inputSchema: 123 as never,
        execute: async () => "ok",
      } as never,
    });

    const [metadata] = server.getToolMetadata();

    expect(metadata.inputSchema).toEqual({
      type: "object",
      properties: {},
    });
    expect(warn).toHaveBeenCalledWith(
      "[VirtualMCPServer] Failed to convert input schema for my-plugin__broken; using an empty object schema instead.",
      expect.anything(),
    );
  });
});
