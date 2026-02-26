/**
 * KeyValueStore adapter for checkpoint saving.
 *
 * KeyValueStoreSaver wraps any {@link KeyValueStore} implementation to provide
 * checkpoint persistence. This allows reusing existing storage backends like
 * Redis, SQLite, or cloud storage for checkpoints.
 *
 * @example
 * ```typescript
 * import { InMemoryStore } from "@lleverage-ai/agent-sdk";
 *
 * const store = new InMemoryStore();
 * const saver = new KeyValueStoreSaver({ store });
 *
 * // Save a checkpoint
 * await saver.save(checkpoint);
 *
 * // Load it back
 * const loaded = await saver.load("session-123");
 * ```
 *
 * @packageDocumentation
 */

import type { KeyValueStore } from "../backends/persistent.js";
import type { BaseCheckpointSaver, Checkpoint, CheckpointSaverOptions } from "./types.js";
import { isCheckpoint } from "./types.js";

// =============================================================================
// Options
// =============================================================================

/**
 * Options for creating a KeyValueStoreSaver.
 *
 * @category Checkpointer
 */
export interface KeyValueStoreSaverOptions extends CheckpointSaverOptions {
  /**
   * The key-value store to use for persistence.
   *
   * Can be any implementation of {@link KeyValueStore}, such as
   * {@link InMemoryStore} for testing, or custom implementations
   * for Redis, SQLite, etc.
   */
  store: KeyValueStore;
}

// =============================================================================
// KeyValueStoreSaver Implementation
// =============================================================================

/**
 * Checkpoint saver that wraps a KeyValueStore.
 *
 * Stores checkpoints at: `[namespace?, "checkpoints", threadId]`
 *
 * This adapter allows using any KeyValueStore implementation for checkpoint
 * persistence, making it easy to integrate with existing storage systems.
 *
 * @example
 * ```typescript
 * // Use with InMemoryStore for testing
 * import { InMemoryStore, KeyValueStoreSaver } from "@lleverage-ai/agent-sdk";
 *
 * const store = new InMemoryStore();
 * const saver = new KeyValueStoreSaver({ store });
 *
 * await saver.save(checkpoint);
 * const loaded = await saver.load("session-123");
 *
 * // Use with namespace for multi-tenant isolation
 * const userSaver = new KeyValueStoreSaver({
 *   store,
 *   namespace: "user-456",
 * });
 * ```
 *
 * @category Checkpointer
 */
export class KeyValueStoreSaver implements BaseCheckpointSaver {
  private readonly store: KeyValueStore;
  private readonly namespace?: string;

  /**
   * Create a new KeyValueStoreSaver.
   *
   * @param options - Configuration including the key-value store
   */
  constructor(options: KeyValueStoreSaverOptions) {
    this.store = options.store;
    this.namespace = options.namespace;
  }

  /**
   * Save a checkpoint to the key-value store.
   *
   * @param checkpoint - The checkpoint to save
   */
  async save(checkpoint: Checkpoint): Promise<void> {
    const storeNamespace = this.getNamespace();
    const key = checkpoint.threadId;

    // Store checkpoint as a record (the KV store will handle serialization)
    await this.store.put(storeNamespace, key, checkpoint as unknown as Record<string, unknown>);
  }

  /**
   * Load a checkpoint from the key-value store.
   *
   * @param threadId - The thread ID to load
   * @returns The checkpoint if found and valid, undefined otherwise
   */
  async load(threadId: string): Promise<Checkpoint | undefined> {
    const storeNamespace = this.getNamespace();
    const data = await this.store.get(storeNamespace, threadId);

    if (!data) {
      return undefined;
    }

    // Validate the loaded data
    if (!isCheckpoint(data)) {
      console.warn(`Invalid checkpoint data for thread ${threadId}, expected Checkpoint object`);
      return undefined;
    }

    return data;
  }

  /**
   * List all thread IDs that have checkpoints.
   *
   * @returns Array of thread IDs
   */
  async list(): Promise<string[]> {
    const storeNamespace = this.getNamespace();
    const entries = await this.store.list(storeNamespace);

    return entries.map((entry) => entry.key);
  }

  /**
   * Delete a checkpoint from the key-value store.
   *
   * @param threadId - The thread ID to delete
   * @returns True if a checkpoint was deleted, false if not found
   */
  async delete(threadId: string): Promise<boolean> {
    const storeNamespace = this.getNamespace();

    // Check if it exists first
    const exists = await this.exists(threadId);
    if (!exists) {
      return false;
    }

    await this.store.delete(storeNamespace, threadId);
    return true;
  }

  /**
   * Check if a checkpoint exists in the key-value store.
   *
   * @param threadId - The thread ID to check
   * @returns True if the checkpoint exists
   */
  async exists(threadId: string): Promise<boolean> {
    const storeNamespace = this.getNamespace();
    const data = await this.store.get(storeNamespace, threadId);
    return data !== undefined;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Get the namespace array for the key-value store.
   *
   * @internal
   */
  private getNamespace(): string[] {
    return this.namespace ? [this.namespace, "checkpoints"] : ["checkpoints"];
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new KeyValueStoreSaver instance.
 *
 * @param options - Configuration including the key-value store
 * @returns A new KeyValueStoreSaver instance
 *
 * @example
 * ```typescript
 * import { InMemoryStore, createKeyValueStoreSaver } from "@lleverage-ai/agent-sdk";
 *
 * // Basic usage with InMemoryStore
 * const store = new InMemoryStore();
 * const saver = createKeyValueStoreSaver({ store });
 *
 * // With namespace for isolation
 * const userSaver = createKeyValueStoreSaver({
 *   store,
 *   namespace: "user-123",
 * });
 * ```
 *
 * @category Checkpointer
 */
export function createKeyValueStoreSaver(options: KeyValueStoreSaverOptions): KeyValueStoreSaver {
  return new KeyValueStoreSaver(options);
}
