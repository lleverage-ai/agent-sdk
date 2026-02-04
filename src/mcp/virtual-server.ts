/**
 * Virtual MCP server for inline plugin tools.
 *
 * Wraps AI SDK tools with MCP-compatible naming and metadata
 * without running an actual MCP server process.
 *
 * @packageDocumentation
 */

import type { Tool, ToolSet } from "ai";
import { asSchema } from "ai";
import type { MCPToolMetadata } from "./types.js";

/**
 * Virtual MCP server that wraps inline plugin tools.
 *
 * This provides a consistent interface for tools defined in code,
 * making them appear the same as tools from external MCP servers.
 *
 * @example
 * ```typescript
 * const server = new VirtualMCPServer("my-plugin", {
 *   greet: tool({
 *     description: "Greet someone",
 *     inputSchema: z.object({ name: z.string() }),
 *     execute: async ({ name }) => `Hello, ${name}!`,
 *   }),
 * });
 *
 * const metadata = server.getToolMetadata();
 * // [{ name: "mcp__my-plugin__greet", ... }]
 * ```
 *
 * @category MCP
 */
export class VirtualMCPServer {
  /** Server/plugin name */
  readonly name: string;

  /** Original tools keyed by original name */
  private tools: Map<string, Tool> = new Map();

  /**
   * Create a virtual MCP server.
   *
   * @param name - Server/plugin name (used in mcp__<name>__<tool> naming)
   * @param tools - AI SDK tools to wrap
   */
  constructor(name: string, tools: ToolSet) {
    this.name = name;
    for (const [toolName, tool] of Object.entries(tools)) {
      this.tools.set(toolName, tool);
    }
  }

  /**
   * Get MCP-formatted metadata for all tools.
   *
   * @returns Array of tool metadata with MCP naming
   */
  getToolMetadata(): MCPToolMetadata[] {
    const metadata: MCPToolMetadata[] = [];

    for (const [toolName, tool] of this.tools) {
      const mcpName = `mcp__${this.name}__${toolName}`;

      // Convert FlexibleSchema to JSON Schema using AI SDK's asSchema
      let inputSchema: MCPToolMetadata["inputSchema"] = {
        type: "object",
        properties: {},
      };

      if (tool.inputSchema) {
        try {
          const schema = asSchema(tool.inputSchema);
          // Handle both sync and async jsonSchema (Schema type allows PromiseLike)
          const jsonSchema = schema.jsonSchema;
          if (jsonSchema && typeof jsonSchema === "object") {
            inputSchema = jsonSchema as MCPToolMetadata["inputSchema"];
          }
        } catch {
          // Fall back to empty schema if conversion fails
        }
      }

      metadata.push({
        name: mcpName,
        description: tool.description ?? "",
        inputSchema,
        source: this.name,
        sourceType: "inline",
      });
    }

    return metadata;
  }

  /**
   * Execute a tool by its original name.
   *
   * @param toolName - Original tool name (without mcp__ prefix)
   * @param args - Tool arguments
   * @param abortSignal - Optional abort signal for cancellation
   * @returns Tool execution result
   * @throws If tool not found
   */
  async callTool(toolName: string, args: unknown, abortSignal?: AbortSignal): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in virtual server '${this.name}'`);
    }

    if (!tool.execute) {
      throw new Error(`Tool '${toolName}' has no execute function`);
    }

    return tool.execute(args as Parameters<typeof tool.execute>[0], {
      toolCallId: `virtual-${Date.now()}`,
      messages: [],
      abortSignal: abortSignal ?? new AbortController().signal,
    });
  }

  /**
   * Get AI SDK compatible ToolSet with MCP naming.
   *
   * @returns ToolSet with mcp__<name>__<tool> keys
   */
  getToolSet(): ToolSet {
    const toolSet: ToolSet = {};

    for (const [toolName, tool] of this.tools) {
      const mcpName = `mcp__${this.name}__${toolName}`;
      toolSet[mcpName] = tool;
    }

    return toolSet;
  }

  /**
   * Check if a tool exists by original name.
   *
   * @param toolName - Original tool name
   */
  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Get list of original tool names.
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
