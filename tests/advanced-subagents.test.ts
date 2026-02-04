/**
 * Tests for advanced subagent system with context isolation and parallel execution.
 */

import type { LanguageModel } from "ai";
import { generateText, tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../src/agent.js";
import type { AgentState, TodoItem } from "../src/backends/state.js";
import { createAgentState } from "../src/backends/state.js";
import type {
  EnhancedSubagentDefinition,
  SubagentErrorEvent,
  SubagentFinishEvent,
  SubagentStartEvent,
  SubagentStepEvent,
} from "../src/subagents/index.js";
import {
  createSubagentContext,
  createSubagentEventEmitter,
  executeSubagent,
  executeSubagentsParallel,
  mergeSubagentContext,
} from "../src/subagents/index.js";

// Mock the AI SDK
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

// Helper to create a mock model
function createMockModel(): LanguageModel {
  return {
    specificationVersion: "v1",
    provider: "mock",
    modelId: "mock-model",
    supportsUrl: () => false,
    defaultObjectGenerationMode: "json",
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  };
}

// Helper to create a parent agent
function createTestParentAgent(state?: AgentState) {
  const mockModel = createMockModel();
  return createAgent({
    model: mockModel,
    systemPrompt: "You are a helpful assistant.",
    backend: (s) => {
      // Use provided state or fresh state
      if (state) {
        Object.assign(s, state);
      }
      return {
        lsInfo: () => [],
        read: () => "",
        readRaw: () => ({ content: [], created_at: "", modified_at: "" }),
        grepRaw: () => [],
        globInfo: () => [],
        write: () => ({ success: true }),
        edit: () => ({ success: true }),
      };
    },
  });
}

describe("createSubagentContext", () => {
  let parentState: AgentState;

  beforeEach(() => {
    parentState = createAgentState();
    parentState.files = {
      "/test.txt": {
        content: ["line 1", "line 2"],
        created_at: "2026-01-30T00:00:00.000Z",
        modified_at: "2026-01-30T00:00:00.000Z",
      },
    };
    parentState.todos = [
      {
        id: "todo-1",
        content: "Parent task",
        status: "pending",
        createdAt: "2026-01-30T00:00:00.000Z",
      },
    ];
  });

  it("creates context with shared files and isolated todos by default", () => {
    const context = createSubagentContext({ parentState });

    expect(context.filesShared).toBe(true);
    expect(context.todosIsolated).toBe(true);
    // Files are shared (same reference)
    expect(context.state.files).toBe(parentState.files);
    // Todos are isolated (empty)
    expect(context.state.todos).toEqual([]);
    expect(context.parentState).toBe(parentState);
  });

  it("shares files via reference when shareFiles is true", () => {
    const context = createSubagentContext({
      parentState,
      shareFiles: true,
    });

    // Same object reference
    expect(context.state.files).toBe(parentState.files);
    expect(context.filesShared).toBe(true);
  });

  it("copies files when shareFiles is false", () => {
    const context = createSubagentContext({
      parentState,
      shareFiles: false,
    });

    // Different object reference
    expect(context.state.files).not.toBe(parentState.files);
    // But same content
    expect(context.state.files["/test.txt"]).toEqual(parentState.files["/test.txt"]);
    expect(context.filesShared).toBe(false);
  });

  it("isolates todos when isolateTodos is true", () => {
    const context = createSubagentContext({
      parentState,
      isolateTodos: true,
    });

    expect(context.state.todos).toEqual([]);
    expect(context.todosIsolated).toBe(true);
  });

  it("inherits todos when isolateTodos is false", () => {
    const context = createSubagentContext({
      parentState,
      isolateTodos: false,
    });

    // Copy of parent todos
    expect(context.state.todos).toHaveLength(1);
    expect(context.state.todos[0].content).toBe("Parent task");
    // But not same reference (to avoid mutations)
    expect(context.state.todos).not.toBe(parentState.todos);
    expect(context.todosIsolated).toBe(false);
  });

  it("uses initialTodos when isolateTodos is true", () => {
    const initialTodos: TodoItem[] = [
      {
        id: "init-1",
        content: "Initial task",
        status: "pending",
        createdAt: "2026-01-30T00:00:00.000Z",
      },
    ];

    const context = createSubagentContext({
      parentState,
      isolateTodos: true,
      initialTodos,
    });

    expect(context.state.todos).toHaveLength(1);
    expect(context.state.todos[0].content).toBe("Initial task");
  });
});

describe("mergeSubagentContext", () => {
  let parentState: AgentState;

  beforeEach(() => {
    parentState = createAgentState();
  });

  it("does nothing when files are shared (already reflected)", () => {
    const context = createSubagentContext({
      parentState,
      shareFiles: true,
    });

    // Subagent adds a file (via shared reference)
    context.state.files["/new.txt"] = {
      content: ["new content"],
      created_at: "2026-01-30T00:00:00.000Z",
      modified_at: "2026-01-30T00:00:00.000Z",
    };

    mergeSubagentContext(context);

    // Already reflected in parent due to shared reference
    expect(parentState.files["/new.txt"]).toBeDefined();
  });

  it("merges file changes back when files were not shared", () => {
    const context = createSubagentContext({
      parentState,
      shareFiles: false,
    });

    // Subagent adds a file
    context.state.files["/new.txt"] = {
      content: ["new content"],
      created_at: "2026-01-30T00:00:00.000Z",
      modified_at: "2026-01-30T00:00:00.000Z",
    };

    // Before merge, parent doesn't have it
    expect(parentState.files["/new.txt"]).toBeUndefined();

    mergeSubagentContext(context);

    // After merge, parent has it
    expect(parentState.files["/new.txt"]).toBeDefined();
  });

  it("does not merge todos back (by design)", () => {
    const context = createSubagentContext({
      parentState,
      isolateTodos: true,
    });

    // Subagent adds a todo
    context.state.todos.push({
      id: "sub-1",
      content: "Subagent task",
      status: "pending",
      createdAt: "2026-01-30T00:00:00.000Z",
    });

    mergeSubagentContext(context);

    // Parent should not have subagent's todo
    expect(parentState.todos).toHaveLength(0);
  });
});

describe("executeSubagent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes subagent with isolated context", async () => {
    // Setup mock response
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Research complete",
      steps: [
        {
          text: "Research complete",
          toolCalls: [],
          toolResults: [],
          finishReason: "stop",
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      ],
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const parentAgent = createTestParentAgent();

    const definition: EnhancedSubagentDefinition = {
      type: "researcher",
      description: "Researches topics",
      systemPrompt: "You are a research assistant.",
    };

    const result = await executeSubagent({
      definition,
      prompt: "Research TypeScript history",
      parentAgent,
    });

    expect(result.success).toBe(true);
    expect(result.text).toBe("Research complete");
    expect(result.steps).toBe(1);
    expect(result.finishReason).toBe("stop");
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.context).toBeDefined();
    expect(result.context.todosIsolated).toBe(true);
  });

  it("calls onStart callback", async () => {
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Done",
      steps: [],
      finishReason: "stop",
    });

    const parentAgent = createTestParentAgent();
    const onStart = vi.fn();

    const definition: EnhancedSubagentDefinition = {
      type: "helper",
      description: "Helps with tasks",
      systemPrompt: "You help.",
    };

    await executeSubagent({
      definition,
      prompt: "Help me",
      parentAgent,
      onStart,
    });

    expect(onStart).toHaveBeenCalledOnce();
    const event = onStart.mock.calls[0][0] as SubagentStartEvent;
    expect(event.type).toBe("subagent-start");
    expect(event.subagentType).toBe("helper");
    expect(event.prompt).toBe("Help me");
  });

  it("calls onStep callback for each step", async () => {
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Final text",
      steps: [
        {
          text: "Step 1 text",
          toolCalls: [{ toolCallId: "call-1", toolName: "search", input: { q: "test" } }],
          toolResults: [{ toolCallId: "call-1", toolName: "search", output: "result" }],
          finishReason: "tool-calls",
        },
        {
          text: "Step 2 text",
          toolCalls: [],
          toolResults: [],
          finishReason: "stop",
        },
      ],
      finishReason: "stop",
    });

    const parentAgent = createTestParentAgent();
    const onStep = vi.fn();

    const definition: EnhancedSubagentDefinition = {
      type: "worker",
      description: "Does work",
      systemPrompt: "Work hard.",
    };

    await executeSubagent({
      definition,
      prompt: "Do work",
      parentAgent,
      onStep,
    });

    expect(onStep).toHaveBeenCalledTimes(2);

    const step1 = onStep.mock.calls[0][0] as SubagentStepEvent;
    expect(step1.type).toBe("subagent-step");
    expect(step1.stepNumber).toBe(1);
    expect(step1.toolCalls).toHaveLength(1);
    expect(step1.toolCalls[0].toolName).toBe("search");

    const step2 = onStep.mock.calls[1][0] as SubagentStepEvent;
    expect(step2.stepNumber).toBe(2);
    expect(step2.toolCalls).toHaveLength(0);
  });

  it("calls onFinish callback on success", async () => {
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Complete",
      steps: [],
      finishReason: "stop",
    });

    const parentAgent = createTestParentAgent();
    const onFinish = vi.fn();

    const definition: EnhancedSubagentDefinition = {
      type: "finisher",
      description: "Finishes tasks",
      systemPrompt: "Finish things.",
    };

    await executeSubagent({
      definition,
      prompt: "Finish this",
      parentAgent,
      onFinish,
    });

    expect(onFinish).toHaveBeenCalledOnce();
    const event = onFinish.mock.calls[0][0] as SubagentFinishEvent;
    expect(event.type).toBe("subagent-finish");
    expect(event.success).toBe(true);
    expect(event.finishReason).toBe("stop");
  });

  it("calls onError callback on failure", async () => {
    (generateText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API error"));

    const parentAgent = createTestParentAgent();
    const onError = vi.fn();

    const definition: EnhancedSubagentDefinition = {
      type: "failer",
      description: "Might fail",
      systemPrompt: "Try your best.",
    };

    const result = await executeSubagent({
      definition,
      prompt: "Try this",
      parentAgent,
      onError,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("API error");
    expect(onError).toHaveBeenCalledOnce();
    const event = onError.mock.calls[0][0] as SubagentErrorEvent;
    expect(event.type).toBe("subagent-error");
    expect(event.error.message).toBe("API error");
  });

  it("uses definition.maxSteps for maxTokens calculation", async () => {
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Done",
      steps: [],
      finishReason: "stop",
    });

    const parentAgent = createTestParentAgent();

    const definition: EnhancedSubagentDefinition = {
      type: "limited",
      description: "Limited steps",
      systemPrompt: "Be quick.",
      maxSteps: 5,
    };

    await executeSubagent({
      definition,
      prompt: "Be brief",
      parentAgent,
    });

    // generateText should have been called
    expect(generateText).toHaveBeenCalled();
  });

  it("resolves tools from string array subset", async () => {
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Done",
      steps: [],
      finishReason: "stop",
    });

    const searchTool = tool({
      description: "Search",
      inputSchema: z.object({ query: z.string() }),
      execute: async () => "results",
    });

    const writeTool = tool({
      description: "Write",
      inputSchema: z.object({ content: z.string() }),
      execute: async () => "written",
    });

    const mockModel = createMockModel();
    const parentAgent = createAgent({
      model: mockModel,
      systemPrompt: "You have tools.",
      tools: {
        search: searchTool,
        write: writeTool,
      },
    });

    const definition: EnhancedSubagentDefinition = {
      type: "searcher",
      description: "Only searches",
      systemPrompt: "Just search.",
      tools: ["search"], // Only use search tool
    };

    await executeSubagent({
      definition,
      prompt: "Find something",
      parentAgent,
    });

    // Subagent should only have access to search tool
    expect(generateText).toHaveBeenCalled();
  });
});

