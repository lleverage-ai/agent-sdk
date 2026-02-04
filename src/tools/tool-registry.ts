/**
 * Tool Registry for progressive tool disclosure.
 *
 * The ToolRegistry enables deferred tool loading to keep initial context small.
 * Instead of loading all tool schemas upfront, tools are registered with lightweight
 * metadata and loaded on-demand when the agent needs them.
 *
 * This mirrors the MCP Tool Search pattern used in Claude Code, where hundreds
 * of tools can be available without consuming context window until needed.
 *
 * @packageDocumentation
 */

import type { Tool, ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod";

// =============================================================================
// Types
// =============================================================================

/**
 * Lightweight metadata for a registered tool.
 *
 * This is what the agent sees before loading - just enough information
 * to decide whether to load the full tool definition.
 *
 * @category Tools
 */
export interface ToolMetadata {
  /** Tool name (unique identifier) */
  name: string;

  /** Brief description for search/discovery */
  description: string;

  /** Plugin that provides this tool (if any) */
  plugin?: string;

  /** Category for grouping related tools */
  category?: string;

  /** Tags for semantic search */
  tags?: string[];
}

/**
 * Internal entry in the tool registry.
 */
interface ToolEntry {
  /** Tool metadata (always available) */
  metadata: ToolMetadata;

  /** Full tool definition (loaded on demand) */
  tool: Tool;

  /** Whether this tool is currently loaded/active */
  loaded: boolean;
}

/**
 * Result from loading tools.
 *
 * @category Tools
 */
export interface ToolLoadResult {
  /** Whether loading was successful */
  success: boolean;

  /** Names of tools that were loaded */
  loaded: string[];

  /** Names of tools that were already loaded (skipped) */
  skipped: string[];

  /** Names of tools that weren't found */
  notFound: string[];

  /** The loaded tools as a ToolSet */
  tools: ToolSet;

  /** Error message if something went wrong */
  error?: string;
}

/**
 * Options for creating a tool registry.
 *
 * @category Tools
 */
export interface ToolRegistryOptions {
  /**
   * Callback when tools are loaded.
   */
  onToolsLoaded?: (result: ToolLoadResult) => void;

  /**
   * Callback when the registry is updated.
   */
  onRegistryUpdated?: () => void;

  /**
   * Callback when a tool is registered.
   */
  onToolRegistered?: (input: {
    tool_name: string;
    description: string;
    source?: string;
  }) => void | Promise<void>;

  /**
   * Callback when a tool fails to load.
   */
  onToolLoadError?: (input: {
    tool_name: string;
    error: Error;
    source?: string;
  }) => void | Promise<void>;
}

/**
 * Options for searching tools.
 *
 * @category Tools
 */
export interface ToolSearchOptions {
  /** Search query (matches name, description, tags) */
  query?: string;

  /** Filter by plugin name */
  plugin?: string;

  /** Filter by category */
  category?: string;

  /** Filter by tags (any match) */
  tags?: string[];

  /** Include already-loaded tools in results */
  includeLoaded?: boolean;

  /** Maximum results to return */
  limit?: number;
}

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * Registry for managing tools with deferred loading.
 *
 * The ToolRegistry stores tools with lightweight metadata and loads full
 * definitions on-demand. This enables agents to have access to hundreds of
 * tools without consuming context window until needed.
 *
 * @example
 * ```typescript
 * const registry = new ToolRegistry();
 *
 * // Register tools (does not load them)
 * registry.register({
 *   name: "stripe_create_payment",
 *   description: "Create a payment intent in Stripe",
 *   plugin: "stripe",
 *   tool: stripeCreatePaymentTool,
 * });
 *
 * // Agent searches for tools
 * const matches = registry.search({ query: "payment" });
 * // Returns: [{ name: "stripe_create_payment", description: "..." }]
 *
 * // Agent loads tools when needed
 * const result = registry.load(["stripe_create_payment"]);
 * // Tools are now available for use
 * ```
 *
 * @category Tools
 */
export class ToolRegistry {
  /** All registered tools */
  private entries = new Map<string, ToolEntry>();

  /** Callbacks */
  private onToolsLoaded?: (result: ToolLoadResult) => void;
  private onRegistryUpdated?: () => void;
  private onToolRegistered?: ToolRegistryOptions["onToolRegistered"];
  private onToolLoadError?: ToolRegistryOptions["onToolLoadError"];

  /**
   * Creates a new tool registry.
   *
   * @param options - Configuration options
   */
  constructor(options: ToolRegistryOptions = {}) {
    this.onToolsLoaded = options.onToolsLoaded;
    this.onRegistryUpdated = options.onRegistryUpdated;
    this.onToolRegistered = options.onToolRegistered;
    this.onToolLoadError = options.onToolLoadError;
  }

  /**
   * Register a tool with the registry.
   *
   * The tool is stored but not loaded - only metadata is exposed until
   * the tool is explicitly loaded.
   *
   * @param metadata - Tool metadata
   * @param toolDef - The full tool definition
   * @throws Error if a tool with the same name is already registered
   *
   * @example
   * ```typescript
   * registry.register(
   *   {
   *     name: "send_email",
   *     description: "Send an email via SMTP",
   *     plugin: "email",
   *     category: "communication",
   *     tags: ["email", "notification"],
   *   },
   *   sendEmailTool
   * );
   * ```
   */
  register(metadata: ToolMetadata, toolDef: Tool): void {
    if (this.entries.has(metadata.name)) {
      throw new Error(`Tool '${metadata.name}' is already registered`);
    }

    this.entries.set(metadata.name, {
      metadata,
      tool: toolDef,
      loaded: false,
    });

    this.onRegistryUpdated?.();

    // Emit tool registered event
    void this.onToolRegistered?.({
      tool_name: metadata.name,
      description: metadata.description,
      source: metadata.plugin,
    });
  }

  /**
   * Register multiple tools at once.
   *
   * @param tools - Array of [metadata, tool] tuples
   *
   * @example
   * ```typescript
   * registry.registerMany([
   *   [{ name: "tool1", description: "..." }, tool1],
   *   [{ name: "tool2", description: "..." }, tool2],
   * ]);
   * ```
   */
  registerMany(tools: Array<[ToolMetadata, Tool]>): void {
    for (const [metadata, toolDef] of tools) {
      this.register(metadata, toolDef);
    }
  }

  /**
   * Register all tools from a plugin.
   *
   * Convenience method that extracts tool metadata and registers each tool
   * with the plugin name attached.
   *
   * @param pluginName - Name of the plugin
   * @param tools - ToolSet from the plugin
   * @param options - Optional metadata overrides
   *
   * @example
   * ```typescript
   * registry.registerPlugin("stripe", stripePlugin.tools, {
   *   category: "payments",
   * });
   * ```
   */
  registerPlugin(
    pluginName: string,
    tools: ToolSet,
    options: { category?: string; tags?: string[] } = {},
  ): void {
    for (const [name, toolDef] of Object.entries(tools)) {
      // Extract description from tool definition
      const description =
        (toolDef as { description?: string }).description ?? `Tool from ${pluginName} plugin`;

      this.register(
        {
          name,
          description,
          plugin: pluginName,
          category: options.category,
          tags: options.tags,
        },
        toolDef,
      );
    }
  }

  /**
   * Unregister a tool from the registry.
   *
   * @param name - The tool name to unregister
   * @returns True if the tool was found and removed
   */
  unregister(name: string): boolean {
    const removed = this.entries.delete(name);
    if (removed) {
      this.onRegistryUpdated?.();
    }
    return removed;
  }

  /**
   * Check if a tool is registered.
   *
   * @param name - The tool name to check
   */
  has(name: string): boolean {
    return this.entries.has(name);
  }

  /**
   * Check if a tool is currently loaded.
   *
   * @param name - The tool name to check
   */
  isLoaded(name: string): boolean {
    return this.entries.get(name)?.loaded ?? false;
  }

  /**
   * Get metadata for a registered tool.
   *
   * @param name - The tool name
   * @returns Tool metadata or undefined if not found
   */
  getMetadata(name: string): ToolMetadata | undefined {
    return this.entries.get(name)?.metadata;
  }

  /**
   * Search for tools matching criteria.
   *
   * Searches tool metadata (name, description, tags) without loading
   * the full tool definitions.
   *
   * @param options - Search options
   * @returns Array of matching tool metadata
   *
   * @example
   * ```typescript
   * // Search by query
   * const paymentTools = registry.search({ query: "payment" });
   *
   * // Filter by plugin
   * const stripeTools = registry.search({ plugin: "stripe" });
   *
   * // Combined search
   * const results = registry.search({
   *   query: "create",
   *   plugin: "stripe",
   *   limit: 5,
   * });
   * ```
   */
  search(options: ToolSearchOptions = {}): ToolMetadata[] {
    const { query, plugin, category, tags, includeLoaded = false, limit } = options;

    const results: ToolMetadata[] = [];

    for (const entry of this.entries.values()) {
      // Skip loaded tools unless explicitly included
      if (entry.loaded && !includeLoaded) {
        continue;
      }

      const meta = entry.metadata;

      // Filter by plugin
      if (plugin && meta.plugin !== plugin) {
        continue;
      }

      // Filter by category
      if (category && meta.category !== category) {
        continue;
      }

      // Filter by tags (any match)
      if (tags && tags.length > 0) {
        const hasMatchingTag = tags.some((tag) => meta.tags?.includes(tag));
        if (!hasMatchingTag) {
          continue;
        }
      }

      // Filter by query (matches name, description, or tags)
      if (query) {
        const queryLower = query.toLowerCase();
        const nameMatch = meta.name.toLowerCase().includes(queryLower);
        const descMatch = meta.description.toLowerCase().includes(queryLower);
        const tagMatch = meta.tags?.some((t) => t.toLowerCase().includes(queryLower));

        if (!nameMatch && !descMatch && !tagMatch) {
          continue;
        }
      }

      results.push(meta);

      // Apply limit
      if (limit && results.length >= limit) {
        break;
      }
    }

    return results;
  }

  /**
   * Load tools, making them available for use.
   *
   * @param names - Tool names to load
   * @returns Result containing loaded tools and status
   *
   * @example
   * ```typescript
   * const result = registry.load(["stripe_create_payment", "stripe_refund"]);
   * if (result.success) {
   *   // result.tools contains the loaded ToolSet
   *   // Inject into agent's active tools
   * }
   * ```
   */
  load(names: string[]): ToolLoadResult {
    const loaded: string[] = [];
    const skipped: string[] = [];
    const notFound: string[] = [];
    const tools: ToolSet = {};

    for (const name of names) {
      const entry = this.entries.get(name);

      if (!entry) {
        notFound.push(name);

        // Emit tool load error for not found tools
        void this.onToolLoadError?.({
          tool_name: name,
          error: new Error(`Tool '${name}' not found in registry`),
          source: undefined,
        });

        continue;
      }

      if (entry.loaded) {
        skipped.push(name);
        continue;
      }

      // Mark as loaded
      entry.loaded = true;
      tools[name] = entry.tool;
      loaded.push(name);
    }

    const result: ToolLoadResult = {
      success: notFound.length === 0,
      loaded,
      skipped,
      notFound,
      tools,
      error: notFound.length > 0 ? `Tools not found: ${notFound.join(", ")}` : undefined,
    };

    if (loaded.length > 0) {
      this.onToolsLoaded?.(result);
    }

    return result;
  }

  /**
   * Load tools matching a search query.
   *
   * Convenience method combining search and load.
   *
   * @param options - Search options (same as search())
   * @returns Result containing loaded tools
   *
   * @example
   * ```typescript
   * const result = registry.loadMatching({ query: "stripe", limit: 5 });
   * ```
   */
  loadMatching(options: ToolSearchOptions): ToolLoadResult {
    const matches = this.search({ ...options, includeLoaded: false });
    return this.load(matches.map((m) => m.name));
  }

  /**
   * Get all currently loaded tools as a ToolSet.
   *
   * @returns ToolSet containing all loaded tools
   */
  getLoadedTools(): ToolSet {
    const tools: ToolSet = {};

    for (const [name, entry] of this.entries) {
      if (entry.loaded) {
        tools[name] = entry.tool;
      }
    }

    return tools;
  }

  /**
   * List all available (not yet loaded) tools.
   *
   * @returns Array of tool metadata
   */
  listAvailable(): ToolMetadata[] {
    return this.search({ includeLoaded: false });
  }

  /**
   * List all loaded tools.
   *
   * @returns Array of tool names
   */
  listLoaded(): string[] {
    const loaded: string[] = [];

    for (const [name, entry] of this.entries) {
      if (entry.loaded) {
        loaded.push(name);
      }
    }

    return loaded;
  }

  /**
   * List all registered tools with their load status.
   *
   * @returns Array of tool metadata with loaded flag
   */
  listAll(): Array<ToolMetadata & { loaded: boolean }> {
    return Array.from(this.entries.values()).map((entry) => ({
      ...entry.metadata,
      loaded: entry.loaded,
    }));
  }

  /**
   * Get all plugins that have registered tools.
   *
   * @returns Array of unique plugin names
   */
  listPlugins(): string[] {
    const plugins = new Set<string>();

    for (const entry of this.entries.values()) {
      if (entry.metadata.plugin) {
        plugins.add(entry.metadata.plugin);
      }
    }

    return Array.from(plugins);
  }

  /**
   * Reset all tools to unloaded state.
   *
   * Does not unregister tools, only marks them as unloaded.
   */
  reset(): void {
    for (const entry of this.entries.values()) {
      entry.loaded = false;
    }
  }

  /**
   * Clear all registered tools.
   */
  clear(): void {
    this.entries.clear();
    this.onRegistryUpdated?.();
  }

  /**
   * Get the number of registered tools.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Get the number of loaded tools.
   */
  get loadedCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.loaded) {
        count++;
      }
    }
    return count;
  }

  /**
   * Build the tool index string for the use_tools description.
   *
   * This creates a compact representation of available tools that fits
   * in the meta-tool description.
   *
   * @param options - Formatting options
   * @returns Formatted tool index string
   */
  buildToolIndex(options: { includePlugins?: boolean } = {}): string {
    const { includePlugins = true } = options;

    if (includePlugins) {
      // Group by plugin
      const byPlugin = new Map<string, ToolMetadata[]>();
      const noPlugin: ToolMetadata[] = [];

      for (const entry of this.entries.values()) {
        if (entry.loaded) continue;

        if (entry.metadata.plugin) {
          const list = byPlugin.get(entry.metadata.plugin) ?? [];
          list.push(entry.metadata);
          byPlugin.set(entry.metadata.plugin, list);
        } else {
          noPlugin.push(entry.metadata);
        }
      }

      const lines: string[] = [];

      // Add plugin sections
      for (const [plugin, tools] of byPlugin) {
        lines.push(`[${plugin}]`);
        for (const t of tools) {
          lines.push(`  - ${t.name}: ${t.description}`);
        }
      }

      // Add tools without plugin
      if (noPlugin.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("[other]");
        for (const t of noPlugin) {
          lines.push(`  - ${t.name}: ${t.description}`);
        }
      }

      return lines.join("\n");
    } else {
      // Flat list
      return this.listAvailable()
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n");
    }
  }
}

