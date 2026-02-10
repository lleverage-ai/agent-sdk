/**
 * Task Manager for background task lifecycle management.
 *
 * Provides a unified interface for tracking, listing, and killing background tasks
 * (both bash commands and subagents). Integrates with checkpointing for state
 * persistence across interrupts.
 *
 * @packageDocumentation
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { BackgroundTask, BackgroundTaskStatus } from "./task-store/types.js";
import { updateBackgroundTask } from "./task-store/types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Filter options for listing tasks.
 *
 * @category TaskManager
 */
export interface TaskFilter {
  /** Filter by task status */
  status?: BackgroundTaskStatus | BackgroundTaskStatus[];
  /** Filter by task type (e.g., "bash", subagent type) */
  type?: string;
}

/**
 * Result of killing a task.
 *
 * @category TaskManager
 */
export interface KillResult {
  /** Whether the task was successfully killed */
  killed: boolean;
  /** Reason if kill failed */
  reason?: string;
}

/**
 * Result of killing all tasks.
 *
 * @category TaskManager
 */
export interface KillAllResult {
  /** Number of tasks successfully killed */
  killed: number;
  /** Number of tasks that failed to kill */
  failed: number;
}

/**
 * Resources associated with a running task.
 *
 * @category TaskManager
 */
export interface TaskResources {
  /** Child process for bash commands */
  process?: ChildProcess;
  /** Abort controller for subagent tasks */
  abortController?: AbortController;
}

/**
 * Options for restoring tasks from checkpoint.
 *
 * @category TaskManager
 */
export interface RestoreOptions {
  /** Mark tasks that were "running" as failed (process died) */
  markRunningAsFailed?: boolean;
  /** Reason to use for failed tasks */
  failureReason?: string;
}

/**
 * Events emitted by TaskManager.
 *
 * @category TaskManager
 */
export interface TaskManagerEvents {
  /** Emitted when any task property changes */
  taskUpdated: [task: BackgroundTask];
  /** Emitted when a task completes successfully */
  taskCompleted: [task: BackgroundTask];
  /** Emitted when a task fails */
  taskFailed: [task: BackgroundTask];
  /** Emitted when a new task is registered */
  taskCreated: [task: BackgroundTask];
  /** Emitted when a task is killed */
  taskKilled: [task: BackgroundTask];
}

// =============================================================================
// TaskManager Class
// =============================================================================

/**
 * Manages background task lifecycle for agents.
 *
 * The TaskManager tracks all background tasks (bash commands and subagents),
 * provides APIs for listing and killing tasks, and integrates with the
 * checkpointing system for state persistence.
 *
 * @example
 * ```typescript
 * const taskManager = new TaskManager();
 *
 * // Register a new task
 * taskManager.registerTask(task, { process: childProcess });
 *
 * // List running tasks
 * const running = taskManager.listTasks({ status: "running" });
 *
 * // Kill a task
 * await taskManager.killTask("task-123");
 *
 * // Subscribe to events
 * taskManager.on("taskCompleted", (task) => {
 *   console.log(`Task ${task.id} completed`);
 * });
 * ```
 *
 * @category TaskManager
 */
export class TaskManager extends EventEmitter<TaskManagerEvents> {
  /** Map of task ID to task data */
  private tasks = new Map<string, BackgroundTask>();

  /** Map of task ID to associated resources (process, abort controller) */
  private resources = new Map<string, TaskResources>();

  /** Whether the task manager is accepting new tasks */
  private accepting = true;

  // ===========================================================================
  // Task Lifecycle
  // ===========================================================================

  /**
   * Register a new background task.
   *
   * @param task - The task to register
   * @param resources - Associated resources (process, abort controller)
   */
  registerTask(task: BackgroundTask, resources: TaskResources = {}): void {
    if (!this.accepting) {
      throw new Error("TaskManager is not accepting new tasks (disposing)");
    }

    this.tasks.set(task.id, task);
    this.resources.set(task.id, resources);
    this.emit("taskCreated", task);
    this.emit("taskUpdated", task);
  }

  /**
   * Update a task's properties.
   *
   * @param taskId - The task ID to update
   * @param updates - Partial updates to apply
   */
  updateTask(taskId: string, updates: Partial<Omit<BackgroundTask, "id" | "createdAt">>): void {
    const existing = this.tasks.get(taskId);
    if (!existing) return;

    const updated = updateBackgroundTask(existing, updates);
    this.tasks.set(taskId, updated);

    // Emit appropriate events
    this.emit("taskUpdated", updated);

    if (updates.status === "completed") {
      this.emit("taskCompleted", updated);
    } else if (updates.status === "failed") {
      this.emit("taskFailed", updated);
    } else if (updates.status === "killed") {
      this.emit("taskKilled", updated);
    }
  }

  // ===========================================================================
  // Queries
  // ===========================================================================

  /**
   * Get a task by ID.
   *
   * @param taskId - The task ID
   * @returns The task or undefined if not found
   */
  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Remove a task from the manager.
   *
   * Only removes tasks in terminal states (completed, failed, killed).
   * Running or pending tasks cannot be removed - use killTask() instead.
   *
   * @param taskId - The task ID to remove
   * @returns True if task was removed, false if not found or still active
   */
  removeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    // Only remove terminal tasks
    if (task.status === "pending" || task.status === "running") {
      return false;
    }

