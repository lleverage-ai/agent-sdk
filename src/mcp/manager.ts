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
 * Searchable metadata fields.
 * @internal
 */
type SearchFieldName = "name" | "source" | "description" | "schema";

/**
 * Per-field corpus statistics for weighted ranking.
 * @internal
 */
interface SearchFieldStats {
  averageLength: number;
  documentFrequency: Map<string, number>;
}

/**
 * Preprocessed search document.
 * @internal
 */
interface SearchDocument {
  metadata: MCPToolMetadata;
  normalizedName: string;
  normalizedSource: string;
  normalizedDescription: string;
  tokensByField: Record<SearchFieldName, string[]>;
  termFrequencyByField: Record<SearchFieldName, Map<string, number>>;
  tokenList: string[];
  trigrams: Set<string>;
}

/**
 * Precomputed search index.
 * @internal
 */
interface SearchIndex {
  documents: SearchDocument[];
  fieldStats: Record<SearchFieldName, SearchFieldStats>;
}

const SEARCH_FIELDS: SearchFieldName[] = ["name", "source", "description", "schema"];
const SEARCH_FIELD_WEIGHTS: Record<SearchFieldName, number> = {
  name: 5,
  source: 3,
  description: 1,
  schema: 2,
};
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const NAME_PHRASE_BONUS = 8;
const SOURCE_PHRASE_BONUS = 4;
const DESCRIPTION_PHRASE_BONUS = 2;
const PREFIX_BONUS = 4;
const MIN_FUZZY_SCORE = 0.12;

/**
 * Normalize text into lowercase alphanumeric terms.
 * @internal
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Split text into normalized terms.
 * @internal
 */
