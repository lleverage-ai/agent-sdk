/**
 * Integration tests for Agent Teams plugin with runtime tools.
 *
 * These tests verify that `start_team` dynamically adds team tools to the
 * primary agent and `end_team` removes them. The primary agent gains/loses
 * tools at runtime.
 *
 * NOTE: Plugin tools are registered through the MCP manager and get
 * prefixed with `mcp__<pluginName>__`. So `start_team` becomes
 * `mcp__agent-teams__start_team` in the primary agent's tool set.
 * The dynamically added team tools (via addRuntimeTools) are NOT prefixed.
 */

import { generateText, tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../../../src/agent.js";
import { TEAM_HOOKS } from "../../../src/plugins/agent-teams/hooks.js";
import { createAgentTeamsPlugin } from "../../../src/plugins/agent-teams/index.js";
import type { TeammateDefinition } from "../../../src/plugins/agent-teams/types.js";
import type { HookRegistration } from "../../../src/types.js";
import { createMockModel, resetMocks } from "../../setup.js";

// Mock AI SDK generateText
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

const mockedGenerateText = vi.mocked(generateText);

/** MCP-prefixed name for the start_team tool on the primary agent */
const START_TEAM = "mcp__agent-teams__start_team";

/**
 * Helper: find a tool by name in opts.tools, checking both
 * direct and MCP-prefixed names.
 */
function findTool(tools: Record<string, any>, name: string) {
  return tools[name] ?? tools[`mcp__agent-teams__${name}`];
}

/**
 * Helper: Create a generateText mock that just returns text (no tool call).
 */
function mockGenerateTextPlain(text = "OK") {
  mockedGenerateText.mockImplementationOnce(async () => {
    return {
      text,
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

/**
 * Helper: Create a generateText mock that calls a tool, then returns a
 * valid response.
 */
function mockGenerateTextWithToolCall(
  toolCallFn: (opts: any) => Promise<void>,
  text = "tool call step",
) {
  mockedGenerateText.mockImplementationOnce(async (opts: any) => {
    await toolCallFn(opts);
    return {
      text,
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

describe("Agent Teams Integration Tests", () => {
  const teammates: TeammateDefinition[] = [
    {
      role: "researcher",
      description: "Researches topics thoroughly",
      agentOptions: { systemPrompt: "You are a researcher." },
    },
    {
      role: "coder",
      description: "Writes clean code",
      agentOptions: { systemPrompt: "You are a coder." },
    },
  ];

  beforeEach(() => {
    resetMocks();
    // Set a default fallback for generateText
    mockedGenerateText.mockImplementation(async () => {
      return {
        text: "fallback response",
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

  // ===========================================================================
  // Runtime Tools Flow
  // ===========================================================================

  describe("runtime tools flow", () => {
    it("start_team adds team tools to the primary agent", async () => {
      const model = createMockModel();
      const plugin = createAgentTeamsPlugin({ teammates });

      const agent = createAgent({
        model,
        systemPrompt: "You are a helpful assistant.",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });
      await agent.ready;

      // Before start_team: no team tools
      const toolsBefore = agent.getActiveTools();
      expect(toolsBefore.team_spawn).toBeUndefined();
      expect(toolsBefore.team_message).toBeUndefined();
      expect(toolsBefore.end_team).toBeUndefined();

      // Call start_team via generate
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        expect(startTeam).toBeDefined();
        const result = await startTeam.execute(
          { reason: "Need parallel research" },
          { toolCallId: "tc-start" },
        );

        // Tool result should contain team activation info
        expect(result).toContain("Team mode activated");
        expect(result).toContain("researcher");
        expect(result).toContain("coder");
      });

      await agent.generate({ prompt: "Research TypeScript features" });

      // After start_team: team tools should be in getActiveTools
      const toolsAfter = agent.getActiveTools();
      expect(toolsAfter.team_spawn).toBeDefined();
      expect(toolsAfter.team_message).toBeDefined();
      expect(toolsAfter.team_shutdown).toBeDefined();
      expect(toolsAfter.team_list_teammates).toBeDefined();
      expect(toolsAfter.team_task_create).toBeDefined();
      expect(toolsAfter.team_task_list).toBeDefined();
      expect(toolsAfter.team_task_get).toBeDefined();
      expect(toolsAfter.team_read_messages).toBeDefined();
      expect(toolsAfter.end_team).toBeDefined();
    });

    it("end_team removes team tools from the primary agent", async () => {
      const model = createMockModel();
      const plugin = createAgentTeamsPlugin({ teammates });

      const agent = createAgent({
        model,
        systemPrompt: "Primary agent",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });
      await agent.ready;

      // Call 1: start_team
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        await startTeam.execute({ reason: "Team work needed" }, { toolCallId: "tc-start" });
      });

      await agent.generate({ prompt: "Start team" });

      // Team tools should be present
      expect(agent.getActiveTools().team_spawn).toBeDefined();

      // Call 2: end_team (now available as a runtime tool)
      mockGenerateTextWithToolCall(async (opts) => {
        expect(opts.tools.end_team).toBeDefined();
        const result = await opts.tools.end_team.execute(
          { summary: "All work completed successfully" },
          { toolCallId: "tc-end" },
        );
        expect(result).toBe("All work completed successfully");
      });

      await agent.generate({ prompt: "End team" });

      // After end_team: team tools should be gone
      const toolsAfter = agent.getActiveTools();
      expect(toolsAfter.team_spawn).toBeUndefined();
      expect(toolsAfter.end_team).toBeUndefined();
      expect(toolsAfter.team_message).toBeUndefined();
    });

    it("double start_team returns error message", async () => {
      const model = createMockModel();
      const plugin = createAgentTeamsPlugin({ teammates });

      const agent = createAgent({
        model,
        systemPrompt: "Primary agent",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });
      await agent.ready;

      // First start_team
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        await startTeam.execute({ reason: "First team" }, { toolCallId: "tc-1" });
      });

      await agent.generate({ prompt: "Start team" });

      // Second start_team should return error
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        const result = await startTeam.execute({ reason: "Second team" }, { toolCallId: "tc-2" });
        expect(result).toContain("Team already active");
      });

      await agent.generate({ prompt: "Start another team" });
    });
  });

  // ===========================================================================
  // Initial Tasks
  // ===========================================================================

  describe("initial tasks", () => {
    it("initial_tasks are created in the coordinator on start_team", async () => {
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
        const result = await startTeam.execute(
          {
            reason: "Parallel research",
            initial_tasks: [
              {
                subject: "Research TypeScript",
                description: "Deep dive into TS generics",
              },
              {
                subject: "Research Rust",
                description: "Compare Rust traits with TS interfaces",
                blocked_by: ["Research TypeScript"],
              },
            ],
          },
          { toolCallId: "tc-start" },
        );

        // Result should mention the tasks
        expect(result).toContain("Research TypeScript");
        expect(result).toContain("Research Rust");
      });

      await agent.generate({ prompt: "Start research" });

      // Verify team_task_list shows the tasks
      mockGenerateTextWithToolCall(async (opts) => {
        expect(opts.tools.team_task_list).toBeDefined();
        const taskList = await opts.tools.team_task_list.execute(
          { status: undefined, assignee: undefined },
          { toolCallId: "tc-list" },
        );
        expect(taskList).toContain("Research TypeScript");
        expect(taskList).toContain("Research Rust");
        expect(taskList).toContain("blocked by");
      });

      await agent.generate({ prompt: "List tasks" });
    });
  });

  // ===========================================================================
  // Team Tools Available During Generation
  // ===========================================================================

  describe("team tools during generation", () => {
    it("team tools are passed to generateText after start_team", async () => {
      const model = createMockModel();
      let toolNamesInGeneration: string[] = [];

      const primaryCustomTool = tool({
        description: "A custom tool from the primary agent",
        inputSchema: z.object({ input: z.string() }),
        execute: async ({ input }) => `Processed: ${input}`,
      });

      const plugin = createAgentTeamsPlugin({ teammates });

      const agent = createAgent({
        model,
        systemPrompt: "Primary agent",
        tools: { custom_tool: primaryCustomTool },
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });
      await agent.ready;

      // Call 1: start_team
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        await startTeam.execute({ reason: "Test" }, { toolCallId: "tc-start" });
      });

      await agent.generate({ prompt: "Start team" });

      // Call 2: capture tools available in generation
      mockedGenerateText.mockImplementationOnce(async (opts: any) => {
        toolNamesInGeneration = Object.keys(opts.tools || {});
        return {
          text: "Team active",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          response: { id: "r1", timestamp: new Date(), modelId: "mock" },
          steps: [],
          warnings: [],
          sources: [],
          toolCalls: [],
          toolResults: [],
          request: { body: {} },
        } as any;
      });

      await agent.generate({ prompt: "Do team work" });

      // Should have team management tools
      expect(toolNamesInGeneration).toContain("team_spawn");
      expect(toolNamesInGeneration).toContain("team_message");
      expect(toolNamesInGeneration).toContain("team_shutdown");
      expect(toolNamesInGeneration).toContain("team_list_teammates");
      expect(toolNamesInGeneration).toContain("team_task_create");
      expect(toolNamesInGeneration).toContain("team_task_list");
      expect(toolNamesInGeneration).toContain("team_task_get");
      expect(toolNamesInGeneration).toContain("team_read_messages");
      expect(toolNamesInGeneration).toContain("end_team");

      // Should also have primary agent's custom tools
      expect(toolNamesInGeneration).toContain("custom_tool");

      // start_team should still be present (as MCP-prefixed)
      expect(toolNamesInGeneration).toContain(START_TEAM);
    });
  });

  // ===========================================================================
  // Hook Observability
  // ===========================================================================

  describe("hook observability", () => {
    it("fires custom hooks throughout the team lifecycle", async () => {
      const hookEvents: Array<{
        event: string;
        payload: Record<string, unknown>;
      }> = [];
      const hookFn = vi.fn(async (input: any) => {
        hookEvents.push({
          event: input.custom_event,
          payload: input.payload,
        });
        return {};
      });

      const hooks: HookRegistration = {
        Custom: {
          [TEAM_HOOKS.TeamTaskCreated]: [hookFn],
          [TEAM_HOOKS.TeamMessageSent]: [hookFn],
          [TEAM_HOOKS.TeammateStopped]: [hookFn],
        },
      };

      const model = createMockModel();
      const plugin = createAgentTeamsPlugin({ teammates, hooks });

      const agent = createAgent({
        model,
        systemPrompt: "Primary",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });
      await agent.ready;

      // Call 1: start_team with initial tasks
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        await startTeam.execute(
          {
            reason: "Parallel work",
            initial_tasks: [
              { subject: "Task A", description: "Do A" },
              { subject: "Task B", description: "Do B" },
            ],
          },
          { toolCallId: "tc-start" },
        );
      });

      await agent.generate({ prompt: "Start team" });

      // Call 2: create a task, send a message, end team
      mockGenerateTextWithToolCall(async (opts) => {
        await opts.tools.team_task_create.execute(
          { subject: "Task C", description: "Do C" },
          { toolCallId: "tc-task" },
        );

        await opts.tools.team_message.execute(
          { to: null, content: "Team update" },
          { toolCallId: "tc-msg" },
        );

        await opts.tools.end_team.execute({ summary: "Done" }, { toolCallId: "tc-end" });
      });

      await agent.generate({ prompt: "Do work and end" });

      // Verify hooks fired
      const eventNames = hookEvents.map((e) => e.event);
      expect(eventNames).toContain(TEAM_HOOKS.TeamTaskCreated);
      expect(eventNames).toContain(TEAM_HOOKS.TeamMessageSent);
    });

    it("fires TeammateSpawned hook when team_spawn is called", async () => {
      const spawnedEvents: Record<string, unknown>[] = [];
      const spawnHook = vi.fn(async (input: any) => {
        spawnedEvents.push(input.payload);
        return {};
      });

      const hooks: HookRegistration = {
        Custom: {
          [TEAM_HOOKS.TeammateSpawned]: [spawnHook],
          [TEAM_HOOKS.TeammateStopped]: [vi.fn(async () => ({}))],
        },
      };

      const model = createMockModel();
      const plugin = createAgentTeamsPlugin({ teammates, hooks });

      const agent = createAgent({
        model,
        systemPrompt: "Primary",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });
      await agent.ready;

      // Call 1: start_team
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        await startTeam.execute({ reason: "Need researchers" }, { toolCallId: "tc-start" });
      });

      await agent.generate({ prompt: "Start team" });

      // Call 2: spawn a teammate, then end team
      mockGenerateTextWithToolCall(async (opts) => {
        await opts.tools.team_spawn.execute(
          {
            role: "researcher",
            initial_prompt: "Research AI safety",
          },
          { toolCallId: "tc-spawn" },
        );

        // End team
        await opts.tools.end_team.execute(
          { summary: "Spawned and stopped" },
          { toolCallId: "tc-end" },
        );
      });

      await agent.generate({ prompt: "Do parallel research" });

      // Verify TeammateSpawned hook was called
      expect(spawnHook).toHaveBeenCalled();
      expect(spawnedEvents.length).toBeGreaterThanOrEqual(1);
      expect(spawnedEvents[0]).toMatchObject({ role: "researcher" });
    });
  });
});
