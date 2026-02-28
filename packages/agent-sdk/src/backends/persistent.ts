/**
 * Persistent backend using a pluggable key-value store.
 *
 * PersistentBackend provides cross-conversation persistence by storing files
 * in a key-value store. This enables long-term memory and state preservation
 * across agent sessions.
 *
 * The backend supports any storage system that implements the KeyValueStore
 * interface, including Redis, SQLite, DynamoDB, or cloud storage.
 *
 * @example
 * ```typescript
 * // Using the built-in in-memory store (for development)
 * const store = new InMemoryStore();
 * const backend = new PersistentBackend({ store });
 *
 * // With namespace isolation
 * const backend = new PersistentBackend({
 *   store,
 *   namespace: "user-123",
 * });
 *
 * // Files are persisted across sessions
 * await backend.write("/notes.md", "# My Notes\n");
 * // Later, in a new session:
 * const content = await backend.read("/notes.md");
 * ```
 *
 * @packageDocumentation
 */

import type {
  BackendProtocol,
  EditResult,
  FileData,
  FileInfo,
  GrepMatch,
  WriteResult,
} from "../backend.js";

// =============================================================================
// Key-Value Store Interface
// =============================================================================

/**
 * Pluggable key-value store interface.
 *
 * Implement this interface to add persistence to any storage backend.
 * The namespace array allows for hierarchical organization of data.
 *
 * @example
 * ```typescript
 * // Example Redis implementation
 * class RedisStore implements KeyValueStore {
 *   private redis: RedisClient;
 *
 *   private makeKey(namespace: string[], key: string): string {
 *     return [...namespace, key].join(":");
 *   }
 *
 *   async get(namespace: string[], key: string) {
 *     const data = await this.redis.get(this.makeKey(namespace, key));
 *     return data ? JSON.parse(data) : undefined;
 *   }
 *
 *   async put(namespace: string[], key: string, value: Record<string, unknown>) {
 *     await this.redis.set(this.makeKey(namespace, key), JSON.stringify(value));
 *   }
 *
 *   async delete(namespace: string[], key: string) {
 *     await this.redis.del(this.makeKey(namespace, key));
 *   }
 *
 *   async list(namespace: string[]) {
 *     const pattern = [...namespace, "*"].join(":");
 *     const keys = await this.redis.keys(pattern);
 *     return Promise.all(keys.map(async k => ({
 *       key: k.split(":").pop()!,
 *       value: JSON.parse(await this.redis.get(k) || "{}"),
 *     })));
 *   }
 * }
 * ```
 *
 * @category Backend
 */
export interface KeyValueStore {
  /**
   * Get a value by namespace and key.
   *
   * @param namespace - Hierarchical namespace array (e.g., ["user-123", "filesystem"])
   * @param key - The key to retrieve
   * @returns The value if found, undefined otherwise
   */
  get(namespace: string[], key: string): Promise<Record<string, unknown> | undefined>;

  /**
   * Store a value at the given namespace and key.
   *
   * @param namespace - Hierarchical namespace array
   * @param key - The key to store at
   * @param value - The value to store (must be JSON-serializable)
   */
  put(namespace: string[], key: string, value: Record<string, unknown>): Promise<void>;

  /**
   * Delete a value by namespace and key.
   *
   * @param namespace - Hierarchical namespace array
   * @param key - The key to delete
   */
  delete(namespace: string[], key: string): Promise<void>;

  /**
   * List all keys and values in a namespace.
   *
   * @param namespace - Hierarchical namespace array
   * @returns Array of key-value pairs in the namespace
   */
  list(namespace: string[]): Promise<Array<{ key: string; value: Record<string, unknown> }>>;
}

// =============================================================================
// In-Memory Store Implementation
// =============================================================================

/**
 * In-memory implementation of KeyValueStore for development and testing.
 *
 * Data is stored in a Map and lost when the process ends.
 * Use this for development or as a reference implementation.
 *
 * @example
 * ```typescript
 * const store = new InMemoryStore();
 *
 * // Store data
 * await store.put(["app", "users"], "user-1", { name: "Alice" });
 *
 * // Retrieve data
 * const user = await store.get(["app", "users"], "user-1");
 *
 * // List all users
 * const users = await store.list(["app", "users"]);
 * ```
 *
 * @category Backend
 */
export class InMemoryStore implements KeyValueStore {
  private data = new Map<string, Record<string, unknown>>();

  /**
   * Create a composite key from namespace and key.
   * @internal
   */
  private makeKey(namespace: string[], key: string): string {
    return [...namespace, key].join("\0");
  }

