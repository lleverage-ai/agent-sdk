/**
 * Mailbox coordination integration tests for Agent Teams plugin.
 *
 * These tests exercise the mailbox flow through the HeadlessSessionRunner:
 * - Teammate spawned → blocks on waitForMessage → lead sends message →
 *   teammate wakes up, processes initial prompt + message → replies.
 * - Teammate processes initial work after idle timeout → sends results.
 *
 * Architecture note: HeadlessSessionRunner yields `waiting_for_input` before
 * processing the queued initial prompt. On the first iteration, it always
 * checks the coordinator mailbox. If empty, it blocks on `waitForMessage`.
 * The initial session event (initial prompt) is only processed AFTER
 * `waitForMessage` resolves (either via incoming message or timeout).
 *
 * Uses mocked generateText with discriminated routing: teammate calls are
 * identified by the presence of `team_task_claim` in opts.tools (a teammate-
 * only tool). Lead calls have `team_spawn` or `mcp__agent-teams__start_team`.
 */

import { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent } from "../../../src/agent.js";
import { InMemoryTeamCoordinator } from "../../../src/plugins/agent-teams/coordinator.js";
import { createAgentTeamsPlugin } from "../../../src/plugins/agent-teams/index.js";
import type { TeammateDefinition } from "../../../src/plugins/agent-teams/types.js";
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

// =============================================================================
// Helpers
// =============================================================================

/** Find a tool by name, checking both direct and MCP-prefixed names. */
function findTool(tools: Record<string, any>, name: string) {
  return tools[name] ?? tools[`mcp__agent-teams__${name}`];
}

