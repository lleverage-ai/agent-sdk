/**
 * In-memory task store implementation.
 *
 * Stores tasks in a Map. Tasks are lost when the process exits.
 * Useful for development, testing, or scenarios where persistence isn't needed.
 *
 * @packageDocumentation
 */

import type {
  BackgroundTask,
  BackgroundTaskStatus,
  BaseTaskStore,
  TaskStoreOptions,
} from "./types.js";
import { shouldExpireTask } from "./types.js";

/**
 * In-memory implementation of the task store.
 *
 * Stores tasks in a Map in memory. All tasks are lost when the process exits.
 *
 * @example
 * ```typescript
 * const store = new MemoryTaskStore();
 *
 * await store.save({
 *   id: "task-123",
 *   subagentType: "researcher",
 *   description: "Research topic",
 *   status: "running",
 *   createdAt: new Date().toISOString(),
 *   updatedAt: new Date().toISOString(),
 * });
 *
 * const task = await store.load("task-123");
 * ```
 *
 * @category TaskStore
 */
export class MemoryTaskStore implements BaseTaskStore {
  private tasks = new Map<string, BackgroundTask>();
  private namespace?: string;
  private expirationMs: number;

  /**
   * Create a new in-memory task store.
   *
   * @param options - Configuration options
   */
  constructor(options: TaskStoreOptions = {}) {
    this.namespace = options.namespace;
    this.expirationMs = options.expirationMs ?? 86400000; // 24 hours default
  }

  /**
   * Get the storage key for a task ID.
   * @internal
   */
  private getKey(taskId: string): string {
    return this.namespace ? `${this.namespace}:${taskId}` : taskId;
  }

  async save(task: BackgroundTask): Promise<void> {
    const key = this.getKey(task.id);
    this.tasks.set(key, { ...task });
  }

  async load(taskId: string): Promise<BackgroundTask | undefined> {
    const key = this.getKey(taskId);
    const task = this.tasks.get(key);
    return task ? { ...task } : undefined;
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
    const prefix = this.namespace ? `${this.namespace}:` : "";
    const tasks: BackgroundTask[] = [];

    for (const [key, task] of this.tasks) {
      // Skip if not in our namespace
      if (prefix && !key.startsWith(prefix)) {
        continue;
      }

      // Apply status filter if provided
      if (filter?.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        if (!statuses.includes(task.status)) {
          continue;
        }
      }

      tasks.push({ ...task });
    }

    return tasks;
  }

  async delete(taskId: string): Promise<boolean> {
    const key = this.getKey(taskId);
    return this.tasks.delete(key);
  }

  async exists(taskId: string): Promise<boolean> {
    const key = this.getKey(taskId);
    return this.tasks.has(key);
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

  /**
   * Clear all tasks from the store.
   *
   * Useful for testing.
   */
  clear(): void {
    if (this.namespace) {
      const prefix = `${this.namespace}:`;
      for (const key of this.tasks.keys()) {
        if (key.startsWith(prefix)) {
          this.tasks.delete(key);
        }
      }
    } else {
      this.tasks.clear();
    }
  }
}
