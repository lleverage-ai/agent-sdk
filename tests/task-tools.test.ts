/**
 * Tests for task tool.
 */

import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCompletedTasks,
  createTaskTool,
  getBackgroundTask,
  listBackgroundTasks,
} from "../src/tools/task.js";
import type { Agent, SubagentDefinition } from "../src/types.js";

// =============================================================================
// Mocks
// =============================================================================

function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "mock-agent",
    options: {
      model: {} as LanguageModel,
    },
    backend: {} as any,
    state: { todos: [], files: {} },
    generate: vi.fn().mockResolvedValue({
      status: "complete",
      text: "Test response",
      steps: [{ text: "Step 1", toolCalls: [], toolResults: [], finishReason: "stop" }],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    }),
    stream: vi.fn() as any,
    streamResponse: vi.fn() as any,
    streamRaw: vi.fn() as any,
    getSkills: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

function createMockSubagentDefinition(
  type: string,
  description: string,
  generateResult?: any,
  options?: { model?: LanguageModel | "inherit"; allowedTools?: string[] },
): SubagentDefinition {
  const mockAgent = createMockAgent();
  if (generateResult) {
    (mockAgent.generate as ReturnType<typeof vi.fn>).mockResolvedValue(generateResult);
  }
  return {
    type,
    description,
    model: options?.model,
    allowedTools: options?.allowedTools,
    create: vi.fn().mockResolvedValue(mockAgent),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Task Tool", () => {
  let parentAgent: Agent;
  let subagents: SubagentDefinition[];

  beforeEach(async () => {
    parentAgent = createMockAgent();
    subagents = [
      createMockSubagentDefinition("coder", "Writes code"),
      createMockSubagentDefinition("reviewer", "Reviews code"),
    ];
    // Clear background tasks between tests
    await clearCompletedTasks();
  });

  describe("createTaskTool", () => {
    it("should create a valid AI SDK tool", () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
      });

      expect(tool).toBeDefined();
      expect(tool.description).toContain("coder");
      expect(tool.description).toContain("reviewer");
      expect(tool.inputSchema).toBeDefined();
    });

    it("should include subagent descriptions in tool description", () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
      });

      expect(tool.description).toContain("Writes code");
      expect(tool.description).toContain("Reviews code");
    });

    it("should allow custom tool description", () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
        description: "Custom description",
      });

      expect(tool.description).toBe("Custom description");
    });

    it("should execute task in foreground successfully", async () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
      });

      const result = await tool.execute!(
        { description: "Write a function", subagent_type: "coder" },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("text", "Test response");
      expect(result).toHaveProperty("taskId");
    });

    it("should return error for unknown subagent type", async () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
      });

      const result = await tool.execute!(
        { description: "Do something", subagent_type: "unknown" },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      expect(result).toHaveProperty("error");
      expect((result as any).error).toContain("Unknown subagent type");
    });

    it("should run task in background when requested", async () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
      });

      const result = await tool.execute!(
        { description: "Long task", subagent_type: "coder", run_in_background: true },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      expect(result).toHaveProperty("taskId");
      expect(result).toHaveProperty("status", "running");
      expect((result as any).message).toContain("background");
    });

    it("should include general-purpose subagent when requested", () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
        includeGeneralPurpose: true,
      });

      expect(tool.description).toContain("general-purpose");
    });

    it("should handle subagent execution errors", async () => {
      const errorSubagent = createMockSubagentDefinition("error-agent", "Throws errors");
      const errorAgent = createMockAgent();
      (errorAgent.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Test error"));
      (errorSubagent.create as ReturnType<typeof vi.fn>).mockResolvedValue(errorAgent);

      const tool = createTaskTool({
        subagents: [errorSubagent],
        defaultModel: {} as LanguageModel,
        parentAgent,
      });

      const result = await tool.execute!(
        { description: "This will fail", subagent_type: "error-agent" },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      expect(result).toHaveProperty("error", true);
      expect((result as any).message).toContain("Test error");
    });
  });

  describe("Background Task Helpers", () => {
    it("should track background tasks with getBackgroundTask", async () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
      });

      const result = await tool.execute!(
        { description: "Background task", subagent_type: "coder", run_in_background: true },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      const taskId = (result as any).taskId;
      const task = await getBackgroundTask(taskId);

      expect(task).toBeDefined();
      expect(task?.subagentType).toBe("coder");
      expect(task?.description).toBe("Background task");
    });

    it("should list all background tasks", async () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
      });

      await tool.execute!(
        { description: "Task 1", subagent_type: "coder", run_in_background: true },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      await tool.execute!(
        { description: "Task 2", subagent_type: "reviewer", run_in_background: true },
        { toolCallId: "tc-2", messages: [], abortSignal: undefined as any },
      );

      const tasks = await listBackgroundTasks();
      expect(tasks.length).toBeGreaterThanOrEqual(2);
    });

    it("should clear completed tasks", async () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
      });

      const result = await tool.execute!(
        { description: "Quick task", subagent_type: "coder", run_in_background: true },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      // Wait for task to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const taskId = (result as any).taskId;
      const task = await getBackgroundTask(taskId);

      // Only clear if task completed
      if (task?.status === "completed" || task?.status === "failed") {
        const cleared = await clearCompletedTasks();
        expect(cleared).toBeGreaterThanOrEqual(1);
        expect(await getBackgroundTask(taskId)).toBeUndefined();
      }
    });

    it("should return undefined for non-existent task", async () => {
      const task = await getBackgroundTask("non-existent-id");
      expect(task).toBeUndefined();
    });
  });

  describe("Integration: Background task workflow", () => {
    it("should complete a full background task workflow", async () => {
      const subagent = createMockSubagentDefinition("worker", "Does work", {
        status: "complete",
        text: "Work complete!",
        steps: [{ text: "Did work", toolCalls: [], toolResults: [], finishReason: "stop" }],
        finishReason: "stop",
      });

      const tool = createTaskTool({
        subagents: [subagent],
        defaultModel: {} as LanguageModel,
        parentAgent,
      });

      // Start background task
      const startResult = await tool.execute!(
        { description: "Do some work", subagent_type: "worker", run_in_background: true },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      expect(startResult).toHaveProperty("status", "running");
      const taskId = (startResult as any).taskId;

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check result via helper
      const task = await getBackgroundTask(taskId);
      expect(task?.status).toBe("completed");
      expect(task?.result).toBe("Work complete!");
    });
  });

  describe("Tool Schema", () => {
    it("should have description", () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
      });
      expect(tool.description).toBeDefined();
      expect(tool.description?.length).toBeGreaterThan(0);
    });

    it("should have parameters schema", () => {
      const tool = createTaskTool({
        subagents,
        defaultModel: {} as LanguageModel,
        parentAgent,
      });
      expect(tool.inputSchema).toBeDefined();
    });
  });

  describe("Subagent Model and AllowedTools", () => {
    it("should pass default model in create context when no model specified", async () => {
      const defaultModel = { modelId: "default-model" } as LanguageModel;
      const subagent = createMockSubagentDefinition("worker", "Does work");

      const tool = createTaskTool({
        subagents: [subagent],
        defaultModel,
        parentAgent,
      });

      await tool.execute!(
        { description: "Do work", subagent_type: "worker" },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      expect(subagent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: defaultModel,
          allowedTools: undefined,
        }),
      );
    });

    it("should pass subagent-specific model in create context", async () => {
      const defaultModel = { modelId: "default-model" } as LanguageModel;
      const specificModel = { modelId: "specific-model" } as LanguageModel;
      const subagent = createMockSubagentDefinition("worker", "Does work", undefined, {
        model: specificModel,
      });

      const tool = createTaskTool({
        subagents: [subagent],
        defaultModel,
        parentAgent,
      });

      await tool.execute!(
        { description: "Do work", subagent_type: "worker" },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      expect(subagent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: specificModel,
        }),
      );
    });

    it("should pass default model when subagent model is inherit", async () => {
      const defaultModel = { modelId: "default-model" } as LanguageModel;
      const subagent = createMockSubagentDefinition("worker", "Does work", undefined, {
        model: "inherit",
      });

      const tool = createTaskTool({
        subagents: [subagent],
        defaultModel,
        parentAgent,
      });

      await tool.execute!(
        { description: "Do work", subagent_type: "worker" },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      expect(subagent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: defaultModel,
        }),
      );
    });

    it("should pass allowedTools in create context", async () => {
      const defaultModel = { modelId: "default-model" } as LanguageModel;
      const subagent = createMockSubagentDefinition("reader", "Read-only agent", undefined, {
        allowedTools: ["read", "glob", "grep"],
      });

      const tool = createTaskTool({
        subagents: [subagent],
        defaultModel,
        parentAgent,
      });

      await tool.execute!(
        { description: "Read some files", subagent_type: "reader" },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      expect(subagent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedTools: ["read", "glob", "grep"],
        }),
      );
    });

    it("should pass both model and allowedTools when both specified", async () => {
      const defaultModel = { modelId: "default-model" } as LanguageModel;
      const fastModel = { modelId: "fast-model" } as LanguageModel;
      const subagent = createMockSubagentDefinition(
        "fast-reader",
        "Fast read-only agent",
        undefined,
        {
          model: fastModel,
          allowedTools: ["read"],
        },
      );

      const tool = createTaskTool({
        subagents: [subagent],
        defaultModel,
        parentAgent,
      });

      await tool.execute!(
        { description: "Quick read", subagent_type: "fast-reader" },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      expect(subagent.create).toHaveBeenCalledWith({
        model: fastModel,
        allowedTools: ["read"],
      });
    });

    it("should allow different subagents to have different models", async () => {
      const defaultModel = { modelId: "default" } as LanguageModel;
      const fastModel = { modelId: "fast" } as LanguageModel;
      const smartModel = { modelId: "smart" } as LanguageModel;

      const fastSubagent = createMockSubagentDefinition("fast", "Quick tasks", undefined, {
        model: fastModel,
      });
      const smartSubagent = createMockSubagentDefinition("smart", "Complex tasks", undefined, {
        model: smartModel,
      });

      const tool = createTaskTool({
        subagents: [fastSubagent, smartSubagent],
        defaultModel,
        parentAgent,
      });

      // Execute fast subagent
      await tool.execute!(
        { description: "Quick task", subagent_type: "fast" },
        { toolCallId: "tc-1", messages: [], abortSignal: undefined as any },
      );

      expect(fastSubagent.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: fastModel }),
      );

      // Execute smart subagent
      await tool.execute!(
        { description: "Complex task", subagent_type: "smart" },
        { toolCallId: "tc-2", messages: [], abortSignal: undefined as any },
      );

      expect(smartSubagent.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: smartModel }),
      );
    });
  });
});