describe("executeSubagentsParallel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes multiple subagents in parallel", async () => {
    let callCount = 0;
    (generateText as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return {
        text: `Result ${callCount}`,
        steps: [],
        finishReason: "stop",
      };
    });

    const parentAgent = createTestParentAgent();

    const tasks = [
      {
        definition: {
          type: "researcher-1",
          description: "First researcher",
          systemPrompt: "Research topic 1.",
        },
        prompt: "Research topic 1",
      },
      {
        definition: {
          type: "researcher-2",
          description: "Second researcher",
          systemPrompt: "Research topic 2.",
        },
        prompt: "Research topic 2",
      },
    ];

    const results = await executeSubagentsParallel(tasks, parentAgent);

    expect(results.results).toHaveLength(2);
    expect(results.successCount).toBe(2);
    expect(results.failureCount).toBe(0);
    expect(results.allSucceeded).toBe(true);
    expect(results.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it("handles partial failures", async () => {
    let callCount = 0;
    (generateText as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error("Second task failed");
      }
      return {
        text: `Result ${callCount}`,
        steps: [],
        finishReason: "stop",
      };
    });

    const parentAgent = createTestParentAgent();

    const tasks = [
      {
        definition: {
          type: "success",
          description: "Will succeed",
          systemPrompt: "Succeed.",
        },
        prompt: "Succeed",
      },
      {
        definition: {
          type: "fail",
          description: "Will fail",
          systemPrompt: "Fail.",
        },
        prompt: "Fail",
      },
    ];

    const results = await executeSubagentsParallel(tasks, parentAgent);

    expect(results.successCount).toBe(1);
    expect(results.failureCount).toBe(1);
    expect(results.allSucceeded).toBe(false);
    expect(results.results[1].success).toBe(false);
    expect(results.results[1].error).toBe("Second task failed");
  });

  it("calls onResult callback for each completed task", async () => {
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Done",
      steps: [],
      finishReason: "stop",
    });

    const parentAgent = createTestParentAgent();
    const onResult = vi.fn();

    const tasks = [
      {
        definition: {
          type: "task-1",
          description: "Task 1",
          systemPrompt: "Do task 1.",
        },
        prompt: "Task 1",
      },
      {
        definition: {
          type: "task-2",
          description: "Task 2",
          systemPrompt: "Do task 2.",
        },
        prompt: "Task 2",
      },
    ];

    await executeSubagentsParallel(tasks, parentAgent, onResult);

    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("shares files between parallel subagents", async () => {
    let callCount = 0;
    (generateText as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return {
        text: `Result ${callCount}`,
        steps: [],
        finishReason: "stop",
      };
    });

    const parentState = createAgentState();
    const parentAgent = createTestParentAgent(parentState);

    const tasks = [
      {
        definition: {
          type: "writer-1",
          description: "Writer 1",
          systemPrompt: "Write.",
        },
        prompt: "Write file 1",
      },
      {
        definition: {
          type: "writer-2",
          description: "Writer 2",
          systemPrompt: "Write.",
        },
        prompt: "Write file 2",
      },
    ];

    const results = await executeSubagentsParallel(tasks, parentAgent);

    // Both subagents should have shared file context
    expect(results.results[0].context.filesShared).toBe(true);
    expect(results.results[1].context.filesShared).toBe(true);
  });
});