    this.tasks.delete(taskId);
    this.resources.delete(taskId);
    return true;
  }

  /**
   * List tasks with optional filtering.
   *
   * @param filter - Optional filter criteria
   * @returns Array of matching tasks
   */
  listTasks(filter?: TaskFilter): BackgroundTask[] {
    let tasks = Array.from(this.tasks.values());

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = tasks.filter((t) => statuses.includes(t.status));
    }

    if (filter?.type) {
      tasks = tasks.filter((t) => t.subagentType === filter.type);
    }

    return tasks;
  }

  /**
   * Get all tasks.
   *
   * @returns Array of all tasks
   */
  getAllTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Check if there are any running or pending tasks.
   *
   * @returns True if there are active tasks
   */
  hasActiveTasks(): boolean {
    return this.listTasks({ status: ["running", "pending"] }).length > 0;
  }

  /**
   * Wait for the next task to reach a terminal state.
   *
   * Returns a promise that resolves with the completed/failed/killed task.
   * If there are no active tasks, this will hang indefinitely — always check
   * `hasActiveTasks()` before calling.
   *
   * @returns Promise resolving with the task that reached a terminal state
   */
  waitForNextCompletion(): Promise<BackgroundTask> {
    return new Promise((resolve) => {
      const onTerminal = (task: BackgroundTask) => {
        this.off("taskCompleted", onTerminal);
        this.off("taskFailed", onTerminal);
        this.off("taskKilled", onTerminal);
        resolve(task);
      };
      this.on("taskCompleted", onTerminal);
      this.on("taskFailed", onTerminal);
      this.on("taskKilled", onTerminal);
    });
  }

  // ===========================================================================
  // Control
  // ===========================================================================

  /**
   * Kill a running task.
   *
   * For bash commands, sends SIGTERM then SIGKILL.
   * For subagents, aborts the controller.
   *
   * @param taskId - The task ID to kill
   * @returns Result indicating success or failure
   */
  async killTask(taskId: string): Promise<KillResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { killed: false, reason: "Task not found" };
    }

    if (task.status === "completed" || task.status === "failed" || task.status === "killed") {
      return { killed: false, reason: "Task already finished" };
    }

    const resources = this.resources.get(taskId);
    if (!resources) {
      return { killed: false, reason: "No resources to kill" };
    }

    try {
      // Set status to "killed" FIRST, before killing the process.
      // This prevents a race condition where the process death triggers
      // onError callbacks that would otherwise set status to "failed".
      this.updateTask(taskId, {
        status: "killed",
        completedAt: new Date().toISOString(),
      });

      // Now kill the process - any callbacks will see status is already "killed"
      if (resources.process) {
        await this.killProcess(resources.process);
      }

      // Abort subagent
      if (resources.abortController) {
        resources.abortController.abort();
      }

      return { killed: true };
    } catch (error) {
      return {
        killed: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Kill all running tasks.
   *
   * @returns Summary of killed and failed tasks
   */
  async killAllTasks(): Promise<KillAllResult> {
    const activeTasks = this.listTasks({ status: ["running", "pending"] });
    let killed = 0;
    let failed = 0;

    for (const task of activeTasks) {
      const result = await this.killTask(task.id);
      if (result.killed) {
        killed++;
      } else {
        failed++;
      }
    }

    return { killed, failed };
  }

  /**
   * Stop accepting new tasks.
   * Used during disposal to prevent new tasks from being registered.
   */
  stopAccepting(): void {
    this.accepting = false;
  }

  /**
   * Resume accepting new tasks.
   */
  resumeAccepting(): void {
    this.accepting = true;
  }

  /**
   * Check if the manager is accepting new tasks.
   */
  isAccepting(): boolean {
    return this.accepting;
  }

  // ===========================================================================
  // Checkpoint Integration
  // ===========================================================================

  /**
   * Restore tasks from a checkpoint.
   *
   * Used when resuming from an interrupt or restarting the agent.
   * Running tasks are marked as failed since the original process is gone.
   *
   * @param tasks - Tasks from checkpoint
   * @param options - Restore options
   */
  restoreFromCheckpoint(tasks: BackgroundTask[], options: RestoreOptions = {}): void {
    const {
      markRunningAsFailed = true,
      failureReason = "Process terminated while task was running",
    } = options;

    for (const task of tasks) {
      if (markRunningAsFailed && (task.status === "running" || task.status === "pending")) {
        // Task was running when process died - mark as failed
        const failedTask = updateBackgroundTask(task, {
          status: "failed",
          error: failureReason,
          completedAt: new Date().toISOString(),
        });
        this.tasks.set(task.id, failedTask);
      } else {
        // Completed or failed tasks - restore as-is
        this.tasks.set(task.id, task);
      }
    }
  }

  /**
   * Clear all tasks.
   * Used for testing or resetting state.
   */
  clear(): void {
    this.tasks.clear();
    this.resources.clear();
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Kill a child process gracefully.
   * Sends SIGTERM first, then SIGKILL after 1 second if still alive.
   */
  private async killProcess(process: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (process.killed || process.exitCode !== null) {
        resolve();
        return;
      }

      // Try graceful termination
      process.kill("SIGTERM");

      // Force kill after 1 second
      const forceKillTimer = setTimeout(() => {
        if (!process.killed && process.exitCode === null) {
          process.kill("SIGKILL");
        }
        resolve();
      }, 1000);

      // Clear timer if process exits
      process.once("exit", () => {
        clearTimeout(forceKillTimer);
        resolve();
      });
    });
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new TaskManager instance.
 *
 * @returns A new TaskManager
 *
 * @example
 * ```typescript
 * const taskManager = createTaskManager();
 * ```
 *
 * @category TaskManager
 */
export function createTaskManager(): TaskManager {
  return new TaskManager();
}
