/**
 * Tests for compaction scheduler functionality.
 */

import type { ModelMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CompactionScheduler,
  type ContextManager,
  createCompactionScheduler,
  createContextManager,
} from "../src/context-manager.js";
import { createMockAgent } from "../src/testing/mock-agent.js";

// Helper to wait for async operations with fake timers
async function _waitForAsync(ms: number) {
  const promise = new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
  vi.advanceTimersByTime(ms);
  await promise;
  // Give microtasks a chance to run
  await new Promise((r) => setImmediate(r));
}

describe("CompactionScheduler", () => {
  let contextManager: ContextManager;
  let scheduler: CompactionScheduler;
  let mockAgent: ReturnType<typeof createMockAgent>;

  beforeEach(() => {
    vi.useFakeTimers();

    contextManager = createContextManager({
      maxTokens: 1000,
    });

    mockAgent = createMockAgent();
    mockAgent.generate = vi.fn(async () => ({
      status: "complete",
      text: "Summary of conversation",
      usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
    })) as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    scheduler?.shutdown();
  });

  it("should create scheduler with default options", () => {
    scheduler = createCompactionScheduler(contextManager);

    expect(scheduler).toBeDefined();
    expect(scheduler.getPendingTasks()).toHaveLength(0);
    expect(scheduler.getLatestResult()).toBeUndefined();
  });

  it("should not schedule tasks when background compaction is disabled", () => {
    scheduler = createCompactionScheduler(contextManager, {
      enableBackgroundCompaction: false,
    });

    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    const taskId = scheduler.schedule(messages, mockAgent, "token_threshold");

    // Should return a placeholder ID but not actually schedule
    expect(taskId).toMatch(/^sync-/);
    expect(scheduler.getPendingTasks()).toHaveLength(0);
  });

  it("should schedule and execute compaction task", async () => {
    vi.useRealTimers(); // Use real timers for this test

    // Create context manager with lower keepMessageCount to trigger compaction
    contextManager = createContextManager({
      maxTokens: 1000,
      summarization: {
        keepMessageCount: 2, // Keep only 2 messages, so 12+ will have oldMessages
      },
    });

    scheduler = createCompactionScheduler(contextManager, {
      enableBackgroundCompaction: true,
      debounceDelayMs: 10, // Shorter delay for faster test
    });

    // Create enough messages to have oldMessages (more than keepMessageCount)
    const messages: ModelMessage[] = Array.from({ length: 15 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as const,
      content: `Message ${i}`,
    }));

    const taskId = scheduler.schedule(messages, mockAgent, "token_threshold");

    expect(taskId).toMatch(/^task-/);
    expect(scheduler.getPendingTasks()).toHaveLength(1);

    const task = scheduler.getTask(taskId);
    expect(task?.status).toBe("pending");

    // Wait for debounce + execution with real timers
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const completedTask = scheduler.getTask(taskId);
    expect(completedTask?.status).toBe("completed");
    expect(completedTask?.result).toBeDefined();
    expect(mockAgent.generate).toHaveBeenCalled();
  });

  it("should debounce multiple rapid schedule calls", async () => {
    vi.useRealTimers(); // Use real timers for this test

    // Create context manager with lower keepMessageCount to trigger compaction
    contextManager = createContextManager({
      maxTokens: 1000,
      summarization: {
        keepMessageCount: 2,
      },
    });

    scheduler = createCompactionScheduler(contextManager, {
      enableBackgroundCompaction: true,
      debounceDelayMs: 100, // 100ms debounce for predictable timing
    });

    // Create enough messages to have oldMessages
    const messages: ModelMessage[] = Array.from({ length: 15 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as const,
      content: `Message ${i}`,
    }));

    // Schedule 3 tasks rapidly
    scheduler.schedule(messages, mockAgent, "token_threshold");
    scheduler.schedule(messages, mockAgent, "token_threshold");
    scheduler.schedule(messages, mockAgent, "token_threshold");

    expect(scheduler.getPendingTasks()).toHaveLength(3);

    // Wait for all tasks to complete (debounce + execution time for each task)
    // With 100ms debounce and 3 tasks, need at least 300ms + execution time
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // All tasks should be completed
    expect(mockAgent.generate).toHaveBeenCalledTimes(3);
  });

  it("should enforce max pending tasks limit", () => {
    scheduler = createCompactionScheduler(contextManager, {
      enableBackgroundCompaction: true,
      debounceDelayMs: 1000, // Long debounce to keep tasks pending
      maxPendingTasks: 2,
    });

    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    // Schedule 3 tasks, but max is 2
    const task1 = scheduler.schedule(messages, mockAgent, "token_threshold");
    const task2 = scheduler.schedule(messages, mockAgent, "token_threshold");
    const task3 = scheduler.schedule(messages, mockAgent, "token_threshold");

    // Should only have 2 pending (oldest dropped)
    expect(scheduler.getPendingTasks()).toHaveLength(2);

    // Task 1 should be dropped, task 2 and 3 should remain
    expect(scheduler.getTask(task1)).toBeUndefined();
    expect(scheduler.getTask(task2)).toBeDefined();
    expect(scheduler.getTask(task3)).toBeDefined();
  });

  it("should call onTaskComplete callback", async () => {
    vi.useRealTimers(); // Use real timers for this test

    const onTaskComplete = vi.fn();

    scheduler = createCompactionScheduler(contextManager, {
      enableBackgroundCompaction: true,
      debounceDelayMs: 10,
      onTaskComplete,
    });

    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    scheduler.schedule(messages, mockAgent, "token_threshold");

    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(onTaskComplete).toHaveBeenCalledTimes(1);
    expect(onTaskComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        result: expect.any(Object),
      }),
    );
  });

  it("should call onTaskError callback on failure", async () => {
    vi.useRealTimers(); // Use real timers for this test

    const onTaskError = vi.fn();

    // Make generate fail
    mockAgent.generate = vi.fn(async () => {
      throw new Error("Compaction failed");
    }) as any;

    // Create context manager with lower keepMessageCount to trigger compaction
    contextManager = createContextManager({
      maxTokens: 1000,
      summarization: {
        keepMessageCount: 2,
      },
    });

    scheduler = createCompactionScheduler(contextManager, {
      enableBackgroundCompaction: true,
      debounceDelayMs: 10,
      onTaskError,
    });

    // Create enough messages to have oldMessages
    const messages: ModelMessage[] = Array.from({ length: 15 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as const,
      content: `Message ${i}`,
    }));

    const taskId = scheduler.schedule(messages, mockAgent, "token_threshold");

    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(onTaskError).toHaveBeenCalledTimes(1);
    expect(onTaskError).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: expect.any(Error),
      }),
    );

    const task = scheduler.getTask(taskId);
    expect(task?.status).toBe("failed");
    expect(task?.error?.message).toBe("Compaction failed");
  });

  it("should return latest result", async () => {
    vi.useRealTimers(); // Use real timers for this test

    // Create context manager with lower keepMessageCount to trigger compaction
    contextManager = createContextManager({
      maxTokens: 1000,
      summarization: {
        keepMessageCount: 2,
      },
    });

    scheduler = createCompactionScheduler(contextManager, {
      enableBackgroundCompaction: true,
      debounceDelayMs: 10,
    });

    // Create enough messages to have oldMessages
    const messages: ModelMessage[] = Array.from({ length: 15 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as const,
      content: `Message ${i}`,
    }));

    scheduler.schedule(messages, mockAgent, "token_threshold");

    expect(scheduler.getLatestResult()).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = scheduler.getLatestResult();
    expect(result).toBeDefined();
    expect(result?.summary).toBe("Summary of conversation");
  });

  it("should cancel pending tasks", () => {
    scheduler = createCompactionScheduler(contextManager, {
      enableBackgroundCompaction: true,
      debounceDelayMs: 1000,
    });

    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    const taskId = scheduler.schedule(messages, mockAgent, "token_threshold");

    expect(scheduler.getPendingTasks()).toHaveLength(1);

    const cancelled = scheduler.cancel(taskId);
    expect(cancelled).toBe(true);
    expect(scheduler.getPendingTasks()).toHaveLength(0);
  });

  it("should not cancel non-pending tasks", async () => {
    vi.useRealTimers(); // Use real timers for this test

    scheduler = createCompactionScheduler(contextManager, {
      enableBackgroundCompaction: true,
      debounceDelayMs: 10,
    });

    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    const taskId = scheduler.schedule(messages, mockAgent, "token_threshold");

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Task is now completed, cannot cancel
    const cancelled = scheduler.cancel(taskId);
    expect(cancelled).toBe(false);
  });

  it("should cleanup completed tasks", async () => {
    vi.useRealTimers(); // Use real timers for this test

    scheduler = createCompactionScheduler(contextManager, {
      enableBackgroundCompaction: true,
      debounceDelayMs: 10,
    });

    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    const taskId = scheduler.schedule(messages, mockAgent, "token_threshold");

    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(scheduler.getTask(taskId)).toBeDefined();

    scheduler.cleanup();

    expect(scheduler.getTask(taskId)).toBeUndefined();
  });

  it("should shutdown and cancel all pending tasks", () => {
    scheduler = createCompactionScheduler(contextManager, {
      enableBackgroundCompaction: true,
      debounceDelayMs: 1000,
    });

    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    const taskId = scheduler.schedule(messages, mockAgent, "token_threshold");

    expect(scheduler.getPendingTasks()).toHaveLength(1);

    scheduler.shutdown();

    const task = scheduler.getTask(taskId);
    expect(task?.status).toBe("failed");
    expect(task?.error?.message).toBe("Scheduler shut down");

    // Should not allow new tasks after shutdown
    expect(() => {
      scheduler.schedule(messages, mockAgent, "token_threshold");
    }).toThrow("Scheduler has been shut down");
  });

  it("should integrate with context manager for background compaction", async () => {
    vi.useRealTimers(); // Use real timers for this test

    const manager = createContextManager({
      maxTokens: 1000,
      policy: {
        enabled: true,
        tokenThreshold: 0.1, // Very low threshold to trigger compaction
      },
      scheduler: {
        enableBackgroundCompaction: true,
        debounceDelayMs: 10,
      },
    });

    const messages: ModelMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as const,
      content: `Message ${i}`.repeat(100), // Large messages to exceed threshold
    }));

    // First call should schedule background compaction
    const result1 = await manager.process(messages, mockAgent);
    expect(result1).toEqual(messages); // Original messages returned
    expect(manager.scheduler?.getPendingTasks()).toHaveLength(1);

    // Wait for compaction to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Second call should apply the background result
    const result2 = await manager.process(messages, mockAgent);
    expect(result2).not.toEqual(messages); // Compacted messages returned
    expect(result2.length).toBeLessThan(messages.length);
  });
});
