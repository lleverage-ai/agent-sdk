/**
 * MCP Manager for unified tool management.
 *
 * Handles both inline plugin tools (via VirtualMCPServer) and
 * external MCP servers (via official SDK).
 *
 * @packageDocumentation
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type Tool, type ToolSet, tool } from "ai";
import type {
  HttpMCPServerConfig,
  MCPServerConfig,
  SseMCPServerConfig,
  StdioMCPServerConfig,
} from "../types.js";
import { expandEnvVars } from "./env.js";
import type { MCPToolLoadResult, MCPToolMetadata, MCPToolSource } from "./types.js";
import { isSchemaEmpty, jsonSchemaToZod, MCPInputValidator } from "./validation.js";
import { VirtualMCPServer } from "./virtual-server.js";

/**
 * Connected external MCP client with metadata.
 * @internal
 */
interface ConnectedClient {
  client: Client;
  sourceType: MCPToolSource;
  tools: MCPToolMetadata[];
  config: MCPServerConfig;
}

/**
 * Options for MCPManager initialization.
 * @category MCP
 */
export interface MCPManagerOptions {
  /** Hook callbacks for MCP lifecycle events */
  onConnectionFailed?: (input: {
    server_name: string;
    config: MCPServerConfig;
    error: Error;
  }) => void | Promise<void>;

  onConnectionRestored?: (input: {
    server_name: string;
    tool_count: number;
  }) => void | Promise<void>;
}

/**
 * Manages MCP tool registration, discovery, and execution.
 *
 * Provides a unified interface for tools from:
 * - Inline plugin definitions (wrapped as virtual MCP servers)
 * - External MCP servers (stdio, http, sse)
 *
 * @example
 * ```typescript
 * const manager = new MCPManager();
 *
 * // Register inline plugin tools
 * manager.registerPluginTools("my-plugin", { myTool: tool(...) });
 *
 * // Connect to external MCP server
 * await manager.connectServer("github", {
 *   type: "stdio",
 *   command: "npx",
 *   args: ["-y", "@modelcontextprotocol/server-github"],
 *   env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
 * });
 *
 * // Search and use tools
 * const tools = manager.searchTools("github issues");
 * const toolSet = manager.getToolSet();
 * ```
 *
 * @category MCP
 */
export class MCPManager {
  /** Virtual servers for inline plugin tools */
  private virtualServers: Map<string, VirtualMCPServer> = new Map();

  /** Connected external MCP clients */
  private externalClients: Map<string, ConnectedClient> = new Map();

  /** Cached tool metadata for search */
  private toolMetadataCache: MCPToolMetadata[] = [];

  /** Whether cache needs refresh */
  private cacheInvalid = true;

  /** Set of tools that are loaded and available for use */
  private loadedTools: Set<string> = new Set();

  /** Track which servers have auto-load enabled */
  private autoLoadServers: Set<string> = new Set();

  /** Connection failure callback */
  private onConnectionFailed?: MCPManagerOptions["onConnectionFailed"];

  /** Connection restored callback */
  private onConnectionRestored?: MCPManagerOptions["onConnectionRestored"];

  /** Input validator for MCP tools */
  private validator: MCPInputValidator = new MCPInputValidator();

  /**
   * Creates a new MCP manager.
   *
   * @param options - Configuration options including hook callbacks
   */
  constructor(options: MCPManagerOptions = {}) {
    this.onConnectionFailed = options.onConnectionFailed;
    this.onConnectionRestored = options.onConnectionRestored;
  }

  /**
   * Check if any external MCP servers are connected or plugin tools are registered.
   *
   * @returns True if there are external MCP servers or registered plugin tools
   *
   * @category MCP
   */
  hasServers(): boolean {
    return this.externalClients.size > 0 || this.virtualServers.size > 0;
  }

  /**
   * Check if any external MCP servers (not plugin tools) are connected.
   *
   * @returns True if there are external MCP servers
   *
   * @category MCP
   */
  hasExternalServers(): boolean {
    return this.externalClients.size > 0;
  }