  /**
   * Parse a composite key to extract namespace and key.
   * @internal
   */
  private parseKey(compositeKey: string): { namespace: string[]; key: string } {
    const parts = compositeKey.split("\0");
    return {
      namespace: parts.slice(0, -1),
      key: parts[parts.length - 1]!,
    };
  }

  /**
   * Check if a composite key starts with the given namespace.
   * @internal
   */
  private startsWithNamespace(compositeKey: string, namespace: string[]): boolean {
    const prefix = `${namespace.join("\0")}\0`;
    return compositeKey.startsWith(prefix);
  }

  async get(namespace: string[], key: string): Promise<Record<string, unknown> | undefined> {
    const compositeKey = this.makeKey(namespace, key);
    const value = this.data.get(compositeKey);
    // Return a deep copy to prevent mutation
    return value ? JSON.parse(JSON.stringify(value)) : undefined;
  }

  async put(namespace: string[], key: string, value: Record<string, unknown>): Promise<void> {
    const compositeKey = this.makeKey(namespace, key);
    // Store a deep copy to prevent mutation
    this.data.set(compositeKey, JSON.parse(JSON.stringify(value)));
  }

  async delete(namespace: string[], key: string): Promise<void> {
    const compositeKey = this.makeKey(namespace, key);
    this.data.delete(compositeKey);
  }

  async list(namespace: string[]): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
    const results: Array<{ key: string; value: Record<string, unknown> }> = [];

    for (const [compositeKey, value] of this.data.entries()) {
      if (this.startsWithNamespace(compositeKey, namespace)) {
        const { key } = this.parseKey(compositeKey);
        // Return deep copies to prevent mutation
        results.push({
          key,
          value: JSON.parse(JSON.stringify(value)),
        });
      }
    }

    return results;
  }

  /**
   * Clear all data from the store.
   *
   * Useful for testing cleanup.
   */
  clear(): void {
    this.data.clear();
  }

  /**
   * Get the number of entries in the store.
   *
   * Useful for testing.
   */
  get size(): number {
    return this.data.size;
  }
}

// =============================================================================
// Persistent Backend Options
// =============================================================================

/**
 * Configuration options for PersistentBackend.
 *
 * @category Backend
 */
export interface PersistentBackendOptions {
  /**
   * The key-value store to use for persistence.
   */
  store: KeyValueStore;

  /**
   * Optional namespace prefix for all keys.
   *
   * Use this to isolate data between different agents, users, or sessions.
   *
   * @defaultValue undefined (no namespace prefix)
   *
   * @example
   * ```typescript
   * // Isolate by user
   * new PersistentBackend({ store, namespace: "user-123" });
   *
   * // Isolate by agent
   * new PersistentBackend({ store, namespace: "agent-coding" });
   * ```
   */
  namespace?: string;
}

// =============================================================================
// Persistent Backend Implementation
// =============================================================================

/**
 * Backend implementation using a pluggable key-value store.
 *
 * All file operations are persisted to the underlying store, allowing
 * data to survive across process restarts and agent sessions.
 *
 * Files are stored at: [namespace?, "filesystem", encodedPath]
 *
 * @example
 * ```typescript
 * import { PersistentBackend, InMemoryStore } from "@lleverage-ai/agent-sdk";
 *
 * // Create with in-memory store
 * const store = new InMemoryStore();
 * const backend = new PersistentBackend({ store });
 *
 * // Write persists to store
 * await backend.write("/notes.md", "# Notes");
 *
 * // Read retrieves from store
 * const content = await backend.read("/notes.md");
 *
 * // With namespace for multi-tenant isolation
 * const userBackend = new PersistentBackend({
 *   store,
 *   namespace: "user-456",
 * });
 * ```
 *
 * @category Backend
 */
export class PersistentBackend implements BackendProtocol {
  private readonly store: KeyValueStore;
  private readonly namespacePrefix: string[];

  /**
   * Create a new PersistentBackend.
   *
   * @param options - Configuration options
   */
  constructor(options: PersistentBackendOptions) {
    this.store = options.store;
    this.namespacePrefix = options.namespace ? [options.namespace, "filesystem"] : ["filesystem"];
  }

  /**
   * Encode a file path as a safe key.
   *
   * File paths may contain characters that are problematic for some
   * key-value stores. We use base64url encoding for safety.
   *
   * @internal
   */
  private encodePathAsKey(path: string): string {
    // Use base64url encoding for safe keys
    const encoder = new TextEncoder();
    const bytes = encoder.encode(path);
    // Convert to base64url (no padding, URL-safe chars)
    let base64 = btoa(String.fromCharCode(...bytes));
    base64 = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return base64;
  }

