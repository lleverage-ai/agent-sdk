/**
 * Todo tool for task planning and tracking.
 *
 * Provides a single `todo_write` tool for managing task lists, similar to
 * Claude Code's TodoWrite. Agents replace the entire todo list with each call.
 *
 * @packageDocumentation
 */

import { tool } from "ai";
import { z } from "zod";
import type { AgentState, TodoItem, TodoStatus } from "../backends/state.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Type of change that occurred to the todo list.
 *
 * @category Tools
 */
export type TodoChangeType = "replaced" | "cleared";

/**
 * Data for todo change events.
 *
 * @category Tools
 */
export interface TodosChangedData {
  /** Discriminator type */
  type: "todosChanged";
  /** Type of change */
  changeType: TodoChangeType;
  /** IDs of affected todos */
  affectedIds: string[];
  /** Total count of todos */
  totalCount: number;
  /** Summary of current todos */
  summary: {
    pending: number;
    inProgress: number;
    completed: number;
  };
}

/**
 * Callback type for todo change events.
 *
 * When provided to the todo tool, this callback is invoked whenever the todo list changes.
 * This enables integration with the hook system for emitting `todos:changed` events.
 *
 * @param data - The change event data
 *
 * @category Tools
 */
export type OnTodosChanged = (data: TodosChangedData) => void | Promise<void>;

/**
 * Input for a todo item.
 *
 * @category Tools
 */
export interface TodoInput {
  /** Description of the task */
  content: string;

  /** Current status of the task */
  status: TodoStatus;
}

/**
 * Options for creating the todo_write tool.
 *
 * @category Tools
 */
export interface TodoWriteToolOptions {
  /** The agent state containing the todo list */
  state: AgentState;

  /**
   * Callback invoked when todos change.
   *
   * Use this to integrate with the hook system for emitting `todos:changed` events.
   *
   * @example
   * ```typescript
   * const todoWrite = createTodoWriteTool({
   *   state,
   *   onTodosChanged: (data) => {
   *     console.log("Todos changed:", data);
   *   },
   * });
   * ```
   */
  onTodosChanged?: OnTodosChanged;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Helper to create a summary of current todos.
 * @internal
 */
function createTodoSummary(todos: TodoItem[]): TodosChangedData["summary"] {
  return {
    pending: todos.filter((t) => t.status === "pending").length,
    inProgress: todos.filter((t) => t.status === "in_progress").length,
    completed: todos.filter((t) => t.status === "completed").length,
  };
}

/**
 * Helper to emit todos:changed event.
 * @internal
 */
async function emitTodosChanged(
  onTodosChanged: OnTodosChanged | undefined,
  changeType: TodoChangeType,
  affectedIds: string[],
  todos: TodoItem[],
): Promise<void> {
  if (!onTodosChanged) return;

  const data: TodosChangedData = {
    type: "todosChanged",
    changeType,
    affectedIds,
    totalCount: todos.length,
    summary: createTodoSummary(todos),
  };

  await onTodosChanged(data);
}

// =============================================================================
// Todo Write Tool
// =============================================================================

/**
 * Creates the todo_write tool for managing task lists.
 *
 * This tool replaces the entire todo list with the provided items. It's designed
 * to match Claude Code's TodoWrite behavior where the agent always provides the
 * complete list state.
 *
 * @param options - Configuration options
 * @returns An AI SDK compatible tool for writing todos
 *
 * @example
 * ```typescript
 * import { createTodoWriteTool, createAgentState } from "@lleverage-ai/agent-sdk";
 *
 * const state = createAgentState();
 * const todoWrite = createTodoWriteTool({ state });
 *
 * const agent = createAgent({
 *   model,
 *   tools: { todo_write: todoWrite },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With change callback for UI integration
 * const todoWrite = createTodoWriteTool({
 *   state,
 *   onTodosChanged: (data) => {
 *     console.log(`Todos updated: ${data.summary.completed}/${data.totalCount} completed`);
 *   },
 * });
 * ```
 *
 * @category Tools
 */
export function createTodoWriteTool(options: TodoWriteToolOptions) {
  const { state, onTodosChanged } = options;

  return tool({
    description:
      "Update the task list. Replace the entire todo list with the provided items. Use this to track progress on multi-step tasks.",
    inputSchema: z.object({
      todos: z.array(
        z.object({
          content: z.string().describe("Task description"),
          status: z.enum(["pending", "in_progress", "completed"]).describe("Current task status"),
        }),
      ),
    }),
    execute: async ({ todos }: { todos: TodoInput[] }) => {
      const now = new Date().toISOString();

      // Transform input to full TodoItem format
      const newTodos: TodoItem[] = todos.map((t, i) => {
        // Try to find existing todo with same content to preserve ID
        const existingTodo = state.todos.find((existing) => existing.content === t.content);

        const id = existingTodo?.id ?? `todo-${Date.now()}-${i}`;
        const createdAt = existingTodo?.createdAt ?? now;
        const completedAt =
          t.status === "completed" ? (existingTodo?.completedAt ?? now) : undefined;

        return {
          id,
          content: t.content,
          status: t.status,
          createdAt,
          completedAt,
        };
      });

      state.todos = newTodos;

      // Emit change event
      await emitTodosChanged(
        onTodosChanged,
        "replaced",
        newTodos.map((t) => t.id),
        newTodos,
      );

      // Generate summary
      const summary = createTodoSummary(newTodos);

      return {
        success: true,
        count: newTodos.length,
        summary,
      };
    },
  });
}
