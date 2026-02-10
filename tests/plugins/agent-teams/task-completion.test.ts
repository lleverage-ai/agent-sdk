/**
 * Tests for end_team incomplete-work reporting.
 *
 * Verifies that end_team prepends a warning when tasks remain
 * incomplete, and returns a clean summary when all tasks are done.
 */

import { generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent } from "../../../src/agent.js";
import { createAgentTeamsPlugin } from "../../../src/plugins/agent-teams/index.js";
import type { TeammateDefinition } from "../../../src/plugins/agent-teams/types.js";
import { createMockModel, resetMocks } from "../../setup.js";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

const mockedGenerateText = vi.mocked(generateText);

function findTool(tools: Record<string, any>, name: string) {
  return tools[name] ?? tools[`mcp__agent-teams__${name}`];
}

function mockGenerateTextWithToolCall(toolCallFn: (opts: any) => Promise<void>) {
  mockedGenerateText.mockImplementationOnce(async (opts: any) => {
    await toolCallFn(opts);
    return {
      text: "done",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      response: {
        id: `r-${Date.now()}`,
        timestamp: new Date(),
        modelId: "mock",
      },
      steps: [],
      warnings: [],
      sources: [],
      toolCalls: [],
      toolResults: [],
      request: { body: {} },
    } as any;
  });
}

