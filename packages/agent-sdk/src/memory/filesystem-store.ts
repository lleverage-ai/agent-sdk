/**
 * Filesystem-based memory store implementation.
 *
 * Stores memory documents as markdown files on the local filesystem.
 * Supports YAML frontmatter for metadata.
 *
 * @example
 * ```typescript
 * import { FilesystemMemoryStore } from "@lleverage-ai/agent-sdk";
 *
 * const store = new FilesystemMemoryStore();
 *
 * // Read user-level memory
 * const userMemory = await store.read("~/.deepagents/my-agent/agent.md");
 *
 * // Write project memory
 * await store.write("/project/.deepagents/agent.md", {
 *   path: "/project/.deepagents/agent.md",
 *   metadata: {},
 *   content: "# Project Rules",
 *   modifiedAt: Date.now(),
 * });
 * ```
 *
 * @packageDocumentation
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { MemoryDocument, MemoryStore } from "./store.js";
import { parseMarkdownWithFrontmatter, serializeMarkdownWithFrontmatter } from "./store.js";

// =============================================================================
// Filesystem Memory Store Options
// =============================================================================

/**
 * Configuration options for FilesystemMemoryStore.
 *
 * @category Memory
 */
export interface FilesystemMemoryStoreOptions {
  /**
   * Override the home directory for `~` expansion.
   *
   * Useful for testing or running in sandboxed environments.
   *
   * @defaultValue os.homedir()
   */
  homeDir?: string;

  /**
   * Create parent directories if they don't exist when writing.
   *
   * @defaultValue true
   */
  createDirs?: boolean;

  /**
   * File extension to use for memory documents.
   *
   * @defaultValue ".md"
   */
  extension?: string;
}

// =============================================================================
// Filesystem Memory Store Implementation
// =============================================================================

/**
 * Filesystem-based implementation of MemoryStore.
 *
 * Stores memory documents as markdown files on disk.
 * Handles `~` expansion for home directory paths.
 *
 * @example
 * ```typescript
 * import { FilesystemMemoryStore } from "@lleverage-ai/agent-sdk";
 *
 * // Create with default options
 * const store = new FilesystemMemoryStore();
 *
 * // Create with custom home directory
 * const store = new FilesystemMemoryStore({
 *   homeDir: "/custom/home",
 * });
 *
 * // Read a memory document
 * const doc = await store.read("~/.deepagents/my-agent/agent.md");
 *
 * // List all memory documents
 * const paths = await store.list("~/.deepagents/my-agent");
 * ```
 *
 * @category Memory
 */
export class FilesystemMemoryStore implements MemoryStore {
  private readonly homeDir: string;
  private readonly createDirs: boolean;
  private readonly extension: string;

  /**
   * Create a new FilesystemMemoryStore.
   *
   * @param options - Configuration options
   */
  constructor(options: FilesystemMemoryStoreOptions = {}) {
    this.homeDir = options.homeDir ?? os.homedir();
    this.createDirs = options.createDirs ?? true;
    this.extension = options.extension ?? ".md";
  }

  /**
   * Expand `~` in paths to the home directory.
   *
   * @param filePath - Path that may contain `~`
   * @returns Expanded path
   *
   * @internal
   */
  private expandPath(filePath: string): string {
    if (filePath.startsWith("~")) {
      return path.join(this.homeDir, filePath.slice(1));
    }
    return filePath;
  }

