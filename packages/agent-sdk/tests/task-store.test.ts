/**
 * Tests for background task persistence.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBackgroundTask,
  FileTaskStore,
  isBackgroundTask,
  type KeyValueStore,
  KVTaskStore,
  MemoryTaskStore,
  shouldExpireTask,
  updateBackgroundTask,
} from "../src/task-store/index.js";

describe("Task Store Types", () => {
  describe("createBackgroundTask", () => {
    it("should create a task with required fields", () => {
      const task = createBackgroundTask({
        id: "task-123",
        subagentType: "researcher",
        description: "Research topic",
      });

      expect(task.id).toBe("task-123");
      expect(task.subagentType).toBe("researcher");
      expect(task.description).toBe("Research topic");
      expect(task.status).toBe("pending");
      expect(task.createdAt).toBeDefined();
      expect(task.updatedAt).toBeDefined();
    });

    it("should allow overriding default fields", () => {
      const task = createBackgroundTask({
        id: "task-123",
        subagentType: "researcher",
        description: "Research topic",
        status: "running",
        result: "Some result",
      });

      expect(task.status).toBe("running");
      expect(task.result).toBe("Some result");
    });
  });

  describe("updateBackgroundTask", () => {
    it("should update task with new fields", async () => {
      const task = createBackgroundTask({
        id: "task-123",
        subagentType: "researcher",
        description: "Research topic",
      });

      // Small delay to ensure timestamp differs
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = updateBackgroundTask(task, {
        status: "completed",
        result: "Task completed",
      });

      expect(updated.id).toBe("task-123");
      expect(updated.status).toBe("completed");
      expect(updated.result).toBe("Task completed");
      expect(updated.updatedAt).not.toBe(task.updatedAt);
      expect(updated.createdAt).toBe(task.createdAt);
    });
  });

  describe("isBackgroundTask", () => {
    it("should validate valid task", () => {
      const task = createBackgroundTask({
        id: "task-123",
        subagentType: "researcher",
        description: "Research topic",
      });

      expect(isBackgroundTask(task)).toBe(true);
    });

    it("should reject invalid task", () => {
      expect(isBackgroundTask(null)).toBe(false);
      expect(isBackgroundTask({})).toBe(false);
      expect(isBackgroundTask({ id: "123" })).toBe(false);
      expect(
        isBackgroundTask({
          id: "123",
          subagentType: "test",
          description: "test",
          status: "invalid",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        }),
      ).toBe(false);
    });
  });

  describe("shouldExpireTask", () => {
    it("should not expire pending or running tasks", () => {
      const oldDate = new Date(Date.now() - 100000000).toISOString();

      const pendingTask = createBackgroundTask({
        id: "task-1",
        subagentType: "test",
        description: "test",
        status: "pending",
        createdAt: oldDate,
        updatedAt: oldDate,
      });

      const runningTask = createBackgroundTask({
        id: "task-2",
        subagentType: "test",
        description: "test",
        status: "running",
        createdAt: oldDate,
        updatedAt: oldDate,
      });

      expect(shouldExpireTask(pendingTask, 1000)).toBe(false);
      expect(shouldExpireTask(runningTask, 1000)).toBe(false);
    });

    it("should expire old completed tasks", () => {
      const oldDate = new Date(Date.now() - 100000).toISOString();

      const task = createBackgroundTask({
        id: "task-1",
        subagentType: "test",
        description: "test",
        status: "completed",
        completedAt: oldDate,
        updatedAt: oldDate,
      });

      expect(shouldExpireTask(task, 10000)).toBe(true);
    });

    it("should not expire recent completed tasks", () => {
      const recentDate = new Date(Date.now() - 1000).toISOString();

      const task = createBackgroundTask({
        id: "task-1",
        subagentType: "test",
        description: "test",
        status: "completed",
        completedAt: recentDate,
        updatedAt: recentDate,
      });

      expect(shouldExpireTask(task, 100000)).toBe(false);
    });
  });
});

describe("MemoryTaskStore", () => {
  let store: MemoryTaskStore;

  beforeEach(() => {
    store = new MemoryTaskStore();
  });

  it("should save and load task", async () => {
    const task = createBackgroundTask({
      id: "task-123",
      subagentType: "researcher",
      description: "Research topic",
    });

    await store.save(task);
    const loaded = await store.load("task-123");

    expect(loaded).toEqual(task);
  });

  it("should return undefined for non-existent task", async () => {
    const loaded = await store.load("non-existent");
    expect(loaded).toBeUndefined();
  });

  it("should list all tasks", async () => {
    const task1 = createBackgroundTask({
      id: "task-1",
      subagentType: "researcher",
      description: "Task 1",
    });

    const task2 = createBackgroundTask({
      id: "task-2",
      subagentType: "coder",
      description: "Task 2",
      status: "running",
    });

    await store.save(task1);
    await store.save(task2);

    const tasks = await store.listTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.id).sort()).toEqual(["task-1", "task-2"]);
  });

  it("should filter tasks by status", async () => {
    const task1 = createBackgroundTask({
      id: "task-1",
      subagentType: "researcher",
      description: "Task 1",
      status: "completed",
    });

    const task2 = createBackgroundTask({
      id: "task-2",
      subagentType: "coder",
      description: "Task 2",
      status: "running",
    });

    await store.save(task1);
    await store.save(task2);

    const completedTasks = await store.listTasks({ status: "completed" });
    expect(completedTasks).toHaveLength(1);
    expect(completedTasks[0]?.id).toBe("task-1");

    const runningTasks = await store.listTasks({ status: "running" });
    expect(runningTasks).toHaveLength(1);
    expect(runningTasks[0]?.id).toBe("task-2");
  });

  it("should delete task", async () => {
    const task = createBackgroundTask({
      id: "task-123",
      subagentType: "researcher",
      description: "Research topic",
    });

    await store.save(task);
    expect(await store.exists("task-123")).toBe(true);

    const deleted = await store.delete("task-123");
    expect(deleted).toBe(true);
    expect(await store.exists("task-123")).toBe(false);
  });

  it("should return false when deleting non-existent task", async () => {
    const deleted = await store.delete("non-existent");
    expect(deleted).toBe(false);
  });

  it("should cleanup expired tasks", async () => {
    // Create a store with short expiration for testing
    const testStore = new MemoryTaskStore({ expirationMs: 10000 }); // 10 seconds

    const oldDate = new Date(Date.now() - 100000).toISOString();

    const expiredTask = createBackgroundTask({
      id: "task-expired",
      subagentType: "test",
      description: "Old task",
      status: "completed",
      completedAt: oldDate,
      updatedAt: oldDate,
    });

    const recentTask = createBackgroundTask({
      id: "task-recent",
      subagentType: "test",
      description: "Recent task",
      status: "completed",
    });

    await testStore.save(expiredTask);
    await testStore.save(recentTask);

    const cleaned = await testStore.cleanup();
    expect(cleaned).toBe(1);

    expect(await testStore.exists("task-expired")).toBe(false);
    expect(await testStore.exists("task-recent")).toBe(true);
  });

  it("should support namespaces", async () => {
    const store1 = new MemoryTaskStore({ namespace: "user1" });
    const store2 = new MemoryTaskStore({ namespace: "user2" });

    const task = createBackgroundTask({
      id: "task-123",
      subagentType: "researcher",
      description: "Research topic",
    });

    await store1.save(task);

    expect(await store1.exists("task-123")).toBe(true);
    expect(await store2.exists("task-123")).toBe(false);

    const tasks1 = await store1.listTasks();
    const tasks2 = await store2.listTasks();

    expect(tasks1).toHaveLength(1);
    expect(tasks2).toHaveLength(0);
  });
});

describe("FileTaskStore", () => {
  const testDir = path.join(process.cwd(), ".test-task-data");
  let store: FileTaskStore;

  beforeEach(async () => {
    store = new FileTaskStore({ directory: testDir });
    // Clean up any existing test data
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore if directory doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore errors
    }
  });

  it("should save and load task from file", async () => {
    const task = createBackgroundTask({
      id: "task-123",
      subagentType: "researcher",
      description: "Research topic",
    });

    await store.save(task);
    const loaded = await store.load("task-123");

    expect(loaded).toEqual(task);

    // Verify file exists
    const filePath = path.join(testDir, "task-123.json");
    const exists = await fs.access(filePath).then(
      () => true,
      () => false,
    );
    expect(exists).toBe(true);
  });

  it("should persist across store instances", async () => {
    const task = createBackgroundTask({
      id: "task-123",
      subagentType: "researcher",
      description: "Research topic",
    });

    await store.save(task);

    // Create new store instance
    const newStore = new FileTaskStore({ directory: testDir });
    const loaded = await newStore.load("task-123");

    expect(loaded).toEqual(task);
  });

  it("should list tasks from filesystem", async () => {
    const task1 = createBackgroundTask({
      id: "task-1",
      subagentType: "researcher",
      description: "Task 1",
    });

    const task2 = createBackgroundTask({
      id: "task-2",
      subagentType: "coder",
      description: "Task 2",
    });

    await store.save(task1);
    await store.save(task2);

    const tasks = await store.listTasks();
    expect(tasks).toHaveLength(2);
  });

  it("should support namespaces with file names", async () => {
    const store1 = new FileTaskStore({ directory: testDir, namespace: "user1" });
    const store2 = new FileTaskStore({ directory: testDir, namespace: "user2" });

    const task = createBackgroundTask({
      id: "task-123",
      subagentType: "researcher",
      description: "Research topic",
    });

    await store1.save(task);

    expect(await store1.exists("task-123")).toBe(true);
    expect(await store2.exists("task-123")).toBe(false);

    // Verify file names
    const file1 = path.join(testDir, "user1-task-123.json");
    const file2 = path.join(testDir, "user2-task-123.json");

    const exists1 = await fs.access(file1).then(
      () => true,
      () => false,
    );
    const exists2 = await fs.access(file2).then(
      () => true,
      () => false,
    );

    expect(exists1).toBe(true);
    expect(exists2).toBe(false);
  });
});

describe("KVTaskStore", () => {
  let kvData: Map<string, string>;
  let kvStore: KeyValueStore;
  let store: KVTaskStore;

  beforeEach(() => {
    kvData = new Map();

    // Mock KV store implementation
    kvStore = {
      async get(key: string): Promise<string | null> {
        return kvData.get(key) ?? null;
      },
      async set(key: string, value: string): Promise<void> {
        kvData.set(key, value);
      },
      async delete(key: string): Promise<boolean> {
        return kvData.delete(key);
      },
      async exists(key: string): Promise<boolean> {
        return kvData.has(key);
      },
      async keys(pattern: string): Promise<string[]> {
        const regex = new RegExp(`^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
        return Array.from(kvData.keys()).filter((key) => regex.test(key));
      },
    };

    store = new KVTaskStore(kvStore);
  });

  it("should save and load task from KV store", async () => {
    const task = createBackgroundTask({
      id: "task-123",
      subagentType: "researcher",
      description: "Research topic",
    });

    await store.save(task);
    const loaded = await store.load("task-123");

    expect(loaded).toEqual(task);
    expect(kvData.has("task:task-123")).toBe(true);
  });

  it("should list tasks from KV store", async () => {
    const task1 = createBackgroundTask({
      id: "task-1",
      subagentType: "researcher",
      description: "Task 1",
    });

    const task2 = createBackgroundTask({
      id: "task-2",
      subagentType: "coder",
      description: "Task 2",
    });

    await store.save(task1);
    await store.save(task2);

    const tasks = await store.listTasks();
    expect(tasks).toHaveLength(2);
  });

  it("should support namespaces with key prefixes", async () => {
    const store1 = new KVTaskStore(kvStore, { namespace: "user1" });
    const store2 = new KVTaskStore(kvStore, { namespace: "user2" });

    const task = createBackgroundTask({
      id: "task-123",
      subagentType: "researcher",
      description: "Research topic",
    });

    await store1.save(task);

    expect(await store1.exists("task-123")).toBe(true);
    expect(await store2.exists("task-123")).toBe(false);

    expect(kvData.has("user1:task:task-123")).toBe(true);
    expect(kvData.has("user2:task:task-123")).toBe(false);
  });

  it("should cleanup expired tasks", async () => {
    // Create a store with short expiration for testing
    const testStore = new KVTaskStore(kvStore, { expirationMs: 10000 }); // 10 seconds

    const oldDate = new Date(Date.now() - 100000).toISOString();

    const expiredTask = createBackgroundTask({
      id: "task-expired",
      subagentType: "test",
      description: "Old task",
      status: "completed",
      completedAt: oldDate,
      updatedAt: oldDate,
    });

    const recentTask = createBackgroundTask({
      id: "task-recent",
      subagentType: "test",
      description: "Recent task",
      status: "completed",
    });

    await testStore.save(expiredTask);
    await testStore.save(recentTask);

    const cleaned = await testStore.cleanup();
    expect(cleaned).toBe(1);

    expect(await testStore.exists("task-expired")).toBe(false);
    expect(await testStore.exists("task-recent")).toBe(true);
  });
});
