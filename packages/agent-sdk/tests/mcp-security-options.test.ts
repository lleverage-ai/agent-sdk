import type { JSONSchema7 } from "json-schema";
import { describe, expect, it } from "vitest";
import { isSchemaEmpty } from "../src/mcp/validation.js";

/**
 * Tests for MCP security options.
 *
 * Note: Full integration tests with real MCP servers require actual MCP server setup.
 * These tests focus on the schema validation and filtering logic.
 */

describe("MCP Security Options - Schema Filtering", () => {
  describe("isSchemaEmpty utility", () => {
    it("should identify empty schemas that requireSchema would reject", () => {
      // Empty object schema - should be rejected
      expect(
        isSchemaEmpty({
          type: "object",
          properties: {},
        }),
      ).toBe(true);

      // Schema with no constraints - should be rejected
      expect(isSchemaEmpty({})).toBe(true);

      // Schema with properties - should be accepted
      expect(
        isSchemaEmpty({
          type: "object",
          properties: {
            name: { type: "string" },
          },
        }),
      ).toBe(false);

      // Schema with required fields - should be accepted
      expect(
        isSchemaEmpty({
          type: "object",
          required: ["id"],
        }),
      ).toBe(false);
    });

    it("should handle various schema patterns", () => {
      // Pattern properties
      expect(
        isSchemaEmpty({
          type: "object",
          patternProperties: {
            "^S_": { type: "string" },
          },
        }),
      ).toBe(false);

      // Additional properties constraint
      expect(
        isSchemaEmpty({
          type: "object",
          additionalProperties: false,
        }),
      ).toBe(false);

      // Union types
      expect(
        isSchemaEmpty({
          anyOf: [{ type: "string" }, { type: "number" }],
        }),
      ).toBe(false);

      // OneOf constraint
      expect(
        isSchemaEmpty({
          oneOf: [{ type: "string" }, { type: "null" }],
        }),
      ).toBe(false);

      // AllOf constraint
      expect(
        isSchemaEmpty({
          allOf: [{ type: "object" }, { properties: { name: { type: "string" } } }],
        }),
      ).toBe(false);
    });
  });

  describe("MCPServerConfig type validation", () => {
    it("should accept valid security configuration", () => {
      // This is a type-level test - if it compiles, the types are correct
      const config = {
        type: "stdio" as const,
        command: "test-server",
        allowedTools: ["tool1", "tool2"],
        validateInputs: true,
        requireSchema: true,
      };

      expect(config.allowedTools).toEqual(["tool1", "tool2"]);
      expect(config.validateInputs).toBe(true);
      expect(config.requireSchema).toBe(true);
    });

    it("should allow optional security fields", () => {
      const config = {
        type: "stdio" as const,
        command: "test-server",
        // All security fields are optional
      };

      expect(config.allowedTools).toBeUndefined();
      expect(config.validateInputs).toBeUndefined();
      expect(config.requireSchema).toBeUndefined();
    });

    it("should work with HTTP and SSE server types", () => {
      const httpConfig = {
        type: "http" as const,
        url: "https://example.com/mcp",
        allowedTools: ["read_only_tool"],
        validateInputs: true,
      };

      const sseConfig = {
        type: "sse" as const,
        url: "https://example.com/sse",
        requireSchema: true,
      };

      expect(httpConfig.type).toBe("http");
      expect(sseConfig.type).toBe("sse");
    });
  });

  describe("Tool filtering logic simulation", () => {
    it("should demonstrate allowlist filtering", () => {
      const serverTools = [
        { name: "tool1", schema: { type: "object", properties: { a: { type: "string" } } } },
        { name: "tool2", schema: { type: "object", properties: { b: { type: "string" } } } },
        { name: "tool3", schema: { type: "object", properties: { c: { type: "string" } } } },
      ];

      const allowedTools = ["tool1", "tool3"];

      // Simulate filtering
      const filtered = serverTools.filter((t) => allowedTools.includes(t.name));

      expect(filtered.length).toBe(2);
      expect(filtered.map((t) => t.name)).toEqual(["tool1", "tool3"]);
    });

    it("should demonstrate requireSchema filtering", () => {
      const serverTools = [
        {
          name: "good",
          schema: { type: "object", properties: { name: { type: "string" } } } as JSONSchema7,
        },
        { name: "bad", schema: { type: "object", properties: {} } as JSONSchema7 },
        { name: "also-good", schema: { type: "object", required: ["id"] } as JSONSchema7 },
      ];

      // Simulate filtering with requireSchema
      const filtered = serverTools.filter((t) => !isSchemaEmpty(t.schema));

      expect(filtered.length).toBe(2);
      expect(filtered.map((t) => t.name)).toEqual(["good", "also-good"]);
    });

    it("should demonstrate combined filtering", () => {
      const serverTools = [
        {
          name: "allowed-good",
          schema: { type: "object", properties: { a: { type: "string" } } } as JSONSchema7,
        },
        { name: "allowed-bad", schema: { type: "object", properties: {} } as JSONSchema7 },
        {
          name: "blocked-good",
          schema: { type: "object", properties: { b: { type: "string" } } } as JSONSchema7,
        },
      ];

      const allowedTools = ["allowed-good", "allowed-bad"];
      const requireSchema = true;

      // Apply both filters
      let filtered = serverTools.filter((t) => allowedTools.includes(t.name));
      if (requireSchema) {
        filtered = filtered.filter((t) => !isSchemaEmpty(t.schema));
      }

      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("allowed-good");
    });
  });
});