  /**
   * Connect to an external MCP server.
   *
   * @param name - Unique name for this server (used in tool naming)
   * @param config - Server connection configuration
   * @throws If server with same name is already connected
   *
   * @example
   * ```typescript
   * // Connect to stdio server
   * await manager.connectServer("github", {
   *   type: "stdio",
   *   command: "npx",
   *   args: ["-y", "@modelcontextprotocol/server-github"],
   *   env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
   * });
   *
   * // Connect to HTTP server
   * await manager.connectServer("docs", {
   *   type: "http",
   *   url: "https://docs.example.com/mcp",
   *   headers: { Authorization: "Bearer ${API_TOKEN}" },
   * });
   * ```
   */
  async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    // Check for duplicate
    if (this.externalClients.has(name) || this.virtualServers.has(name)) {
      throw new Error(`Server '${name}' is already connected`);
    }

    try {
      // Create transport based on config type
      const transport = this.createTransport(config);

      // Create and connect client
      const client = new Client({
        name: `agent-sdk-${name}`,
        version: "1.0.0",
      });

      await client.connect(transport);

      // Fetch available tools
      const { tools: serverTools } = await client.listTools();

      // Convert to MCPToolMetadata and apply security filters
      const sourceType = config.type as MCPToolSource;
      const allowedToolsSet = config.allowedTools ? new Set(config.allowedTools) : null;

      const tools: MCPToolMetadata[] = [];
      for (const t of serverTools) {
        // Apply allowlist filter
        if (allowedToolsSet && !allowedToolsSet.has(t.name)) {
          continue; // Skip tools not in allowlist
        }

        const schema = (t.inputSchema as MCPToolMetadata["inputSchema"]) ?? {
          type: "object",
          properties: {},
        };

        // Apply requireSchema filter
        if (config.requireSchema && isSchemaEmpty(schema)) {
          continue; // Skip tools without meaningful schema
        }

        const mcpName = `mcp__${name}__${t.name}`;
        tools.push({
          name: mcpName,
          description: t.description ?? "",
          inputSchema: schema,
          source: name,
          sourceType,
        });

        // Register schema for validation if enabled
        if (config.validateInputs) {
          this.validator.registerSchema(mcpName, schema);
        }
      }

      // Store client and metadata
      this.externalClients.set(name, { client, sourceType, tools, config });
      this.cacheInvalid = true;

      // Auto-load external server tools (they're always available once connected)
      for (const t of tools) {
        this.loadedTools.add(t.name);
      }

      // Emit connection restored event (for reconnections)
      await this.onConnectionRestored?.({
        server_name: name,
        tool_count: tools.length,
      });
    } catch (error) {
      // Emit connection failed event
      await this.onConnectionFailed?.({
        server_name: name,
        config,
        error: error as Error,
      });

      // Re-throw the error
      throw error;
    }
  }

  /**
   * Create transport for MCP connection.
   * @internal
   */
  private createTransport(config: MCPServerConfig) {
    switch (config.type) {
      case "stdio": {
        const stdioConfig = config as StdioMCPServerConfig;
        return new StdioClientTransport({
          command: stdioConfig.command,
          args: stdioConfig.args,
          env: stdioConfig.env ? expandEnvVars(stdioConfig.env) : undefined,
        });
      }
      case "http": {
        const httpConfig = config as HttpMCPServerConfig;
        const url = new URL(expandEnvVars(httpConfig.url));
        return new StreamableHTTPClientTransport(url, {
          requestInit: httpConfig.headers
            ? { headers: expandEnvVars(httpConfig.headers) }
            : undefined,
        });
      }
      case "sse": {
        const sseConfig = config as SseMCPServerConfig;
        const url = new URL(expandEnvVars(sseConfig.url));
        return new SSEClientTransport(url, {
          requestInit: sseConfig.headers
            ? { headers: expandEnvVars(sseConfig.headers) }
            : undefined,
        });
      }
      default:
        throw new Error(`Unknown MCP server type: ${(config as MCPServerConfig).type}`);
    }
  }

  /**
   * Register inline plugin tools as a virtual MCP server.
   *
   * Tools will be exposed with naming pattern `mcp__<pluginName>__<toolName>`.
   *
   * @param pluginName - Plugin/server name
   * @param tools - AI SDK tools to register
   * @param options - Registration options
   */
  registerPluginTools(
    pluginName: string,
    tools: ToolSet,
    options: { autoLoad?: boolean } = {},
  ): void {
    const { autoLoad = true } = options;

    const server = new VirtualMCPServer(pluginName, tools);
    this.virtualServers.set(pluginName, server);
    this.cacheInvalid = true;

    // Track auto-load setting and mark tools as loaded if auto-load is enabled
    if (autoLoad) {
      this.autoLoadServers.add(pluginName);
      // Mark all tools from this server as loaded
      const serverTools = server.getToolSet();
      for (const name of Object.keys(serverTools)) {
        this.loadedTools.add(name);
      }
    }
  }

  /**
   * List all available tools from all sources.
   *
   * @returns Array of tool metadata
   */
  listTools(): MCPToolMetadata[] {
    this.refreshCacheIfNeeded();
    return [...this.toolMetadataCache];
  }

  /**
   * Search tools by query string.
   *
   * Matches against tool name and description (case-insensitive).
   *
   * @param query - Search query
   * @param limit - Maximum results to return
   * @returns Matching tool metadata
   */
  searchTools(query: string, limit = 10): MCPToolMetadata[] {
    this.refreshCacheIfNeeded();

    if (!query) {
      return this.toolMetadataCache.slice(0, limit);
    }

    const lowerQuery = query.toLowerCase();
    const matches = this.toolMetadataCache.filter(
      (tool) =>
        tool.name.toLowerCase().includes(lowerQuery) ||
        tool.description.toLowerCase().includes(lowerQuery),
    );

    return matches.slice(0, limit);
  }

  /**
   * Get AI SDK compatible ToolSet.
   *
   * Only returns tools that have been loaded (either via autoLoad or explicit loadTools call).
   *
   * @param filter - Optional list of tool names to include
   * @returns ToolSet with MCP-named tools
   */
  getToolSet(filter?: string[]): ToolSet {
    const toolSet: ToolSet = {};
    const filterSet = filter ? new Set(filter) : null;

    // Include virtual server tools (only if loaded)
    for (const server of this.virtualServers.values()) {
      const serverTools = server.getToolSet();
      for (const [name, t] of Object.entries(serverTools)) {
        // Only include if loaded and passes filter
        if (this.loadedTools.has(name)) {
          if (!filterSet || filterSet.has(name)) {
            toolSet[name] = t;
          }
        }
      }
    }

    // Include external server tools (only if loaded)
    for (const [serverName, { tools }] of this.externalClients) {
      for (const metadata of tools) {
        if (this.loadedTools.has(metadata.name)) {
          if (!filterSet || filterSet.has(metadata.name)) {
            toolSet[metadata.name] = this.createExternalTool(serverName, metadata);
          }
        }
      }
    }

    return toolSet;
  }

  /**
   * Extract text result from MCP tool response.
   * @internal
   */
  private extractTextResult(result: unknown): unknown {
    if (result && typeof result === "object" && "content" in result) {
      const content = (result as { content: unknown }).content;
      if (Array.isArray(content)) {
        const textContent = content.find((c: { type: string }) => c.type === "text");
        if (textContent && "text" in textContent) {
          return (textContent as { text: string }).text;
        }
      }
    }
    return typeof result === "object" ? JSON.stringify(result) : result;
  }

  /**
   * Create an AI SDK tool for an external MCP tool.
   * @internal
   */
  private createExternalTool(serverName: string, metadata: MCPToolMetadata): Tool {
    const originalName = metadata.name.replace(`mcp__${serverName}__`, "");

    // Convert JSON Schema to Zod schema for tighter model-facing validation
    // This gives the AI model better constraints about what inputs are valid
    const conversionResult = jsonSchemaToZod(metadata.inputSchema);
    const inputSchema = conversionResult.schema;

    return tool({
      description: metadata.description,
      inputSchema,
      execute: async (args) => {
        const connected = this.externalClients.get(serverName);
        if (!connected) {
          throw new Error(`Server '${serverName}' is not connected`);
        }

        // Validate inputs if enabled for this server (belt-and-suspenders with Zod)
        if (connected.config.validateInputs) {
          this.validator.validate(metadata.name, args);
        }

        const result = await connected.client.callTool({
          name: originalName,
          arguments: args as Record<string, unknown>,
        });

        return this.extractTextResult(result);
      },
    });
  }

  /**
   * Call a tool by its MCP name.
   *
   * @param mcpName - Full MCP tool name (mcp__<source>__<tool>)
   * @param args - Tool arguments
   * @returns Tool execution result
   */
  async callTool(mcpName: string, args: unknown): Promise<unknown> {
    // Parse MCP name: mcp__<source>__<tool>
    const parts = mcpName.split("__");
    if (parts.length < 3 || parts[0] !== "mcp") {
      throw new Error(`Invalid MCP tool name format: ${mcpName}`);
    }

    // Try to find a matching server
    // Start by assuming the tool name is just the last part
    for (let i = parts.length - 1; i >= 2; i--) {
      const sourceName = parts.slice(1, i).join("__");
      const toolName = parts.slice(i).join("__");

      // Check virtual servers first
      const virtualServer = this.virtualServers.get(sourceName);
      if (virtualServer?.hasTool(toolName)) {
        return virtualServer.callTool(toolName, args);
      }

      // Check external clients
      const externalClient = this.externalClients.get(sourceName);
      if (externalClient) {
        const hasMatchingTool = externalClient.tools.some((t) => t.name === mcpName);
        if (hasMatchingTool) {
          // Validate inputs if enabled for this server
          if (externalClient.config.validateInputs) {
            this.validator.validate(mcpName, args);
          }

          const result = await externalClient.client.callTool({
            name: toolName,
            arguments: args as Record<string, unknown>,
          });

          return this.extractTextResult(result);
        }
      }
    }

    throw new Error(`Tool not found: ${mcpName}`);
  }

  /**
   * Load specific tools by name, making them available via getToolSet().
   *
   * @param toolNames - MCP tool names to load
   * @returns Load result with loaded/alreadyLoaded/notFound lists
   */
  loadTools(toolNames: string[]): MCPToolLoadResult {
    this.refreshCacheIfNeeded();
    const loaded: string[] = [];
    const alreadyLoaded: string[] = [];
    const notFound: string[] = [];

    for (const name of toolNames) {
      const metadata = this.toolMetadataCache.find((t) => t.name === name);
      if (metadata) {
        if (this.loadedTools.has(name)) {
          alreadyLoaded.push(name);
        } else {
          this.loadedTools.add(name);
          loaded.push(name);
        }
      } else {
        notFound.push(name);
      }
    }

    return { loaded, alreadyLoaded, notFound };
  }

  /**
   * Disconnect all external MCP servers.
   */
  async disconnect(): Promise<void> {
    // Close external clients
    for (const { client } of this.externalClients.values()) {
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
    }
    this.externalClients.clear();

    // Clear virtual servers
    this.virtualServers.clear();
    this.cacheInvalid = true;

    // Clear all validators
    this.validator.clear();
  }

  /**
   * Refresh metadata cache if invalid.
   */
  private refreshCacheIfNeeded(): void {
    if (!this.cacheInvalid) return;

    this.toolMetadataCache = [];

    // Add virtual server tools
    for (const server of this.virtualServers.values()) {
      this.toolMetadataCache.push(...server.getToolMetadata());
    }

    // Add external server tools
    for (const { tools } of this.externalClients.values()) {
      this.toolMetadataCache.push(...tools);
    }

    this.cacheInvalid = false;
  }
}
