/**
 * Key-value store task implementation.
 *
 * Stores tasks in a key-value store (Redis, DynamoDB, etc.).
 * Provides persistence with fast access.
 *
 * @packageDocumentation
 */

import type {
  BackgroundTask,
  BackgroundTaskStatus,
  BaseTaskStore,
  TaskStoreOptions,
} from "./types.js";
import { isBackgroundTask, shouldExpireTask } from "./types.js";

/**
 * Abstract key-value store interface.
 *
 * Implement this interface to connect to your KV store backend.
 *
 * @category TaskStore
 */
export interface KeyValueStore {
  /**
   * Get a value by key.
   *
   * @param key - The key to get
   * @returns The value if found, null otherwise
   */
  get(key: string): Promise<string | null>;

  /**
   * Set a value for a key.
   *
   * @param key - The key to set
   * @param value - The value to store
   * @param options - Optional TTL in seconds
   */
  set(key: string, value: string, options?: { ttl?: number }): Promise<void>;

  /**
   * Delete a key.
   *
   * @param key - The key to delete
   * @returns True if deleted, false if not found
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists.
   *
   * @param key - The key to check
   * @returns True if exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * List all keys matching a pattern.
   *
   * @param pattern - Glob pattern (e.g., "tasks:*")
   * @returns Array of matching keys
   */
  keys(pattern: string): Promise<string[]>;
}

/**
 * Key-value store implementation of the task store.
 *
 * Stores tasks in a key-value store (Redis, DynamoDB, etc.).
 * Requires a KeyValueStore implementation.
 *
 * @example
 * ```typescript
 * // Using Redis
 * import { createClient } from "redis";
 *
 * const redisClient = createClient();
 * await redisClient.connect();
 *
 * const kvStore: KeyValueStore = {
 *   async get(key) {
 *     return redisClient.get(key);
 *   },
 *   async set(key, value, options) {
 *     if (options?.ttl) {
 *       await redisClient.setEx(key, options.ttl, value);
 *     } else {
 *       await redisClient.set(key, value);
 *     }
 *   },
 *   async delete(key) {
 *     const result = await redisClient.del(key);
 *     return result > 0;
 *   },
 *   async exists(key) {
 *     const result = await redisClient.exists(key);
 *     return result > 0;
 *   },
 *   async keys(pattern) {
 *     return redisClient.keys(pattern);
 *   },
 * };
 *
 * const store = new KVTaskStore(kvStore, {
 *   namespace: "myapp",
 * });
 * ```
 *
 * @category TaskStore
 */
export class KVTaskStore implements BaseTaskStore {
  private kv: KeyValueStore;
  private namespace?: string;
  private expirationMs: number;

  /**
   * Create a new KV-based task store.
   *
   * @param kv - The key-value store implementation
   * @param options - Configuration options
   */
  constructor(kv: KeyValueStore, options: TaskStoreOptions = {}) {
    this.kv = kv;
    this.namespace = options.namespace;
    this.expirationMs = options.expirationMs ?? 86400000; // 24 hours default
  }

  /**
   * Get the storage key for a task ID.
   * @internal
   */
  private getKey(taskId: string): string {
    return this.namespace ? `${this.namespace}:task:${taskId}` : `task:${taskId}`;
  }

  /**
   * Get the task ID from a storage key.
   * @internal
   */
  private getTaskIdFromKey(key: string): string | null {
    const prefix = this.namespace ? `${this.namespace}:task:` : "task:";
    if (key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }
    return null;
  }

  /**
   * Get the key pattern for listing tasks.
   * @internal
   */
  private getKeyPattern(): string {
    return this.namespace ? `${this.namespace}:task:*` : "task:*";
  }

  async save(task: BackgroundTask): Promise<void> {
    const key = this.getKey(task.id);
    const data = JSON.stringify(task);
    await this.kv.set(key, data);
  }

  async load(taskId: string): Promise<BackgroundTask | undefined> {
    const key = this.getKey(taskId);
    const data = await this.kv.get(key);

    if (!data) {
      return undefined;
    }

    try {
      const task = JSON.parse(data);

      if (!isBackgroundTask(task)) {
        console.warn(`Invalid task data for key ${key}, skipping`);
        return undefined;
      }

      return task;
    } catch (error) {
      console.warn(`Failed to parse task data for key ${key}:`, error);
      return undefined;
    }
  }

  async list(filter?: {
    status?: BackgroundTaskStatus | BackgroundTaskStatus[];
  }): Promise<string[]> {
    const tasks = await this.listTasks(filter);
    return tasks.map((t) => t.id);
  }

  async listTasks(filter?: {
    status?: BackgroundTaskStatus | BackgroundTaskStatus[];
  }): Promise<BackgroundTask[]> {
    const pattern = this.getKeyPattern();
    const keys = await this.kv.keys(pattern);
    const tasks: BackgroundTask[] = [];

    for (const key of keys) {
      const taskId = this.getTaskIdFromKey(key);
      if (!taskId) {
        continue;
      }

      const task = await this.load(taskId);
      if (!task) {
        continue;
      }

      // Apply status filter if provided
      if (filter?.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        if (!statuses.includes(task.status)) {
          continue;
        }
      }

      tasks.push(task);
    }

    return tasks;
  }

  async delete(taskId: string): Promise<boolean> {
    const key = this.getKey(taskId);
    return this.kv.delete(key);
  }

  async exists(taskId: string): Promise<boolean> {
    const key = this.getKey(taskId);
    return this.kv.exists(key);
  }

  async cleanup(): Promise<number> {
    const allTasks = await this.listTasks({
      status: ["completed", "failed"],
    });

    let cleaned = 0;
    for (const task of allTasks) {
      if (shouldExpireTask(task, this.expirationMs)) {
        await this.delete(task.id);
        cleaned++;
      }
    }

    return cleaned;
  }
}
