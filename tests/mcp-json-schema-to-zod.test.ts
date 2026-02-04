import type { JSONSchema7 } from "json-schema";
import { describe, expect, it } from "vitest";
import { jsonSchemaToZod } from "../src/mcp/validation.js";

describe("jsonSchemaToZod", () => {
  describe("primitive types", () => {
    it("converts string type", () => {
      const schema: JSONSchema7 = { type: "string" };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("hello")).toBe("hello");
      expect(() => result.schema.parse(123)).toThrow();
    });

    it("converts number type", () => {
      const schema: JSONSchema7 = { type: "number" };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(42)).toBe(42);
      expect(result.schema.parse(3.14)).toBe(3.14);
      expect(() => result.schema.parse("not a number")).toThrow();
    });

    it("converts integer type", () => {
      const schema: JSONSchema7 = { type: "integer" };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(42)).toBe(42);
      expect(() => result.schema.parse(3.14)).toThrow();
    });

    it("converts boolean type", () => {
      const schema: JSONSchema7 = { type: "boolean" };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(true)).toBe(true);
      expect(result.schema.parse(false)).toBe(false);
      expect(() => result.schema.parse("true")).toThrow();
    });

    it("converts null type", () => {
      const schema: JSONSchema7 = { type: "null" };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(null)).toBe(null);
      expect(() => result.schema.parse(undefined)).toThrow();
    });
  });

  describe("string constraints", () => {
    it("validates minLength", () => {
      const schema: JSONSchema7 = { type: "string", minLength: 3 };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("hello")).toBe("hello");
      expect(() => result.schema.parse("hi")).toThrow();
    });

    it("validates maxLength", () => {
      const schema: JSONSchema7 = { type: "string", maxLength: 5 };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("hello")).toBe("hello");
      expect(() => result.schema.parse("hello world")).toThrow();
    });

    it("validates pattern", () => {
      const schema: JSONSchema7 = { type: "string", pattern: "^[a-z]+$" };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("hello")).toBe("hello");
      expect(() => result.schema.parse("Hello")).toThrow();
    });

    it("validates email format", () => {
      const schema: JSONSchema7 = { type: "string", format: "email" };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("test@example.com")).toBe("test@example.com");
      expect(() => result.schema.parse("not-an-email")).toThrow();
    });

    it("validates uri format", () => {
      const schema: JSONSchema7 = { type: "string", format: "uri" };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("https://example.com")).toBe("https://example.com");
      expect(() => result.schema.parse("not-a-url")).toThrow();
    });

    it("validates uuid format", () => {
      const schema: JSONSchema7 = { type: "string", format: "uuid" };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("550e8400-e29b-41d4-a716-446655440000")).toBe(
        "550e8400-e29b-41d4-a716-446655440000",
      );
      expect(() => result.schema.parse("not-a-uuid")).toThrow();
    });
  });

  describe("number constraints", () => {
    it("validates minimum", () => {
      const schema: JSONSchema7 = { type: "number", minimum: 0 };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(0)).toBe(0);
      expect(result.schema.parse(10)).toBe(10);
      expect(() => result.schema.parse(-1)).toThrow();
    });

    it("validates maximum", () => {
      const schema: JSONSchema7 = { type: "number", maximum: 100 };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(100)).toBe(100);
      expect(() => result.schema.parse(101)).toThrow();
    });

    it("validates exclusiveMinimum", () => {
      const schema: JSONSchema7 = { type: "number", exclusiveMinimum: 0 };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(1)).toBe(1);
      expect(() => result.schema.parse(0)).toThrow();
    });

    it("validates exclusiveMaximum", () => {
      const schema: JSONSchema7 = { type: "number", exclusiveMaximum: 100 };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(99)).toBe(99);
      expect(() => result.schema.parse(100)).toThrow();
    });

    it("validates multipleOf", () => {
      const schema: JSONSchema7 = { type: "number", multipleOf: 5 };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(10)).toBe(10);
      expect(() => result.schema.parse(7)).toThrow();
    });
  });

  describe("array type", () => {
    it("converts simple array", () => {
      const schema: JSONSchema7 = {
        type: "array",
        items: { type: "string" },
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(["a", "b"])).toEqual(["a", "b"]);
      expect(() => result.schema.parse([1, 2])).toThrow();
    });

    it("validates minItems", () => {
      const schema: JSONSchema7 = {
        type: "array",
        items: { type: "string" },
        minItems: 2,
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(["a", "b"])).toEqual(["a", "b"]);
      expect(() => result.schema.parse(["a"])).toThrow();
    });

    it("validates maxItems", () => {
      const schema: JSONSchema7 = {
        type: "array",
        items: { type: "string" },
        maxItems: 2,
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(["a", "b"])).toEqual(["a", "b"]);
      expect(() => result.schema.parse(["a", "b", "c"])).toThrow();
    });
  });

  describe("object type", () => {
    it("converts simple object", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse({ name: "Alice", age: 30 })).toEqual({
        name: "Alice",
        age: 30,
      });
    });

    it("validates required fields", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse({ name: "Alice" })).toEqual({ name: "Alice" });
      expect(() => result.schema.parse({ age: 30 })).toThrow();
    });

    it("handles optional fields", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      // age is optional
      expect(result.schema.parse({ name: "Alice" })).toEqual({ name: "Alice" });
    });

    it("handles additionalProperties: false", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        additionalProperties: false,
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse({ name: "Alice" })).toEqual({ name: "Alice" });
      expect(() => result.schema.parse({ name: "Alice", extra: "value" })).toThrow();
    });

    it("handles additionalProperties with schema", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        additionalProperties: { type: "number" },
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse({ id: "abc", count: 42 })).toEqual({
        id: "abc",
        count: 42,
      });
    });

    it("converts nested objects", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string", format: "email" },
            },
            required: ["email"],
          },
        },
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(
        result.schema.parse({
          user: { name: "Bob", email: "bob@example.com" },
        }),
      ).toEqual({
        user: { name: "Bob", email: "bob@example.com" },
      });
    });
  });

  describe("enum and const", () => {
    it("converts string enum", () => {
      const schema: JSONSchema7 = {
        type: "string",
        enum: ["red", "green", "blue"],
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("red")).toBe("red");
      expect(() => result.schema.parse("yellow")).toThrow();
    });

    it("converts numeric enum", () => {
      const schema: JSONSchema7 = {
        type: "number",
        enum: [1, 2, 3],
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(1)).toBe(1);
      expect(result.schema.parse(2)).toBe(2);
      expect(result.schema.parse(3)).toBe(3);
      expect(() => result.schema.parse(4)).toThrow();
      expect(() => result.schema.parse("1")).toThrow();
    });

    it("converts mixed enum (string and number)", () => {
      const schema: JSONSchema7 = {
        enum: ["auto", 0, 1, 2],
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("auto")).toBe("auto");
      expect(result.schema.parse(0)).toBe(0);
      expect(result.schema.parse(1)).toBe(1);
      expect(result.schema.parse(2)).toBe(2);
      expect(() => result.schema.parse("manual")).toThrow();
      expect(() => result.schema.parse(3)).toThrow();
    });

    it("converts enum with null", () => {
      const schema: JSONSchema7 = {
        enum: ["enabled", "disabled", null],
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("enabled")).toBe("enabled");
      expect(result.schema.parse("disabled")).toBe("disabled");
      expect(result.schema.parse(null)).toBe(null);
      expect(() => result.schema.parse("unknown")).toThrow();
    });

    it("converts enum with boolean values", () => {
      const schema: JSONSchema7 = {
        enum: [true, false, "unknown"],
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse(true)).toBe(true);
      expect(result.schema.parse(false)).toBe(false);
      expect(result.schema.parse("unknown")).toBe("unknown");
      expect(() => result.schema.parse("true")).toThrow();
      expect(() => result.schema.parse(1)).toThrow();
    });

    it("converts const", () => {
      const schema: JSONSchema7 = {
        const: "fixed-value",
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("fixed-value")).toBe("fixed-value");
      expect(() => result.schema.parse("other")).toThrow();
    });
  });

  describe("anyOf and oneOf", () => {
    it("converts anyOf", () => {
      const schema: JSONSchema7 = {
        anyOf: [{ type: "string" }, { type: "number" }],
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("hello")).toBe("hello");
      expect(result.schema.parse(42)).toBe(42);
      expect(() => result.schema.parse(true)).toThrow();
    });

    it("converts oneOf", () => {
      const schema: JSONSchema7 = {
        oneOf: [{ type: "string" }, { type: "number" }],
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("hello")).toBe("hello");
      expect(result.schema.parse(42)).toBe(42);
    });
  });

  describe("allOf", () => {
    it("converts allOf with object schemas", () => {
      const schema: JSONSchema7 = {
        allOf: [
          {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
          {
            type: "object",
            properties: { age: { type: "number" } },
            required: ["age"],
          },
        ],
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse({ name: "Alice", age: 30 })).toEqual({
        name: "Alice",
        age: 30,
      });
    });
  });

  describe("type arrays", () => {
    it("converts type array (nullable)", () => {
      const schema: JSONSchema7 = {
        type: ["string", "null"],
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse("hello")).toBe("hello");
      expect(result.schema.parse(null)).toBe(null);
    });
  });

  describe("empty schema handling", () => {
    it("returns permissive schema for empty object schema", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {},
      };
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      // z.unknown() accepts any value - objects, strings, numbers, etc.
      expect(result.schema.parse({ any: "value" })).toEqual({ any: "value" });
      expect(result.schema.parse("string")).toBe("string");
      expect(result.schema.parse(42)).toBe(42);
    });

    it("returns permissive schema for completely empty schema", () => {
      const schema: JSONSchema7 = {};
      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      // z.unknown() accepts any value
      expect(result.schema.parse({ anything: "goes" })).toEqual({
        anything: "goes",
      });
      expect(result.schema.parse("anything")).toBe("anything");
      expect(result.schema.parse(null)).toBe(null);
    });
  });

  describe("error handling", () => {
    it("returns fallback schema on deeply nested schema", () => {
      // Create a deeply nested schema that would exceed max depth
      let schema: JSONSchema7 = { type: "string" };
      for (let i = 0; i < 25; i++) {
        schema = {
          type: "object",
          properties: { nested: schema },
        };
      }

      const result = jsonSchemaToZod(schema);

      // Should fail gracefully with permissive fallback
      expect(result.success).toBe(false);
      expect(result.error).toContain("too deeply nested");
      // Fallback schema should still work
      expect(result.schema.parse({ any: "value" })).toEqual({ any: "value" });
    });
  });

  describe("real-world MCP schema examples", () => {
    it("handles GitHub MCP list_issues schema", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          state: {
            type: "string",
            enum: ["open", "closed", "all"],
            description: "Issue state filter",
          },
          per_page: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Results per page",
          },
        },
        required: ["owner", "repo"],
      };

      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse({ owner: "anthropics", repo: "sdk", state: "open" })).toEqual({
        owner: "anthropics",
        repo: "sdk",
        state: "open",
      });
      expect(() =>
        result.schema.parse({ owner: "anthropics", repo: "sdk", state: "invalid" }),
      ).toThrow();
      expect(
        () => result.schema.parse({ repo: "sdk" }), // missing owner
      ).toThrow();
    });

    it("handles file system read schema", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute file path",
            minLength: 1,
          },
          offset: {
            type: "integer",
            minimum: 0,
            description: "Line offset to start reading",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 10000,
            description: "Max lines to read",
          },
        },
        required: ["path"],
      };

      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(result.schema.parse({ path: "/home/user/file.txt" })).toEqual({
        path: "/home/user/file.txt",
      });
      expect(result.schema.parse({ path: "/home/user/file.txt", offset: 10, limit: 100 })).toEqual({
        path: "/home/user/file.txt",
        offset: 10,
        limit: 100,
      });
      expect(() => result.schema.parse({ path: "" })).toThrow(); // empty path
      expect(() => result.schema.parse({ path: "/file", offset: -1 })).toThrow(); // negative offset
    });

    it("handles database query schema with nested objects", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1 },
          parameters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                value: {},
              },
              required: ["name"],
            },
          },
          options: {
            type: "object",
            properties: {
              timeout: { type: "integer", minimum: 0 },
              readOnly: { type: "boolean" },
            },
          },
        },
        required: ["query"],
      };

      const result = jsonSchemaToZod(schema);

      expect(result.success).toBe(true);
      expect(
        result.schema.parse({
          query: "SELECT * FROM users",
          parameters: [{ name: "id", value: 1 }],
          options: { timeout: 5000, readOnly: true },
        }),
      ).toEqual({
        query: "SELECT * FROM users",
        parameters: [{ name: "id", value: 1 }],
        options: { timeout: 5000, readOnly: true },
      });
    });
  });
});