  /**
   * Decode a key back to a file path.
   * @internal
   */
  private decodeKeyToPath(key: string): string {
    // Add padding back
    let base64 = key.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
      base64 += "=";
    }
    // Decode
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  }

  /**
   * Normalize a path to ensure consistent format.
   * @internal
   */
  private normalizePath(path: string): string {
    // Ensure path starts with /
    let normalized = path.startsWith("/") ? path : `/${path}`;

    // Remove trailing slash for files
    if (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }

    // Collapse multiple slashes
    normalized = normalized.replace(/\/+/g, "/");

    return normalized;
  }

  /**
   * Get the namespace for a file path.
   * @internal
   */
  private getNamespace(): string[] {
    return this.namespacePrefix;
  }

  /**
   * List files and directories at the given path.
   */
  async lsInfo(path: string): Promise<FileInfo[]> {
    // Normalize and ensure trailing slash for directory matching
    let normalizedPath = this.normalizePath(path);
    if (!normalizedPath.endsWith("/")) {
      normalizedPath += "/";
    }
    if (normalizedPath === "//") {
      normalizedPath = "/";
    }

    const results: FileInfo[] = [];
    const seen = new Set<string>();

    // Get all files from the store
    const entries = await this.store.list(this.getNamespace());

    for (const { key, value } of entries) {
      const filePath = this.decodeKeyToPath(key);
      const fileData = value as unknown as FileData;

      // Check if file is under the path
      if (!filePath.startsWith(normalizedPath)) {
        continue;
      }

      const relativePath = filePath.slice(normalizedPath.length);
      const segments = relativePath.split("/").filter(Boolean);

      if (segments.length === 0) {
        continue;
      }

      if (segments.length === 1) {
        // Direct child file
        results.push({
          path: filePath,
          is_dir: false,
          size: fileData.content.join("\n").length,
          modified_at: fileData.modified_at,
        });
      } else {
        // Subdirectory
        const dirName = segments[0];
        const dirPath = normalizedPath + dirName;

        if (!seen.has(dirPath)) {
          seen.add(dirPath);
          results.push({
            path: dirPath,
            is_dir: true,
          });
        }
      }
    }

    return results;
  }

  /**
   * Read file content with line numbers.
   */
  async read(filePath: string, offset?: number, limit?: number): Promise<string> {
    const normalizedPath = this.normalizePath(filePath);
    const key = this.encodePathAsKey(normalizedPath);
    const value = await this.store.get(this.getNamespace(), key);

    if (!value) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileData = value as unknown as FileData;
    const startLine = offset ?? 0;
    const maxLines = limit ?? 2000;
    const lines = fileData.content.slice(startLine, startLine + maxLines);

    // Format with line numbers (matching the Read tool format)
    return lines
      .map((line, i) => {
        const lineNum = startLine + i + 1;
        const padding = " ".repeat(Math.max(0, 6 - String(lineNum).length));
        return `${padding}${lineNum}→${line}`;
      })
      .join("\n");
  }

  /**
   * Read raw file content as FileData.
   */
  async readRaw(filePath: string): Promise<FileData> {
    const normalizedPath = this.normalizePath(filePath);
    const key = this.encodePathAsKey(normalizedPath);
    const value = await this.store.get(this.getNamespace(), key);

    if (!value) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileData = value as unknown as FileData;

    // Return a deep copy to prevent mutation
    return {
      content: [...fileData.content],
      created_at: fileData.created_at,
      modified_at: fileData.modified_at,
    };
  }

  /**
   * Search for pattern matches using regex.
   */
  async grepRaw(pattern: string, path?: string | null, glob?: string | null): Promise<GrepMatch[]> {
    const regex = new RegExp(pattern);
    const searchPath = path ? this.normalizePath(path) : "/";
    const matches: GrepMatch[] = [];

    // Get all files from the store
    const entries = await this.store.list(this.getNamespace());

    for (const { key, value } of entries) {
      const filePath = this.decodeKeyToPath(key);
      const fileData = value as unknown as FileData;

      // Check if file is under the search path
      if (!filePath.startsWith(searchPath)) {
        continue;
      }

      // Check glob pattern if provided
      if (glob && !this.matchesGlob(filePath, glob)) {
        continue;
      }

      // Search each line
      for (let i = 0; i < fileData.content.length; i++) {
        const line = fileData.content[i]!;
        if (regex.test(line)) {
          matches.push({
            path: filePath,
            line: i + 1, // 1-indexed
            text: line,
          });
        }
      }
    }

    return matches;
  }

  /**
   * Find files matching a glob pattern.
   */
  async globInfo(pattern: string, path?: string): Promise<FileInfo[]> {
    // Normalize search path and ensure trailing slash for directory matching
    let searchPath = path ? this.normalizePath(path) : "/";
    if (!searchPath.endsWith("/")) {
      searchPath += "/";
    }
    if (searchPath === "//") {
      searchPath = "/";
    }

    const results: FileInfo[] = [];

    // Get all files from the store
    const entries = await this.store.list(this.getNamespace());

    for (const { key, value } of entries) {
      const filePath = this.decodeKeyToPath(key);
      const fileData = value as unknown as FileData;

      // Check if file is under the search path
      if (!filePath.startsWith(searchPath)) {
        continue;
      }

      // Get the relative path for matching (without leading slash)
      let relativePath = filePath.slice(searchPath.length);
      if (relativePath.startsWith("/")) {
        relativePath = relativePath.slice(1);
      }

      if (this.matchesGlob(relativePath, pattern)) {
        results.push({
          path: filePath,
          is_dir: false,
          size: fileData.content.join("\n").length,
          modified_at: fileData.modified_at,
        });
      }
    }

    return results;
  }

  /**
   * Create or overwrite a file.
   */
  async write(filePath: string, content: string): Promise<WriteResult> {
    const normalizedPath = this.normalizePath(filePath);
    const key = this.encodePathAsKey(normalizedPath);
    const now = new Date().toISOString();

    // Check for existing file to preserve created_at
    const existingValue = await this.store.get(this.getNamespace(), key);
    const existingData = existingValue as unknown as FileData | undefined;

    const fileData: FileData = {
      content: content.split("\n"),
      created_at: existingData?.created_at ?? now,
      modified_at: now,
    };

    await this.store.put(this.getNamespace(), key, fileData as unknown as Record<string, unknown>);

    return {
      success: true,
      path: normalizedPath,
    };
  }

  /**
   * Edit a file by replacing text.
   */
  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<EditResult> {
    const normalizedPath = this.normalizePath(filePath);
    const key = this.encodePathAsKey(normalizedPath);
    const value = await this.store.get(this.getNamespace(), key);

    if (!value) {
      return {
        success: false,
        error: `File not found: ${filePath}`,
        path: normalizedPath,
      };
    }

    const fileData = value as unknown as FileData;
    const fullContent = fileData.content.join("\n");
    const occurrences = fullContent.split(oldString).length - 1;

    if (occurrences === 0) {
      return {
        success: false,
        error: `String not found in file: "${oldString.slice(0, 50)}${oldString.length > 50 ? "..." : ""}"`,
        path: normalizedPath,
      };
    }

    if (occurrences > 1 && !replaceAll) {
      return {
        success: false,
        error: `Multiple occurrences (${occurrences}) found. Use replace_all=true to replace all.`,
        path: normalizedPath,
        occurrences,
      };
    }

    const newContent = replaceAll
      ? fullContent.replaceAll(oldString, newString)
      : fullContent.replace(oldString, newString);

    const updatedFileData: FileData = {
      content: newContent.split("\n"),
      created_at: fileData.created_at,
      modified_at: new Date().toISOString(),
    };

    await this.store.put(
      this.getNamespace(),
      key,
      updatedFileData as unknown as Record<string, unknown>,
    );

    return {
      success: true,
      path: normalizedPath,
      occurrences: replaceAll ? occurrences : 1,
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Check if a path matches a glob pattern.
   * Supports basic glob patterns: *, **, ?
   * @internal
   */
  private matchesGlob(path: string, pattern: string): boolean {
    // Convert glob to regex using placeholder approach to avoid
    // replacement conflicts with regex special chars
    let regexPattern = pattern
      // Escape special regex chars except * and ?
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      // ** followed by / matches any path segments including empty
      .replace(/\*\*\//g, "<<<GLOBSTAR_SLASH>>>")
      // ** at end matches any remaining path
      .replace(/\*\*/g, "<<<GLOBSTAR>>>")
      // * matches anything except /
      .replace(/\*/g, "[^/]*")
      // ? matches single char except /
      .replace(/\?/g, "[^/]")
      // Now restore globstars with actual regex
      .replace(/<<<GLOBSTAR_SLASH>>>/g, "(?:.*/)?")
      .replace(/<<<GLOBSTAR>>>/g, ".*");

    // Anchor the pattern
    regexPattern = `^${regexPattern}$`;

    return new RegExp(regexPattern).test(path);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new PersistentBackend.
 *
 * Convenience function that wraps the PersistentBackend constructor.
 *
 * @param options - Configuration options
 * @returns A new PersistentBackend instance
 *
 * @example
 * ```typescript
 * const store = new InMemoryStore();
 * const backend = createPersistentBackend({ store });
 * ```
 *
 * @category Backend
 */
export function createPersistentBackend(options: PersistentBackendOptions): PersistentBackend {
  return new PersistentBackend(options);
}
