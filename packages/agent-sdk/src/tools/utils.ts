/**
 * Tool utilities for improved developer experience.
 *
 * Provides helpers for working with qualified tool names for inline plugins
 * and external MCP servers.
 *
 * @packageDocumentation
 */

import type { Tool, ToolSet } from "ai";
import { formatMcpToolName, formatPluginToolName } from "../tool-names.js";
import type { PluginOptions } from "../types.js";

/**
 * A reference to a tool that can be resolved to a tool name.
 *
 * Can be:
 * - A string (tool name directly)
 * - A Tool object (name extracted from key when in a ToolSet)
 * - A Plugin (all inline plugin tool names extracted, or external MCP tool names generated)
 * - A ToolSet record (all keys extracted as tool names)
 *
 * @category Tools
 */
export type ToolReference = string | Tool | PluginOptions | ToolSet | ToolReference[];

/**
 * Creates a helper for generating qualified tool names for a specific inline plugin.
 *
 * Inline plugin tools use `<plugin-name>__<tool-name>` names. This helper
 * makes it easier to reference these tools without typing the full name.
 *
 * @param pluginName - The inline plugin name (e.g., "web-search")
 * @returns A function that generates full plugin tool names
 *
 * @example
 * ```typescript
 * const webSearch = pluginTools("web-search");
 *
 * const subagent = createSubagent(parent, {
 *   allowedTools: [webSearch("search"), webSearch("extract")],
 *   // Equivalent to: ["web-search__search", "web-search__extract"]
 * });
 * ```
 *
 * @category Tools
 */
export function pluginTools(pluginName: string): (toolName: string) => string {
  return (toolName: string) => formatPluginToolName(pluginName, toolName);
}

/**
 * Creates a helper for a specific inline plugin with known tools.
 *
 * Returns an object with tool name properties for better IDE autocomplete.
 *
 * @param pluginName - The inline plugin name
 * @param toolNames - Array of tool names provided by the plugin
 * @returns An object mapping tool names to their full plugin-namespaced names
 *
 * @example
 * ```typescript
 * const webSearch = pluginToolsFor("web-search", ["search", "extract"] as const);
 *
 * // Now you get autocomplete:
 * webSearch.search  // "web-search__search"
 * webSearch.extract // "web-search__extract"
 *
 * const subagent = createSubagent(parent, {
 *   allowedTools: [webSearch.search, webSearch.extract],
 * });
 * ```
 *
 * @category Tools
 */
export function pluginToolsFor<T extends readonly string[]>(
  pluginName: string,
  toolNames: T,
): { [K in T[number]]: string } {
  const result = {} as { [K in T[number]]: string };
  for (const name of toolNames) {
    (result as Record<string, string>)[name] = formatPluginToolName(pluginName, name);
  }
  return result;
}

/**
 * Creates a helper for generating qualified tool names for an external MCP server.
 *
 * External MCP tools are prefixed with `mcp__<server-name>__<tool-name>`.
 *
 * @param serverName - The MCP server name
 * @returns A function that generates full MCP tool names
 *
 * @category Tools
 */
export function mcpTools(serverName: string): (toolName: string) => string {
  return (toolName: string) => formatMcpToolName(serverName, toolName);
}

/**
 * Creates a helper for a specific external MCP server with known tools.
 *
 * @param serverName - The MCP server name
 * @param toolNames - Array of tool names provided by the server
 * @returns An object mapping tool names to their full MCP names
 *
 * @category Tools
 */
export function mcpToolsFor<T extends readonly string[]>(
  serverName: string,
  toolNames: T,
): { [K in T[number]]: string } {
  const result = {} as { [K in T[number]]: string };
  for (const name of toolNames) {
    (result as Record<string, string>)[name] = formatMcpToolName(serverName, name);
  }
  return result;
}

/**
 * Extracts qualified tool names from a plugin.
 *
 * For inline plugins, returns `<plugin>__<tool>` names.
 * For MCP plugins, generates `mcp__<server>__<tool>` names from the provided
 * tool list.
 *
 * @param plugin - The plugin to extract tool names from
 * @param mcpToolNames - For MCP plugins, the specific tool names to include
 * @returns Array of tool name strings
 *
 * @example
 * ```typescript
 * // Regular plugin with tools
 * const names = toolsFromPlugin(myPlugin);
 * // Returns: ["my-plugin__tool1", "my-plugin__tool2", ...]
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
    const helper = pluginTools(plugin.name);
    return Object.keys(plugin.tools).map(helper);
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
      if (ref.mcpServer) {
        console.warn(
          `Skipping MCP plugin "${ref.name}" in toolsFrom(). ` +
            `Use toolsFromPlugin(plugin, ["tool1", "tool2"]) for MCP plugins.`,
        );
      } else {
        names.push(...toolsFromPlugin(ref));
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
