/**
 * Tests for todo_write tool.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { AgentState, TodoItem } from "../src/backends/state.js";
import type { TodosChangedData } from "../src/tools/todos.js";
import { createTodoWriteTool } from "../src/tools/todos.js";

// Mock state factory
function createMockState(todos: TodoItem[] = []): AgentState {
  return {
    todos: [...todos],
    files: {},
    version: 1,
  };
}

describe("Todo Write Tool", () => {
  let state: AgentState;

  beforeEach(() => {
    state = createMockState();
  });

  describe("createTodoWriteTool", () => {
    it("should create new todos", async () => {
      const tool = createTodoWriteTool({ state });
      const result = await tool.execute(
        {
          todos: [
            { content: "Task 1", status: "pending" },
            { content: "Task 2", status: "in_progress" },
          ],
        },
        {} as any,
      );

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(state.todos).toHaveLength(2);
      expect(state.todos[0].content).toBe("Task 1");
      expect(state.todos[0].status).toBe("pending");
      expect(state.todos[1].content).toBe("Task 2");
      expect(state.todos[1].status).toBe("in_progress");
    });

    it("should replace existing todos", async () => {
      state.todos = [
        { id: "old-1", content: "Old task", status: "pending", createdAt: "2024-01-01" },
      ];

      const tool = createTodoWriteTool({ state });
      await tool.execute(
        {
          todos: [
            { content: "New task 1", status: "pending" },
            { content: "New task 2", status: "completed" },
          ],
        },
        {} as any,
      );

      expect(state.todos).toHaveLength(2);
      expect(state.todos[0].content).toBe("New task 1");
      expect(state.todos[1].content).toBe("New task 2");
    });

    it("should preserve ID and createdAt for matching content", async () => {
      const originalTodo: TodoItem = {
        id: "original-id",
        content: "Keep me",
        status: "pending",
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      state.todos = [originalTodo];

      const tool = createTodoWriteTool({ state });
      await tool.execute(
        {
          todos: [{ content: "Keep me", status: "completed" }],
        },
        {} as any,
      );

      expect(state.todos[0].id).toBe("original-id");
      expect(state.todos[0].createdAt).toBe("2024-01-01T00:00:00.000Z");
      expect(state.todos[0].status).toBe("completed");
    });

    it("should generate unique IDs for new todos", async () => {
      const tool = createTodoWriteTool({ state });
      await tool.execute(
        {
          todos: [
            { content: "Task 1", status: "pending" },
            { content: "Task 2", status: "pending" },
          ],
        },
        {} as any,
      );

      expect(state.todos[0].id).toBeDefined();
      expect(state.todos[1].id).toBeDefined();
      expect(state.todos[0].id).not.toBe(state.todos[1].id);
    });

    it("should return summary statistics", async () => {
      const tool = createTodoWriteTool({ state });
      const result = await tool.execute(
        {
          todos: [
            { content: "Task 1", status: "pending" },
            { content: "Task 2", status: "in_progress" },
            { content: "Task 3", status: "completed" },
            { content: "Task 4", status: "pending" },
          ],
        },
        {} as any,
      );

      expect(result.summary).toEqual({
        pending: 2,
        inProgress: 1,
        completed: 1,
      });
    });

    it("should set completedAt for completed todos", async () => {
      const tool = createTodoWriteTool({ state });
      await tool.execute(
        {
          todos: [{ content: "Done task", status: "completed" }],
        },
        {} as any,
      );

      expect(state.todos[0].completedAt).toBeDefined();
    });

    it("should not set completedAt for non-completed todos", async () => {
      const tool = createTodoWriteTool({ state });
      await tool.execute(
        {
          todos: [
            { content: "Pending task", status: "pending" },
            { content: "In progress task", status: "in_progress" },
          ],
        },
        {} as any,
      );

      expect(state.todos[0].completedAt).toBeUndefined();
      expect(state.todos[1].completedAt).toBeUndefined();
    });

    it("should clear todos when given empty array", async () => {
      state.todos = [{ id: "1", content: "Task", status: "pending", createdAt: "2024-01-01" }];

      const tool = createTodoWriteTool({ state });
      await tool.execute({ todos: [] }, {} as any);

      expect(state.todos).toHaveLength(0);
    });
  });

  describe("Tool Schema", () => {
    it("should have description", () => {
      const tool = createTodoWriteTool({ state });
      expect(tool.description).toBeDefined();
      expect(tool.description?.length).toBeGreaterThan(0);
    });

    it("should have parameters schema", () => {
      const tool = createTodoWriteTool({ state });
      expect(tool.inputSchema).toBeDefined();
    });
  });

  describe("todos:changed events", () => {
    it("should emit replaced event", async () => {
      const events: TodosChangedData[] = [];
      const onTodosChanged = (data: TodosChangedData) => {
        events.push(data);
      };

      const tool = createTodoWriteTool({ state, onTodosChanged });
      await tool.execute(
        {
          todos: [
            { content: "Task 1", status: "pending" },
            { content: "Task 2", status: "completed" },
          ],
        },
        {} as any,
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("todosChanged");
      expect(events[0].changeType).toBe("replaced");
      expect(events[0].totalCount).toBe(2);
      expect(events[0].summary.pending).toBe(1);
      expect(events[0].summary.completed).toBe(1);
    });

    it("should work without callback (no errors)", async () => {
      const tool = createTodoWriteTool({ state });

      // Should not throw
      await tool.execute(
        {
          todos: [{ content: "Task", status: "pending" }],
        },
        {} as any,
      );

      expect(state.todos).toHaveLength(1);
    });

    it("should support async callback", async () => {
      const events: TodosChangedData[] = [];
      const onTodosChanged = async (data: TodosChangedData) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        events.push(data);
      };

      const tool = createTodoWriteTool({ state, onTodosChanged });
      await tool.execute(
        {
          todos: [{ content: "Task", status: "pending" }],
        },
        {} as any,
      );

      expect(events).toHaveLength(1);
    });
  });
});
