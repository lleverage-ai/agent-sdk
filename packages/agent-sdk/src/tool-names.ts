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

/**
 * Resolve a tool description to a static string.
 *
 * AI SDK 7 allows `Tool.description` to be a function that is evaluated when
 * the request is prepared (the SDK's own `skill` tool uses this so a mutable
 * registry is reflected without recreating the tool). Callers that need a
 * string outside a request — the system-prompt tool listing, MCP metadata —
 * evaluate the function with an empty context and fall back to `""` if it
 * throws.
 *
 * @internal
 */
export function resolveStaticToolDescription(description: unknown): string {
  if (typeof description === "string") {
    return description;
  }
  if (typeof description === "function") {
    try {
      const resolved = (description as (options: { context: unknown }) => unknown)({
        context: undefined,
      });
      return typeof resolved === "string" ? resolved : "";
    } catch {
      return "";
    }
  }
  return "";
}
