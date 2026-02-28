/**
 * Tool utilities for improved developer experience.
 *
 * Provides helpers for working with tool names, especially for MCP tools
 * which have verbose prefixed names.
 *
 * @packageDocumentation
 */

import type { Tool, ToolSet } from "ai";
import type { PluginOptions } from "../types.js";

/**
 * A reference to a tool that can be resolved to a tool name.
 *
 * Can be:
 * - A string (tool name directly)
 * - A Tool object (name extracted from key when in a ToolSet)
 * - A Plugin (all tool names extracted, or MCP tool names generated)
 * - A ToolSet record (all keys extracted as tool names)
 *
 * @category Tools
 */
export type ToolReference = string | Tool | PluginOptions | ToolSet | ToolReference[];

/**
 * Creates a helper for generating MCP tool names for a specific plugin.
 *
 * MCP tools are prefixed with `mcp__<plugin-name>__<tool-name>`. This helper
 * makes it easier to reference these tools without typing the full name.
 *
 * @param pluginName - The MCP plugin name (e.g., "web-search")
 * @returns A function that generates full MCP tool names
 *
 * @example
 * ```typescript
 * const webSearch = mcpTools("web-search");
 *
 * const subagent = createSubagent(parent, {
 *   allowedTools: [webSearch("search"), webSearch("extract")],
 *   // Equivalent to: ["mcp__web-search__search", "mcp__web-search__extract"]
 * });
 * ```
 *
 * @category Tools
 */
export function mcpTools(pluginName: string): (toolName: string) => string {
  return (toolName: string) => `mcp__${pluginName}__${toolName}`;
}

/**
 * Creates a helper for a specific MCP plugin with known tools.
 *
 * Returns an object with tool name properties for better IDE autocomplete.
 *
 * @param pluginName - The MCP plugin name
 * @param toolNames - Array of tool names provided by the plugin
 * @returns An object mapping tool names to their full MCP names
 *
 * @example
 * ```typescript
 * const webSearch = mcpToolsFor("web-search", ["search", "extract"] as const);
 *
 * // Now you get autocomplete:
 * webSearch.search  // "mcp__web-search__search"
 * webSearch.extract // "mcp__web-search__extract"
 *
 * const subagent = createSubagent(parent, {
 *   allowedTools: [webSearch.search, webSearch.extract],
 * });
 * ```
 *
 * @category Tools
 */
export function mcpToolsFor<T extends readonly string[]>(
  pluginName: string,
  toolNames: T,
): { [K in T[number]]: string } {
  const result = {} as { [K in T[number]]: string };
  for (const name of toolNames) {
    (result as Record<string, string>)[name] = `mcp__${pluginName}__${name}`;
  }
  return result;
}

/**
 * Extracts tool names from a plugin.
 *
 * For regular plugins, extracts tool names from the tools property.
 * For MCP plugins, generates tool names based on the plugin name and
 * optionally specified tool names.
 *
 * @param plugin - The plugin to extract tool names from
 * @param mcpToolNames - For MCP plugins, the specific tool names to include
 * @returns Array of tool name strings
 *
 * @example
 * ```typescript
 * // Regular plugin with tools
 * const names = toolsFromPlugin(myPlugin);
 * // Returns: ["tool1", "tool2", ...]
 *
 * // MCP plugin with specific tools
 * const names = toolsFromPlugin(webSearchPlugin, ["search", "extract"]);
 * // Returns: ["mcp__web-search__search", "mcp__web-search__extract"]
 * ```
 *
 * @category Tools
 */
export function toolsFromPlugin(plugin: PluginOptions, mcpToolNames?: string[]): string[] {
  // If it's an MCP plugin
  if (plugin.mcpServer) {
    if (!mcpToolNames || mcpToolNames.length === 0) {
      throw new Error(
        `MCP plugin "${plugin.name}" requires explicit tool names. ` +
          `Use toolsFromPlugin(plugin, ["toolName1", "toolName2"]) or mcpTools("${plugin.name}")("toolName").`,
      );
    }
    const helper = mcpTools(plugin.name);
    return mcpToolNames.map(helper);
  }

  // Regular plugin with tools
  if (plugin.tools) {
    if (typeof plugin.tools === "function") {
      throw new Error(
        `Plugin "${plugin.name}" uses dynamic tools (StreamingToolsFactory). ` +
          `Tool names cannot be extracted statically. Use string tool names instead.`,
      );
    }
    return Object.keys(plugin.tools);
  }

  return [];
}

/**
 * Extracts tool names from various sources.
 *
 * Accepts strings, plugins, tool sets, or arrays of these and returns
 * a flat array of tool name strings.
 *
 * @param refs - Tool references to extract names from
 * @returns Array of tool name strings
 *
 * @example
 * ```typescript
 * // Mix of different reference types
 * const tools = toolsFrom(
 *   "read",                           // String
 *   "write",
 *   myPlugin,                         // Plugin (extracts tool names)
 *   { custom: customTool },           // ToolSet (extracts keys)
 * );
 *
 * const subagent = createSubagent(parent, {
 *   allowedTools: tools,
 * });
 * ```
 *
 * @category Tools
 */
export function toolsFrom(...refs: ToolReference[]): string[] {
  const names: string[] = [];

  for (const ref of refs) {
    if (typeof ref === "string") {
      names.push(ref);
    } else if (Array.isArray(ref)) {
      names.push(...toolsFrom(...ref));
    } else if (isPlugin(ref)) {
      // For plugins, extract tool names (throws for MCP without explicit names)
      try {
        names.push(...toolsFromPlugin(ref));
      } catch {
        // MCP plugin without tool names - skip with warning
        console.warn(
          `Skipping MCP plugin "${ref.name}" in toolsFrom(). ` +
            `Use toolsFromPlugin(plugin, ["tool1", "tool2"]) for MCP plugins.`,
        );
      }
    } else if (isToolSet(ref)) {
      names.push(...Object.keys(ref));
    }
    // Tool objects without names are skipped - they need to be in a ToolSet
  }

  return names;
}

/**
 * Type guard to check if a value is a Plugin.
 * @internal
 */
function isPlugin(value: unknown): value is PluginOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof (value as PluginOptions).name === "string"
  );
}

/**
 * Type guard to check if a value is a ToolSet.
 * @internal
 */
function isToolSet(value: unknown): value is ToolSet {
  if (typeof value !== "object" || value === null) return false;
  // A ToolSet is a Record<string, Tool>
  // Check that it's not a Plugin (which also has string keys)
  if ("name" in value && typeof (value as PluginOptions).name === "string") {
    return false;
  }
  // Check if all values look like tools (have execute function)
  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  return entries.every(([, v]) => typeof v === "object" && v !== null && "execute" in v);
}
