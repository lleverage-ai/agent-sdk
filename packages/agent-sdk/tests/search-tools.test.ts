import { jsonSchema, tool } from "ai";
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

    expect(result).toContain("github__list_issues");
    expect(result).toContain("github__create_pr");
  });

  it("returns formatted results with descriptions", async () => {
    const manager = createTestManager();
    const searchTool = createSearchToolsTool({ manager });

    const result = await searchTool.execute!(
      { query: "query" },
      { toolCallId: "test", messages: [], abortSignal: undefined as unknown as AbortSignal },
    );

    expect(result).toContain("db__query");
    expect(result).toContain("Execute a database query");
  });

  it("respects maxResults option", async () => {
    const manager = createTestManager();
    const searchTool = createSearchToolsTool({ manager, maxResults: 1 });

    const result = await searchTool.execute!(
      { query: "" },
      { toolCallId: "test", messages: [], abortSignal: undefined as unknown as AbortSignal },
    );

    const listedTools = (result as string)
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).split(":")[0]?.trim());

    expect(listedTools).toHaveLength(1);
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

  describe("Parameters line with includeSchema", () => {
    const execOptions = {
      toolCallId: "test",
      messages: [],
      abortSignal: undefined as unknown as AbortSignal,
    };

    const parametersFor = async (manager: MCPManager, query: string): Promise<string> => {
      const searchTool = createSearchToolsTool({ manager, includeSchema: true });
      const result = (await searchTool.execute!({ query }, execOptions)) as string;
      const line = result.split("\n").find((l) => l.trimStart().startsWith("Parameters: "));
      expect(line).toBeDefined();
      return line!.trimStart().slice("Parameters: ".length);
    };

    const bytes = (text: string) => new TextEncoder().encode(text).length;

    it("prints enum values inline (create-metric valueType)", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("lleverage", {
        "create-metric": tool({
          description: "Creates a custom metric definition",
          inputSchema: z.object({
            name: z.string().min(1),
            valueType: z.enum(["ENUM", "NUMBER", "BOOLEAN"]),
            enumValues: z.array(z.string()).optional(),
            unit: z.string().optional(),
          }),
          execute: async () => "ok",
        }),
      });

      expect(await parametersFor(manager, "create-metric")).toBe(
        '{ name: string, valueType: "ENUM"|"NUMBER"|"BOOLEAN", enumValues?: string[], unit?: string }',
      );
    });

    it("prints one level of nested object keys (update-request-view filters)", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("lleverage", {
        "update-request-view": tool({
          description: "Updates a saved request view",
          inputSchema: z.object({
            viewId: z.string(),
            filters: z
              .object({
                workflowId: z.string().optional(),
                status: z.enum(["OPEN", "CLOSED"]).optional(),
                range: z.object({ from: z.string(), to: z.string() }).optional(),
              })
              .optional(),
          }),
          execute: async () => "ok",
        }),
      });

      expect(await parametersFor(manager, "update-request-view")).toBe(
        '{ viewId: string, filters?: { workflowId?: string, status?: "OPEN"|"CLOSED", range?: object } }',
      );
    });

    it("prints enums from a plain JSON Schema (gmail_create-draft bodyType)", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("gmail", {
        "create-draft": tool({
          description: "Creates a Gmail draft",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: {
              to: { type: "array", items: { type: "string" } },
              subject: { type: "string" },
              body: { type: "string" },
              bodyType: { type: "string", enum: ["Text", "HTML"] },
            },
            required: ["to", "subject", "body"],
          }),
          execute: async () => "ok",
        }),
      });

      expect(await parametersFor(manager, "create-draft")).toBe(
        '{ to: string[], subject: string, body: string, bodyType?: "Text"|"HTML" }',
      );
    });

    it("prints arrays of enums with their values", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("notify", {
        send: tool({
          description: "Sends a notification",
          inputSchema: z.object({
            channels: z.array(z.enum(["email", "slack"])),
            workflowIds: z.array(z.string()).optional(),
          }),
          execute: async () => "ok",
        }),
      });

      expect(await parametersFor(manager, "notify")).toBe(
        '{ channels: ("email"|"slack")[], workflowIds?: string[] }',
      );
    });

    it("prints nullable fields as T|null and const as its literal", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("zodschema", {
        update: tool({
          description: "Updates a record",
          inputSchema: z.object({
            kind: z.literal("record"),
            note: z.string().nullable(),
            size: z.enum(["low", "high"]).nullable().optional(),
          }),
          execute: async () => "ok",
        }),
      });
      manager.registerPluginTools("jsonschema", {
        update: tool({
          description: "Updates a record",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: {
              note: { anyOf: [{ type: "string" }, { type: "null" }] },
              count: { type: ["integer", "null"] },
            },
            required: ["note"],
          }),
          execute: async () => "ok",
        }),
      });

      expect(await parametersFor(manager, "zodschema")).toBe(
        '{ kind: "record", note: string|null, size?: "low"|"high"|null }',
      );
      expect(await parametersFor(manager, "jsonschema")).toBe(
        "{ note: string|null, count?: integer|null }",
      );
    });

    it("prints a small union of objects with each member's keys", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("small", {
        edit: tool({
          description: "Edits a small draft",
          inputSchema: z.object({
            operations: z.array(
              z.discriminatedUnion("op", [
                z.object({ op: z.literal("rename"), name: z.string() }),
                z.object({ op: z.literal("disable") }),
              ]),
            ),
          }),
          execute: async () => "ok",
        }),
      });

      expect(await parametersFor(manager, "small")).toBe(
        '{ operations: ({ op: "rename", name: string }|{ op: "disable" })[] }',
      );
    });

    it("falls back to the bare type for an oversized union (edit-workflow-draft)", async () => {
      const operation = (op: string) =>
        z.object({
          op: z.literal(op),
          stepId: z.string(),
          name: z.string().optional(),
          position: z.object({ x: z.number(), y: z.number() }).optional(),
        });
      const ops = ["addStep", "removeStep", "rename", "setDescription", "disable", "enable"];
      const manager = new MCPManager();
      manager.registerPluginTools("lleverage", {
        "edit-workflow-draft": tool({
          description: "Edits a workflow draft",
          inputSchema: z.object({
            workflowId: z.string(),
            mode: z.enum(["draft", "live"]).optional(),
            operations: z.array(
              z.discriminatedUnion(
                "op",
                ops.map(operation) as unknown as [
                  ReturnType<typeof operation>,
                  ...ReturnType<typeof operation>[],
                ],
              ),
            ),
          }),
          execute: async () => "ok",
        }),
      });

      expect(await parametersFor(manager, "edit-workflow-draft")).toBe(
        '{ workflowId: string, mode?: "draft"|"live", operations: array }',
      );
    });

    it("keeps the whole line within the budget, falling back the widest properties first", async () => {
      const values = (prefix: string, n: number) =>
        Array.from({ length: n }, (_, i) => `${prefix}_value_${i}`) as [string, ...string[]];
      const manager = new MCPManager();
      manager.registerPluginTools("wide", {
        configure: tool({
          description: "Configures many things",
          inputSchema: z.object({
            small: z.enum(["a", "b"]),
            first: z.enum(values("first", 12)),
            second: z.enum(values("second", 12)),
            third: z.enum(values("third", 12)),
          }),
          execute: async () => "ok",
        }),
      });

      const line = await parametersFor(manager, "wide");
      expect(bytes(line)).toBeLessThanOrEqual(600);
      expect(line).toContain('small: "a"|"b"');
      expect(line).toContain("second: string");
      expect(line).toContain('first: "first_value_0"|');
    });

    it("still prints bare types for properties without shapes", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("plain", {
        run: tool({
          description: "Runs a plain tool",
          inputSchema: z.object({
            id: z.string(),
            count: z.number().optional(),
            options: z.record(z.string(), z.string()).optional(),
          }),
          execute: async () => "ok",
        }),
      });

      expect(await parametersFor(manager, "plain")).toBe(
        "{ id: string, count?: number, options?: object }",
      );
    });
  });
});