/** Create a valid generateText response (no tool calls). */
function validResponse(text = "ok") {
  return {
    text,
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    response: {
      id: `r-${Date.now()}-${Math.random()}`,
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
}

/** Check if a generateText call is from a teammate (has team_task_claim tool). */
function isTeammateCall(opts: any): boolean {
  return opts.tools && "team_task_claim" in opts.tools;
}

/**
 * Wait for a condition to become true. Polls every `intervalMs` and
 * rejects after `timeoutMs`.
 */
function waitFor(
  description: string,
  condition: () => boolean,
  { timeoutMs = 10_000, intervalMs = 50 } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`waitFor("${description}") timed out after ${timeoutMs}ms`));
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

/**
 * Creates a mock router that dispatches generateText calls to separate
 * FIFO queues for the lead and teammate based on available tools.
 */
function createMockRouter() {
  const leadQueue: Array<(opts: any) => Promise<any>> = [];
  const teammateQueue: Array<(opts: any) => Promise<any>> = [];

  const router = async (opts: any) => {
    if (isTeammateCall(opts)) {
      const handler = teammateQueue.shift();
      if (handler) return handler(opts);
      return validResponse("teammate fallback");
    }
    const handler = leadQueue.shift();
    if (handler) return handler(opts);
    return validResponse("lead fallback");
  };

  return {
    install() {
      mockedGenerateText.mockImplementation(router as any);
    },
    /** Enqueue a lead mock that calls tools. */
    leadToolCall(fn: (opts: any) => Promise<void>, text = "lead step") {
      leadQueue.push(async (opts) => {
        await fn(opts);
        return validResponse(text);
      });
    },
    /** Enqueue a lead mock that returns plain text. */
    leadPlain(text = "OK") {
      leadQueue.push(async () => validResponse(text));
    },
    /** Enqueue a teammate mock that calls tools. */
    teammateToolCall(fn: (opts: any) => Promise<void>, text = "teammate step") {
      teammateQueue.push(async (opts) => {
        await fn(opts);
        return validResponse(text);
      });
    },
    /** Enqueue a teammate mock that returns plain text. */
    teammatePlain(text = "OK") {
      teammateQueue.push(async () => validResponse(text));
    },
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe("Mailbox Coordination Integration Tests", () => {
  const teammates: TeammateDefinition[] = [
    {
      role: "researcher",
      description: "Researches topics thoroughly",
      agentOptions: { systemPrompt: "You are a researcher." },
    },
  ];

  let coordinator: InMemoryTeamCoordinator;

  beforeEach(() => {
    resetMocks();
    coordinator = new InMemoryTeamCoordinator();
  });

  afterEach(() => {
    coordinator.dispose();
  });

  // =========================================================================
  // Test 1: teammate processes initial prompt, reports results to lead
  // =========================================================================

  it("teammate reports results to lead after idle timeout, lead reads them", async () => {
    const model = createMockModel();
    const errors: string[] = [];
    const router = createMockRouter();

    const plugin = createAgentTeamsPlugin({
      teammates,
      coordinator,
      // Short timeout so the teammate quickly processes its initial prompt
      idleTimeoutMs: 100,
      onError: (_id, err) => {
        errors.push(err.message);
      },
    });

    const agent = createAgent({
      model,
      systemPrompt: "You are a lead.",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    // Lead mock 1: start_team with a task
    router.leadToolCall(async (opts) => {
      const startTeam = findTool(opts.tools, "start_team");
      await startTeam.execute(
        {
          reason: "Need research",
          initial_tasks: [
            {
              subject: "Research AI",
              description: "Research artificial intelligence",
            },
          ],
        },
        { toolCallId: "tc-start" },
      );
    });

    // Lead mock 2: spawn researcher
    router.leadToolCall(async (opts) => {
      await opts.tools.team_spawn.execute(
        { role: "researcher", initial_prompt: "Research AI safety" },
        { toolCallId: "tc-spawn" },
      );
    });

    // Teammate mock 1: processes initial prompt — claim task, complete, message lead
    router.teammateToolCall(async (opts) => {
      await opts.tools.team_task_claim.execute({ task_id: "task-1" }, { toolCallId: "tc-claim" });
      await opts.tools.team_task_complete.execute(
        {
          task_id: "task-1",
          result: "AI safety is crucial for AGI development",
        },
        { toolCallId: "tc-complete" },
      );
      await opts.tools.team_message.execute(
        {
          to: "lead",
          content: "Research complete: AI safety is crucial for AGI development",
        },
        { toolCallId: "tc-msg" },
      );
    });

    // Lead mock 3: read messages, end team
    router.leadToolCall(async (opts) => {
      const msgs = await opts.tools.team_read_messages.execute({}, { toolCallId: "tc-read" });
      expect(msgs).toContain("Research complete");
      expect(msgs).toContain("AI safety is crucial");

      await opts.tools.end_team.execute({ summary: "Research done" }, { toolCallId: "tc-end" });
    });

    router.install();

    await agent.generate({ prompt: "Start team" });
    await agent.generate({ prompt: "Spawn researcher" });

    // Wait for teammate to finish (status becomes "stopped" after idle timeout + work)
    await waitFor("teammate stopped", () => {
      const tm = coordinator.listTeammates();
      return tm.length > 0 && tm[0].status === "stopped";
    });

    // Verify the message from teammate is in the coordinator
    const msgsForLead = coordinator.getMessages("lead", false);
    expect(msgsForLead.length).toBe(1);
    expect(msgsForLead[0].content).toContain("AI safety is crucial");

    await agent.generate({ prompt: "Read messages and end team" });

    expect(errors).toHaveLength(0);
  });

  // =========================================================================
  // Test 2: lead sends message to idle teammate, teammate wakes and replies
  // =========================================================================

  it("lead sends message to idle teammate, teammate wakes up and processes it", async () => {
    const model = createMockModel();
    const errors: string[] = [];
    const router = createMockRouter();

    const plugin = createAgentTeamsPlugin({
      teammates,
      coordinator,
      // Long enough to not timeout before the lead sends a message,
      // short enough that the second idle period doesn't slow the test
      idleTimeoutMs: 500,
      onError: (_id, err) => {
        errors.push(err.message);
      },
    });

    const agent = createAgent({
      model,
      systemPrompt: "You are a lead.",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    // Lead mock 1: start_team
    router.leadToolCall(async (opts) => {
      const startTeam = findTool(opts.tools, "start_team");
      await startTeam.execute({ reason: "Parallel research" }, { toolCallId: "tc-start" });
    });

    // Lead mock 2: spawn researcher
    router.leadToolCall(async (opts) => {
      await opts.tools.team_spawn.execute(
        {
          role: "researcher",
          initial_prompt: "Stand by for instructions",
        },
        { toolCallId: "tc-spawn" },
      );
    });

    // Teammate mock 1: processes initial prompt after being woken up
    router.teammateToolCall(async (opts) => {
      await opts.tools.team_message.execute(
        { to: "lead", content: "Ready for instructions" },
        { toolCallId: "tc-ack" },
      );
    });

    // Teammate mock 2: processes the injected coordinator message
    router.teammateToolCall(async (opts) => {
      await opts.tools.team_message.execute(
        {
          to: "lead",
          content: "Completed research on topic X",
        },
        { toolCallId: "tc-reply" },
      );
    });

    // Lead mock 3: send message to teammate
    router.leadToolCall(async (opts) => {
      const tmList = coordinator.listTeammates();
      const tmId = tmList[0].id;
      await opts.tools.team_message.execute(
        { to: tmId, content: "Please research topic X" },
        { toolCallId: "tc-msg" },
      );
    });

    // Lead mock 4: read messages and end team
    router.leadToolCall(async (opts) => {
      const msgs = await opts.tools.team_read_messages.execute({}, { toolCallId: "tc-read" });
      expect(msgs).toContain("Ready for instructions");
      expect(msgs).toContain("Completed research on topic X");

      await opts.tools.end_team.execute({ summary: "Done" }, { toolCallId: "tc-end" });
    });

    router.install();

    await agent.generate({ prompt: "Start team" });
    await agent.generate({ prompt: "Spawn researcher" });

    // Wait for teammate to be idle (it's blocking on waitForMessage)
    await waitFor("teammate idle", () => {
      const tm = coordinator.listTeammates();
      return tm.length > 0 && tm[0].status === "idle";
    });

    // Send message to teammate — this wakes the teammate's waitForMessage
    await agent.generate({
      prompt: "Send instructions to teammate",
    });

    // Wait for the teammate to process and send its replies
    await waitFor("teammate sends replies", () => {
      const msgs = coordinator.getMessages("lead", false);
      return msgs.length >= 2;
    });

    // Wait for teammate to stop (second idle timeout after processing)
    await waitFor("teammate stopped", () => {
      const tm = coordinator.listTeammates();
      return tm.length > 0 && tm[0].status === "stopped";
    });

    // Verify messages
    const msgsForLead = coordinator.getMessages("lead", false);
    expect(msgsForLead.length).toBe(2);
    expect(msgsForLead[0].content).toContain("Ready for instructions");
    expect(msgsForLead[1].content).toContain("Completed research on topic X");

    await agent.generate({ prompt: "Read and end" });
    expect(errors).toHaveLength(0);
  });

  // =========================================================================
  // Test 3: broadcast message from lead wakes idle teammate
  // =========================================================================

  it("broadcast message from lead wakes idle teammate", async () => {
    const model = createMockModel();
    const errors: string[] = [];
    const router = createMockRouter();

    const plugin = createAgentTeamsPlugin({
      teammates,
      coordinator,
      // Long enough to not timeout before the lead sends a broadcast,
      // short enough that the second idle period doesn't slow the test
      idleTimeoutMs: 500,
      onError: (_id, err) => {
        errors.push(err.message);
      },
    });

    const agent = createAgent({
      model,
      systemPrompt: "You are a lead.",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });
    await agent.ready;

    // Lead mock 1: start_team
    router.leadToolCall(async (opts) => {
      const startTeam = findTool(opts.tools, "start_team");
      await startTeam.execute({ reason: "Team work" }, { toolCallId: "tc-start" });
    });

    // Lead mock 2: spawn researcher
    router.leadToolCall(async (opts) => {
      await opts.tools.team_spawn.execute(
        {
          role: "researcher",
          initial_prompt: "Stand by for broadcast",
        },
        { toolCallId: "tc-spawn" },
      );
    });

    // Teammate mock 1: processes initial prompt after wake-up
    router.teammatePlain("Standing by");

    // Teammate mock 2: processes injected broadcast message
    router.teammateToolCall(async (opts) => {
      await opts.tools.team_message.execute(
        {
          to: "lead",
          content: "Acknowledged broadcast, starting work",
        },
        { toolCallId: "tc-ack" },
      );
    });

    // Lead mock 3: send broadcast (to: null)
    router.leadToolCall(async (opts) => {
      await opts.tools.team_message.execute(
        {
          to: null,
          content: "All teammates: priority shift to topic Z",
        },
        { toolCallId: "tc-broadcast" },
      );
    });

    // Lead mock 4: read and end
    router.leadToolCall(async (opts) => {
      const msgs = await opts.tools.team_read_messages.execute({}, { toolCallId: "tc-read" });
      expect(msgs).toContain("Acknowledged broadcast");

      await opts.tools.end_team.execute(
        { summary: "Broadcast test done" },
        { toolCallId: "tc-end" },
      );
    });

    router.install();

    await agent.generate({ prompt: "Start team" });
    await agent.generate({ prompt: "Spawn researcher" });

    // Wait for teammate to be idle
    await waitFor("teammate idle", () => {
      const tm = coordinator.listTeammates();
      return tm.length > 0 && tm[0].status === "idle";
    });

    // Send broadcast — this wakes the teammate
    await agent.generate({ prompt: "Broadcast to all" });

    // Wait for teammate to process the broadcast and reply
    await waitFor("teammate replies to broadcast", () => {
      const msgs = coordinator.getMessages("lead", false);
      return msgs.length >= 1;
    });

    // Verify the reply
    const msgsForLead = coordinator.getMessages("lead", false);
    expect(msgsForLead.some((m) => m.content.includes("Acknowledged broadcast"))).toBe(true);

    // Verify the broadcast message is in the coordinator
    const tmId = coordinator.listTeammates()[0].id;
    const msgsForTeammate = coordinator.getMessages(tmId, false);
    expect(msgsForTeammate.some((m) => m.content.includes("priority shift to topic Z"))).toBe(true);

    // Wait for teammate to stop
    await waitFor("teammate stopped", () => {
      const tm = coordinator.listTeammates();
      return tm.length > 0 && tm[0].status === "stopped";
    });

    await agent.generate({ prompt: "Read and end" });
    expect(errors).toHaveLength(0);
  });
});
