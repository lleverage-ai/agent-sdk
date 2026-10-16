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
import { formatToolNameList, suggestNearMissTools } from "./call-tool.js";
import { formatSchemaDetail } from "./schema-detail.js";

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
   * It also adds an optional `path` parameter: with `query` set to an exact
   * tool name and `path` to a dotted argument path (`filters`,
   * `filters.status`), the tool returns that argument's full schema and
   * descriptions instead of searching. In the `Parameters:` line, `…` marks a
   * shape that was cut for length and `{…}` an object whose keys were left out.
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

  const pathDescription = includeSchema ? PATH_TOOL_DESCRIPTION : "";

  const query = z
    .string()
    .describe("Search query to find relevant tools. Can match tool names or descriptions.");
  const load = z
    .boolean()
    .optional()
    .describe(
      "If true, load the discovered tools for immediate use. Default is false (search only).",
    );
  const path = z.string().optional().describe(PATH_PARAMETER_DESCRIPTION);

  // Only the options this configuration accepts are shown to the model.
  const inputSchema = z.object({
    query,
    ...(shouldAllowManualLoad ? { load } : {}),
    ...(includeSchema ? { path } : {}),
  }) as unknown as z.ZodType<SearchToolsInput>;

  return tool({
    description: baseDescription + loadDescription + pathDescription,
    inputSchema,
    execute: async (input: SearchToolsInput) => {
      const { query, load = false } = input;

      if (includeSchema && typeof input.path === "string") {
        return describeArgument(manager, query, input.path);
      }

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

/** Input accepted by `search_tools`; `load` and `path` only when enabled. */
interface SearchToolsInput {
  query: string;
  load?: boolean;
  path?: string;
}

/**
 * Sentence added to `search_tools`' description when schemas are shown.
 * @internal
 */
const PATH_TOOL_DESCRIPTION =
  " Parameters omit descriptions and … marks a cut shape." +
  " For one argument in full, pass the exact tool name as query and a path.";

/** @internal */
const PATH_PARAMETER_DESCRIPTION =
  'Argument path, e.g. "filters" or "filters.status": returns its full schema and descriptions.';

/**
 * Render one argument of an exactly named tool for the `path` option.
 * @internal
 */
function describeArgument(manager: MCPManager, query: string, path: string): string {
  const toolName = query.trim();
  const metadata = manager.getToolMetadata(toolName);
  if (!metadata) {
    const suggestions = suggestNearMissTools(manager, toolName);
    return suggestions.length > 0
      ? `Error: No tool named "${toolName}". path needs the exact tool name as query. Closest: ${formatToolNameList(suggestions)}.`
      : `Error: No tool named "${toolName}". path needs the exact tool name as query; search without path to find it.`;
  }
  const detail = formatSchemaDetail(metadata.name, metadata.inputSchema, path);
  return detail.ok ? detail.text : `Error: ${detail.error}`;
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
      line += `\n  ${PARAMETERS_PREFIX}${schemaStr}`;
    }
  }

  return line;
}

/** @internal */
const PARAMETERS_PREFIX = "Parameters: ";

/**
 * Maximum UTF-8 bytes for one property in a `Parameters:` line. A property
 * whose full shape is longer falls back to its bare type, marked where detail
 * was cut (`{…}`, `{…}[]`, `string…`), and a bare entry still longer (a very
 * long name) is cut short with `…`.
 * @internal
 */
const MAX_PROPERTY_BYTES = 300;

/**
 * Maximum UTF-8 bytes for one tool's whole `Parameters:` line, prefix
 * included. Over it, the widest properties fall back to their bare type; if
 * the bare entries still don't fit, the last ones (optional first) are left
 * out and counted as `…N more`.
 * @internal
 */
const MAX_PARAMETERS_BYTES = 600;

/**
 * Object nesting whose keys are shown: the top-level properties are depth 0,
 * so objects among them list their keys and objects inside those print as
 * `{…}` (or `object` when they have no named keys).
 * @internal
 */
const MAX_OBJECT_DEPTH = 1;

const utf8 = new TextEncoder();

function byteLength(text: string): number {
  return utf8.encode(text).length;
}

/** Cut `text` to at most `max` UTF-8 bytes, ending in `…` when cut. */
function truncateBytes(text: string, max: number): string {
  if (byteLength(text) <= max) return text;
  const ellipsis = "…";
  let out = "";
  let size = byteLength(ellipsis);
  for (const char of text) {
    const charSize = byteLength(char);
    if (size + charSize > max) break;
    out += char;
    size += charSize;
  }
  return out + ellipsis;
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
 * {@link MAX_PARAMETERS_BYTES}: over either, a property prints its bare type
 * with `…` where detail was cut, and entries that still don't fit are cut
 * short or left out. `search_tools`' `path` option shows what was cut.
 * @internal
 */
function formatSchemaCompact(schema: unknown): string {
  if (!isRecord(schema) || !isRecord(schema.properties)) return "";
  const properties = Object.entries(schema.properties);
  if (properties.length === 0) return "";

  const budget = MAX_PARAMETERS_BYTES - byteLength(PARAMETERS_PREFIX);
  const required = requiredKeys(schema);
  const entries = properties.map(([name, prop]) => {
    const key = `${name}${required.has(name) ? "" : "?"}`;
    const bare = truncateBytes(`${key}: ${formatCutType(prop)}`, MAX_PROPERTY_BYTES);
    const full = `${key}: ${formatType(prop, 0)}`;
    return {
      bare,
      text: byteLength(full) <= MAX_PROPERTY_BYTES ? full : bare,
      required: required.has(name),
      shown: true,
    };
  });

  const render = () => {
    const shown = entries.filter((entry) => entry.shown).map((entry) => entry.text);
    const omitted = entries.length - shown.length;
    if (omitted > 0) shown.push(`…${omitted} more`);
    return `{ ${shown.join(", ")} }`;
  };

  // First fall back the property whose shape costs the most bytes.
  let line = render();
  while (byteLength(line) > budget) {
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

  // Bare types alone are too long: leave out the last entries, optional first.
  while (byteLength(line) > budget) {
    let last: (typeof entries)[number] | undefined;
    for (let i = entries.length - 1; i >= 0 && !last; i--) {
      const entry = entries[i];
      if (entry?.shown && !entry.required) last = entry;
    }
    for (let i = entries.length - 1; i >= 0 && !last; i--) {
      const entry = entries[i];
      if (entry?.shown) last = entry;
    }
    if (!last) break;
    last.shown = false;
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

/**
 * A property's bare type, marking where detail is left out: `{…}` for an
 * object with keys, `{…}[]` for an array of them, `string…` for an enum, and
 * plain `string`, `object` or `string|null` when there is nothing more to show.
 */
function formatCutType(prop: unknown): string {
  return unique(cutTypeVariants(prop)).join("|");
}

function cutTypeVariants(prop: unknown): string[] {
  if (!isRecord(prop)) return ["unknown"];
  const names = typeNames(prop);
  if ("const" in prop || (Array.isArray(prop.enum) && prop.enum.length > 0)) {
    const values = "const" in prop ? [prop.const] : (prop.enum as unknown[]);
    const literalTypes = names.length > 0 ? names : unique(values.map(literalTypeName));
    return literalTypes.map((name) => `${name}…`);
  }
  const variants = Array.isArray(prop.anyOf)
    ? prop.anyOf
    : Array.isArray(prop.oneOf)
      ? prop.oneOf
      : undefined;
  if (variants && variants.length > 0) {
    return unique(variants.flatMap(cutTypeVariants));
  }
  if (names.length === 0) return ["unknown"];
  return unique(
    names.map((name) => {
      if (name === "object") return hasNamedKeys(prop) ? "{…}" : "object";
      if (name !== "array" || !isRecord(prop.items)) return name;
      const items = unique(cutTypeVariants(prop.items));
      return items.length > 1 ? `(${items.join("|")})[]` : `${items[0]}[]`;
    }),
  );
}

function hasNamedKeys(prop: Record<string, unknown>): boolean {
  return isRecord(prop.properties) && Object.keys(prop.properties).length > 0;
}

function literalTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
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
    if (!isRecord(prop.properties)) return "object";
    const properties = Object.entries(prop.properties);
    if (properties.length === 0) return "object";
    if (depth >= MAX_OBJECT_DEPTH) return "{…}";
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