// =============================================================================
// use_tools Meta-Tool
// =============================================================================

/**
 * Options for creating the use_tools meta-tool.
 *
 * @category Tools
 */
export interface UseToolsToolOptions {
  /** The tool registry to use */
  registry: ToolRegistry;

  /**
   * Custom name for the tool.
   * @defaultValue "use_tools"
   */
  name?: string;

  /**
   * Custom description prefix.
   */
  descriptionPrefix?: string;

  /**
   * Whether to include plugin groupings in tool index.
   * @defaultValue true
   */
  groupByPlugin?: boolean;
}

/**
 * Creates the use_tools meta-tool for discovering and loading tools.
 *
 * This tool allows agents to search available tools and load them on-demand.
 * Tools loaded through this tool become available in subsequent agent steps.
 *
 * @param options - Configuration options
 * @returns An AI SDK compatible tool
 *
 * @example
 * ```typescript
 * const registry = new ToolRegistry();
 * registry.registerPlugin("stripe", stripePlugin.tools);
 *
 * const useToolsTool = createUseToolsTool({ registry });
 *
 * const agent = createAgent({
 *   model,
 *   tools: {
 *     ...coreTools,
 *     use_tools: useToolsTool,
 *   },
 *   toolRegistry: registry,
 * });
 * ```
 *
 * @category Tools
 */
