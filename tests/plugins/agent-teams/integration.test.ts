/**
 * Mock-based integration tests for Agent Teams plugin.
 *
 * These tests wire up real `createAgent` + `AgentSession` with a mocked
 * `generateText` to verify the full handoff flow, team coordination,
 * and hook observability without needing API keys.
 *
 * NOTE: Plugin tools are registered through the MCP manager and get
 * prefixed with `mcp__<pluginName>__`. So `start_team` becomes
 * `mcp__agent-teams__start_team` in the primary agent's tool set.
 * The leader agent's tools are passed directly via `tools:`, so they
 * are NOT prefixed.
 *
 * NOTE: The handoff mechanism uses a cooperative signal-catching approach.
 * When a tool throws HandoffSignal, the outermost wrapper catches it,
 * stores it in shared state, and returns a placeholder. The mock must
 * return a valid response object after calling execute() — `generate()`
 * checks the signal state before processing the response.
 */

import { generateText, tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../../../src/agent.js";
import { TEAM_HOOKS } from "../../../src/plugins/agent-teams/hooks.js";
import { createAgentTeamsPlugin } from "../../../src/plugins/agent-teams/index.js";
import type { TeammateDefinition } from "../../../src/plugins/agent-teams/types.js";
import type { SessionOutput } from "../../../src/session.js";
import { AgentSession } from "../../../src/session.js";
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
 * valid response. The signal-catching wrapper intercepts HandoffSignal
 * before it propagates, so the mock must return normally.
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

/**
 * Helper: Collect session outputs until generation_complete or error.
 */
async function collectOutputs(
  agent: { ready: Promise<void> },
  session: AgentSession,
  prompt: string,
  maxIterations = 30,
): Promise<SessionOutput[]> {
  await agent.ready;
  session.sendMessage(prompt);
  const outputs: SessionOutput[] = [];
  let count = 0;
  for await (const output of session.run()) {
    outputs.push(output);
    count++;
    if (count >= maxIterations) {
      session.stop();
      break;
    }
    if (output.type === "generation_complete" || output.type === "error") {
      session.stop();
      break;
    }
  }
  return outputs;
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
    // Set a default fallback for generateText in case extra calls happen
    // (e.g., from HeadlessSessionRunner background runs)
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
  // Handoff Flow
  // ===========================================================================

  describe("full handoff flow", () => {
    it("primary agent hands off to team leader via start_team", async () => {
      const model = createMockModel();
      const plugin = createAgentTeamsPlugin({ teammates });

      const agent = createAgent({
        model,
        systemPrompt: "You are a helpful assistant.",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });

      // Call 1: primary agent calls start_team → HandoffSignal caught cooperatively
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        expect(startTeam).toBeDefined();
        await startTeam.execute(
          {
            reason: "Need parallel research",
            initial_tasks: [
              {
                subject: "Research TS",
                description: "Research TypeScript generics",
              },
            ],
          },
          { toolCallId: "tc-start" },
        );
      });

      // Call 2: team leader agent generates a response
      mockGenerateTextPlain("Team leader: coordinating work...");

      const session = new AgentSession({ agent });
      const outputs = await collectOutputs(agent, session, "Research TypeScript features");

      // Should have agent_handoff event
      const handoffs = outputs.filter((o) => o.type === "agent_handoff");
      expect(handoffs.length).toBeGreaterThanOrEqual(1);
      expect(handoffs[0]).toMatchObject({
        type: "agent_handoff",
        context: expect.stringContaining("parallel research"),
      });

      // Should eventually get generation_complete from the leader
      const complete = outputs.find((o) => o.type === "generation_complete");
      expect(complete).toBeDefined();
    });

    it("team leader hands back to primary agent via end_team", async () => {
      const model = createMockModel();
      const plugin = createAgentTeamsPlugin({ teammates });

      const primaryAgent = createAgent({
        model,
        systemPrompt: "Primary agent",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });

      // Call 1: primary calls start_team → handoff to leader
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        await startTeam.execute({ reason: "Team work needed" }, { toolCallId: "tc-start" });
      });

      // Call 2: leader calls end_team → handback to primary
      mockGenerateTextWithToolCall(async (opts) => {
        // Leader tools are NOT MCP-prefixed (they're in tools: directly)
        await opts.tools.end_team.execute(
          { summary: "All work completed successfully" },
          { toolCallId: "tc-end" },
        );
      });

      // Call 3: primary agent resumes with the summary as context
      mockGenerateTextPlain("Here are the consolidated results from the team.");

      const session = new AgentSession({ agent: primaryAgent });
      const outputs = await collectOutputs(primaryAgent, session, "Do team work");

      // Should have 2 handoff events: handoff + handback
      const handoffs = outputs.filter((o) => o.type === "agent_handoff");
      expect(handoffs.length).toBe(2);

      // First: handoff to leader
      expect(handoffs[0].context).toContain("Team work needed");

      // Second: handback with summary
      expect(handoffs[1].context).toBe("All work completed successfully");

      // Final generation_complete should be from the primary agent
      const complete = outputs.find((o) => o.type === "generation_complete");
      expect(complete).toBeDefined();
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

      // Call 1: primary calls start_team with initial tasks
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

      // Call 2: leader creates an additional task, sends a message, then ends team
      mockGenerateTextWithToolCall(async (opts) => {
        // Leader tools are NOT MCP-prefixed
        await opts.tools.team_task_create.execute(
          { subject: "Task C", description: "Do C" },
          { toolCallId: "tc-task" },
        );

        await opts.tools.team_message.execute(
          { to: null, content: "Team update" },
          { toolCallId: "tc-msg" },
        );

        // End the team
        await opts.tools.end_team.execute({ summary: "Done" }, { toolCallId: "tc-end" });
      });

      // Call 3: primary resumes
      mockGenerateTextPlain("Results processed.");

      const session = new AgentSession({ agent });
      const outputs = await collectOutputs(agent, session, "Start team work");

      // Verify hooks fired
      const eventNames = hookEvents.map((e) => e.event);

      // TeamTaskCreated should fire for the tool-created task
      expect(eventNames).toContain(TEAM_HOOKS.TeamTaskCreated);

      // TeamMessageSent should fire
      expect(eventNames).toContain(TEAM_HOOKS.TeamMessageSent);

      // No errors
      const errors = outputs.filter((o) => o.type === "error");
      expect(errors).toHaveLength(0);
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

      // Call 1: start_team
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        await startTeam.execute({ reason: "Need researchers" }, { toolCallId: "tc-start" });
      });

      // Call 2: leader spawns a teammate, then ends team
      mockGenerateTextWithToolCall(async (opts) => {
        // Leader tools are NOT MCP-prefixed
        await opts.tools.team_spawn.execute(
          {
            role: "researcher",
            initial_prompt: "Research AI safety",
          },
          { toolCallId: "tc-spawn" },
        );

        // End team (this stops all runners)
        await opts.tools.end_team.execute(
          { summary: "Spawned and stopped" },
          { toolCallId: "tc-end" },
        );
      });

      // Call 3: primary resumes
      mockGenerateTextPlain("OK");

      const session = new AgentSession({ agent });
      const outputs = await collectOutputs(agent, session, "Do parallel research");

      // No errors
      const errors = outputs.filter((o) => o.type === "error");
      expect(errors).toHaveLength(0);

      // Verify TeammateSpawned hook was called
      expect(spawnHook).toHaveBeenCalled();
      expect(spawnedEvents.length).toBeGreaterThanOrEqual(1);
      expect(spawnedEvents[0]).toMatchObject({
        role: "researcher",
      });
    });
  });

  // ===========================================================================
  // Team Leader Tools
  // ===========================================================================

  describe("team leader has correct tools", () => {
    it("leader agent receives team management tools plus primary agent tools", async () => {
      const model = createMockModel();
      let leaderToolNames: string[] = [];

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

      // Call 1: start_team → handoff to leader
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        await startTeam.execute({ reason: "Test" }, { toolCallId: "tc-start" });
      });

      // Call 2: capture the tools available to the leader
      mockedGenerateText.mockImplementationOnce(async (opts: any) => {
        leaderToolNames = Object.keys(opts.tools || {});
        return {
          text: "Leader done",
          finishReason: "stop",
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
          },
          response: {
            id: "r1",
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

      const session = new AgentSession({ agent });
      const outputs = await collectOutputs(agent, session, "Test team tools");

      // Leader should have team management tools (NOT MCP-prefixed)
      expect(leaderToolNames).toContain("team_spawn");
      expect(leaderToolNames).toContain("team_message");
      expect(leaderToolNames).toContain("team_shutdown");
      expect(leaderToolNames).toContain("team_list_teammates");
      expect(leaderToolNames).toContain("team_task_create");
      expect(leaderToolNames).toContain("team_task_list");
      expect(leaderToolNames).toContain("team_task_get");
      expect(leaderToolNames).toContain("team_read_messages");
      expect(leaderToolNames).toContain("end_team");

      // Leader should also inherit primary agent's custom tools
      expect(leaderToolNames).toContain("custom_tool");

      // Leader should NOT have start_team (that's for the primary)
      expect(leaderToolNames).not.toContain("start_team");
      expect(leaderToolNames).not.toContain(START_TEAM);
    });
  });

  // ===========================================================================
  // Task Management through Handoff
  // ===========================================================================

  describe("task management through handoff", () => {
    it("initial_tasks are created in the coordinator on start_team", async () => {
      const model = createMockModel();
      let leaderTaskList = "";

      const plugin = createAgentTeamsPlugin({ teammates });

      const agent = createAgent({
        model,
        systemPrompt: "Primary",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });

      // Call 1: start_team with initial tasks
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        await startTeam.execute(
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
      });

      // Call 2: leader lists tasks, then ends team
      mockGenerateTextWithToolCall(async (opts) => {
        leaderTaskList = await opts.tools.team_task_list.execute(
          { status: undefined, assignee: undefined },
          { toolCallId: "tc-list" },
        );

        // End team
        await opts.tools.end_team.execute({ summary: "Done" }, { toolCallId: "tc-end" });
      });

      // Call 3: primary resumes
      mockGenerateTextPlain("OK");

      const session = new AgentSession({ agent });
      const outputs = await collectOutputs(agent, session, "Start research");

      // No errors
      const errors = outputs.filter((o) => o.type === "error");
      expect(errors).toHaveLength(0);

      // Verify tasks were created
      expect(leaderTaskList).toContain("Research TypeScript");
      expect(leaderTaskList).toContain("Research Rust");
      // The second task should show as blocked
      expect(leaderTaskList).toContain("blocked by");
    });
  });

  // ===========================================================================
  // Leader System Prompt
  // ===========================================================================

  describe("system prompt augmentation", () => {
    it("leader system prompt includes teammate roles and workflow", async () => {
      const model = createMockModel();
      let leaderSystemPrompt = "";

      const plugin = createAgentTeamsPlugin({ teammates });

      const agent = createAgent({
        model,
        systemPrompt: "You are a helpful assistant.",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });

      // Call 1: start_team
      mockGenerateTextWithToolCall(async (opts) => {
        const startTeam = findTool(opts.tools, "start_team");
        await startTeam.execute({ reason: "Test system prompt" }, { toolCallId: "tc-start" });
      });

      // Call 2: capture leader's system prompt
      mockedGenerateText.mockImplementationOnce(async (opts: any) => {
        leaderSystemPrompt = opts.system ?? "";
        return {
          text: "Leader active",
          finishReason: "stop",
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
          },
          response: {
            id: "r1",
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

      const session = new AgentSession({ agent });
      const outputs = await collectOutputs(agent, session, "Test prompt");

      // No errors
      const errors = outputs.filter((o) => o.type === "error");
      expect(errors).toHaveLength(0);

      // Leader prompt should include team coordination instructions
      expect(leaderSystemPrompt).toContain("Team Leader Mode");
      expect(leaderSystemPrompt).toContain("researcher");
      expect(leaderSystemPrompt).toContain("coder");
      expect(leaderSystemPrompt).toContain("team_task_create");
      expect(leaderSystemPrompt).toContain("team_spawn");
      expect(leaderSystemPrompt).toContain("end_team");
    });
  });
});
