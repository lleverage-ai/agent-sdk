/**
 * Proxy tool for invoking registered-but-not-loaded tools.
 *
 * The `call_tool` meta-tool enables stable tool schemas by allowing agents
 * to discover tools via `search_tools` and invoke them via `call_tool(name, args)`.
 * The active ToolSet never changes, preserving prompt cache prefixes.
 *
 * @packageDocumentation
 */

import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { MCPManager } from "../mcp/manager.js";
import type { ToolRegistry } from "./tool-registry.js";

/**
 * Options for creating the call_tool proxy tool.
 *
 * @category Tools
 */
export interface CallToolOptions {
  /**
   * MCP manager for looking up plugin/MCP tools.
   * Tools registered in MCP (both virtual plugin servers and external servers)
   * are checked first.
   */
  mcpManager?: MCPManager;

  /**
   * Tool registry for looking up lazily-registered tools.
   * Checked as fallback if the tool is not found in MCPManager.
   */
  toolRegistry?: ToolRegistry;

  /**
   * Hook callback to fire before executing the proxied tool.
   * Receives the actual tool name (not "call_tool").
   */
  onBeforeCall?: (toolName: string, args: Record<string, unknown>) => void | Promise<void>;

  /**
   * Hook callback to fire after executing the proxied tool.
   * Receives the actual tool name and result.
   */
  onAfterCall?: (
    toolName: string,
    args: Record<string, unknown>,
    result: unknown,
  ) => void | Promise<void>;
}

/**
 * Creates the `call_tool` proxy tool for invoking registered-but-not-loaded tools.
 *
 * This tool allows agents to call any tool discoverable via `search_tools`
 * without actually loading it into the active tool set. This keeps the
 * ToolSet stable across generations, preserving prompt cache prefixes.
 *
 * @param options - Configuration options
 * @returns AI SDK tool definition
 *
 * @example
 * ```typescript
 * const callTool = createCallToolTool({
 *   mcpManager,
 *   toolRegistry,
 * });
 *
 * // Agent uses:
 * // search_tools({ query: "payment" })  → finds mcp__stripe__create_payment
 * // call_tool({ tool_name: "mcp__stripe__create_payment", arguments: { amount: 100 } })
 * ```
 *
 * @category Tools
 */
export function createCallToolTool(options: CallToolOptions): Tool {
  const { mcpManager, toolRegistry, onBeforeCall, onAfterCall } = options;

  return tool({
    description:
      "Call a tool by name. Use this to invoke tools discovered via search_tools " +
      "that are not directly available as top-level tools. Pass the tool name from " +
      "search_tools results and the arguments matching the tool's parameter schema.",
    inputSchema: z.object({
      tool_name: z.string().describe("Tool name from search_tools results"),
      arguments: z
        .record(z.string(), z.unknown())
        .default({})
        .describe("Arguments matching the tool's parameter schema"),
    }),
    execute: async ({
      tool_name,
      arguments: args,
    }: {
      tool_name: string;
      arguments: Record<string, unknown>;
    }) => {
      // Fire pre-call hook with the proxied tool name
      await onBeforeCall?.(tool_name, args);

      let result: unknown;

      // Try MCPManager first (covers both virtual plugin tools and external MCP)
      if (mcpManager) {
        const metadata = mcpManager.getToolMetadata(tool_name);
        if (metadata) {
          try {
            result = await mcpManager.callTool(tool_name, args);
            await onAfterCall?.(tool_name, args, result);
            return formatResult(tool_name, result);
          } catch (error) {
            return formatError(tool_name, error);
          }
        }
      }

      // Fallback to ToolRegistry
      if (toolRegistry) {
        const toolDef = toolRegistry.getTool(tool_name);
        if (toolDef) {
          try {
            result = await toolRegistry.executeTool(tool_name, args);
            await onAfterCall?.(tool_name, args, result);
            return formatResult(tool_name, result);
          } catch (error) {
            return formatError(tool_name, error);
          }
        }
      }

      return `Error: Tool "${tool_name}" not found. Use search_tools to discover available tools.`;
    },
  });
}

/**
 * Format a successful tool result.
 * @internal
 */
function formatResult(toolName: string, result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/**
 * Format an error from tool execution.
 * @internal
 */
function formatError(toolName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Error executing "${toolName}": ${message}`;
}
