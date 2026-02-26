/**
 * Type definitions for the task store system.
 *
 * Task stores provide persistence for background task state, allowing tasks
 * to survive process restarts and be recovered when the agent resumes.
 *
 * @packageDocumentation
 */

// =============================================================================
// Background Task Data Structure
// =============================================================================

/**
 * Status of a background task.
 *
 * - `pending`: Task created but not yet started
 * - `running`: Task is currently executing
 * - `completed`: Task finished successfully
 * - `failed`: Task encountered an error
 * - `killed`: Task was explicitly terminated by the user
 *
 * @category TaskStore
 */
export type BackgroundTaskStatus = "pending" | "running" | "completed" | "failed" | "killed";

/**
 * Complete snapshot of a background task's state.
 *
 * A background task captures the execution state of an async subagent,
 * including:
 * - Task metadata (ID, type, description)
 * - Current status and timestamps
 * - Result or error information
 * - Optional metadata for custom data
 *
 * @example
 * ```typescript
 * const task: BackgroundTask = {
 *   id: "task-123",
 *   subagentType: "researcher",
 *   description: "Research TypeScript history",
 *   status: "running",
 *   createdAt: "2026-01-30T10:00:00Z",
 *   updatedAt: "2026-01-30T10:05:00Z",
 * };
 * ```
 *
 * @category TaskStore
 */
export interface BackgroundTask {
  /** Unique identifier for this task */
  id: string;

  /** Type of subagent handling this task */
  subagentType: string;

  /** Task description/prompt */
  description: string;

  /** Current status */
  status: BackgroundTaskStatus;

  /** ISO 8601 timestamp when this task was created */
  createdAt: string;

  /** ISO 8601 timestamp when this task was last updated */
  updatedAt: string;

  /** ISO 8601 timestamp when this task completed (if completed/failed) */
  completedAt?: string;

  /** Result text (when completed) */
  result?: string;

  /** Error message (when failed) */
  error?: string;

  /** Optional metadata for custom data */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Task Store Interface
// =============================================================================

/**
 * Options for creating a task store.
 *
 * @category TaskStore
 */
export interface TaskStoreOptions {
  /**
   * Namespace for isolating tasks.
   *
   * Useful for multi-tenant scenarios where different users or sessions
   * need separate task storage.
   *
   * @defaultValue undefined (no namespace)
   */
  namespace?: string;

  /**
   * Task expiration time in milliseconds.
   *
   * Completed/failed tasks older than this will be automatically cleaned up.
   *
   * @defaultValue 86400000 (24 hours)
   */
  expirationMs?: number;
}

/**
 * Abstract storage interface for background tasks.
 *
 * Implement this interface to create custom task storage backends
 * such as Redis, SQLite, cloud storage, or any other persistence layer.
 *
 * @example
 * ```typescript
 * class RedisTaskStore implements BaseTaskStore {
 *   constructor(private redis: RedisClient) {}
 *
 *   async save(task: BackgroundTask): Promise<void> {
 *     const key = `task:${task.id}`;
 *     await this.redis.set(key, JSON.stringify(task));
 *   }
 *
 *   async load(taskId: string): Promise<BackgroundTask | undefined> {
 *     const key = `task:${taskId}`;
 *     const data = await this.redis.get(key);
 *     return data ? JSON.parse(data) : undefined;
 *   }
 *
 *   // ... other methods
 * }
 * ```
 *
 * @category TaskStore
 */
export interface BaseTaskStore {
  /**
   * Save a task.
   *
   * If a task with the same `id` exists, it should be updated.
   *
   * @param task - The task to save
   */
  save(task: BackgroundTask): Promise<void>;

  /**
   * Load a task by ID.
   *
   * @param taskId - The unique task identifier
   * @returns The task if found, undefined otherwise
   */
  load(taskId: string): Promise<BackgroundTask | undefined>;

  /**
   * List all task IDs.
   *
   * @param filter - Optional filter by status
   * @returns Array of task IDs
   */
  list(filter?: { status?: BackgroundTaskStatus | BackgroundTaskStatus[] }): Promise<string[]>;

  /**
   * List all tasks.
   *
   * @param filter - Optional filter by status
   * @returns Array of tasks
   */
  listTasks(filter?: {
    status?: BackgroundTaskStatus | BackgroundTaskStatus[];
  }): Promise<BackgroundTask[]>;

  /**
   * Delete a task.
   *
   * @param taskId - The task ID to delete
   * @returns True if a task was deleted, false if not found
   */
  delete(taskId: string): Promise<boolean>;

  /**
   * Check if a task exists.
   *
   * @param taskId - The task ID to check
   * @returns True if the task exists
   */
  exists(taskId: string): Promise<boolean>;

  /**
   * Clean up expired tasks.
   *
   * Removes completed/failed tasks older than the expiration time.
   *
   * @returns Number of tasks cleaned up
   */
  cleanup(): Promise<number>;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new background task with the given data.
 *
 * This is a convenience function that ensures timestamps are set correctly.
 *
 * @param data - Partial task data (id, subagentType, description required)
 * @returns A complete task object
 *
 * @example
 * ```typescript
 * const task = createBackgroundTask({
 *   id: "task-123",
 *   subagentType: "researcher",
 *   description: "Research topic X",
 * });
 * ```
 *
 * @category TaskStore
 */
export function createBackgroundTask(
  data: Pick<BackgroundTask, "id" | "subagentType" | "description"> &
    Partial<Omit<BackgroundTask, "id" | "subagentType" | "description">>,
): BackgroundTask {
  const now = new Date().toISOString();
  return {
    status: "pending",
    createdAt: now,
    updatedAt: now,
    ...data,
  };
}

/**
 * Update an existing task with new data.
 *
 * Automatically updates the `updatedAt` timestamp.
 *
 * @param task - The existing task
 * @param updates - Partial updates to apply
 * @returns A new task object with updates applied
 *
 * @example
 * ```typescript
 * const updated = updateBackgroundTask(task, {
 *   status: "completed",
 *   result: "Task completed successfully",
 *   completedAt: new Date().toISOString(),
 * });
 * ```
 *
 * @category TaskStore
 */
export function updateBackgroundTask(
  task: BackgroundTask,
  updates: Partial<Omit<BackgroundTask, "id" | "createdAt">>,
): BackgroundTask {
  return {
    ...task,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Type guard to check if an object is a valid BackgroundTask.
 *
 * @param value - The value to check
 * @returns True if the value is a valid BackgroundTask
 *
 * @category TaskStore
 */
export function isBackgroundTask(value: unknown): value is BackgroundTask {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "string" &&
    typeof obj.subagentType === "string" &&
    typeof obj.description === "string" &&
    (obj.status === "pending" ||
      obj.status === "running" ||
      obj.status === "completed" ||
      obj.status === "failed" ||
      obj.status === "killed") &&
    typeof obj.createdAt === "string" &&
    typeof obj.updatedAt === "string"
  );
}

/**
 * Check if a task should be expired based on age and status.
 *
 * @param task - The task to check
 * @param expirationMs - Expiration time in milliseconds
 * @returns True if the task should be expired
 *
 * @category TaskStore
 */
export function shouldExpireTask(task: BackgroundTask, expirationMs: number): boolean {
  // Only expire completed, failed, or killed tasks
  if (task.status !== "completed" && task.status !== "failed" && task.status !== "killed") {
    return false;
  }

  // Use completedAt if available, otherwise use updatedAt
  const timestampStr = task.completedAt ?? task.updatedAt;
  const timestamp = new Date(timestampStr).getTime();
  const now = Date.now();

  return now - timestamp > expirationMs;
}
