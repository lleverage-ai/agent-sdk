/**
 * MCP-specific type definitions.
 *
 * @packageDocumentation
 */

import type { JSONSchema7 } from "json-schema";

/**
 * Source type for discovered tools managed by {@link MCPManager}.
 *
 * - `inline` - Tool defined in plugin code
 * - `stdio` - Tool from stdio-based MCP server
 * - `http` - Tool from HTTP-based MCP server
 * - `sse` - Tool from SSE-based MCP server
 *
 * @category MCP
 */
export type MCPToolSource = "inline" | "stdio" | "http" | "sse";

/**
 * Metadata for an MCP tool.
 *
 * Used for tool discovery and search without loading full tool definition.
 *
 * @category MCP
 */
export interface MCPToolMetadata {
  /**
   * Qualified tool name.
   *
   * Formats:
   * - `<plugin>__<tool-name>` for inline plugins
   * - `mcp__<source>__<tool-name>` for external MCP servers
   */
  name: string;

  /** Human-readable description of what the tool does */
  description: string;

  /** JSON Schema for the tool's input parameters */
  inputSchema: JSONSchema7;

  /** Plugin or server name this tool comes from */
  source: string;

  /** How this tool is provided */
  sourceType: MCPToolSource;
}

/**
 * Result from loading MCP tools.
 *
 * @category MCP
 */
export interface MCPToolLoadResult {
  /** Tools that were successfully loaded */
  loaded: string[];

  /** Tools that were already loaded (skipped) */
  alreadyLoaded: string[];

  /** Tools that could not be found */
  notFound: string[];

  /** Any errors that occurred during loading */
  errors?: Array<{ tool: string; error: Error }>;
}
