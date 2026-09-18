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
import {
  type OwnedTaskCallbacks,
  type OwnedTaskPolicy,
  type OwnedTaskScope,
  OwnedTasks,
} from "./owned-tasks.js";
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

  /** Process-local delegation implementation. @internal */
  owned?: OwnedTasks;

  /**
   * Enable in-process ownership once. Omitted lifetime/drain limits create no timers.
   * @param policy - Cancellation grace and optional lifetime/replay limits
   * @param callbacks - Optional host admission and unresolved-work notifications
   */
  configureOwnedTasks(policy: OwnedTaskPolicy, callbacks?: OwnedTaskCallbacks): void {
    this.owned ??= new OwnedTasks(this, policy, callbacks, {
      tasks: this.tasks,
      resources: this.resources,
    });
  }

  /**
   * Begin a host attempt only after all previous work has settled.
   * @param scope - Host run/attempt identity and cancellation
   */
  beginTaskScope(scope: OwnedTaskScope): void {
    this.owned?.begin(scope);
  }

  /**
   * Cancel and settle delegations; reject if any real execution remains unresolved.
   * @param reason - Why the scope is ending
   * @param reopen - Reopen admissions only after successful settlement without scope cancellation
   */
  async settleOwnedTasks(reason: string, reopen = false): Promise<void> {
    await this.owned?.close(reason, reopen);
  }

  /** Release retained payloads after settlement/quarantine transfer, never live ownership. */
  releaseOwnedTaskResults(): void {
    this.owned?.releaseResults();
  }

  /**
   * Synchronously claim a result shared by manual and automatic delivery.
   * @param taskId - Terminal background task to consume
   * @returns The claimed task, or undefined if unavailable/already consumed/foreground
   */
  consumeTask(taskId: string): BackgroundTask | undefined {
    if (this.owned) return this.owned.consume(taskId);
    const task = this.getTask(taskId);
    return task && this.removeTask(taskId) ? task : undefined;
  }

  /** Whether any background tasks remain, excluding owned foreground results. */
  hasBackgroundTasks(): boolean {
    return this.getAllTasks().some((task) => !this.owned || this.owned.isBackground(task.id));
  }

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
    // A terminal state has one winner; late settlement cannot resurrect work.
    if (this.owned && !["running", "pending"].includes(existing.status)) return;

    const updated = updateBackgroundTask(existing, updates);
    this.tasks.set(taskId, updated);

    // Emit appropriate events
    this.emit("taskUpdated", updated);

    // Foreground results are returned inline, never through the completion queue.
    if (this.owned && !this.owned.isBackground(taskId)) return;
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

    if (this.owned?.records.has(taskId)) return false;
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
   * Check if there are any terminal tasks still in the manager (not yet removed).
   *
   * @returns True if there are unprocessed terminal tasks
   */
  hasTerminalTasks(): boolean {
    return this.listTasks({ status: ["completed", "failed", "killed"] }).length > 0;
  }

  /**
   * Wait for the next task to reach a terminal state.
   *
   * If a task is already in a terminal state, resolves immediately with it.
   * Otherwise, subscribes to events and waits for the next terminal transition.
   *
   * @returns Promise resolving with the task that reached a terminal state
   */
  waitForNextCompletion(): Promise<BackgroundTask> {
    if (this.owned) return this.owned.nextCompletion();
    // Check for already-terminal tasks first to avoid missing events
    // that fired while no listener was attached.
    const terminal = this.listTasks({ status: ["completed", "failed", "killed"] });
    const firstTerminal = terminal[0];
    if (firstTerminal) {
      return Promise.resolve(firstTerminal);
    }

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
    if (this.owned?.records.has(taskId)) return this.owned.kill(taskId);
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
    // Cancel all owned work before waiting one shared grace. Legacy shell
    // termination remains independent.
    const ownedIds = new Set(this.owned?.records.keys() ?? []);
    if (this.owned) {
      try {
        await this.owned.close("kill_all_tasks");
      } catch {
        /* Ownership stays quarantined. */
      }
      failed = [...ownedIds].filter((id) => this.owned?.records.has(id)).length;
      killed = ownedIds.size - failed;
    }

    for (const task of activeTasks) {
      if (ownedIds.has(task.id)) continue;
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
    if (this.owned?.records.size) throw new Error("subagent_cleanup_unresolved");
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