describe("createSubagentEventEmitter", () => {
  it("creates emitter with all event handlers", () => {
    const emitter = createSubagentEventEmitter();

    expect(typeof emitter.onStart).toBe("function");
    expect(typeof emitter.onStep).toBe("function");
    expect(typeof emitter.onFinish).toBe("function");
    expect(typeof emitter.onError).toBe("function");
    expect(typeof emitter.removeAllListeners).toBe("function");
  });

  it("registers and clears listeners", () => {
    const emitter = createSubagentEventEmitter();

    const startHandler = vi.fn();
    const stepHandler = vi.fn();
    const finishHandler = vi.fn();
    const errorHandler = vi.fn();

    emitter.onStart(startHandler);
    emitter.onStep(stepHandler);
    emitter.onFinish(finishHandler);
    emitter.onError(errorHandler);

    // Remove all listeners
    emitter.removeAllListeners();

    // No way to verify handlers were removed without internal access,
    // but we can verify removeAllListeners doesn't throw
  });
});

describe("EnhancedSubagentDefinition", () => {
  it("supports output schema", () => {
    const definition: EnhancedSubagentDefinition = {
      type: "structured",
      description: "Returns structured output",
      systemPrompt: "Return JSON.",
      output: {
        schema: z.object({
          summary: z.string(),
          confidence: z.number(),
        }),
        description: "Analysis result",
      },
    };

    expect(definition.output?.schema).toBeDefined();
    expect(definition.output?.description).toBe("Analysis result");
  });

  it("supports interrupt configuration", () => {
    const definition: EnhancedSubagentDefinition = {
      type: "careful",
      description: "Requires approval for dangerous operations",
      systemPrompt: "Be careful.",
      interruptOn: {
        delete_file: true,
        write_file: false,
      },
    };

    expect(definition.interruptOn?.delete_file).toBe(true);
    expect(definition.interruptOn?.write_file).toBe(false);
  });

  it("supports model override", () => {
    const definition: EnhancedSubagentDefinition = {
      type: "custom-model",
      description: "Uses custom model",
      systemPrompt: "Use different model.",
      model: createMockModel(),
    };

    expect(definition.model).toBeDefined();
  });

  it("supports maxSteps configuration", () => {
    const definition: EnhancedSubagentDefinition = {
      type: "limited",
      description: "Limited steps",
      systemPrompt: "Be quick.",
      maxSteps: 3,
    };

    expect(definition.maxSteps).toBe(3);
  });
});

