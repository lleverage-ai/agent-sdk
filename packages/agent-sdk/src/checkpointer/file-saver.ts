/**
 * File-based checkpoint saver for JSON persistence.
 *
 * FileSaver stores checkpoints as JSON files on disk, providing:
 * - Persistence across process restarts
 * - Human-readable checkpoint data
 * - Simple backup and debugging capabilities
 *
 * Each checkpoint is stored as a separate JSON file: `{dir}/{threadId}.json`
 *
 * @example
 * ```typescript
 * const saver = new FileSaver({ dir: "./.checkpoints" });
 *
 * // Save a checkpoint
 * await saver.save(checkpoint);
 * // Creates: .checkpoints/session-123.json
 *
 * // Load it back
 * const loaded = await saver.load("session-123");
 * ```
 *
 * @packageDocumentation
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BaseCheckpointSaver, Checkpoint, CheckpointSaverOptions } from "./types.js";
import { isCheckpoint } from "./types.js";

// =============================================================================
// Options
// =============================================================================

/**
 * Options for creating a FileSaver.
 *
 * @category Checkpointer
 */
export interface FileSaverOptions extends CheckpointSaverOptions {
  /**
   * Directory path for storing checkpoint files.
   *
   * The directory will be created if it doesn't exist.
   */
  dir: string;

  /**
   * File extension for checkpoint files.
   * @defaultValue ".json"
   */
  extension?: string;

  /**
   * Whether to format JSON with indentation for readability.
   * @defaultValue true
   */
  pretty?: boolean;
}

// =============================================================================
// FileSaver Implementation
// =============================================================================

/**
 * File-based checkpoint saver using JSON files.
 *
 * Stores each checkpoint as a separate JSON file in the specified directory.
 * Thread IDs are sanitized to create safe filenames.
 *
 * @example
 * ```typescript
 * const saver = new FileSaver({ dir: "./.checkpoints" });
 *
 * // Save multiple checkpoints
 * await saver.save(checkpoint1);
 * await saver.save(checkpoint2);
 *
 * // List all threads
 * const threads = await saver.list();
 * // ["session-1", "session-2"]
 *
 * // Clean up
 * for (const thread of threads) {
 *   await saver.delete(thread);
 * }
 * ```
 *
 * @category Checkpointer
 */
export class FileSaver implements BaseCheckpointSaver {
  private readonly dir: string;
  private readonly extension: string;
  private readonly pretty: boolean;
  private readonly namespace?: string;
  private initialized = false;

  /**
   * Create a new FileSaver.
   *
   * @param options - Configuration including the directory path
   */
  constructor(options: FileSaverOptions) {
    this.dir = path.resolve(options.dir);
    this.extension = options.extension ?? ".json";
    this.pretty = options.pretty ?? true;
    this.namespace = options.namespace;
  }

  /**
   * Save a checkpoint to a JSON file.
   *
   * Creates the directory if it doesn't exist.
   * Overwrites existing checkpoint with the same threadId.
   *
   * @param checkpoint - The checkpoint to save
   */
  async save(checkpoint: Checkpoint): Promise<void> {
    await this.ensureInitialized();

    const filePath = this.getFilePath(checkpoint.threadId);
    const data = this.pretty ? JSON.stringify(checkpoint, null, 2) : JSON.stringify(checkpoint);

    await fs.writeFile(filePath, data, "utf-8");
  }

  /**
   * Load a checkpoint from a JSON file.
   *
   * @param threadId - The thread ID to load
   * @returns The checkpoint if found and valid, undefined otherwise
   */
  async load(threadId: string): Promise<Checkpoint | undefined> {
    const filePath = this.getFilePath(threadId);

    try {
      const data = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(data);

      // Validate the parsed data
      if (!isCheckpoint(parsed)) {
        console.warn(`Invalid checkpoint data in ${filePath}, expected Checkpoint object`);
        return undefined;
      }

      return parsed;
    } catch (error) {
      // File not found or read error
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * List all thread IDs that have checkpoint files.
   *
   * @returns Array of thread IDs
   */
  async list(): Promise<string[]> {
    await this.ensureInitialized();

    try {
      const files = await fs.readdir(this.dir);
      const threads: string[] = [];

      for (const file of files) {
        if (file.endsWith(this.extension)) {
          const threadId = this.fileToThreadId(file);
          if (threadId) {
            threads.push(threadId);
          }
        }
      }

      return threads;
    } catch (error) {
      // Directory doesn't exist yet
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  /**
   * Delete a checkpoint file.
   *
   * @param threadId - The thread ID to delete
   * @returns True if a file was deleted, false if not found
   */
  async delete(threadId: string): Promise<boolean> {
    const filePath = this.getFilePath(threadId);

    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Check if a checkpoint file exists.
   *
   * @param threadId - The thread ID to check
   * @returns True if the file exists
   */
  async exists(threadId: string): Promise<boolean> {
    const filePath = this.getFilePath(threadId);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Additional Utility Methods
  // ===========================================================================

  /**
   * Get the directory path where checkpoints are stored.
   */
  getDir(): string {
    return this.dir;
  }

  /**
   * Get the full file path for a thread ID.
   *
   * @param threadId - The thread ID
   * @returns The full file path
   */
  getFilePath(threadId: string): string {
    const filename = this.threadIdToFile(threadId);
    return path.join(this.dir, filename);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Ensure the checkpoint directory exists.
   * @internal
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await fs.mkdir(this.dir, { recursive: true });
    } catch (error) {
      // Directory already exists is fine
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }

    this.initialized = true;
  }

  /**
   * Convert a thread ID to a safe filename.
   *
   * Sanitizes the thread ID to remove or replace characters that are
   * problematic in filenames across different operating systems.
   *
   * @internal
   */
  private threadIdToFile(threadId: string): string {
    // Apply namespace prefix if configured
    const prefixed = this.namespace ? `${this.namespace}_${threadId}` : threadId;

    // Replace problematic characters with underscores
    // Keep: alphanumeric, dash, underscore, dot
    // Replace: slashes, colons, special chars
    const sanitized = prefixed
      .replace(/[/\\:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_") // Collapse multiple underscores
      .replace(/^_|_$/g, ""); // Trim leading/trailing underscores

    // Ensure we have a valid filename
    const filename = sanitized || "checkpoint";

    return `${filename}${this.extension}`;
  }

  /**
   * Convert a filename back to a thread ID.
   *
   * @internal
   */
  private fileToThreadId(filename: string): string | undefined {
    if (!filename.endsWith(this.extension)) {
      return undefined;
    }

    // Remove extension
    let threadId = filename.slice(0, -this.extension.length);

    // Remove namespace prefix if configured
    if (this.namespace) {
      const prefix = `${this.namespace}_`;
      if (threadId.startsWith(prefix)) {
        threadId = threadId.slice(prefix.length);
      } else {
        // File doesn't belong to this namespace
        return undefined;
      }
    }

    return threadId || undefined;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new FileSaver instance.
 *
 * @param options - Configuration including the directory path
 * @returns A new FileSaver instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const saver = createFileSaver({ dir: "./.checkpoints" });
 *
 * // With namespace for multi-tenant isolation
 * const userSaver = createFileSaver({
 *   dir: "./.checkpoints",
 *   namespace: "user-123",
 * });
 *
 * // Compact JSON (no pretty printing)
 * const compactSaver = createFileSaver({
 *   dir: "./.checkpoints",
 *   pretty: false,
 * });
 * ```
 *
 * @category Checkpointer
 */
export function createFileSaver(options: FileSaverOptions): FileSaver {
  return new FileSaver(options);
}
