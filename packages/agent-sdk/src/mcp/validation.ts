/**
 * Input validation utilities for MCP tools.
 *
 * @packageDocumentation
 */

import type { ValidateFunction } from "ajv";
import { Ajv } from "ajv";
import type { JSONSchema7, JSONSchema7TypeName } from "json-schema";
import { z } from "zod";

/**
 * Validation error thrown when MCP tool input validation fails.
 *
 * @category MCP
 */
export class MCPInputValidationError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly errors: string[],
  ) {
    super(`Invalid input for MCP tool '${toolName}': ${errors.join(", ")}`);
    this.name = "MCPInputValidationError";
  }
}

/**
 * Check if a JSON Schema is non-empty and meaningful.
 * An empty schema is one that accepts anything (no properties, no required fields, etc.).
 *
 * @internal
 */
export function isSchemaEmpty(schema: JSONSchema7): boolean {
  // Empty schema with just type: object and no properties/required/additionalProperties constraints
  if (schema.type === "object") {
    const hasProperties = schema.properties && Object.keys(schema.properties).length > 0;
    const hasRequired = schema.required && schema.required.length > 0;
    const hasAdditionalProperties = schema.additionalProperties !== undefined;
    const hasPatternProperties =
      schema.patternProperties && Object.keys(schema.patternProperties).length > 0;
    const hasConstraints =
      hasProperties || hasRequired || hasAdditionalProperties || hasPatternProperties;

    if (!hasConstraints) {
      return true;
    }
  }

  // Schema with no type and no constraints is empty
  if (
    !schema.type &&
    !schema.properties &&
    !schema.required &&
    !schema.anyOf &&
    !schema.oneOf &&
    !schema.allOf &&
    !schema.enum
  ) {
    return true;
  }

  return false;
}

/**
 * Validator for MCP tool inputs using AJV.
 *
 * @category MCP
 */
export class MCPInputValidator {
  private ajv: Ajv;
  private validators: Map<string, ValidateFunction> = new Map();

  constructor() {
    // Create AJV instance with permissive settings for MCP schemas
    this.ajv = new Ajv({
      strict: false, // MCP schemas may not be strict JSON Schema
      allErrors: true, // Collect all errors for better error messages
      coerceTypes: false, // Don't coerce types - be strict about input types
    });
  }

