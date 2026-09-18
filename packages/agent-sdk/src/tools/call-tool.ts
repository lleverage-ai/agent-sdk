/**
 * Proxy tool for invoking registered-but-not-loaded tools.
 *
 * The `call_tool` meta-tool enables stable tool schemas by allowing agents
 * to discover tools via `search_tools` and invoke them via `call_tool(name, args)`.
 * The active ToolSet never changes, preserving prompt cache prefixes.
 *
 * @packageDocumentation
 */

import type { Tool, ToolExecutionOptions } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { MCPManager } from "../mcp/manager.js";
import type { ExtendedToolExecutionOptions, StreamingContext } from "../types.js";

type ProxyToolExecutionOptions = Partial<ExtendedToolExecutionOptions> & {
  streamingContext?: StreamingContext | null;
};

/**
 * Options for creating the call_tool proxy tool.
 *
 * @category Tools
 */
export interface CallToolOptions {
  /**
   * Discovery manager for looking up inline plugin tools and external MCP tools.
   */
  mcpManager?: MCPManager;

  /**
   * Optional fallback streaming context for proxied function-based tools.
   *
   * When provided, deferred plugin tools created from a {@link StreamingContext}
   * receive the live writer when invoked via `call_tool`.
   *
   * This is primarily for request-scoped call_tool instances created in streaming flows.
   */
  streamingContext?: StreamingContext | null;

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
 * });
 *
 * // Agent uses:
 * // search_tools({ query: "payment" })  → finds stripe__create_payment
 * // call_tool({ tool_name: "stripe__create_payment", arguments: { amount: 100 } })
 * ```
 *
 * @category Tools
 */
export function createCallToolTool(options: CallToolOptions): Tool {
  const { mcpManager, onBeforeCall, onAfterCall, streamingContext } = options;

  return tool({
    description:
      "Call a tool by name. Use this to invoke tools discovered via search_tools " +
      "that are not directly available as top-level tools. Pass the qualified tool name from " +
      "search_tools results and the arguments matching the tool's parameter schema.",
    inputSchema: z.object({
      tool_name: z.string().describe("Qualified tool name from search_tools results"),
      arguments: z
        .record(z.string(), z.unknown())
        .default({})
        .describe("Arguments matching the tool's parameter schema"),
    }),
    execute: async (
      {
        tool_name,
        arguments: args,
      }: {
        tool_name: string;
        arguments: Record<string, unknown>;
      },
      execOptions?: ToolExecutionOptions<unknown>,
    ) => {
      // Fire pre-call hook with the proxied tool name
      await onBeforeCall?.(tool_name, args);

      let result: unknown;

      // Look up tool in MCPManager (covers both inline plugin tools and external MCP)
      if (mcpManager) {
        const metadata = mcpManager.getToolMetadata(tool_name);
        if (metadata) {
          try {
            const proxyExecutionOptions = execOptions as ProxyToolExecutionOptions | undefined;
            const requestStreamingContext =
              proxyExecutionOptions?.streamingContext ?? streamingContext ?? null;

            result = await mcpManager.callTool(tool_name, args, {
              ...proxyExecutionOptions,
              streamingContext: requestStreamingContext,
            });
            await onAfterCall?.(tool_name, args, result);
            return formatResult(tool_name, result);
          } catch (error) {
            if (isInterruptSignalLike(error)) {
              throw error;
            }
            return formatError(tool_name, error);
          }
        }
      }

      const suggestions = mcpManager ? suggestNearMissTools(mcpManager, tool_name) : [];
      return suggestions.length > 0
        ? `Error: Tool "${tool_name}" not found. Closest available tools: ${formatToolNameList(suggestions)}. Call one of them by its exact name.`
        : `Error: Tool "${tool_name}" not found. Use search_tools to discover available tools.`;
    },
  });
}

/** Maximum number of near-miss suggestions named in an unknown-tool error. */
export const NEAR_MISS_SUGGESTION_LIMIT = 3;

/**
 * Names the closest discoverable tools for an unknown tool name.
 *
 * A near-miss name (`skills__update_skill` for `skills__change_skill_draft`)
 * otherwise fails with a bare "not found" and a pointer at `search_tools`,
 * costing a search round trip per miss and, intermittently, a model that
 * concludes the tool does not exist. Suggestions are names only; nothing is
 * auto-executed. The requested name is never suggested back, and a failing
 * search yields no suggestions rather than an error.
 *
 * @param mcpManager - Manager whose search index ranks candidates
 * @param toolName - The unknown name the model asked for
 * @returns Up to {@link NEAR_MISS_SUGGESTION_LIMIT} tool names, best first
 *
 * @category Tools
 */
export function suggestNearMissTools(mcpManager: MCPManager, toolName: string): string[] {
  try {
    return (
      mcpManager
        // Deliberately `limit`, not `limit + 1`: the requested name is unknown,
        // so it can only appear in results through a stubbed search. Hosts pin
        // this exact call (`searchTools(name, 3)`) as their compatibility golden.
        .searchTools(toolName, NEAR_MISS_SUGGESTION_LIMIT)
        .map((metadata) => metadata.name)
        .filter((name) => name !== toolName)
    );
  } catch {
    return [];
  }
}

/**
 * Formats tool names as a backticked, comma-separated list for error text.
 *
 * @internal
 */
export function formatToolNameList(names: string[]): string {
  return names.map((name) => `\`${name}\``).join(", ");
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

function isInterruptSignalLike(error: unknown): boolean {
  return error instanceof Error && error.name === "InterruptSignal" && "interrupt" in error;
}
