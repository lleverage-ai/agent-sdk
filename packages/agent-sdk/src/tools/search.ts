/**
 * Tool search meta-tool for progressive disclosure.
 *
 * @packageDocumentation
 */

import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { MCPManager } from "../mcp/manager.js";
import type { MCPToolMetadata } from "../mcp/types.js";

/**
 * Options for creating the search_tools tool.
 *
 * @category Tools
 */
export interface SearchToolsOptions {
  /** MCP manager to search */
  manager: MCPManager;

  /**
   * Maximum results to return.
   * @defaultValue 10
   */
  maxResults?: number;

  /**
   * Whether to enable loading tools after search.
   * When true, the tool accepts an optional 'load' parameter.
   * @defaultValue false
   */
  enableLoad?: boolean;

  /**
   * Whether to automatically load tools after searching.
   * When true, found tools are automatically loaded without requiring load: true.
   * This provides better UX by eliminating the two-step search-then-load process.
   * @defaultValue false
   */
  autoLoad?: boolean;

  /**
   * Whether to include parameter schema information in search results.
   * When true, results include parameter details so the LLM can construct
   * `call_tool` arguments without needing to load the tool.
   *
   * @defaultValue false
   */
  includeSchema?: boolean;

  /**
   * Callback when tools are loaded.
   * Used to notify the agent that tools have changed.
   */
  onToolsLoaded?: (toolNames: string[]) => void;
}

/**
 * Creates the search_tools meta-tool for discovering inline plugin tools and MCP tools.
 *
 * This tool allows agents to search for available tools by query,
 * enabling progressive disclosure of capabilities.
 *
 * @param options - Configuration options
 * @returns AI SDK tool definition
 *
 * @example
 * ```typescript
 * // Auto-load pattern (recommended)
 * const searchTool = createSearchToolsTool({
 *   manager: mcpManager,
 *   maxResults: 5,
 *   autoLoad: true, // Tools are automatically loaded after search
 * });
 *
 * // Agent can then use:
 * // search_tools({ query: "github issues" })
 * // Returns: "Found and loaded 3 tools... These tools are now available for immediate use."
 *
 * // Manual load pattern (if autoLoad is false)
 * // search_tools({ query: "github issues", load: true })
 * ```
 *
 * @category Tools
 */
export function createSearchToolsTool(options: SearchToolsOptions): Tool {
  const {
    manager,
    maxResults = 10,
    enableLoad = false,
    autoLoad = false,
    includeSchema = false,
    onToolsLoaded,
  } = options;

  // Auto-load takes precedence - if enabled, tools are always loaded
  const shouldAutoLoad = autoLoad;
  const shouldAllowManualLoad = enableLoad && !autoLoad;

  const baseDescription =
    "Search for available tools by query. Returns tool names and descriptions. " +
    "Use this to discover tools that can help with your task.";

  const loadDescription = shouldAutoLoad
    ? " Found tools are automatically loaded and ready for immediate use."
    : shouldAllowManualLoad
      ? " Set 'load: true' to load discovered tools for immediate use."
      : "";

  const inputSchema = shouldAllowManualLoad
    ? z.object({
        query: z
          .string()
          .describe("Search query to find relevant tools. Can match tool names or descriptions."),
        load: z
          .boolean()
          .optional()
          .describe(
            "If true, load the discovered tools for immediate use. Default is false (search only).",
          ),
      })
    : z.object({
        query: z
          .string()
          .describe("Search query to find relevant tools. Can match tool names or descriptions."),
      });

  return tool({
    description: baseDescription + loadDescription,
    inputSchema,
    execute: async (input: { query: string; load?: boolean }) => {
      const { query, load = false } = input;
      const results = manager.searchTools(query, maxResults);

      if (results.length === 0) {
        return `No tools found matching "${query}". Try a different search term.`;
      }

      // Determine if we should load tools
      const shouldLoad = shouldAutoLoad || (load && shouldAllowManualLoad);

      // If loading is requested or auto-load is enabled, load the discovered tools
      if (shouldLoad) {
        const toolNames = results.map((t) => t.name);
        const loadResult = manager.loadTools(toolNames);

        // Notify callback if provided
        if (onToolsLoaded && loadResult.loaded.length > 0) {
          onToolsLoaded(loadResult.loaded);
        }

        if (loadResult.loaded.length === 0) {
          const formatted = results.map((t) => `- **${t.name}**: ${t.description}`).join("\n");
          const autoLoadMsg = shouldAutoLoad ? " (already loaded)" : " (all already loaded)";
          return `Found ${results.length} tool(s)${autoLoadMsg}:\n\n${formatted}`;
        }

        const loadedFormatted = loadResult.loaded
          .map((name) => {
            const meta = results.find((t) => t.name === name);
            return `- **${name}**: ${meta?.description ?? ""}`;
          })
          .join("\n");

        const autoLoadPrefix = shouldAutoLoad ? "Found and loaded" : "Loaded";
        let response = `${autoLoadPrefix} ${loadResult.loaded.length} tool(s):\n\n${loadedFormatted}`;

        if (loadResult.alreadyLoaded.length > 0) {
          response += `\n\n(${loadResult.alreadyLoaded.length} tool(s) were already loaded)`;
        }

        if (shouldAutoLoad) {
          response += `\n\nThese tools are now available for immediate use.`;
        }

        return response;
      }

      // Search only - return results without loading
      const formatted = results.map((t) => formatToolResult(t, manager, includeSchema)).join("\n");

      return `Found ${results.length} tool(s):\n\n${formatted}`;
    },
  });
}

