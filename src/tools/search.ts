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
 * Creates the search_tools meta-tool for discovering MCP tools.
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
function formatToolResult(
  t: MCPToolMetadata,
  manager: MCPManager,
  includeSchema: boolean,
): string {
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
 * Format a JSON Schema as a compact parameter description.
 * @internal
 */
function formatSchemaCompact(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "";
  const s = schema as Record<string, unknown>;
  const properties = s.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties || Object.keys(properties).length === 0) {
    return "";
  }

  const required = new Set((s.required as string[]) ?? []);
  const parts: string[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const type = (prop.type as string) ?? "unknown";
    const optional = required.has(name) ? "" : "?";
    parts.push(`${name}${optional}: ${type}`);
  }

  return `{ ${parts.join(", ")} }`;
}