  /**
   * Register a tool's input schema for validation.
   *
   * @param toolName - Full MCP tool name
   * @param schema - JSON Schema for the tool's inputs
   */
  registerSchema(toolName: string, schema: JSONSchema7): void {
    try {
      const validator = this.ajv.compile(schema);
      this.validators.set(toolName, validator);
    } catch (err: unknown) {
      throw new Error(
        `Failed to compile schema for MCP tool '${toolName}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Validate tool input against its registered schema.
   *
   * @param toolName - Full MCP tool name
   * @param input - Tool input to validate
   * @throws {MCPInputValidationError} If validation fails
   */
  validate(toolName: string, input: unknown): void {
    const validator = this.validators.get(toolName);
    if (!validator) {
      throw new Error(
        `No schema registered for MCP tool '${toolName}'. Call registerSchema first.`,
      );
    }

    const valid = validator(input);
    if (!valid && validator.errors) {
      const errors = validator.errors.map(
        (err) => `${err.instancePath || "input"} ${err.message || "is invalid"}`,
      );
      throw new MCPInputValidationError(toolName, errors);
    }
  }

  /**
   * Check if a tool has a registered schema.
   *
   * @param toolName - Full MCP tool name
   * @returns True if schema is registered
   */
  hasSchema(toolName: string): boolean {
    return this.validators.has(toolName);
  }

  /**
   * Unregister a tool's schema.
   *
   * @param toolName - Full MCP tool name
   */
  unregisterSchema(toolName: string): void {
    this.validators.delete(toolName);
  }

  /**
   * Clear all registered schemas.
   */
  clear(): void {
    this.validators.clear();
  }
}

/**
 * Result of JSON Schema to Zod conversion.
 *
 * @category MCP
 */
export interface JsonSchemaToZodResult {
  /** Whether the conversion succeeded */
  success: boolean;
  /** The converted Zod schema (permissive fallback if conversion failed) */
  schema: z.ZodType;
  /** Error message if conversion failed */
  error?: string;
}

/**
 * Convert a JSON Schema to a Zod schema for AI SDK tool definitions.
 *
 * This is a best-effort conversion that handles common JSON Schema patterns.
 * Falls back to a permissive schema if conversion fails.
 *
 * Supported JSON Schema features:
 * - Primitive types: string, number, integer, boolean, null
 * - Objects with properties and required fields
 * - Arrays with items
 * - Enums
 * - anyOf/oneOf unions
 * - Basic format validators (date-time, email, uri, uuid)
 * - String constraints (minLength, maxLength, pattern)
 * - Number constraints (minimum, maximum, exclusiveMinimum, exclusiveMaximum)
 * - Array constraints (minItems, maxItems)
 *
 * @param jsonSchema - JSON Schema to convert
 * @returns Conversion result with Zod schema
 *
 * @example
 * ```typescript
 * const result = jsonSchemaToZod({
 *   type: "object",
 *   properties: {
 *     name: { type: "string" },
 *     age: { type: "number" }
 *   },
 *   required: ["name"]
 * });
 *
 * if (result.success) {
 *   // Use result.schema for AI SDK tool definition
 * }
 * ```
 *
 * @category MCP
 */
export function jsonSchemaToZod(jsonSchema: JSONSchema7): JsonSchemaToZodResult {
  try {
    const zodSchema = convertJsonSchemaToZod(jsonSchema);
    return { success: true, schema: zodSchema };
  } catch (err) {
    return {
      success: false,
      schema: z.record(z.string(), z.unknown()),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Primitive type for Zod literals.
 * @internal
 */
type ZodPrimitive = string | number | boolean | bigint | null | undefined;

/**
 * Internal conversion function that may throw.
 * @internal
 */
function convertJsonSchemaToZod(schema: JSONSchema7, depth = 0): z.ZodType {
  // Prevent infinite recursion
  if (depth > 20) {
    throw new Error("JSON Schema too deeply nested");
  }

  // Handle const first - a const-only schema is not empty
  if (schema.const !== undefined) {
    return z.literal(schema.const as ZodPrimitive);
  }

  // Handle empty schema or schema with no constraints - accepts any value
  if (isSchemaEmpty(schema)) {
    return z.unknown();
  }

  // Handle anyOf
  if (schema.anyOf && schema.anyOf.length > 0) {
    const schemas = schema.anyOf.map((s) => convertJsonSchemaToZod(s as JSONSchema7, depth + 1));
    if (schemas.length === 1) {
      return schemas[0]!;
    }
    return z.union([schemas[0]!, schemas[1]!, ...schemas.slice(2)] as [
      z.ZodType,
      z.ZodType,
      ...z.ZodType[],
    ]);
  }

  // Handle oneOf (same as anyOf for our purposes)
  if (schema.oneOf && schema.oneOf.length > 0) {
    const schemas = schema.oneOf.map((s) => convertJsonSchemaToZod(s as JSONSchema7, depth + 1));
    if (schemas.length === 1) {
      return schemas[0]!;
    }
    return z.union([schemas[0]!, schemas[1]!, ...schemas.slice(2)] as [
      z.ZodType,
      z.ZodType,
      ...z.ZodType[],
    ]);
  }

  // Handle allOf - intersect all schemas
  if (schema.allOf && schema.allOf.length > 0) {
    const schemas = schema.allOf.map((s) => convertJsonSchemaToZod(s as JSONSchema7, depth + 1));
    if (schemas.length === 1) {
      return schemas[0]!;
    }
    // For simplicity, merge object schemas or take the first one
    let result: z.ZodType = schemas[0]!;
    for (let i = 1; i < schemas.length; i++) {
      result = z.intersection(result, schemas[i]!);
    }
    return result;
  }

  // Handle enum
  if (schema.enum && schema.enum.length > 0) {
    const values = schema.enum as ZodPrimitive[];
    if (values.length === 1) {
      return z.literal(values[0]!);
    }
    // z.enum() only supports string arrays, so check if all values are strings
    const allStrings = values.every((v) => typeof v === "string");
    if (allStrings) {
      return z.enum(values as [string, ...string[]]);
    }
    // For numeric, boolean, null, or mixed enums, use z.union() with literals
    const literals = values.map((v) => z.literal(v));
    return z.union([literals[0]!, literals[1]!, ...literals.slice(2)] as [
      z.ZodType,
      z.ZodType,
      ...z.ZodType[],
    ]);
  }

  // Handle type-based conversion
  const type = schema.type;

  // Handle array of types
  if (Array.isArray(type)) {
    const schemas = type.map((t) =>
      convertJsonSchemaToZod({ ...schema, type: t as JSONSchema7TypeName }, depth + 1),
    );
    if (schemas.length === 1) {
      return schemas[0]!;
    }
    return z.union([schemas[0]!, schemas[1]!, ...schemas.slice(2)] as [
      z.ZodType,
      z.ZodType,
      ...z.ZodType[],
    ]);
  }

  switch (type) {
    case "string":
      return convertStringSchema(schema);
    case "number":
    case "integer":
      return convertNumberSchema(schema, type === "integer");
    case "boolean":
      return z.boolean();
    case "null":
      return z.null();
    case "array":
      return convertArraySchema(schema, depth);
    case "object":
      return convertObjectSchema(schema, depth);
    default:
      // No type specified but has properties - treat as object
      if (schema.properties) {
        return convertObjectSchema(schema, depth);
      }
      // Fall back to permissive schema
      return z.unknown();
  }
}

/**
 * Convert a string JSON Schema to Zod.
 * @internal
 */
function convertStringSchema(schema: JSONSchema7): z.ZodString | z.ZodType {
  let zodString = z.string();

  // Apply format validators
  if (schema.format) {
    switch (schema.format) {
      case "email":
        zodString = zodString.email();
        break;
      case "uri":
      case "url":
        zodString = zodString.url();
        break;
      case "uuid":
        zodString = zodString.uuid();
        break;
      case "date-time":
        zodString = zodString.datetime();
        break;
      case "date":
        zodString = zodString.date();
        break;
      case "time":
        zodString = zodString.time();
        break;
      case "ipv4":
        zodString = zodString.regex(
          /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
        );
        break;
      case "ipv6":
        zodString = zodString.regex(/^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/);
        break;
      // Other formats are not validated strictly
    }
  }

  // Apply length constraints
  if (typeof schema.minLength === "number") {
    zodString = zodString.min(schema.minLength);
  }
  if (typeof schema.maxLength === "number") {
    zodString = zodString.max(schema.maxLength);
  }

  // Apply pattern constraint
  if (schema.pattern) {
    zodString = zodString.regex(new RegExp(schema.pattern));
  }

  return zodString;
}

/**
 * Convert a number JSON Schema to Zod.
 * @internal
 */
function convertNumberSchema(schema: JSONSchema7, isInteger: boolean): z.ZodNumber {
  let zodNumber = isInteger ? z.number().int() : z.number();

  // Apply range constraints
  if (typeof schema.minimum === "number") {
    zodNumber = zodNumber.min(schema.minimum);
  }
  if (typeof schema.maximum === "number") {
    zodNumber = zodNumber.max(schema.maximum);
  }
  if (typeof schema.exclusiveMinimum === "number") {
    zodNumber = zodNumber.gt(schema.exclusiveMinimum);
  }
  if (typeof schema.exclusiveMaximum === "number") {
    zodNumber = zodNumber.lt(schema.exclusiveMaximum);
  }
  if (typeof schema.multipleOf === "number") {
    zodNumber = zodNumber.multipleOf(schema.multipleOf);
  }

  return zodNumber;
}

/**
 * Convert an array JSON Schema to Zod.
 * @internal
 */
function convertArraySchema(schema: JSONSchema7, depth: number): z.ZodType {
  let itemSchema: z.ZodType = z.unknown();

  if (schema.items) {
    if (Array.isArray(schema.items)) {
      // Tuple type - for simplicity, use the first item's schema or union
      if (schema.items.length > 0) {
        const itemSchemas = schema.items.map((s) =>
          convertJsonSchemaToZod(s as JSONSchema7, depth + 1),
        );
        if (itemSchemas.length === 1) {
          itemSchema = itemSchemas[0]!;
        } else {
          itemSchema = z.union([itemSchemas[0]!, itemSchemas[1]!, ...itemSchemas.slice(2)] as [
            z.ZodType,
            z.ZodType,
            ...z.ZodType[],
          ]);
        }
      }
    } else {
      itemSchema = convertJsonSchemaToZod(schema.items as JSONSchema7, depth + 1);
    }
  }

  let zodArray = z.array(itemSchema);

  // Apply length constraints
  if (typeof schema.minItems === "number") {
    zodArray = zodArray.min(schema.minItems);
  }
  if (typeof schema.maxItems === "number") {
    zodArray = zodArray.max(schema.maxItems);
  }

  return zodArray;
}

/**
 * Convert an object JSON Schema to Zod.
 * @internal
 */
function convertObjectSchema(schema: JSONSchema7, depth: number): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  const required = new Set(schema.required || []);

  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      let propZod = convertJsonSchemaToZod(propSchema as JSONSchema7, depth + 1);
      if (!required.has(key)) {
        propZod = propZod.optional();
      }
      shape[key] = propZod;
    }
  }

  // Handle additionalProperties
  if (schema.additionalProperties === false) {
    return z.object(shape).strict();
  } else if (
    schema.additionalProperties !== undefined &&
    schema.additionalProperties !== true &&
    typeof schema.additionalProperties === "object"
  ) {
    // Allow additional properties with specific schema
    const additionalSchema = convertJsonSchemaToZod(
      schema.additionalProperties as JSONSchema7,
      depth + 1,
    );
    return z.object(shape).catchall(additionalSchema);
  }

  return z.object(shape);
}