/**
 * Format a single tool result for display.
 *
 * When includeSchema is true, includes parameter descriptions and loaded status.
 * @internal
 */
function formatToolResult(t: MCPToolMetadata, manager: MCPManager, includeSchema: boolean): string {
  const loaded = manager.isToolLoaded(t.name);
  const loadedTag = `[loaded: ${loaded}]`;

  let line = `- **${t.name}** ${loadedTag}: ${t.description}`;

  if (includeSchema && t.inputSchema) {
    const schemaStr = formatSchemaCompact(t.inputSchema);
    if (schemaStr) {
      line += `\n  Parameters: ${schemaStr}`;
    }
  }

  return line;
}

/**
 * Maximum UTF-8 bytes for one property in a `Parameters:` line. A property
 * whose full shape is longer falls back to its bare type (`object`, `array`).
 * @internal
 */
const MAX_PROPERTY_BYTES = 300;

/**
 * Maximum UTF-8 bytes for one tool's whole `Parameters:` line. Over it, the
 * widest properties fall back to their bare type until the line fits.
 * @internal
 */
const MAX_PARAMETERS_BYTES = 600;

/**
 * Object nesting whose keys are shown: the top-level properties are depth 0,
 * so objects among them list their keys and objects inside those print as
 * `object`.
 * @internal
 */
const MAX_OBJECT_DEPTH = 1;

const utf8 = new TextEncoder();

function byteLength(text: string): number {
  return utf8.encode(text).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Format a JSON Schema as a compact parameter description, such as
 * `{ valueType: "ENUM"|"NUMBER", unit?: string, ids?: string[] }`.
 *
 * Enum values and `const` print as literals, nullable fields as `T|null`,
 * arrays with their item type and objects with one level of keys. Each
 * property stays within {@link MAX_PROPERTY_BYTES} and the line within
 * {@link MAX_PARAMETERS_BYTES}; over either, a property prints its bare type.
 * @internal
 */
function formatSchemaCompact(schema: unknown): string {
  if (!isRecord(schema) || !isRecord(schema.properties)) return "";
  const properties = Object.entries(schema.properties);
  if (properties.length === 0) return "";

  const required = requiredKeys(schema);
  const entries = properties.map(([name, prop]) => {
    const key = `${name}${required.has(name) ? "" : "?"}`;
    const bare = `${key}: ${formatBareType(prop)}`;
    const full = `${key}: ${formatType(prop, 0)}`;
    return { bare, text: byteLength(full) <= MAX_PROPERTY_BYTES ? full : bare };
  });

  const render = () => `{ ${entries.map((entry) => entry.text).join(", ")} }`;
  let line = render();
  while (byteLength(line) > MAX_PARAMETERS_BYTES) {
    let widest: (typeof entries)[number] | undefined;
    let saving = 0;
    for (const entry of entries) {
      const entrySaving = byteLength(entry.text) - byteLength(entry.bare);
      if (entrySaving > saving) {
        saving = entrySaving;
        widest = entry;
      }
    }
    if (!widest) break;
    widest.text = widest.bare;
    line = render();
  }
  return line;
}

function requiredKeys(schema: Record<string, unknown>): Set<string> {
  return new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : [],
  );
}

function typeNames(prop: Record<string, unknown>): string[] {
  if (typeof prop.type === "string") return [prop.type];
  if (Array.isArray(prop.type)) {
    return prop.type.filter((name): name is string => typeof name === "string");
  }
  return [];
}

/** The type a property printed before shapes were shown: `object`, `string|null`. */
function formatBareType(prop: unknown): string {
  if (!isRecord(prop)) return "unknown";
  const names = typeNames(prop);
  return names.length > 0 ? names.join("|") : "unknown";
}

function formatType(prop: unknown, depth: number): string {
  return formatTypeVariants(prop, depth).join("|");
}

/** The union members of a property's type, each printed on its own. */
function formatTypeVariants(prop: unknown, depth: number): string[] {
  if (!isRecord(prop)) return ["unknown"];
  if ("const" in prop) return [formatLiteral(prop.const)];
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    return unique(prop.enum.map(formatLiteral));
  }
  const variants = Array.isArray(prop.anyOf)
    ? prop.anyOf
    : Array.isArray(prop.oneOf)
      ? prop.oneOf
      : undefined;
  if (variants && variants.length > 0) {
    return unique(variants.flatMap((variant) => formatTypeVariants(variant, depth)));
  }
  const names = typeNames(prop);
  if (names.length === 0) return ["unknown"];
  return unique(names.map((name) => formatNamedType(name, prop, depth)));
}

function formatNamedType(name: string, prop: Record<string, unknown>, depth: number): string {
  if (name === "array") {
    if (!isRecord(prop.items)) return "array";
    const items = formatTypeVariants(prop.items, depth);
    return items.length > 1 ? `(${items.join("|")})[]` : `${items[0]}[]`;
  }
  if (name === "object") {
    if (depth >= MAX_OBJECT_DEPTH || !isRecord(prop.properties)) return "object";
    const properties = Object.entries(prop.properties);
    if (properties.length === 0) return "object";
    const required = requiredKeys(prop);
    const keys = properties.map(
      ([key, child]) => `${key}${required.has(key) ? "" : "?"}: ${formatType(child, depth + 1)}`,
    );
    return `{ ${keys.join(", ")} }`;
  }
  return name;
}

function formatLiteral(value: unknown): string {
  return JSON.stringify(value) ?? "unknown";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