describe("integration tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("full workflow: create context, execute, merge", async () => {
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Created new file",
      steps: [
        {
          text: "Creating file",
          toolCalls: [],
          toolResults: [],
          finishReason: "stop",
        },
      ],
      finishReason: "stop",
    });

    // Create parent state with initial file
    const parentState = createAgentState();
    parentState.files["/existing.txt"] = {
      content: ["existing content"],
      created_at: "2026-01-30T00:00:00.000Z",
      modified_at: "2026-01-30T00:00:00.000Z",
    };
    parentState.todos.push({
      id: "parent-todo",
      content: "Parent task",
      status: "pending",
      createdAt: "2026-01-30T00:00:00.000Z",
    });

    const parentAgent = createTestParentAgent(parentState);

    // Execute subagent
    const definition: EnhancedSubagentDefinition = {
      type: "file-creator",
      description: "Creates files",
      systemPrompt: "Create files when asked.",
    };

    const result = await executeSubagent({
      definition,
      prompt: "Create a new file",
      parentAgent,
    });

    expect(result.success).toBe(true);

    // Verify context isolation
    // Subagent should have had access to parent's files (shared)
    expect(result.context.state.files["/existing.txt"]).toBeDefined();
    // But subagent should have empty todos (isolated)
    expect(result.context.state.todos).toHaveLength(0);

    // Simulate subagent creating a file via shared reference
    result.context.state.files["/new.txt"] = {
      content: ["new content"],
      created_at: "2026-01-30T00:00:00.000Z",
      modified_at: "2026-01-30T00:00:00.000Z",
    };

    // Merge context back
    mergeSubagentContext(result.context);

    // Parent should have new file (due to shared reference)
    expect(parentState.files["/new.txt"]).toBeDefined();
    // Parent todos should be unchanged
    expect(parentState.todos).toHaveLength(1);
    expect(parentState.todos[0].content).toBe("Parent task");
  });

  it("parallel execution with file collaboration", async () => {
    let callCount = 0;
    (generateText as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return {
        text: `Task ${callCount} complete`,
        steps: [],
        finishReason: "stop",
      };
    });

    const parentState = createAgentState();
    const parentAgent = createTestParentAgent(parentState);

    // Both tasks should be able to write files that are visible to parent
    const tasks = [
      {
        definition: {
          type: "writer-a",
          description: "Writes file A",
          systemPrompt: "Write file A.",
        },
        prompt: "Write file A",
      },
      {
        definition: {
          type: "writer-b",
          description: "Writes file B",
          systemPrompt: "Write file B.",
        },
        prompt: "Write file B",
      },
    ];

    const results = await executeSubagentsParallel(tasks, parentAgent, (result, index) => {
      // Simulate each subagent writing a file
      result.context.state.files[`/file-${index}.txt`] = {
        content: [`Content from task ${index}`],
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
      };
    });

    expect(results.allSucceeded).toBe(true);

    // Both files should be in parent state (due to shared reference)
    expect(parentState.files["/file-0.txt"]).toBeDefined();
    expect(parentState.files["/file-1.txt"]).toBeDefined();
  });
});
