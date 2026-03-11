/**
 * Internal wrapper for inline plugin tools.
 *
 * Wraps AI SDK tools with plugin-namespaced naming and metadata
 * without running an actual MCP server process.
 *
 * @packageDocumentation
 */

import type { Tool, ToolSet } from "ai";
import { asSchema } from "ai";
import { formatPluginToolName } from "../tool-names.js";
import type { StreamingContext, StreamingToolsFactory } from "../types.js";
import type { MCPToolMetadata } from "./types.js";

const DEFAULT_STREAMING_CONTEXT: StreamingContext = { writer: null };

/**
 * Internal wrapper that presents inline plugin tools through the shared discovery interface.
 *
 * This keeps inline plugin tools on the same discovery path as external MCP tools
 * while exposing them as plain `<plugin>__<tool>` names to callers.
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
 * // [{ name: "my-plugin__greet", ... }]
 * ```
 *
 * @category MCP
 */
export class VirtualMCPServer {
  /** Server/plugin name */
  readonly name: string;

  /** Registered tools keyed by original name for metadata/name lookups */
  private tools: Map<string, Tool> = new Map();

  /** Optional factory for streaming-aware inline tools */
  private readonly toolsFactory?: StreamingToolsFactory;

  /**
   * Create an inline plugin tool wrapper.
   *
   * @param name - Plugin name (used in <name>__<tool> naming)
   * @param tools - AI SDK tools or tool factory to wrap
   */
  constructor(name: string, tools: ToolSet | StreamingToolsFactory) {
    this.name = name;
    this.toolsFactory = typeof tools === "function" ? tools : undefined;

    const initialTools = typeof tools === "function" ? tools(DEFAULT_STREAMING_CONTEXT) : tools;

    for (const [toolName, tool] of Object.entries(initialTools)) {
      this.tools.set(toolName, tool);
    }
  }

  /**
   * Get qualified metadata for all tools.
   *
   * @returns Array of tool metadata with plugin-namespaced naming
   */
  getToolMetadata(): MCPToolMetadata[] {
    const metadata: MCPToolMetadata[] = [];

    for (const [toolName, tool] of this.tools) {
      const qualifiedName = formatPluginToolName(this.name, toolName);

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
        } catch (error) {
          console.warn(
            `[VirtualMCPServer] Failed to convert input schema for ${qualifiedName}; using an empty object schema instead.`,
            error,
          );
        }
      }

      metadata.push({
        name: qualifiedName,
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
   * @param toolName - Original tool name (without the plugin namespace)
   * @param args - Tool arguments
   * @param options - Optional execution options
   * @returns Tool execution result
   * @throws If tool not found
   */
  async callTool(
    toolName: string,
    args: unknown,
    options: {
      abortSignal?: AbortSignal;
      streamingContext?: StreamingContext;
    } = {},
  ): Promise<unknown> {
    const tool = this.resolveTool(toolName, options.streamingContext);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in inline plugin '${this.name}'`);
    }

    if (!tool.execute) {
      throw new Error(`Tool '${toolName}' has no execute function`);
    }

    return tool.execute(args as Parameters<typeof tool.execute>[0], {
      toolCallId: `virtual-${Date.now()}`,
      messages: [],
      abortSignal: options.abortSignal ?? new AbortController().signal,
    });
  }

  /**
   * Get AI SDK compatible ToolSet with plugin-namespaced naming.
   *
   * @param streamingContext - Optional streaming context for tool factories
   * @returns ToolSet with <name>__<tool> keys
   */
  getToolSet(streamingContext?: StreamingContext): ToolSet {
    const toolSet: ToolSet = {};

    for (const [toolName, tool] of Object.entries(this.getResolvedTools(streamingContext))) {
      const qualifiedName = formatPluginToolName(this.name, toolName);
      toolSet[qualifiedName] = tool;
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

  /**
   * Resolve a tool definition, invoking the streaming factory when needed.
   * @internal
   */
  private resolveTool(toolName: string, streamingContext?: StreamingContext): Tool | undefined {
    if (!this.toolsFactory) {
      return this.tools.get(toolName);
    }

    return this.toolsFactory(streamingContext ?? DEFAULT_STREAMING_CONTEXT)[toolName];
  }

  /**
   * Get the current tool set, resolving streaming-aware factories when needed.
   * @internal
   */
  private getResolvedTools(streamingContext?: StreamingContext): ToolSet {
    if (!this.toolsFactory) {
      return Object.fromEntries(this.tools.entries());
    }

    return this.toolsFactory(streamingContext ?? DEFAULT_STREAMING_CONTEXT);
  }
}