export function createUseToolsTool(options: UseToolsToolOptions) {
  const { registry, descriptionPrefix, groupByPlugin = true } = options;

  // Build dynamic description
  const buildDescription = () => {
    const available = registry.listAvailable();

    if (available.length === 0) {
      return "No additional tools available to load.";
    }

    const prefix =
      descriptionPrefix ??
      `Search and load tools on-demand. Tools loaded become available for use in subsequent actions.`;

    const toolIndex = registry.buildToolIndex({ includePlugins: groupByPlugin });

    return `${prefix}\n\nAvailable tools (${available.length}):\n${toolIndex}`;
  };

  return tool({
    description: buildDescription(),
    inputSchema: z.object({
      query: z.string().optional().describe("Search query to find relevant tools"),
      tools: z.array(z.string()).optional().describe("Specific tool names to load"),
      plugin: z.string().optional().describe("Load all tools from a plugin"),
    }),
    execute: async ({
      query,
      tools: toolNames,
      plugin,
    }: {
      query?: string;
      tools?: string[];
      plugin?: string;
    }) => {
      // Determine which tools to load
      let namesToLoad: string[] = [];

      if (toolNames && toolNames.length > 0) {
        // Explicit tool names
        namesToLoad = toolNames;
      } else if (plugin) {
        // All tools from a plugin
        const matches = registry.search({ plugin, includeLoaded: false });
        namesToLoad = matches.map((m) => m.name);
      } else if (query) {
        // Search by query
        const matches = registry.search({ query, includeLoaded: false });
        namesToLoad = matches.map((m) => m.name);
      } else {
        return {
          success: false,
          error: "Please specify tools to load via 'tools', 'plugin', or 'query'",
        };
      }

      if (namesToLoad.length === 0) {
        return {
          success: false,
          error: "No matching tools found",
          suggestion: "Try a different search query or check available tools",
        };
      }

      // Load the tools
      const result = registry.load(namesToLoad);

      // Build response
      const response: Record<string, unknown> = {
        success: result.success,
        loaded: result.loaded,
      };

      if (result.skipped.length > 0) {
        response.alreadyLoaded = result.skipped;
      }

      if (result.notFound.length > 0) {
        response.notFound = result.notFound;
      }

      if (result.loaded.length > 0) {
        response.message = `Loaded ${result.loaded.length} tool(s): ${result.loaded.join(", ")}. These tools are now available for use.`;
      } else if (result.skipped.length > 0) {
        response.message = `Tools already loaded: ${result.skipped.join(", ")}`;
      } else {
        response.message = "No tools were loaded";
      }

      return response;
    },
  });
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a new tool registry.
 *
 * @param options - Configuration options
 * @returns A new ToolRegistry instance
 *
 * @example
 * ```typescript
 * const registry = createToolRegistry({
 *   onToolsLoaded: (result) => console.log("Loaded:", result.loaded),
 * });
 * ```
 *
 * @category Tools
 */
export function createToolRegistry(options?: ToolRegistryOptions): ToolRegistry {
  return new ToolRegistry(options);
}
