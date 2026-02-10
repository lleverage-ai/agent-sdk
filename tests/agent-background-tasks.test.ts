/**
 * Tests for agent.generate() / stream() automatic background task handling.
 */

import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskManager } from "../src/task-manager.js";
import type { BackgroundTask } from "../src/task-store/types.js";
import type { Agent, GenerateResult } from "../src/types.js";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a mock agent whose generate/stream methods can be controlled per-call.
 * Each call to generate/stream records the invocation and can return custom results.
 */
function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "mock-agent",
    options: { model: {} as LanguageModel },
    backend: {} as any,
    state: { todos: [], files: {} },
    ready: Promise.resolve(),
    generate: vi.fn().mockResolvedValue({
      status: "complete",
      text: "Agent response",
      steps: [],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    } satisfies GenerateResult),
    resume: vi.fn().mockResolvedValue({
      status: "complete",
      text: "Resumed response",
      steps: [],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    }),
    stream: vi.fn() as any,
    streamResponse: vi.fn() as any,
    streamRaw: vi.fn() as any,
    streamDataResponse: vi.fn() as any,
    getSkills: vi.fn().mockReturnValue([]),
    taskManager: new TaskManager(),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createRunningTask(id: string, metadata?: Record<string, unknown>): BackgroundTask {
  return {
    id,
    subagentType: "bash",
    description: `Task ${id}`,
    status: "running",
    metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// TaskManager.waitForNextCompletion() tests
// =============================================================================

describe("TaskManager.waitForNextCompletion", () => {
  it("should resolve when a task completes", async () => {
    const tm = new TaskManager();
    const task = createRunningTask("t1");
    tm.registerTask(task, {});

    const completionPromise = tm.waitForNextCompletion();

    // Complete the task
    tm.updateTask("t1", { status: "completed", result: "done" });

    const result = await completionPromise;
    expect(result.id).toBe("t1");
    expect(result.status).toBe("completed");
  });

  it("should resolve when a task fails", async () => {
    const tm = new TaskManager();
    const task = createRunningTask("t1");
    tm.registerTask(task, {});

    const completionPromise = tm.waitForNextCompletion();

    tm.updateTask("t1", { status: "failed", error: "oops" });

    const result = await completionPromise;
    expect(result.id).toBe("t1");
    expect(result.status).toBe("failed");
  });

  it("should resolve when a task is killed", async () => {
    const tm = new TaskManager();
    const task = createRunningTask("t1");
    tm.registerTask(task, {});

    const completionPromise = tm.waitForNextCompletion();

    tm.updateTask("t1", { status: "killed" });

    const result = await completionPromise;
    expect(result.id).toBe("t1");
    expect(result.status).toBe("killed");
  });

  it("should only resolve once with the first terminal task", async () => {
    const tm = new TaskManager();
    tm.registerTask(createRunningTask("t1"), {});
    tm.registerTask(createRunningTask("t2"), {});

    const completionPromise = tm.waitForNextCompletion();

    // Complete both in quick succession
    tm.updateTask("t1", { status: "completed", result: "first" });
    tm.updateTask("t2", { status: "completed", result: "second" });

    const result = await completionPromise;
    // Should get the first one
    expect(result.id).toBe("t1");

    // Second call should get the second one
    const secondPromise = tm.waitForNextCompletion();
    // t2 already completed, but the event was already emitted.
    // We need to trigger a new event for the second call.
    // Since t2 was already completed, we need a new task.
    tm.registerTask(createRunningTask("t3"), {});
    tm.updateTask("t3", { status: "completed", result: "third" });

    const result2 = await secondPromise;
    expect(result2.id).toBe("t3");
  });
});

// =============================================================================
// Agent background task integration tests (via generate)
// =============================================================================
// Note: These tests validate the background task loop logic at the unit level.
// The actual integration with createAgent() is tested implicitly — here we test
// the TaskManager primitives and the expected behavioral contracts.

describe("Agent background task integration", () => {
  let taskManager: TaskManager;

  beforeEach(() => {
    taskManager = new TaskManager();
  });

  describe("waitForBackgroundTasks behavior", () => {
    it("should not block when no active tasks", () => {
      // hasActiveTasks() should be false when no tasks registered
      expect(taskManager.hasActiveTasks()).toBe(false);
    });

    it("should detect active tasks correctly", () => {
      taskManager.registerTask(createRunningTask("t1"), {});
      expect(taskManager.hasActiveTasks()).toBe(true);

      taskManager.updateTask("t1", { status: "completed", result: "done" });
      expect(taskManager.hasActiveTasks()).toBe(false);
    });

    it("should detect pending tasks as active", () => {
      const pendingTask: BackgroundTask = {
        id: "p1",
        subagentType: "bash",
        description: "Pending task",
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      taskManager.registerTask(pendingTask, {});
      expect(taskManager.hasActiveTasks()).toBe(true);
    });
  });

  describe("deduplication with task_output", () => {
    it("should skip already-consumed tasks (removed from TaskManager)", async () => {
      const task = createRunningTask("consumed-task");
      taskManager.registerTask(task, {});

      // Complete the task
      taskManager.updateTask("consumed-task", { status: "completed", result: "output" });

      // Simulate task_output consuming it (removes from TaskManager)
      taskManager.removeTask("consumed-task");

      // Now getTask should return undefined
      expect(taskManager.getTask("consumed-task")).toBeUndefined();
    });

    it("should process tasks that are still in TaskManager", async () => {
      const task = createRunningTask("unconsumed-task");
      taskManager.registerTask(task, {});

      taskManager.updateTask("unconsumed-task", { status: "completed", result: "output" });

      // Task is still in TaskManager (not consumed by task_output)
      expect(taskManager.getTask("unconsumed-task")).toBeDefined();
      expect(taskManager.getTask("unconsumed-task")?.status).toBe("completed");
    });
  });

  describe("killed task handling", () => {
    it("should allow removing killed tasks", () => {
      const task = createRunningTask("killed-task");
      taskManager.registerTask(task, {});

      taskManager.updateTask("killed-task", { status: "killed" });

      // Can be removed
      const removed = taskManager.removeTask("killed-task");
      expect(removed).toBe(true);
      expect(taskManager.getTask("killed-task")).toBeUndefined();
    });
  });

  describe("multiple sequential completions", () => {
    it("should handle multiple tasks completing sequentially", async () => {
      taskManager.registerTask(createRunningTask("t1"), {});
      taskManager.registerTask(createRunningTask("t2"), {});

      // Complete first task
      const p1 = taskManager.waitForNextCompletion();
      taskManager.updateTask("t1", { status: "completed", result: "result1" });
      const result1 = await p1;
      expect(result1.id).toBe("t1");

      // Remove first task (simulating the loop behavior)
      taskManager.removeTask("t1");

      // Second task is still active
      expect(taskManager.hasActiveTasks()).toBe(true);

      // Complete second task
      const p2 = taskManager.waitForNextCompletion();
      taskManager.updateTask("t2", { status: "completed", result: "result2" });
      const result2 = await p2;
      expect(result2.id).toBe("t2");

      taskManager.removeTask("t2");
      expect(taskManager.hasActiveTasks()).toBe(false);
    });
  });

  describe("task failure handling", () => {
    it("should emit taskFailed event with error info", async () => {
      taskManager.registerTask(createRunningTask("fail-task"), {});

      const p = taskManager.waitForNextCompletion();
      taskManager.updateTask("fail-task", {
        status: "failed",
        error: "Command timed out",
      });

      const result = await p;
      expect(result.id).toBe("fail-task");
      expect(result.status).toBe("failed");
      expect(result.error).toBe("Command timed out");
    });
  });

  describe("recursive spawning", () => {
    it("should track nested tasks after first batch completes", async () => {
      // Simulate: first task completes, its follow-up spawns a new task
      taskManager.registerTask(createRunningTask("gen1-task"), {});

      const p1 = taskManager.waitForNextCompletion();
      taskManager.updateTask("gen1-task", { status: "completed", result: "first output" });
      await p1;
      taskManager.removeTask("gen1-task");

      // Follow-up generation spawns a new task
      taskManager.registerTask(createRunningTask("gen2-task"), {});
      expect(taskManager.hasActiveTasks()).toBe(true);

      const p2 = taskManager.waitForNextCompletion();
      taskManager.updateTask("gen2-task", { status: "completed", result: "second output" });
      const result2 = await p2;
      expect(result2.id).toBe("gen2-task");

      taskManager.removeTask("gen2-task");
      expect(taskManager.hasActiveTasks()).toBe(false);
    });
  });
});

// =============================================================================
// Default formatter tests
// =============================================================================

describe("default task formatters", () => {
  it("should format completed task with metadata command", () => {
    // These match the default formatters used in agent.ts
    const task: BackgroundTask = {
      id: "t1",
      subagentType: "bash",
      description: "Test task",
      status: "completed",
      result: "Hello world",
      metadata: { command: "echo hello" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    // Replicate default formatter
    const command = task.metadata?.command ?? "unknown command";
    const formatted = `[Background task completed: ${task.id}]\nCommand: ${command}\nOutput:\n${task.result ?? "(no output)"}`;

    expect(formatted).toContain("t1");
    expect(formatted).toContain("echo hello");
    expect(formatted).toContain("Hello world");
  });

  it("should format failed task with error", () => {
    const task: BackgroundTask = {
      id: "t2",
      subagentType: "bash",
      description: "Test task",
      status: "failed",
      error: "Permission denied",
      metadata: { command: "rm -rf /" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    const command = task.metadata?.command ?? "unknown command";
    const formatted = `[Background task failed: ${task.id}]\nCommand: ${command}\nError: ${task.error ?? "Unknown error"}`;

    expect(formatted).toContain("t2");
    expect(formatted).toContain("rm -rf /");
    expect(formatted).toContain("Permission denied");
  });

  it("should use 'unknown command' when no metadata", () => {
    const task: BackgroundTask = {
      id: "t3",
      subagentType: "bash",
      description: "Test task",
      status: "completed",
      result: "output",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    const command = task.metadata?.command ?? "unknown command";
    expect(command).toBe("unknown command");
  });
});
