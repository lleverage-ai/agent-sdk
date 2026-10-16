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
        '{ viewId: string, filters?: { workflowId?: string, status?: "OPEN"|"CLOSED", range?: {…} } }',
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

    it("falls back to a marked bare type for an oversized union (edit-workflow-draft)", async () => {
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
        '{ workflowId: string, mode?: "draft"|"live", operations: {…}[] }',
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
      expect(bytes(`Parameters: ${line}`)).toBeLessThanOrEqual(600);
      expect(line).toContain('small: "a"|"b"');
      expect(line).toContain("second: string…");
      expect(line).toContain('first: "first_value_0"|');
    });

    it("leaves out the last entries, optional first, when bare types alone are too long", async () => {
      const fields = Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [`field_${String(i).padStart(2, "0")}`, z.string()]),
      );
      const manager = new MCPManager();
      manager.registerPluginTools("many", {
        fill: tool({
          description: "Fills a long form",
          inputSchema: z.object({
            ...fields,
            extra: z.string().optional(),
          }),
          execute: async () => "ok",
        }),
      });

      const line = await parametersFor(manager, "many");
      expect(bytes(`Parameters: ${line}`)).toBeLessThanOrEqual(600);
      expect(line).toMatch(/^\{ field_00: string, .*, …\d+ more \}$/);
      expect(line).not.toContain("extra");
    });

    it("cuts a property short when even its bare entry is over the property budget", async () => {
      const longName = `x${"é".repeat(200)}`;
      const manager = new MCPManager();
      manager.registerPluginTools("longname", {
        run: tool({
          description: "Has one very long parameter name",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: { [longName]: { type: "string" }, id: { type: "string" } },
            required: [longName, "id"],
          }),
          execute: async () => "ok",
        }),
      });

      const line = await parametersFor(manager, "longname");
      const [longEntry] = line.slice(2, -2).split(", ");
      expect(bytes(longEntry!)).toBeLessThanOrEqual(300);
      expect(longEntry).toMatch(/^xé+…$/);
      expect(line).toContain(", id: string }");
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

  describe("path drill-down with includeSchema", () => {
    const execOptions = {
      toolCallId: "test",
      messages: [],
      abortSignal: undefined as unknown as AbortSignal,
    };
    const bytes = (text: string) => new TextEncoder().encode(text).length;

    const ids = (description?: string) => {
      const schema = z.array(z.string().min(1).max(200));
      return (description ? schema.describe(description) : schema).optional();
    };

    // Modelled on lleverage's update-request-view input: 23 filter keys, too
    // wide for the 300-byte property budget of the Parameters line.
    const requestFilters = z
      .object({
        status: z
          .array(z.enum(["PENDING", "COMPLETED", "CANCELLED", "SUPERSEDED", "FAILED"]))
          .optional(),
        type: z.array(z.enum(["APPROVAL", "INPUT"])).optional(),
        workflowId: ids("Workflow ids: any workflow in the project"),
        decision: ids("Recorded decision labels of resolved approvals"),
        decisionPending: z
          .boolean()
          .optional()
          .describe("Only approvals still awaiting a decision"),
        titleContains: z.string().max(200).optional(),
        titleNotContains: z.string().max(200).optional(),
        assigneeId: ids('Assigned user ids; "me" is you'),
        assigneeRoles: z.array(z.enum(["OWNER", "BUILDER", "OPERATOR", "MEMBER"])).optional(),
        createdById: ids(),
        mentionedId: ids('Users mentioned in a comment; "me" is you'),
        personalStatus: z.enum(["PENDING", "MENTIONED", "RESPONDED"]).optional(),
        hideResponded: z.boolean().optional(),
        hideCompleted: z.boolean().optional(),
        includeArchived: z.boolean().optional(),
        dateRange: z
          .object({
            preset: z.enum(["last24h", "last7d", "last30d", "custom", "all"]).optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
          })
          .optional()
          .describe("Created within"),
        relatedTableId: z.string().max(200).optional(),
        relatedRecordId: z.string().max(200).optional(),
        relatedRecordFilters: z.string().max(4000).optional(),
        advanced: z
          .object({
            logicalOperator: z.enum(["AND", "OR"]),
            conditions: z
              .array(
                z.object({
                  field: z.string().min(1).describe("status, type, title or metric:<metricId>"),
                  operator: z.enum(["equals", "not_equals", "contains", "is_before", "is_after"]),
                  value: z.unknown().optional(),
                }),
              )
              .min(1)
              .max(20),
          })
          .optional(),
        metricFilters: z.record(z.string(), z.unknown()).optional(),
        sortField: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("createdAt, priority or slaDeadline"),
        sortDirection: z.enum(["asc", "desc"]).optional(),
      })
      .describe("The view's filters");

    const createManager = () => {
      const manager = new MCPManager();
      manager.registerPluginTools("lleverage", {
        "update-request-view": tool({
          description: "Updates a saved request view",
          inputSchema: z.object({
            viewId: z.string().min(1).describe("The saved view's id"),
            title: z.string().min(1).max(100).optional(),
            filters: requestFilters.optional(),
          }),
          execute: async () => "ok",
        }),
      });
      return manager;
    };

    const drill = async (manager: MCPManager, query: string, path: string) => {
      const searchTool = createSearchToolsTool({ manager, includeSchema: true });
      return (await searchTool.execute!({ query, path }, execOptions)) as string;
    };

    const toolName = "lleverage__update-request-view";

    it("marks the cut filters object in the Parameters line", async () => {
      const searchTool = createSearchToolsTool({ manager: createManager(), includeSchema: true });
      const result = (await searchTool.execute!(
        { query: "update-request-view" },
        execOptions,
      )) as string;

      expect(result).toContain("Parameters: { viewId: string, title?: string, filters?: {…} }");
    });

    it("returns every filters key with its values and descriptions (update-request-view)", async () => {
      const result = await drill(createManager(), toolName, "filters");
      const lines = result.split("\n");

      expect(lines[0]).toBe(`Schema of filters in ${toolName}:`);
      expect(lines[1]).toBe("filters?: object — The view's filters");
      const keys = lines
        .filter((line) => /^ {2}[A-Za-z]/.test(line))
        .map((line) => line.trim().split(/\??:/)[0]);
      expect(keys).toEqual(Object.keys(requestFilters.shape));
      expect(result).toContain(
        '  status?: ("PENDING"|"COMPLETED"|"CANCELLED"|"SUPERSEDED"|"FAILED")[]',
      );
      expect(result).toContain('  assigneeId?: string[] — Assigned user ids; "me" is you');
      expect(result).toContain("  titleContains?: string (at most 200 chars)");
      expect(result).toContain("  dateRange?: object — Created within\n    preset?: ");
      expect(result).toContain(
        "    conditions: object[] (1–20 items)\n      field: string (non-empty) — status",
      );
      expect(result).toContain("  metricFilters?: object\n    [key: string]: any");
      expect(bytes(result)).toBeLessThanOrEqual(4000);
    });

    it("returns only the asked-for key for a nested path (filters.status)", async () => {
      const result = await drill(createManager(), toolName, "filters.status");

      expect(result).toBe(
        `Schema of filters.status in ${toolName}:\n` +
          'filters.status?: ("PENDING"|"COMPLETED"|"CANCELLED"|"SUPERSEDED"|"FAILED")[]',
      );
    });

    it("walks through arrays to a key of their items (filters.advanced.conditions.operator)", async () => {
      const result = await drill(createManager(), toolName, "filters.advanced.conditions.operator");

      expect(result.split("\n")[1]).toBe(
        'filters.advanced.conditions.operator: "equals"|"not_equals"|"contains"|"is_before"|"is_after"',
      );
      expect(
        await drill(createManager(), toolName, "filters.advanced.conditions[].field"),
      ).toContain(
        "filters.advanced.conditions[].field: string (non-empty) — status, type, title or metric:<metricId>",
      );
    });

    it("returns the whole input for an empty path", async () => {
      const result = await drill(createManager(), toolName, "");

      expect(result.split("\n").slice(0, 3)).toEqual([
        `Arguments of ${toolName}:`,
        "viewId: string (non-empty) — The saved view's id",
        "title?: string (1–100 chars)",
      ]);
      expect(result).toContain("\n  status?: ");
    });

    it("names the keys that exist when the path is unknown", async () => {
      const result = await drill(createManager(), toolName, "filters.advanced.nope");

      expect(result).toBe(
        `Error: No argument "nope" at "filters.advanced" in ${toolName}. Keys there: logicalOperator, conditions.`,
      );
    });

    it("names the closest tools when the query is not an exact tool name", async () => {
      const result = await drill(createManager(), "update-request-view", "filters");

      expect(result).toContain('Error: No tool named "update-request-view"');
      expect(result).toContain(`\`${toolName}\``);
    });

    it("lists each member of a union and marks nullable objects", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("draft", {
        edit: tool({
          description: "Edits a draft",
          inputSchema: z.object({
            operations: z.array(
              z.discriminatedUnion("op", [
                z.object({ op: z.literal("rename"), name: z.string().describe("New name") }),
                z.object({ op: z.literal("disable") }),
              ]),
            ),
            position: z.object({ x: z.number(), y: z.number() }).nullable(),
          }),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "draft__edit", "")).toBe(
        [
          "Arguments of draft__edit:",
          "operations: object[]",
          "  - object",
          '    op: "rename"',
          "    name: string — New name",
          "  - object",
          '    op: "disable"',
          "position: object|null",
          "  x: number",
          "  y: number",
        ].join("\n"),
      );
      // Only one member has name, so it is optional across the union.
      expect(await drill(manager, "draft__edit", "operations.name")).toContain(
        "operations.name?: string — New name",
      );
    });

    it("stops at a recursive schema instead of looping", async () => {
      interface TreeNode {
        label: string;
        children?: TreeNode[];
      }
      const node: z.ZodType<TreeNode> = z.lazy(() =>
        z.object({ label: z.string(), children: z.array(node).optional() }),
      );
      const manager = new MCPManager();
      manager.registerPluginTools("tree", {
        save: tool({
          description: "Saves a tree",
          inputSchema: z.object({ root: node }),
          execute: async () => "ok",
        }),
      });

      const result = await drill(manager, "tree__save", "root");
      expect(result).toBe(
        [
          "Schema of root in tree__save:",
          "root: object",
          "  label: string",
          "  children?: object[]",
          '    items: same shape as "root" (recursive)',
        ].join("\n"),
      );
      expect(await drill(manager, "tree__save", "root.children.children.label")).toContain(
        "root.children.children.label: string",
      );
      expect(bytes(result)).toBeLessThan(500);
    });

    it("stays within 4000 bytes and names narrower paths when an argument is too big", async () => {
      const section = (n: number) =>
        z.object(
          Object.fromEntries(
            Array.from({ length: 12 }, (_, i) => [
              `field_${n}_${i}`,
              z
                .string()
                .describe("A field with a description long enough to fill the budget quickly"),
            ]),
          ),
        );
      const manager = new MCPManager();
      manager.registerPluginTools("big", {
        configure: tool({
          description: "Configures a lot",
          inputSchema: z.object({
            config: z.object(
              Object.fromEntries(Array.from({ length: 8 }, (_, n) => [`section_${n}`, section(n)])),
            ),
          }),
          execute: async () => "ok",
        }),
      });

      const result = await drill(manager, "big__configure", "config");
      expect(bytes(result)).toBeLessThanOrEqual(4000);
      expect(result).toMatch(
        /\n…cut here to stay within 4000 bytes\. Ask for a narrower path, such as "config\.section_\d"\.$/,
      );
      expect(await drill(manager, "big__configure", "config.section_7")).toContain(
        "field_7_11: string",
      );
    });

    it("keeps the footer within 4000 bytes when the paths are long and multibyte", async () => {
      const longKey = (i: number) => `${"é".repeat(150)}_${i}`;
      const field = { type: "string", description: "A described field to fill the budget" };
      const manager = new MCPManager();
      manager.registerPluginTools("wide", {
        configure: tool({
          description: "Configures a lot",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: Object.fromEntries(
              Array.from({ length: 30 }, (_, i) => [
                longKey(i),
                { type: "object", properties: { a: field, b: field, c: field } },
              ]),
            ),
          }),
          execute: async () => "ok",
        }),
      });

      const result = await drill(manager, "wide__configure", "");
      expect(bytes(result)).toBeLessThanOrEqual(4000);
      expect(result).toMatch(
        /\n…cut here to stay within 4000 bytes\. Ask for a narrower path, such as "é+…"\.$/,
      );
    });

    it("keeps the annotations of array items and of scalar union members", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("people", {
        invite: tool({
          description: "Invites someone",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: {
              who: {
                description: "Who to invite",
                anyOf: [
                  { type: "string", pattern: "^usr_", description: "An existing user id" },
                  { type: "string", format: "email", description: "An address to invite" },
                ],
              },
              ids: {
                type: "array",
                description: "User ids",
                items: { type: "string", minLength: 1, maxLength: 200 },
              },
              tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
            },
            required: ["who"],
          }),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "people__invite", "")).toBe(
        [
          "Arguments of people__invite:",
          "who: one of — Who to invite",
          "  - string (pattern ^usr_) — An existing user id",
          "  - string (email) — An address to invite",
          "ids?: string[] — User ids",
          "  items: string (1–200 chars)",
          'tags?: ("a"|"b")[]',
        ].join("\n"),
      );
      expect(await drill(createManager(), toolName, "filters")).toContain(
        '  assigneeId?: string[] — Assigned user ids; "me" is you\n    items: string (1–200 chars)',
      );
    });

    it("lists the alternatives of a whole input that is a union", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("acl", {
        grant: tool({
          description: "Grants access",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            oneOf: [
              {
                type: "object",
                properties: { kind: { const: "user" }, userId: { type: "string" } },
                required: ["kind", "userId"],
              },
              {
                type: "object",
                properties: { kind: { const: "group" }, groupId: { type: "string" } },
                required: ["kind", "groupId"],
              },
            ],
          }),
          execute: async () => "ok",
        }),
        ping: tool({
          description: "Takes nothing",
          inputSchema: z.object({}),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "acl__grant", "")).toBe(
        [
          "Arguments of acl__grant:",
          "one of:",
          "  - object",
          '    kind: "user"',
          "    userId: string",
          "  - object",
          '    kind: "group"',
          "    groupId: string",
        ].join("\n"),
      );
      expect(await drill(manager, "acl__grant", "kind")).toBe(
        'Schema of kind in acl__grant:\nkind: "user"|"group"',
      );
      expect(await drill(manager, "acl__ping", "")).toBe("acl__ping takes no arguments.");
    });

    it("keeps allOf restrictions together, required when any of them requires it", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("strict", {
        set: tool({
          description: "Sets a status",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            allOf: [
              {
                properties: { status: { type: "string", enum: ["PENDING", "COMPLETED"] } },
                required: ["status"],
              },
              {
                properties: {
                  status: { type: "string", enum: ["COMPLETED", "FAILED"] },
                  note: { type: "string" },
                },
              },
            ],
          }),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "strict__set", "status")).toBe(
        [
          "Schema of status in strict__set:",
          "status: all of",
          '  - "PENDING"|"COMPLETED"',
          '  - "COMPLETED"|"FAILED"',
        ].join("\n"),
      );
      expect(await drill(manager, "strict__set", "note")).toBe(
        "Schema of note in strict__set:\nnote?: string",
      );
    });

    it("bounds the work on shared $refs that describe exponentially many paths", async () => {
      const depth = 30;
      const defs = Object.fromEntries(
        Array.from({ length: depth }, (_, i) => [
          `D${i}`,
          i === depth - 1
            ? { type: "string" }
            : {
                type: "object",
                properties: {
                  left: { $ref: `#/$defs/D${i + 1}` },
                  right: { $ref: `#/$defs/D${i + 1}` },
                },
              },
        ]),
      );
      const manager = new MCPManager();
      manager.registerPluginTools("dag", {
        walk: tool({
          description: "Walks a DAG",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: { root: { $ref: "#/$defs/D0" } },
            $defs: defs,
          }),
          execute: async () => "ok",
        }),
      });

      const started = Date.now();
      const result = await drill(manager, "dag__walk", "root");
      expect(Date.now() - started).toBeLessThan(2000);
      expect(bytes(result)).toBeLessThanOrEqual(4000);
      expect(result).toContain("\n…cut here to stay within 4000 bytes.");
      const nested = await drill(manager, "dag__walk", "root.right.left.right.left");
      expect(nested).toMatch(
        /^Schema of root\.right\.left\.right\.left in dag__walk:\nroot\.right\.left\.right\.left\?: object\n {2}left\?: object\n/,
      );
      expect(bytes(nested)).toBeLessThanOrEqual(4000);
    });

    it("bounds the work on shared $refs in allOf when resolving a path", async () => {
      const depth = 30;
      const defs = Object.fromEntries(
        Array.from({ length: depth }, (_, i) => [
          `D${i}`,
          i === depth - 1
            ? { type: "object", properties: { value: { type: "string" } } }
            : {
                allOf: [
                  { $ref: `#/$defs/D${i + 1}` },
                  {
                    allOf: [{ $ref: `#/$defs/D${i + 1}` }],
                    properties: { value: { description: String(i) } },
                  },
                ],
              },
        ]),
      );
      const manager = new MCPManager();
      manager.registerPluginTools("dag", {
        nest: tool({
          description: "Nests a DAG",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: { root: { $ref: "#/$defs/D0" } },
            $defs: defs,
          }),
          execute: async () => "ok",
        }),
      });

      const started = Date.now();
      const result = await drill(manager, "dag__nest", "root.value");
      expect(Date.now() - started).toBeLessThan(2000);
      expect(bytes(result)).toBeLessThanOrEqual(4000);
      // Every allOf member is a string, so they fold into one line with all their descriptions.
      expect(result).toMatch(
        /^Schema of root\.value in dag__nest:\nroot\.value\?: string — 28; 27; /,
      );
      expect(result).toMatch(/; 1; 0$/);
    });

    it("keeps annotations below composed and nullable array items", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("people", {
        invite: tool({
          description: "Invites people",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: {
              who: {
                type: "array",
                items: {
                  anyOf: [
                    { type: "string", pattern: "^usr_", description: "Existing user" },
                    { type: "string", format: "email", description: "Invitation address" },
                  ],
                },
              },
              names: {
                type: "array",
                items: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
              },
              code: {
                anyOf: [
                  {
                    allOf: [
                      { type: "string", minLength: 3 },
                      { type: "string", pattern: "^[A-Z]+$" },
                    ],
                  },
                  { type: "null" },
                ],
              },
            },
            required: ["who"],
          }),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "people__invite", "")).toBe(
        [
          "Arguments of people__invite:",
          "who: string[]",
          "  items: one of",
          "    - string (pattern ^usr_) — Existing user",
          "    - string (email) — Invitation address",
          "names?: (string|null)[]",
          "  items: string|null (non-empty)",
          // Restrictions of the same type all apply to the one string.
          "code?: string|null (at least 3 chars, pattern ^[A-Z]+$)",
        ].join("\n"),
      );
    });

    it("keeps a nullable wrapper's own annotations next to its member's", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("mail", {
        send: tool({
          description: "Sends mail",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: {
              codes: {
                type: "array",
                items: { minLength: 3, anyOf: [{ type: "string" }, { type: "null" }] },
              },
              to: {
                description: "Recipient or null",
                anyOf: [{ type: "string", description: "Existing user" }, { type: "null" }],
              },
              cc: {
                default: null,
                anyOf: [{ anyOf: [{ type: "string", maxLength: 50 }, { type: "null" }] }],
              },
            },
          }),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "mail__send", "")).toBe(
        [
          "Arguments of mail__send:",
          "codes?: (string|null)[]",
          "  items: string|null (at least 3 chars)",
          "to?: string|null — Recipient or null; Existing user",
          "cc?: string|null (default null, at most 50 chars)",
        ].join("\n"),
      );
      expect(await drill(manager, "mail__send", "to")).toBe(
        "Schema of to in mail__send:\nto?: string|null — Recipient or null; Existing user",
      );
    });

    it("shows a value's union and its allOf restrictions together", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("ids", {
        set: tool({
          description: "Sets an id",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: {
              id: {
                anyOf: [
                  { type: "string", pattern: "^usr_", description: "A user id" },
                  { type: "string", format: "email", description: "An address" },
                ],
                allOf: [{ minLength: 5 }, { type: "string", maxLength: 100 }],
              },
              kind: {
                type: "string",
                anyOf: [{ const: "user" }, { const: "group" }],
                allOf: [{ enum: ["user", "group", "team"] }],
              },
            },
          }),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "ids__set", "")).toBe(
        [
          "Arguments of ids__set:",
          // Restrictions on the same string join its line; the alternatives list below it.
          "id?: string (at least 5 chars, at most 100 chars)",
          "  one of:",
          "    - string (pattern ^usr_) — A user id",
          "    - string (email) — An address",
          // Literals that the string type hides are listed, and so is a restriction of another type.
          "kind?: string",
          "  one of:",
          '    - "user"',
          '    - "group"',
          "  all of:",
          '    - "user"|"group"|"team"',
        ].join("\n"),
      );
    });

    it("treats only a branch's own ancestry as recursive, not a $ref folded in beside it", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("refs", {
        shared: tool({
          description: "Inherits Base and reuses it in a property",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            allOf: [{ $ref: "#/$defs/Base" }],
            properties: { previous: { $ref: "#/$defs/Base" } },
            $defs: { Base: { type: "object", properties: { name: { type: "string" } } } },
          }),
          execute: async () => "ok",
        }),
        chain: tool({
          description: "Inherits a recursive Node",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            allOf: [{ $ref: "#/$defs/Node" }],
            properties: { id: { type: "string" } },
            $defs: {
              Node: { type: "object", properties: { next: { $ref: "#/$defs/Node" } } },
            },
          }),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "refs__shared", "")).toBe(
        [
          "Arguments of refs__shared:",
          "previous?: object",
          "  name?: string",
          "name?: string",
        ].join("\n"),
      );
      expect(await drill(manager, "refs__chain", "")).toBe(
        [
          "Arguments of refs__chain:",
          "id?: string",
          "next?: same shape as Node, part of the whole input (recursive)",
        ].join("\n"),
      );
    });

    it("keeps the enclosing required on keys of an allOf member listed on its own", async () => {
      const manager = new MCPManager();
      const member = (nullable: object) => ({
        type: "object",
        required: ["userId"],
        allOf: [nullable],
      });
      manager.registerPluginTools("req", {
        typed: tool({
          description: "Nullable through type",
          inputSchema: jsonSchema<Record<string, unknown>>(
            member({ type: ["object", "null"], properties: { userId: { type: "string" } } }),
          ),
          execute: async () => "ok",
        }),
        union: tool({
          description: "Nullable through anyOf",
          inputSchema: jsonSchema<Record<string, unknown>>(
            member({
              anyOf: [
                { type: "object", properties: { userId: { type: "string" } } },
                { type: "null" },
              ],
            }),
          ),
          execute: async () => "ok",
        }),
      });

      for (const name of ["req__typed", "req__union"]) {
        expect(await drill(manager, name, "")).toBe(
          [`Arguments of ${name}:`, "all of:", "  - object|null", "    userId: string"].join("\n"),
        );
        expect(await drill(manager, name, "userId")).toBe(
          `Schema of userId in ${name}:\nuserId: string`,
        );
      }
    });

    it("keeps literal alternatives next to a restriction of another type", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("kinds", {
        set: tool({
          description: "Sets a kind",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: {
              kind: { anyOf: [{ const: "a" }, { const: "b" }], allOf: [{ type: "string" }] },
            },
          }),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "kinds__set", "kind")).toBe(
        ["Schema of kind in kinds__set:", 'kind?: "a"|"b"', "  all of:", "    - string"].join("\n"),
      );
    });

    it("says what a described null alternative means", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("task", {
        update: tool({
          description: "Updates a task",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: {
              due: {
                anyOf: [
                  { type: "string", format: "date" },
                  { type: "null", description: "Clears the due date" },
                ],
              },
              owner: {
                anyOf: [
                  { type: "string", description: "A user id" },
                  { type: "number" },
                  { type: "null", description: "Unassigns it" },
                ],
              },
            },
          }),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "task__update", "")).toBe(
        [
          "Arguments of task__update:",
          "due?: string|null (date) — null: Clears the due date",
          "owner?: one of (or null) — null: Unassigns it",
          "  - string — A user id",
          "  - number",
        ].join("\n"),
      );
    });

    it("lists the alternatives of a whole input that is a union inside allOf", async () => {
      const manager = new MCPManager();
      const alternatives = {
        oneOf: [
          { type: "object", properties: { userId: { type: "string" } }, required: ["userId"] },
          { type: "object", properties: { groupId: { type: "string" } }, required: ["groupId"] },
        ],
      };
      manager.registerPluginTools("acl", {
        wrapped: tool({
          description: "A union inside allOf",
          inputSchema: jsonSchema<Record<string, unknown>>({ allOf: [alternatives] }),
          execute: async () => "ok",
        }),
        typed: tool({
          description: "A typed object around a union inside allOf",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: { note: { type: "string" } },
            allOf: [{ $ref: "#/$defs/Who" }],
            $defs: { Who: alternatives },
          }),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "acl__wrapped", "")).toBe(
        [
          "Arguments of acl__wrapped:",
          "one of:",
          "  - object",
          "    userId: string",
          "  - object",
          "    groupId: string",
        ].join("\n"),
      );
      expect(await drill(manager, "acl__typed", "")).toBe(
        [
          "Arguments of acl__typed:",
          "note?: string",
          "one of:",
          "  - object",
          "    userId: string",
          "  - object",
          "    groupId: string",
        ].join("\n"),
      );
    });

    it("marks a key required when required sits in a different allOf member", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("split", {
        apart: tool({
          description: "Required in its own member",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            allOf: [{ properties: { status: { type: "string" } } }, { required: ["status"] }],
          }),
          execute: async () => "ok",
        }),
        outside: tool({
          description: "Required on the enclosing node",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            required: ["status"],
            allOf: [{ properties: { status: { type: "string" } } }],
          }),
          execute: async () => "ok",
        }),
        either: tool({
          description: "Required in only one alternative",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: { status: { type: "string" } },
            anyOf: [{ required: ["status"] }, { required: ["note"] }],
          }),
          execute: async () => "ok",
        }),
      });

      for (const name of ["split__apart", "split__outside"]) {
        expect(await drill(manager, name, "status")).toBe(
          `Schema of status in ${name}:\nstatus: string`,
        );
      }
      expect(await drill(manager, "split__either", "status")).toBe(
        "Schema of status in split__either:\nstatus?: string",
      );
      for (const name of ["split__apart", "split__outside"]) {
        expect(await drill(manager, name, "")).toBe(`Arguments of ${name}:\nstatus: string`);
      }
      expect(await drill(manager, "split__either", "")).toBe(
        "Arguments of split__either:\nstatus?: string",
      );
    });

    it("gives a shared definition the same type in sibling branches", async () => {
      const manager = new MCPManager();
      manager.registerPluginTools("ids", {
        pick: tool({
          description: "Picks one or more ids",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: {
              id: {
                anyOf: [{ $ref: "#/$defs/Id" }, { type: "array", items: { $ref: "#/$defs/Id" } }],
              },
            },
            $defs: { Id: { type: "string" } },
          }),
          execute: async () => "ok",
        }),
      });

      expect(await drill(manager, "ids__pick", "id")).toBe(
        "Schema of id in ids__pick:\nid?: string|string[]",
      );
    });

    it("shows long enums and literals whole when they fit", async () => {
      const countries = Array.from({ length: 150 }, (_, i) => `Country number ${i}`);
      const longConst = "x".repeat(200);
      const manager = new MCPManager();
      manager.registerPluginTools("geo", {
        set: tool({
          description: "Sets a country",
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: "object",
            properties: {
              country: { type: "string", enum: countries.slice(0, 90) },
              marker: { const: longConst },
              everything: { type: "string", enum: countries.concat(countries.map((c) => `${c}!`)) },
            },
          }),
          execute: async () => "ok",
        }),
      });

      const country = await drill(manager, "geo__set", "country");
      expect(bytes(country)).toBeGreaterThan(1500);
      expect(country).toContain('"Country number 89"');
      expect(country).not.toContain("…");
      expect(await drill(manager, "geo__set", "marker")).toContain(JSON.stringify(longConst));

      // A result that needs no footer may use the whole budget.
      for (const value of ["x".repeat(3900), "é".repeat(1950)]) {
        const fits = new MCPManager();
        fits.registerPluginTools("geo", {
          mark: tool({
            description: "Sets a marker",
            inputSchema: jsonSchema<Record<string, unknown>>({
              type: "object",
              properties: { marker: { const: value } },
            }),
            execute: async () => "ok",
          }),
        });
        const marker = await drill(fits, "geo__mark", "marker");
        expect(marker).toBe(`Schema of marker in geo__mark:\nmarker?: ${JSON.stringify(value)}`);
        expect(bytes(marker)).toBeGreaterThan(3900);
        expect(bytes(marker)).toBeLessThanOrEqual(4000);
      }

      const everything = await drill(manager, "geo__set", "everything");
      expect(bytes(everything)).toBeLessThanOrEqual(4000);
      expect(everything).toBe(
        'Schema of everything in geo__set:\n…"everything" is too long to show within 4000 bytes.',
      );
    });

    it("offers path only when schemas are shown", () => {
      const manager = createManager();
      const withSchema = createSearchToolsTool({ manager, includeSchema: true });
      const withoutSchema = createSearchToolsTool({ manager, enableLoad: true });

      expect(withSchema.description).toContain("path");
      expect(Object.keys((withSchema.inputSchema as z.ZodObject).shape)).toEqual(["query", "path"]);
      expect(withoutSchema.description).not.toContain("path");
      expect(Object.keys((withoutSchema.inputSchema as z.ZodObject).shape)).toEqual([
        "query",
        "load",
      ]);
    });
  });
});
