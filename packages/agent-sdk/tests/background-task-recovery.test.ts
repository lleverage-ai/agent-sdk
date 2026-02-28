/**
 * Tests for background task recovery utilities.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createBackgroundTask, updateBackgroundTask } from "../src/task-store/index.js";
import { MemoryTaskStore } from "../src/task-store/memory-store.js";
import { cleanupStaleTasks, recoverFailedTasks, recoverRunningTasks } from "../src/tools/task.js";

describe("Background Task Recovery", () => {
  let store: MemoryTaskStore;

  beforeEach(() => {
    store = new MemoryTaskStore();
  });

  describe("recoverRunningTasks", () => {
    it("should mark running tasks as failed on recovery", async () => {
      // Create running tasks
      const task1 = createBackgroundTask({
        id: "task-1",
        subagentType: "researcher",
        description: "Task 1",
      });
      const runningTask1 = updateBackgroundTask(task1, { status: "running" });
      await store.save(runningTask1);

      const task2 = createBackgroundTask({
        id: "task-2",
        subagentType: "writer",
        description: "Task 2",
      });
      const runningTask2 = updateBackgroundTask(task2, { status: "running" });
      await store.save(runningTask2);

      // Create a completed task (should not be affected)
      const task3 = createBackgroundTask({
        id: "task-3",
        subagentType: "researcher",
        description: "Task 3",
      });
      const completedTask = updateBackgroundTask(task3, {
        status: "completed",
        result: "Done",
        completedAt: new Date().toISOString(),
      });
      await store.save(completedTask);

      // Recover running tasks
      const recovered = await recoverRunningTasks(store);

      // Verify 2 tasks were recovered
      expect(recovered).toBe(2);

      // Verify tasks are now failed
      const task1After = await store.load("task-1");
      expect(task1After?.status).toBe("failed");
      expect(task1After?.error).toContain("interrupted by agent restart");
      expect(task1After?.completedAt).toBeDefined();

      const task2After = await store.load("task-2");
      expect(task2After?.status).toBe("failed");
      expect(task2After?.error).toContain("interrupted by agent restart");

      // Verify completed task was not affected
      const task3After = await store.load("task-3");
      expect(task3After?.status).toBe("completed");
      expect(task3After?.result).toBe("Done");
    });

    it("should return 0 when no running tasks exist", async () => {
      const recovered = await recoverRunningTasks(store);
      expect(recovered).toBe(0);
    });

    it("should return 0 when store is not provided and no global store exists", async () => {
      const recovered = await recoverRunningTasks();
      expect(recovered).toBe(0);
    });
  });

  describe("recoverFailedTasks", () => {
    it("should return all failed tasks", async () => {
      // Create failed tasks
      const task1 = createBackgroundTask({
        id: "task-1",
        subagentType: "researcher",
        description: "Task 1",
      });
      const failedTask1 = updateBackgroundTask(task1, {
        status: "failed",
        error: "Network timeout",
        completedAt: new Date().toISOString(),
      });
      await store.save(failedTask1);

      const task2 = createBackgroundTask({
        id: "task-2",
        subagentType: "writer",
        description: "Task 2",
      });
      const failedTask2 = updateBackgroundTask(task2, {
        status: "failed",
        error: "Connection refused",
        completedAt: new Date().toISOString(),
      });
      await store.save(failedTask2);

      // Create a completed task (should not be returned)
      const task3 = createBackgroundTask({
        id: "task-3",
        subagentType: "researcher",
        description: "Task 3",
      });
      const completedTask = updateBackgroundTask(task3, {
        status: "completed",
        result: "Done",
        completedAt: new Date().toISOString(),
      });
      await store.save(completedTask);

      // Recover failed tasks
      const failedTasks = await recoverFailedTasks(store);

      // Verify we got 2 failed tasks
      expect(failedTasks.length).toBe(2);
      expect(failedTasks.every((t) => t.status === "failed")).toBe(true);
    });

    it("should filter by error pattern", async () => {
      // Create failed tasks with different errors
      const task1 = createBackgroundTask({
        id: "task-1",
        subagentType: "researcher",
        description: "Task 1",
      });
      const failedTask1 = updateBackgroundTask(task1, {
        status: "failed",
        error: "Network timeout",
        completedAt: new Date().toISOString(),
      });
      await store.save(failedTask1);

      const task2 = createBackgroundTask({
        id: "task-2",
        subagentType: "writer",
        description: "Task 2",
      });
      const failedTask2 = updateBackgroundTask(task2, {
        status: "failed",
        error: "Invalid input",
        completedAt: new Date().toISOString(),
      });
      await store.save(failedTask2);

      const task3 = createBackgroundTask({
        id: "task-3",
        subagentType: "analyst",
        description: "Task 3",
      });
      const failedTask3 = updateBackgroundTask(task3, {
        status: "failed",
        error: "Connection refused (ECONNREFUSED)",
        completedAt: new Date().toISOString(),
      });
      await store.save(failedTask3);

      // Recover only network-related failures
      const networkFailures = await recoverFailedTasks(store, {
        errorPattern: /timeout|ECONNREFUSED/,
      });

      // Should get 2 tasks (timeout and ECONNREFUSED)
      expect(networkFailures.length).toBe(2);
      expect(networkFailures.some((t) => t.id === "task-1")).toBe(true);
      expect(networkFailures.some((t) => t.id === "task-3")).toBe(true);
      expect(networkFailures.some((t) => t.id === "task-2")).toBe(false);
    });

    it("should filter by date range", async () => {
      const now = Date.now();
      const yesterday = new Date(now - 86400000).toISOString();
      const twoDaysAgo = new Date(now - 2 * 86400000).toISOString();

      // Create failed tasks at different times
      const task1 = createBackgroundTask({
        id: "task-1",
        subagentType: "researcher",
        description: "Task 1",
      });
      task1.createdAt = twoDaysAgo;
      const failedTask1 = updateBackgroundTask(task1, {
        status: "failed",
        error: "Error 1",
        completedAt: twoDaysAgo,
      });
      await store.save(failedTask1);

      const task2 = createBackgroundTask({
        id: "task-2",
        subagentType: "writer",
        description: "Task 2",
      });
      task2.createdAt = yesterday;
      const failedTask2 = updateBackgroundTask(task2, {
        status: "failed",
        error: "Error 2",
        completedAt: yesterday,
      });
      await store.save(failedTask2);

      // Recover only tasks from last 36 hours
      const recentFailures = await recoverFailedTasks(store, {
        minCreatedAt: new Date(now - 36 * 60 * 60 * 1000),
      });

      // Should get only task-2
      expect(recentFailures.length).toBe(1);
      expect(recentFailures[0].id).toBe("task-2");
    });

    it("should apply multiple filters", async () => {
      const now = Date.now();
      const yesterday = new Date(now - 86400000).toISOString();

      // Create tasks
      const task1 = createBackgroundTask({
        id: "task-1",
        subagentType: "researcher",
        description: "Task 1",
      });
      task1.createdAt = yesterday;
      const failedTask1 = updateBackgroundTask(task1, {
        status: "failed",
        error: "Network timeout",
        completedAt: yesterday,
      });
      await store.save(failedTask1);

      const task2 = createBackgroundTask({
        id: "task-2",
        subagentType: "writer",
        description: "Task 2",
      });
      task2.createdAt = yesterday;
      const failedTask2 = updateBackgroundTask(task2, {
        status: "failed",
        error: "Invalid input",
        completedAt: yesterday,
      });
      await store.save(failedTask2);

      // Apply both pattern and date filters
      const filtered = await recoverFailedTasks(store, {
        errorPattern: /timeout/,
        minCreatedAt: new Date(now - 48 * 60 * 60 * 1000),
      });

      // Should get only task-1 (matches both filters)
      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe("task-1");
    });
  });

  describe("cleanupStaleTasks", () => {
    it("should clean up old completed tasks", async () => {
      const now = Date.now();
      const oldTimestamp = new Date(now - 10 * 86400000).toISOString(); // 10 days ago
      const recentTimestamp = new Date(now - 1000).toISOString(); // 1 second ago

      // Create old completed task
      const task1 = createBackgroundTask({
        id: "task-1",
        subagentType: "researcher",
        description: "Task 1",
      });
      const oldCompleted = updateBackgroundTask(task1, {
        status: "completed",
        result: "Done",
        completedAt: oldTimestamp,
      });
      await store.save(oldCompleted);

      // Create recent completed task
      const task2 = createBackgroundTask({
        id: "task-2",
        subagentType: "writer",
        description: "Task 2",
      });
      const recentCompleted = updateBackgroundTask(task2, {
        status: "completed",
        result: "Done",
        completedAt: recentTimestamp,
      });
      await store.save(recentCompleted);

      // Clean up tasks older than 7 days
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const cleaned = await cleanupStaleTasks(store, sevenDays);

      // Should clean up 1 task
      expect(cleaned).toBe(1);

      // Verify old task was deleted
      const task1After = await store.load("task-1");
      expect(task1After).toBeUndefined();

      // Verify recent task still exists
      const task2After = await store.load("task-2");
      expect(task2After).toBeDefined();
      expect(task2After?.status).toBe("completed");
    });

    it("should clean up old failed tasks", async () => {
      const now = Date.now();
      const oldTimestamp = new Date(now - 10 * 86400000).toISOString();

      // Create old failed task
      const task1 = createBackgroundTask({
        id: "task-1",
        subagentType: "researcher",
        description: "Task 1",
      });
      const oldFailed = updateBackgroundTask(task1, {
        status: "failed",
        error: "Some error",
        completedAt: oldTimestamp,
      });
      await store.save(oldFailed);

      // Clean up
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const cleaned = await cleanupStaleTasks(store, sevenDays);

      expect(cleaned).toBe(1);
      const taskAfter = await store.load("task-1");
      expect(taskAfter).toBeUndefined();
    });

    it("should not clean up running or pending tasks", async () => {
      const now = Date.now();
      const oldTimestamp = new Date(now - 10 * 86400000).toISOString();

      // Create old running task
      const task1 = createBackgroundTask({
        id: "task-1",
        subagentType: "researcher",
        description: "Task 1",
      });
      task1.updatedAt = oldTimestamp;
      const runningTask = updateBackgroundTask(task1, { status: "running" });
      runningTask.updatedAt = oldTimestamp; // Force old timestamp
      await store.save(runningTask);

      // Create old pending task
      const task2 = createBackgroundTask({
        id: "task-2",
        subagentType: "writer",
        description: "Task 2",
      });
      task2.updatedAt = oldTimestamp;
      await store.save(task2);

      // Clean up
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const cleaned = await cleanupStaleTasks(store, sevenDays);

      // Should not clean up any tasks
      expect(cleaned).toBe(0);

      // Verify tasks still exist
      const task1After = await store.load("task-1");
      expect(task1After).toBeDefined();

      const task2After = await store.load("task-2");
      expect(task2After).toBeDefined();
    });

    it("should use completedAt timestamp when available", async () => {
      const now = Date.now();
      const oldCompletedAt = new Date(now - 10 * 86400000).toISOString();
      const recentUpdatedAt = new Date(now - 1000).toISOString();

      // Create task with old completedAt but recent updatedAt
      const task1 = createBackgroundTask({
        id: "task-1",
        subagentType: "researcher",
        description: "Task 1",
      });
      const completed = updateBackgroundTask(task1, {
        status: "completed",
        result: "Done",
        completedAt: oldCompletedAt,
      });
      completed.updatedAt = recentUpdatedAt; // Force recent updatedAt
      await store.save(completed);

      // Clean up (should use completedAt, not updatedAt)
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const cleaned = await cleanupStaleTasks(store, sevenDays);

      // Should clean up the task (based on completedAt)
      expect(cleaned).toBe(1);
    });

    it("should return 0 when no tasks need cleanup", async () => {
      const cleaned = await cleanupStaleTasks(store, 7 * 24 * 60 * 60 * 1000);
      expect(cleaned).toBe(0);
    });
  });

  describe("Integration: Complete recovery workflow", () => {
    it("should handle a complete recovery scenario", async () => {
      const now = Date.now();
      const oldTimestamp = new Date(now - 10 * 86400000).toISOString();
      const recentTimestamp = new Date(now - 1000).toISOString();

      // 1. Create running tasks (interrupted by restart)
      const runningTask = createBackgroundTask({
        id: "task-running-1",
        subagentType: "researcher",
        description: "Running task",
      });
      await store.save(updateBackgroundTask(runningTask, { status: "running" }));

      // 2. Create failed tasks (transient errors)
      const failedTask = createBackgroundTask({
        id: "task-failed-1",
        subagentType: "writer",
        description: "Failed task",
      });
      await store.save(
        updateBackgroundTask(failedTask, {
          status: "failed",
          error: "Network timeout",
          completedAt: recentTimestamp,
        }),
      );

      // 3. Create old completed tasks (should be cleaned)
      const oldTask = createBackgroundTask({
        id: "task-old-1",
        subagentType: "researcher",
        description: "Old task",
      });
      await store.save(
        updateBackgroundTask(oldTask, {
          status: "completed",
          result: "Done",
          completedAt: oldTimestamp,
        }),
      );

      // 4. Create recent completed task (should be kept)
      const recentTask = createBackgroundTask({
        id: "task-recent-1",
        subagentType: "analyst",
        description: "Recent task",
      });
      await store.save(
        updateBackgroundTask(recentTask, {
          status: "completed",
          result: "Done",
          completedAt: recentTimestamp,
        }),
      );

      // Execute recovery workflow
      // Step 1: Recover running tasks
      const recovered = await recoverRunningTasks(store);
      expect(recovered).toBe(1);

      // Step 2: Find retryable failed tasks
      const retryable = await recoverFailedTasks(store, {
        errorPattern: /timeout/,
      });
      expect(retryable.length).toBe(1);

      // Step 3: Clean up stale tasks
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const cleaned = await cleanupStaleTasks(store, sevenDays);
      expect(cleaned).toBe(1);

      // Verify final state
      const allTasks = await store.listTasks();
      expect(allTasks.length).toBe(3); // running (now failed), failed (network), recent completed

      // Verify running task is now failed
      const runningAfter = await store.load("task-running-1");
      expect(runningAfter?.status).toBe("failed");

      // Verify old task was cleaned
      const oldAfter = await store.load("task-old-1");
      expect(oldAfter).toBeUndefined();

      // Verify recent task was kept
      const recentAfter = await store.load("task-recent-1");
      expect(recentAfter?.status).toBe("completed");
    });
  });
});
