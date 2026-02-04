/**
 * In-memory checkpoint saver for ephemeral storage.
 *
 * MemorySaver stores checkpoints in a Map, making it ideal for:
 * - Development and testing
 * - Single-session applications
 * - Scenarios where persistence is not required
 *
 * Note: All data is lost when the process ends.
 *
 * @example
 * ```typescript
 * const saver = new MemorySaver();
 *
 * // Save a checkpoint
 * await saver.save({
 *   threadId: "session-123",
 *   messages: [...],
 *   state: { todos: [], files: {} },
 *   step: 0,
 *   createdAt: new Date().toISOString(),
 *   updatedAt: new Date().toISOString(),
 * });
 *
 * // Load it back
 * const checkpoint = await saver.load("session-123");
 * ```
 *
 * @packageDocumentation
 */

import type { BaseCheckpointSaver, Checkpoint, CheckpointSaverOptions } from "./types.js";

/**
 * Options for creating a MemorySaver.
 *
 * @category Checkpointer
 */
export interface MemorySaverOptions extends CheckpointSaverOptions {
  /**
   * Initial checkpoints to populate the store with.
   * Useful for testing or restoring from a backup.
   */
  initialCheckpoints?: Checkpoint[];
}

/**
 * In-memory checkpoint saver.
 *
 * Stores checkpoints in a JavaScript Map for fast access.
 * All data is ephemeral and lost when the process terminates.
 *
 * @example
 * ```typescript
 * const saver = new MemorySaver();
 *
 * // Save a checkpoint
 * await saver.save(checkpoint);
 *
 * // List all threads
 * const threads = await saver.list();
 *
 * // Load a specific thread
 * const loaded = await saver.load(threads[0]);
 *
 * // Delete when done
 * await saver.delete(threads[0]);
 * ```
 *
 * @category Checkpointer
 */
export class MemorySaver implements BaseCheckpointSaver {
  private readonly checkpoints = new Map<string, Checkpoint>();
  private readonly namespace?: string;

  /**
   * Create a new MemorySaver.
   *
   * @param options - Optional configuration
   */
  constructor(options?: MemorySaverOptions) {
    this.namespace = options?.namespace;

    // Populate with initial checkpoints if provided
    if (options?.initialCheckpoints) {
      for (const checkpoint of options.initialCheckpoints) {
        const key = this.getKey(checkpoint.threadId);
        // Deep copy to prevent external mutation
        this.checkpoints.set(key, this.deepCopy(checkpoint));
      }
    }
  }

  /**
   * Save a checkpoint.
   *
   * If a checkpoint with the same threadId exists, it will be overwritten.
   * The checkpoint is deep-copied to prevent external mutation.
   *
   * @param checkpoint - The checkpoint to save
   */
  async save(checkpoint: Checkpoint): Promise<void> {
    const key = this.getKey(checkpoint.threadId);
    // Deep copy to prevent external mutation affecting stored data
    this.checkpoints.set(key, this.deepCopy(checkpoint));
  }

  /**
   * Load a checkpoint by thread ID.
   *
   * Returns a deep copy to prevent external mutation of stored data.
   *
   * @param threadId - The thread ID to load
   * @returns The checkpoint if found, undefined otherwise
   */
  async load(threadId: string): Promise<Checkpoint | undefined> {
    const key = this.getKey(threadId);
    const checkpoint = this.checkpoints.get(key);
    // Return deep copy to prevent external mutation
    return checkpoint ? this.deepCopy(checkpoint) : undefined;
  }

  /**
   * List all thread IDs that have checkpoints.
   *
   * If a namespace is configured, only returns threads within that namespace.
   *
   * @returns Array of thread IDs
   */
  async list(): Promise<string[]> {
    const threads: string[] = [];
    const prefix = this.namespace ? `${this.namespace}:` : "";

    for (const key of this.checkpoints.keys()) {
      if (this.namespace) {
        if (key.startsWith(prefix)) {
          threads.push(key.slice(prefix.length));
        }
      } else {
        threads.push(key);
      }
    }

    return threads;
  }

  /**
   * Delete a checkpoint.
   *
   * @param threadId - The thread ID to delete
   * @returns True if a checkpoint was deleted, false if not found
   */
  async delete(threadId: string): Promise<boolean> {
    const key = this.getKey(threadId);
    return this.checkpoints.delete(key);
  }

  /**
   * Check if a checkpoint exists.
   *
   * @param threadId - The thread ID to check
   * @returns True if the checkpoint exists
   */
  async exists(threadId: string): Promise<boolean> {
    const key = this.getKey(threadId);
    return this.checkpoints.has(key);
  }

  // ===========================================================================
  // Additional Utility Methods
  // ===========================================================================

  /**
   * Get the number of stored checkpoints.
   *
   * If a namespace is configured, returns count within that namespace only.
   */
  get size(): number {
    if (!this.namespace) {
      return this.checkpoints.size;
    }

    const prefix = `${this.namespace}:`;
    let count = 0;
    for (const key of this.checkpoints.keys()) {
      if (key.startsWith(prefix)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all stored checkpoints.
   *
   * If a namespace is configured, only clears checkpoints within that namespace.
   */
  clear(): void {
    if (!this.namespace) {
      this.checkpoints.clear();
      return;
    }

    const prefix = `${this.namespace}:`;
    for (const key of [...this.checkpoints.keys()]) {
      if (key.startsWith(prefix)) {
        this.checkpoints.delete(key);
      }
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Get the storage key for a thread ID.
   * @internal
   */
  private getKey(threadId: string): string {
    return this.namespace ? `${this.namespace}:${threadId}` : threadId;
  }

  /**
   * Deep copy a checkpoint to prevent mutation.
   * @internal
   */
  private deepCopy(checkpoint: Checkpoint): Checkpoint {
    return JSON.parse(JSON.stringify(checkpoint));
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new MemorySaver instance.
 *
 * @param options - Optional configuration
 * @returns A new MemorySaver instance
 *
 * @example
 * ```typescript
 * const saver = createMemorySaver();
 *
 * // Or with namespace for multi-tenant isolation
 * const userSaver = createMemorySaver({ namespace: "user-123" });
 * ```
 *
 * @category Checkpointer
 */
export function createMemorySaver(options?: MemorySaverOptions): MemorySaver {
  return new MemorySaver(options);
}
