/**
 * Tests for AgentSession event-driven processing and deduplication.
 */

import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/session.js";
import { TaskManager } from "../src/task-manager.js";
import type { BackgroundTask } from "../src/task-store/types.js";
import type { Agent, GenerateResult } from "../src/types.js";

// =============================================================================
// Helpers
// =============================================================================

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
    getSkills: vi.fn().mockReturnValue([]),
    taskManager: new TaskManager(),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createCompletedTask(id: string, result = "task output"): BackgroundTask {
  return {
    id,
    subagentType: "worker",
    description: `Task ${id}`,
    status: "completed",
    result,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

function createFailedTask(id: string, error = "something went wrong"): BackgroundTask {
  return {
    id,
    subagentType: "worker",
    description: `Task ${id}`,
    status: "failed",
    error,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

/** Collect outputs from the session until a specific type is seen or timeout. */
async function collectOutputs(
  session: AgentSession,
  opts: { until?: string; maxOutputs?: number; timeoutMs?: number } = {},
) {
  const { until, maxOutputs = 20, timeoutMs = 2000 } = opts;
  const outputs: Awaited<
    ReturnType<typeof session.run> extends AsyncGenerator<infer T> ? T : never
  >[] = [];

  const gen = session.run();
  const deadline = Date.now() + timeoutMs;

  for (let i = 0; i < maxOutputs; i++) {
    if (Date.now() > deadline) break;

    const result = await Promise.race([
      gen.next(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(
          () => resolve({ done: true, value: undefined }),
          Math.max(0, deadline - Date.now()),
        ),
      ),
    ]);

    if (result.done) break;
    outputs.push(result.value);

    if (until && result.value.type === until) {
      // Stop after first generation_complete
      session.stop();
      // Drain the stop
      await gen.next();
      break;
    }
  }

  return outputs;
}

// =============================================================================
// Tests
// =============================================================================

describe("AgentSession", () => {
  let agent: Agent;

  beforeEach(() => {
    agent = createMockAgent();
  });

  // ---------------------------------------------------------------------------
  // Basic session flow
  // ---------------------------------------------------------------------------

  describe("basic flow", () => {
    it("should yield waiting_for_input then process user message", async () => {
      const session = new AgentSession({ agent });

      // Send a message right away so the session doesn't block
      setTimeout(() => session.sendMessage("Hello"), 10);
      // Stop after first generation
      setTimeout(() => session.stop(), 200);

      const outputs = await collectOutputs(session, { until: "generation_complete" });

      expect(outputs.some((o) => o.type === "waiting_for_input")).toBe(true);
      expect(outputs.some((o) => o.type === "text_delta")).toBe(true);
      expect(outputs.some((o) => o.type === "generation_complete")).toBe(true);
      expect(agent.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Hello" }));
    });
  });

  // ---------------------------------------------------------------------------
  // Task completion push delivery
  // ---------------------------------------------------------------------------

  describe("task completion push delivery", () => {
    it("should auto-generate response when task completes", async () => {
      const session = new AgentSession({ agent });
      const task = createCompletedTask("task-1");

      // Register task with TaskManager so it's found during dedup check
      agent.taskManager.registerTask(task, {});

      // Emit taskCompleted after session starts
      setTimeout(() => agent.taskManager.emit("taskCompleted", task), 50);
      setTimeout(() => session.stop(), 500);

      const outputs = await collectOutputs(session, { until: "generation_complete" });

      expect(agent.generate).toHaveBeenCalled();
      const call = (agent.generate as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0].prompt).toContain("task-1");
      expect(outputs.some((o) => o.type === "generation_complete")).toBe(true);
    });

    it("should auto-generate response when task fails", async () => {
      const session = new AgentSession({ agent });
      const task = createFailedTask("task-2", "timeout error");

      agent.taskManager.registerTask({ ...task, status: "running" } as any, {});
      agent.taskManager.updateTask("task-2", {
        status: "failed",
        error: "timeout error",
        completedAt: new Date().toISOString(),
      });

      setTimeout(() => session.stop(), 500);

      const outputs = await collectOutputs(session, { until: "generation_complete" });

      expect(agent.generate).toHaveBeenCalled();
      const call = (agent.generate as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0].prompt).toContain("task-2");
      expect(call[0].prompt).toContain("failed");
    });
  });

  // ---------------------------------------------------------------------------
  // Deduplication: task consumed via task_output
  // ---------------------------------------------------------------------------

  describe("deduplication", () => {
    it("should skip task_completed event when task was already consumed (removed from TaskManager)", async () => {
      const session = new AgentSession({ agent });
      const task = createCompletedTask("task-consumed");

      // Simulate: task was registered, completed, then consumed via task_output
      // (task_output removes it from TaskManager after observation)
      // The event is already enqueued by the time session processes it,
      // but the task is gone from TaskManager → skip.

      // Don't register the task — it's already been consumed/removed
      // Manually enqueue the event as if TaskManager emitted it before removal
      setTimeout(() => {
        // Directly enqueue event (simulating what happens when task_output
        // has already cleaned up the task from TaskManager)
        agent.taskManager.emit("taskCompleted", task);
      }, 50);

      setTimeout(() => session.stop(), 300);

      const outputs = await collectOutputs(session, { timeoutMs: 500 });

      // generate should NOT have been called since the task was consumed
      expect(agent.generate).not.toHaveBeenCalled();
    });

    it("should process task_completed when task is still in TaskManager (not consumed)", async () => {
      const session = new AgentSession({ agent });
      const task = createCompletedTask("task-unconsumed");

      // Register the task — it hasn't been consumed by task_output
      agent.taskManager.registerTask(task, {});

      setTimeout(() => agent.taskManager.emit("taskCompleted", task), 50);
      setTimeout(() => session.stop(), 500);

      const outputs = await collectOutputs(session, { until: "generation_complete" });

      // generate SHOULD have been called since task is still in TaskManager
      expect(agent.generate).toHaveBeenCalled();
      expect(outputs.some((o) => o.type === "generation_complete")).toBe(true);
    });

    it("should skip task_failed event when task was already consumed", async () => {
      const session = new AgentSession({ agent });
      const task = createFailedTask("task-fail-consumed");

      // Task not in TaskManager (already consumed)
      setTimeout(() => agent.taskManager.emit("taskFailed", task), 50);
      setTimeout(() => session.stop(), 300);

      const outputs = await collectOutputs(session, { timeoutMs: 500 });

      expect(agent.generate).not.toHaveBeenCalled();
    });

    it("should handle mixed scenario: one consumed, one not", async () => {
      const session = new AgentSession({ agent });

      const consumed = createCompletedTask("task-consumed-mix");
      const unconsumed = createCompletedTask("task-unconsumed-mix");

      // Only register the unconsumed task
      agent.taskManager.registerTask(unconsumed, {});

      setTimeout(() => {
        // Both events arrive
        agent.taskManager.emit("taskCompleted", consumed);
        agent.taskManager.emit("taskCompleted", unconsumed);
      }, 50);

      setTimeout(() => session.stop(), 500);

      const outputs = await collectOutputs(session, { until: "generation_complete" });

      // Only the unconsumed task should trigger generation
      expect(agent.generate).toHaveBeenCalledTimes(1);
      const call = (agent.generate as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0].prompt).toContain("task-unconsumed-mix");
    });
  });

  // ---------------------------------------------------------------------------
  // Cleanup after push delivery
  // ---------------------------------------------------------------------------

  describe("cleanup after push delivery", () => {
    it("should remove task from TaskManager after push delivery", async () => {
      const session = new AgentSession({ agent });
      const task = createCompletedTask("task-cleanup");

      // Register the task so it's found during dedup check
      agent.taskManager.registerTask(task, {});
      expect(agent.taskManager.getTask("task-cleanup")).toBeDefined();

      setTimeout(() => agent.taskManager.emit("taskCompleted", task), 50);
      setTimeout(() => session.stop(), 500);

      await collectOutputs(session, { until: "generation_complete" });

      // After push delivery, task should be removed from TaskManager
      expect(agent.taskManager.getTask("task-cleanup")).toBeUndefined();
    });

    it("should remove failed task from TaskManager after push delivery", async () => {
      const session = new AgentSession({ agent });
      const failedTask = createFailedTask("task-fail-cleanup");

      // Register as running, then update to failed
      agent.taskManager.registerTask({ ...failedTask, status: "running" } as BackgroundTask, {});
      agent.taskManager.updateTask("task-fail-cleanup", {
        status: "failed",
        error: "something went wrong",
        completedAt: new Date().toISOString(),
      });

      setTimeout(() => session.stop(), 500);

      await collectOutputs(session, { until: "generation_complete" });

      // After push delivery, task should be removed
      expect(agent.taskManager.getTask("task-fail-cleanup")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // autoProcessTaskCompletions: false
  // ---------------------------------------------------------------------------

  describe("autoProcessTaskCompletions: false", () => {
    it("should not subscribe to task events when disabled", async () => {
      const session = new AgentSession({
        agent,
        autoProcessTaskCompletions: false,
      });

      const task = createCompletedTask("task-no-auto");
      agent.taskManager.registerTask(task, {});

      // Emit event — should NOT trigger processing
      setTimeout(() => agent.taskManager.emit("taskCompleted", task), 50);
      setTimeout(() => session.stop(), 300);

      const outputs = await collectOutputs(session, { timeoutMs: 500 });

      // No generation should have been triggered
      expect(agent.generate).not.toHaveBeenCalled();
      // Only waiting_for_input outputs expected
      expect(outputs.every((o) => o.type === "waiting_for_input")).toBe(true);
    });
  });
});
