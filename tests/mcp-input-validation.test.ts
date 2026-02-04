import type { JSONSchema7 } from "json-schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isSchemaEmpty,
  MCPInputValidationError,
  MCPInputValidator,
} from "../src/mcp/validation.js";

describe("isSchemaEmpty", () => {
  it("should identify empty object schema with no properties", () => {
    const schema: JSONSchema7 = {
      type: "object",
      properties: {},
    };
    expect(isSchemaEmpty(schema)).toBe(true);
  });

  it("should identify empty object schema with no type", () => {
    const schema: JSONSchema7 = {};
    expect(isSchemaEmpty(schema)).toBe(true);
  });

  it("should identify non-empty schema with properties", () => {
    const schema: JSONSchema7 = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    };
    expect(isSchemaEmpty(schema)).toBe(false);
  });

  it("should identify non-empty schema with required fields", () => {
    const schema: JSONSchema7 = {
      type: "object",
      properties: {},
      required: ["id"],
    };
    expect(isSchemaEmpty(schema)).toBe(false);
  });

  it("should identify non-empty schema with additionalProperties", () => {
    const schema: JSONSchema7 = {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
    expect(isSchemaEmpty(schema)).toBe(false);
  });

  it("should identify non-empty schema with pattern properties", () => {
    const schema: JSONSchema7 = {
      type: "object",
      properties: {},
      patternProperties: {
        "^S_": { type: "string" },
      },
    };
    expect(isSchemaEmpty(schema)).toBe(false);
  });

  it("should identify non-empty schema with anyOf", () => {
    const schema: JSONSchema7 = {
      anyOf: [{ type: "string" }, { type: "number" }],
    };
    expect(isSchemaEmpty(schema)).toBe(false);
  });
});

describe("MCPInputValidator", () => {
  let validator: MCPInputValidator;

  beforeEach(() => {
    validator = new MCPInputValidator();
  });

  describe("registerSchema", () => {
    it("should register a valid schema", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      };

      expect(() => {
        validator.registerSchema("test-tool", schema);
      }).not.toThrow();

      expect(validator.hasSchema("test-tool")).toBe(true);
    });

    it("should throw on invalid schema", () => {
      const invalidSchema = {
        type: "invalid-type",
      } as unknown as JSONSchema7;

      expect(() => {
        validator.registerSchema("bad-tool", invalidSchema);
      }).toThrow(/Failed to compile schema/);
    });
  });

  describe("validate", () => {
    it("should validate correct input", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      };

      validator.registerSchema("user-tool", schema);

      expect(() => {
        validator.validate("user-tool", { name: "Alice", age: 30 });
      }).not.toThrow();
    });

    it("should throw MCPInputValidationError for missing required field", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      };

      validator.registerSchema("user-tool", schema);

      expect(() => {
        validator.validate("user-tool", {});
      }).toThrow(MCPInputValidationError);

      try {
        validator.validate("user-tool", {});
      } catch (error) {
        expect(error).toBeInstanceOf(MCPInputValidationError);
        if (error instanceof MCPInputValidationError) {
          expect(error.toolName).toBe("user-tool");
          expect(error.errors.length).toBeGreaterThan(0);
          expect(error.message).toContain("Invalid input for MCP tool");
        }
      }
    });

    it("should throw MCPInputValidationError for wrong type", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          age: { type: "number" },
        },
      };

      validator.registerSchema("age-tool", schema);

      expect(() => {
        validator.validate("age-tool", { age: "not a number" });
      }).toThrow(MCPInputValidationError);
    });

    it("should throw if schema not registered", () => {
      expect(() => {
        validator.validate("unknown-tool", {});
      }).toThrow(/No schema registered/);
    });

    it("should validate with nested objects", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
            },
            required: ["email"],
          },
        },
      };

      validator.registerSchema("nested-tool", schema);

      expect(() => {
        validator.validate("nested-tool", {
          user: { name: "Bob", email: "bob@example.com" },
        });
      }).not.toThrow();

      expect(() => {
        validator.validate("nested-tool", {
          user: { name: "Bob" }, // Missing required email
        });
      }).toThrow(MCPInputValidationError);
    });

    it("should validate arrays", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
      };

      validator.registerSchema("array-tool", schema);

      expect(() => {
        validator.validate("array-tool", { tags: ["a", "b", "c"] });
      }).not.toThrow();

      expect(() => {
        validator.validate("array-tool", { tags: [1, 2, 3] });
      }).toThrow(MCPInputValidationError);
    });
  });

  describe("unregisterSchema", () => {
    it("should remove a registered schema", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: { name: { type: "string" } },
      };

      validator.registerSchema("temp-tool", schema);
      expect(validator.hasSchema("temp-tool")).toBe(true);

      validator.unregisterSchema("temp-tool");
      expect(validator.hasSchema("temp-tool")).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all registered schemas", () => {
      const schema: JSONSchema7 = {
        type: "object",
        properties: { name: { type: "string" } },
      };

      validator.registerSchema("tool1", schema);
      validator.registerSchema("tool2", schema);
      expect(validator.hasSchema("tool1")).toBe(true);
      expect(validator.hasSchema("tool2")).toBe(true);

      validator.clear();
      expect(validator.hasSchema("tool1")).toBe(false);
      expect(validator.hasSchema("tool2")).toBe(false);
    });
  });
});
