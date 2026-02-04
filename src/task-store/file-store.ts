/**
 * File-based task store implementation.
 *
 * Stores tasks as JSON files in a directory.
 * Provides persistence across process restarts.
 *
 * @packageDocumentation
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type {
  BackgroundTask,
  BackgroundTaskStatus,
  BaseTaskStore,
  TaskStoreOptions,
} from "./types.js";
import { isBackgroundTask, shouldExpireTask } from "./types.js";

/**
 * File-based implementation of the task store.
 *
 * Stores each task as a JSON file in the specified directory.
 * Tasks persist across process restarts.
 *
 * @example
 * ```typescript
 * const store = new FileTaskStore({
 *   directory: "./task-data",
 * });
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
export class FileTaskStore implements BaseTaskStore {
  private directory: string;
  private namespace?: string;
  private expirationMs: number;

  /**
   * Create a new file-based task store.
   *
   * @param options - Configuration options including directory path
   */
  constructor(
    options: TaskStoreOptions & {
      /** Directory to store task files */
      directory: string;
    },
  ) {
    this.directory = options.directory;
    this.namespace = options.namespace;
    this.expirationMs = options.expirationMs ?? 86400000; // 24 hours default
  }

  /**
   * Get the file path for a task ID.
   * @internal
   */
  private getFilePath(taskId: string): string {
    const fileName = this.namespace ? `${this.namespace}-${taskId}.json` : `${taskId}.json`;
    return path.join(this.directory, fileName);
  }

  /**
   * Get the task ID from a file name.
   * @internal
   */
  private getTaskIdFromFileName(fileName: string): string | null {
    if (!fileName.endsWith(".json")) {
      return null;
    }

    const baseName = fileName.slice(0, -5); // Remove .json

    if (this.namespace) {
      const prefix = `${this.namespace}-`;
      if (baseName.startsWith(prefix)) {
        return baseName.slice(prefix.length);
      }
      return null; // Not in our namespace
    }

    return baseName;
  }

  /**
   * Ensure the storage directory exists.
   * @internal
   */
  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.directory, { recursive: true });
    } catch (error) {
      // Ignore if directory already exists
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  async save(task: BackgroundTask): Promise<void> {
    await this.ensureDirectory();
    const filePath = this.getFilePath(task.id);
    const data = JSON.stringify(task, null, 2);
    await fs.writeFile(filePath, data, "utf-8");
  }

  async load(taskId: string): Promise<BackgroundTask | undefined> {
    const filePath = this.getFilePath(taskId);

    try {
      const data = await fs.readFile(filePath, "utf-8");
      const task = JSON.parse(data);

      if (!isBackgroundTask(task)) {
        console.warn(`Invalid task data in ${filePath}, skipping`);
        return undefined;
      }

      return task;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined; // File not found
      }
      throw error;
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
    await this.ensureDirectory();

    try {
      const files = await fs.readdir(this.directory);
      const tasks: BackgroundTask[] = [];

      for (const file of files) {
        const taskId = this.getTaskIdFromFileName(file);
        if (!taskId) {
          continue; // Not a task file or not in our namespace
        }

        const task = await this.load(taskId);
        if (!task) {
          continue; // Invalid or missing task
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return []; // Directory doesn't exist yet
      }
      throw error;
    }
  }

  async delete(taskId: string): Promise<boolean> {
    const filePath = this.getFilePath(taskId);

    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false; // File not found
      }
      throw error;
    }
  }

  async exists(taskId: string): Promise<boolean> {
    const filePath = this.getFilePath(taskId);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
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
