/**
 * Task management tools for controlling background tasks.
 *
 * Provides tools for the agent to list and kill background tasks.
 * These complement the programmatic API on agent.taskManager.
 *
 * @packageDocumentation
 */

import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { TaskFilter, TaskManager } from "../task-manager.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating the kill_task tool.
 *
 * @category TaskManager
 */
export interface KillTaskToolOptions {
  /** The task manager instance */
  taskManager: TaskManager;
  /** Custom tool description */
  description?: string;
}

/**
 * Options for creating the list_tasks tool.
 *
 * @category TaskManager
 */
export interface ListTasksToolOptions {
  /** The task manager instance */
  taskManager: TaskManager;
  /** Custom tool description */
  description?: string;
}

// =============================================================================
// Kill Task Tool
// =============================================================================

/**
 * Creates a tool for killing running background tasks.
 *
 * This tool allows the agent to terminate background tasks (bash commands
 * or subagents) that are still running.
 *
 * @param options - Configuration options
 * @returns An AI SDK compatible tool
 *
 * @example
 * ```typescript
 * const killTask = createKillTaskTool({ taskManager });
 *
 * const agent = createAgent({
 *   model,
 *   tools: { kill_task: killTask },
 * });
 * ```
 *
 * @category TaskManager
 */
export function createKillTaskTool(options: KillTaskToolOptions): Tool {
  const { taskManager } = options;

  const toolDescription =
    options.description ??
    `Kill a running background task.

Use this tool to terminate a background task (bash command or subagent) that is still running.
The task will be marked as failed with reason "Killed by user".

Parameters:
- task_id: The ID of the task to kill (returned when the task was started)`;

  return tool({
    description: toolDescription,
    inputSchema: z.object({
      task_id: z.string().describe("The task ID to kill"),
    }),
    execute: async ({ task_id }) => {
      const result = await taskManager.killTask(task_id);

      if (result.killed) {
        return {
          success: true,
          message: `Task ${task_id} has been killed.`,
        };
      }

      return {
        success: false,
        message: `Failed to kill task ${task_id}: ${result.reason}`,
      };
    },
  });
}

// =============================================================================
// List Tasks Tool
// =============================================================================

/**
 * Creates a tool for listing background tasks.
 *
 * This tool allows the agent to see all background tasks and their status.
 *
 * @param options - Configuration options
 * @returns An AI SDK compatible tool
 *
 * @example
 * ```typescript
 * const listTasks = createListTasksTool({ taskManager });
 *
 * const agent = createAgent({
 *   model,
 *   tools: { list_tasks: listTasks },
 * });
 * ```
 *
 * @category TaskManager
 */
export function createListTasksTool(options: ListTasksToolOptions): Tool {
  const { taskManager } = options;

  const toolDescription =
    options.description ??
    `List background tasks and their status.

Use this tool to see all background tasks (bash commands and subagents).
You can filter by status and/or type.

Parameters:
- status: Optional filter by status ("pending", "running", "completed", "failed")
- type: Optional filter by type ("bash" for bash commands, or subagent type name)`;

  return tool({
    description: toolDescription,
    inputSchema: z.object({
      status: z
        .enum(["pending", "running", "completed", "failed"])
        .optional()
        .describe("Filter by task status"),
      type: z.string().optional().describe('Filter by task type (e.g., "bash", "researcher")'),
    }),
    execute: async ({ status, type }) => {
      const filter: TaskFilter = {};
      if (status) filter.status = status;
      if (type) filter.type = type;

      const tasks = taskManager.listTasks(filter);

      return {
        count: tasks.length,
        tasks: tasks.map((t) => ({
          id: t.id,
          type: t.subagentType,
          description: t.description,
          status: t.status,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
          // Include error for failed tasks
          ...(t.status === "failed" && t.error ? { error: t.error } : {}),
        })),
      };
    },
  });
}