describe("end_team task completion validation", () => {
  const teammates: TeammateDefinition[] = [
    {
      role: "researcher",
      description: "Researches topics",
      agentOptions: { systemPrompt: "Research" },
    },
  ];

  beforeEach(() => {
    resetMocks();
    mockedGenerateText.mockImplementation(async () => {
      return {
        text: "fallback",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        response: {
          id: "r-fallback",
          timestamp: new Date(),
          modelId: "mock",
        },
        steps: [],
        warnings: [],
        sources: [],
        toolCalls: [],
        toolResults: [],
        request: { body: {} },
      } as any;
    });
  });

  it("returns clean summary when all tasks are completed", async () => {
    const model = createMockModel();
    const { InMemoryTeamCoordinator } = await import(
      "../../../src/plugins/agent-teams/coordinator.js"
    );
    const coordinator = new InMemoryTeamCoordinator();
    const plugin = createAgentTeamsPlugin({ teammates, coordinator });
    const agent = createAgent({
      model,
      systemPrompt: "Primary",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    // start_team with initial tasks
    mockGenerateTextWithToolCall(async (opts) => {
      const startTeam = findTool(opts.tools, "start_team");
      await startTeam.execute(
        {
          reason: "Test",
          initial_tasks: [
            { subject: "Task A", description: "Do A" },
            { subject: "Task B", description: "Do B" },
          ],
        },
        { toolCallId: "tc-start" },
      );
    });
    await agent.generate({ prompt: "Start" });

    // Complete all tasks via the coordinator
    coordinator.claimTask("task-1", "tm-1");
    coordinator.completeTask("task-1", "A done");
    coordinator.claimTask("task-2", "tm-1");
    coordinator.completeTask("task-2", "B done");

    // end_team — all tasks completed, should be clean
    let endResult: string | undefined;
    mockGenerateTextWithToolCall(async (opts) => {
      endResult = await opts.tools.end_team.execute(
        { summary: "All done" },
        { toolCallId: "tc-end" },
      );
    });
    await agent.generate({ prompt: "End" });

    expect(endResult).toBe("All done");
    expect(endResult).not.toContain("Warning");
  });

  it("returns clean summary when no tasks were created", async () => {
    const model = createMockModel();
    const plugin = createAgentTeamsPlugin({ teammates });
    const agent = createAgent({
      model,
      systemPrompt: "Primary",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    // start_team without initial tasks
    mockGenerateTextWithToolCall(async (opts) => {
      const startTeam = findTool(opts.tools, "start_team");
      await startTeam.execute({ reason: "Test" }, { toolCallId: "tc-start" });
    });
    await agent.generate({ prompt: "Start" });

    // end_team immediately — no tasks exist
    let endResult: string | undefined;
    mockGenerateTextWithToolCall(async (opts) => {
      endResult = await opts.tools.end_team.execute(
        { summary: "Nothing to do" },
        { toolCallId: "tc-end" },
      );
    });
    await agent.generate({ prompt: "End" });

    expect(endResult).toBe("Nothing to do");
    expect(endResult).not.toContain("Warning");
  });

  it("returns warning when some tasks are incomplete", async () => {
    const model = createMockModel();
    const plugin = createAgentTeamsPlugin({ teammates });
    const agent = createAgent({
      model,
      systemPrompt: "Primary",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    // start_team with initial tasks
    mockGenerateTextWithToolCall(async (opts) => {
      const startTeam = findTool(opts.tools, "start_team");
      await startTeam.execute(
        {
          reason: "Test",
          initial_tasks: [
            { subject: "Task A", description: "Do A" },
            { subject: "Task B", description: "Do B" },
          ],
        },
        { toolCallId: "tc-start" },
      );
    });
    await agent.generate({ prompt: "Start" });

    // end_team without completing any tasks
    let endResult: string | undefined;
    mockGenerateTextWithToolCall(async (opts) => {
      endResult = await opts.tools.end_team.execute(
        { summary: "Ending early" },
        { toolCallId: "tc-end" },
      );
    });
    await agent.generate({ prompt: "End" });

    expect(endResult).toContain("Warning: 2 task(s) not completed");
    expect(endResult).toContain("Task A");
    expect(endResult).toContain("Task B");
    expect(endResult).toContain("[pending]");
    expect(endResult).toContain("Ending early");
  });

  it("returns warning listing only incomplete tasks when some are completed", async () => {
    const model = createMockModel();
    const { InMemoryTeamCoordinator } = await import(
      "../../../src/plugins/agent-teams/coordinator.js"
    );
    const coordinator = new InMemoryTeamCoordinator();
    const plugin = createAgentTeamsPlugin({ teammates, coordinator });
    const agent = createAgent({
      model,
      systemPrompt: "Primary",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    // start_team with initial tasks
    mockGenerateTextWithToolCall(async (opts) => {
      const startTeam = findTool(opts.tools, "start_team");
      await startTeam.execute(
        {
          reason: "Test",
          initial_tasks: [
            { subject: "Task A", description: "Do A" },
            { subject: "Task B", description: "Do B" },
            { subject: "Task C", description: "Do C" },
          ],
        },
        { toolCallId: "tc-start" },
      );
    });
    await agent.generate({ prompt: "Start" });

    // Complete task-1 via the coordinator, leave task-2 and task-3 incomplete
    coordinator.claimTask("task-1", "tm-1");
    coordinator.completeTask("task-1", "done");

    // end_team
    let endResult: string | undefined;
    mockGenerateTextWithToolCall(async (opts) => {
      endResult = await opts.tools.end_team.execute(
        { summary: "Partial work" },
        { toolCallId: "tc-end" },
      );
    });
    await agent.generate({ prompt: "End" });

    expect(endResult).toContain("Warning: 2 task(s) not completed");
    expect(endResult).toContain("Task B");
    expect(endResult).toContain("Task C");
    expect(endResult).not.toContain("Task A");
    expect(endResult).toContain("Partial work");
  });

  it("returns clean summary when all tasks completed in valid dependency order", async () => {
    const model = createMockModel();
    const { InMemoryTeamCoordinator } = await import(
      "../../../src/plugins/agent-teams/coordinator.js"
    );
    const coordinator = new InMemoryTeamCoordinator();
    const plugin = createAgentTeamsPlugin({ teammates, coordinator });
    const agent = createAgent({
      model,
      systemPrompt: "Primary",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    // start_team with dependent tasks: A → B
    mockGenerateTextWithToolCall(async (opts) => {
      const startTeam = findTool(opts.tools, "start_team");
      await startTeam.execute(
        {
          reason: "Test",
          initial_tasks: [
            { subject: "Task A", description: "Do A first" },
            {
              subject: "Task B",
              description: "Do B after A",
              blocked_by: ["Task A"],
            },
          ],
        },
        { toolCallId: "tc-start" },
      );
    });
    await agent.generate({ prompt: "Start" });

    // Complete tasks in order
    coordinator.claimTask("task-1", "tm-1");
    coordinator.completeTask("task-1", "A done");
    coordinator.claimTask("task-2", "tm-1");
    coordinator.completeTask("task-2", "B done");

    // end_team
    let endResult: string | undefined;
    mockGenerateTextWithToolCall(async (opts) => {
      endResult = await opts.tools.end_team.execute(
        { summary: "All tasks completed in order" },
        { toolCallId: "tc-end" },
      );
    });
    await agent.generate({ prompt: "End" });

    expect(endResult).toBe("All tasks completed in order");
    expect(endResult).not.toContain("Warning");
  });

  it("warns about blocked incomplete tasks", async () => {
    const model = createMockModel();
    const { InMemoryTeamCoordinator } = await import(
      "../../../src/plugins/agent-teams/coordinator.js"
    );
    const coordinator = new InMemoryTeamCoordinator();
    const plugin = createAgentTeamsPlugin({ teammates, coordinator });
    const agent = createAgent({
      model,
      systemPrompt: "Primary",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    // start_team with dependent tasks: A → B
    mockGenerateTextWithToolCall(async (opts) => {
      const startTeam = findTool(opts.tools, "start_team");
      await startTeam.execute(
        {
          reason: "Test",
          initial_tasks: [
            { subject: "Task A", description: "Prereq" },
            {
              subject: "Task B",
              description: "Blocked by A",
              blocked_by: ["Task A"],
            },
          ],
        },
        { toolCallId: "tc-start" },
      );
    });
    await agent.generate({ prompt: "Start" });

    // Complete A but leave B incomplete (still pending/blocked)
    coordinator.claimTask("task-1", "tm-1");
    coordinator.completeTask("task-1", "A done");

    // end_team — B should show in warning
    let endResult: string | undefined;
    mockGenerateTextWithToolCall(async (opts) => {
      endResult = await opts.tools.end_team.execute(
        { summary: "Ended early" },
        { toolCallId: "tc-end" },
      );
    });
    await agent.generate({ prompt: "End" });

    expect(endResult).toContain("Warning: 1 task(s) not completed");
    expect(endResult).toContain("Task B");
    expect(endResult).toContain("[pending]");
    expect(endResult).toContain("Ended early");
  });
});