function tokenizeText(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

/**
 * Build term-frequency map for a token array.
 * @internal
 */
function buildTermFrequency(tokens: string[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  return frequency;
}

/**
 * Extract useful search terms from JSON schema keys and enums.
 * @internal
 */
function extractSchemaTokens(schema: unknown, maxTokens = 64): string[] {
  const tokens: string[] = [];
  const visited = new Set<object>();

  const pushTokens = (value: string): void => {
    for (const token of tokenizeText(value)) {
      if (tokens.length >= maxTokens) return;
      tokens.push(token);
    }
  };

  const visit = (value: unknown): void => {
    if (tokens.length >= maxTokens) return;
    if (!value || typeof value !== "object") return;

    const obj = value as Record<string, unknown>;
    if (visited.has(obj)) return;
    visited.add(obj);

    if (obj.properties && typeof obj.properties === "object") {
      for (const [key, prop] of Object.entries(obj.properties as Record<string, unknown>)) {
        pushTokens(key);
        visit(prop);
        if (tokens.length >= maxTokens) break;
      }
    }

    if (Array.isArray(obj.required)) {
      for (const required of obj.required) {
        if (typeof required === "string") {
          pushTokens(required);
        }
      }
    }

    if (Array.isArray(obj.enum)) {
      for (const enumValue of obj.enum.slice(0, 10)) {
        if (typeof enumValue === "string") {
          pushTokens(enumValue);
        }
      }
    }

    const nestedValue = [
      obj.items,
      obj.anyOf,
      obj.oneOf,
      obj.allOf,
      obj.not,
      obj.if,
      obj.then,
      obj.else,
    ];

    for (const nested of nestedValue) {
      if (Array.isArray(nested)) {
        for (const item of nested) {
          visit(item);
        }
      } else {
        visit(nested);
      }
    }
  };

  visit(schema);
  return tokens;
}

/**
 * Generate trigrams for fuzzy matching.
 * @internal
 */
function toTrigrams(text: string): Set<string> {
  const normalized = normalizeText(text).replace(/\s+/g, " ");
  if (!normalized) return new Set<string>();
  if (normalized.length <= 3) return new Set([normalized]);

  const padded = `  ${normalized}  `;
  const trigrams = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    trigrams.add(padded.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * Compute Jaccard similarity between two sets.
 * @internal
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  let intersection = 0;

  for (const token of smaller) {
    if (larger.has(token)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Build a precomputed search index from tool metadata.
 * @internal
 */
function buildSearchIndex(metadata: MCPToolMetadata[]): SearchIndex {
  const fieldTotalLength: Record<SearchFieldName, number> = {
    name: 0,
    source: 0,
    description: 0,
    schema: 0,
  };
  const fieldDocumentFrequency: Record<SearchFieldName, Map<string, number>> = {
    name: new Map<string, number>(),
    source: new Map<string, number>(),
    description: new Map<string, number>(),
    schema: new Map<string, number>(),
  };

  const documents: SearchDocument[] = metadata.map((tool) => {
    const schemaTokens = extractSchemaTokens(tool.inputSchema);
    const tokensByField: Record<SearchFieldName, string[]> = {
      name: tokenizeText(tool.name),
      source: tokenizeText(tool.source),
      description: tokenizeText(tool.description),
      schema: schemaTokens,
    };

    const termFrequencyByField: Record<SearchFieldName, Map<string, number>> = {
      name: buildTermFrequency(tokensByField.name),
      source: buildTermFrequency(tokensByField.source),
      description: buildTermFrequency(tokensByField.description),
      schema: buildTermFrequency(tokensByField.schema),
    };

    for (const field of SEARCH_FIELDS) {
      const tokens = tokensByField[field];
      fieldTotalLength[field] += tokens.length;
      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        fieldDocumentFrequency[field].set(token, (fieldDocumentFrequency[field].get(token) ?? 0) + 1);
      }
    }

    const tokenSet = new Set<string>([
      ...tokensByField.name,
      ...tokensByField.source,
      ...tokensByField.description,
      ...tokensByField.schema,
    ]);
    const tokenList = Array.from(tokenSet);

    return {
      metadata: tool,
      normalizedName: normalizeText(tool.name),
      normalizedSource: normalizeText(tool.source),
      normalizedDescription: normalizeText(tool.description),
      tokensByField,
      termFrequencyByField,
      tokenList,
      trigrams: toTrigrams(
        [tool.name, tool.source, tool.description, schemaTokens.join(" ")].filter(Boolean).join(" "),
      ),
    };
  });

  const docCount = Math.max(documents.length, 1);
  const fieldStats: Record<SearchFieldName, SearchFieldStats> = {
    name: {
      averageLength: fieldTotalLength.name / docCount,
      documentFrequency: fieldDocumentFrequency.name,
    },
    source: {
      averageLength: fieldTotalLength.source / docCount,
      documentFrequency: fieldDocumentFrequency.source,
    },
    description: {
      averageLength: fieldTotalLength.description / docCount,
      documentFrequency: fieldDocumentFrequency.description,
    },
    schema: {
      averageLength: fieldTotalLength.schema / docCount,
      documentFrequency: fieldDocumentFrequency.schema,
    },
  };

  return { documents, fieldStats };
}

/**
 * Compute BM25 contribution for a single term.
 * @internal
 */
function scoreBm25Term(
  termFrequency: number,
  fieldLength: number,
  averageFieldLength: number,
  idf: number,
): number {
  const normalizedAverageLength = Math.max(averageFieldLength, 1);
  const denominator =
    termFrequency +
    BM25_K1 * (1 - BM25_B + (BM25_B * Math.max(fieldLength, 1)) / normalizedAverageLength);

  if (denominator === 0) return 0;
  return ((termFrequency * (BM25_K1 + 1)) / denominator) * idf;
}

/**
 * Compute partial token match score for fuzzy retrieval.
 * @internal
 */
function scorePartialTokenMatches(queryTokens: string[], docTokens: string[]): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  let totalScore = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const docToken of docTokens) {
      if (docToken === queryToken) {
        best = 1;
        break;
      }
      if (docToken.startsWith(queryToken) || queryToken.startsWith(docToken)) {
        best = Math.max(best, 0.85);
      } else if (docToken.includes(queryToken) || queryToken.includes(docToken)) {
        best = Math.max(best, 0.6);
      }
    }
    totalScore += best;
  }

  return totalScore / queryTokens.length;
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

  /** Precomputed search index for fast ranked lookup */
  private searchIndex: SearchIndex = buildSearchIndex([]);

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
   * Check if a specific tool is currently loaded.
   *
   * @param name - MCP tool name to check
   * @returns True if the tool is loaded and available
   */
  isToolLoaded(name: string): boolean {
    return this.loadedTools.has(name);
  }

  /**
   * Get metadata for a specific tool by name.
   *
   * @param name - MCP tool name
   * @returns Tool metadata or undefined if not found
   */
  getToolMetadata(name: string): MCPToolMetadata | undefined {
    this.refreshCacheIfNeeded();
    return this.toolMetadataCache.find((t) => t.name === name);
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
   * Uses weighted lexical ranking (name/source/description/schema) with
   * fuzzy fallback for typo tolerance.
   *
   * @param query - Search query
   * @param limit - Maximum results to return
   * @returns Matching tool metadata
   */
  searchTools(query: string, limit = 10): MCPToolMetadata[] {
    this.refreshCacheIfNeeded();

    if (!query || limit <= 0) {
      return this.toolMetadataCache.slice(0, limit);
    }

    const normalizedQuery = normalizeText(query);
    const queryTokens = tokenizeText(query);
    if (!normalizedQuery || queryTokens.length === 0) {
      return [];
    }

    const queryTrigrams = toTrigrams(query);
    const docCount = Math.max(this.searchIndex.documents.length, 1);
    const scored = this.searchIndex.documents
      .map((document) => {
        let lexicalScore = 0;

        for (const field of SEARCH_FIELDS) {
          const fieldWeight = SEARCH_FIELD_WEIGHTS[field];
          if (fieldWeight === 0) continue;

          const fieldStats = this.searchIndex.fieldStats[field];
          const termFrequency = document.termFrequencyByField[field];
          const fieldLength = document.tokensByField[field].length;

          for (const token of queryTokens) {
            const tf = termFrequency.get(token) ?? 0;
            if (tf === 0) continue;

            const documentFrequency = fieldStats.documentFrequency.get(token) ?? 0;
            const idf = Math.log(1 + (docCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
            lexicalScore +=
              fieldWeight * scoreBm25Term(tf, fieldLength, fieldStats.averageLength, Math.max(idf, 0));
          }
        }

        if (document.normalizedName.includes(normalizedQuery)) {
          lexicalScore += NAME_PHRASE_BONUS;
        }
        if (document.normalizedName.startsWith(normalizedQuery)) {
          lexicalScore += PREFIX_BONUS;
        }
        if (document.normalizedSource.includes(normalizedQuery)) {
          lexicalScore += SOURCE_PHRASE_BONUS;
        }
        if (document.normalizedDescription.includes(normalizedQuery)) {
          lexicalScore += DESCRIPTION_PHRASE_BONUS;
        }

        const trigramScore = jaccardSimilarity(queryTrigrams, document.trigrams);
        const partialTokenScore = scorePartialTokenMatches(queryTokens, document.tokenList);
        const fuzzyScore = trigramScore * 0.7 + partialTokenScore * 0.3;

        const combinedScore =
          lexicalScore > 0
            ? lexicalScore + fuzzyScore * 0.25
            : fuzzyScore >= MIN_FUZZY_SCORE
              ? fuzzyScore
              : 0;

        return {
          metadata: document.metadata,
          combinedScore,
          lexicalScore,
        };
      })
      .filter((entry) => entry.combinedScore > 0);

    scored.sort((a, b) => {
      if (b.combinedScore !== a.combinedScore) {
        return b.combinedScore - a.combinedScore;
      }
      if (b.lexicalScore !== a.lexicalScore) {
        return b.lexicalScore - a.lexicalScore;
      }
      return a.metadata.name.localeCompare(b.metadata.name);
    });

    return scored.slice(0, limit).map((entry) => entry.metadata);
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
    this.searchIndex = buildSearchIndex([]);

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

    this.searchIndex = buildSearchIndex(this.toolMetadataCache);
    this.cacheInvalid = false;
  }
}
