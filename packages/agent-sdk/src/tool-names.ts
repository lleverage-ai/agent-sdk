/**
 * Internal helpers for qualified tool naming.
 *
 * @packageDocumentation
 */

/**
 * Prefix for tools provided by external MCP servers.
 *
 * @internal
 */
export const MCP_TOOL_PREFIX = "mcp__";

/**
 * Format a qualified name for an external MCP tool.
 *
 * @internal
 */
export function formatMcpToolName(sourceName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${sourceName}__${toolName}`;
}

/**
 * Format a qualified name for an inline plugin tool.
 *
 * @throws {Error} When the plugin name would collide with the reserved `mcp__` namespace
 *
 * @internal
 */
export function formatPluginToolName(pluginName: string, toolName: string): string {
  const qualifiedToolName = `${pluginName}__${toolName}`;
  if (qualifiedToolName.startsWith(MCP_TOOL_PREFIX)) {
    throw new Error(
      `Inline plugin name "${pluginName}" is reserved because it collides with the mcp__ namespace.`,
    );
  }
  return qualifiedToolName;
}

/**
 * Check whether a tool name refers to an external MCP tool.
 *
 * @internal
 */
export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX);
}