  /**
   * Read a memory document from the filesystem.
   *
   * @param filePath - Path to the memory document
   * @returns The memory document if found, undefined otherwise
   */
  async read(filePath: string): Promise<MemoryDocument | undefined> {
    const expandedPath = this.expandPath(filePath);

    try {
      const content = await fs.readFile(expandedPath, "utf-8");
      const stats = await fs.stat(expandedPath);

      const { metadata, content: markdownContent } = parseMarkdownWithFrontmatter(content);

      return {
        path: filePath, // Keep original path for consistency
        metadata,
        content: markdownContent,
        modifiedAt: stats.mtimeMs,
      };
    } catch (error) {
      // File doesn't exist or can't be read
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Write a memory document to the filesystem.
   *
   * @param filePath - Path to write to
   * @param document - Document to write
   */
  async write(filePath: string, document: MemoryDocument): Promise<void> {
    const expandedPath = this.expandPath(filePath);

    // Create parent directories if needed
    if (this.createDirs) {
      const dir = path.dirname(expandedPath);
      await fs.mkdir(dir, { recursive: true });
    }

    // Serialize to markdown with frontmatter
    const content = serializeMarkdownWithFrontmatter({
      metadata: document.metadata,
      content: document.content,
    });

    await fs.writeFile(expandedPath, content, "utf-8");
  }

  /**
   * Delete a memory document from the filesystem.
   *
   * @param filePath - Path to delete
   * @returns True if deleted, false if it didn't exist
   */
  async delete(filePath: string): Promise<boolean> {
    const expandedPath = this.expandPath(filePath);

    try {
      await fs.unlink(expandedPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  /**
   * List memory documents matching a pattern.
   *
   * @param pattern - Directory or glob pattern to search
   * @returns Array of paths to matching documents
   */
  async list(pattern?: string): Promise<string[]> {
    // Default to listing all .md files in the current directory
    const searchPath = pattern ? this.expandPath(pattern) : ".";

    try {
      const stats = await fs.stat(searchPath);

      if (stats.isDirectory()) {
        // List all .md files in the directory
        return this.listDirectory(searchPath);
      } else if (stats.isFile() && searchPath.endsWith(this.extension)) {
        // Single file
        return [pattern ?? searchPath];
      }

      return [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  /**
   * Check if a memory document exists.
   *
   * @param filePath - Path to check
   * @returns True if the file exists
   */
  async exists(filePath: string): Promise<boolean> {
    const expandedPath = this.expandPath(filePath);

    try {
      await fs.access(expandedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all memory documents in a directory recursively.
   *
   * @param dirPath - Directory to list
   * @returns Array of file paths
   *
   * @internal
   */
  private async listDirectory(dirPath: string): Promise<string[]> {
    const results: string[] = [];

    async function walk(dir: string, extension: string): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            await walk(fullPath, extension);
          } else if (entry.isFile() && entry.name.endsWith(extension)) {
            results.push(fullPath);
          }
        }
      } catch (error) {
        // Ignore permission errors for directories
        if ((error as NodeJS.ErrnoException).code !== "EACCES") {
          throw error;
        }
      }
    }

    await walk(dirPath, this.extension);
    return results;
  }
}

// =============================================================================
// In-Memory Memory Store (for testing)
// =============================================================================

/**
 * In-memory implementation of MemoryStore for testing.
 *
 * Documents are stored in a Map and not persisted.
 *
 * @example
 * ```typescript
 * const store = new InMemoryMemoryStore();
 *
 * await store.write("/test/doc.md", {
 *   path: "/test/doc.md",
 *   metadata: {},
 *   content: "# Test",
 *   modifiedAt: Date.now(),
 * });
 *
 * const doc = await store.read("/test/doc.md");
 * ```
 *
 * @category Memory
 */
export class InMemoryMemoryStore implements MemoryStore {
  private documents = new Map<string, MemoryDocument>();

  /**
   * Read a document from memory.
   */
  async read(path: string): Promise<MemoryDocument | undefined> {
    const doc = this.documents.get(path);
    if (!doc) return undefined;

    // Return a copy to prevent mutation
    return {
      ...doc,
      metadata: { ...doc.metadata },
    };
  }

  /**
   * Write a document to memory.
   */
  async write(path: string, document: MemoryDocument): Promise<void> {
    // Store a copy to prevent mutation
    this.documents.set(path, {
      ...document,
      metadata: { ...document.metadata },
      modifiedAt: Date.now(),
    });
  }

  /**
   * Delete a document from memory.
   */
  async delete(path: string): Promise<boolean> {
    return this.documents.delete(path);
  }

  /**
   * List all documents matching a prefix.
   */
  async list(pattern?: string): Promise<string[]> {
    if (!pattern) {
      return Array.from(this.documents.keys());
    }

    return Array.from(this.documents.keys()).filter(
      (p) => p.startsWith(pattern) && p.endsWith(".md"),
    );
  }

  /**
   * Check if a document exists.
   */
  async exists(path: string): Promise<boolean> {
    return this.documents.has(path);
  }

  /**
   * Clear all documents.
   *
   * Useful for test cleanup.
   */
  clear(): void {
    this.documents.clear();
  }

  /**
   * Get the number of documents.
   */
  get size(): number {
    return this.documents.size;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new FilesystemMemoryStore.
 *
 * @param options - Configuration options
 * @returns A new FilesystemMemoryStore instance
 *
 * @category Memory
 */
export function createFilesystemMemoryStore(
  options?: FilesystemMemoryStoreOptions,
): FilesystemMemoryStore {
  return new FilesystemMemoryStore(options);
}

/**
 * Create a new InMemoryMemoryStore.
 *
 * @returns A new InMemoryMemoryStore instance
 *
 * @category Memory
 */
export function createInMemoryMemoryStore(): InMemoryMemoryStore {
  return new InMemoryMemoryStore();
}
