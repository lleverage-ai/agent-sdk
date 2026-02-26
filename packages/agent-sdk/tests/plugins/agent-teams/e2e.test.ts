/**
 * End-to-end tests for Agent Teams plugin with real LLM calls.
 *
 * These tests use AI Gateway with `anthropic/claude-haiku-4.5` to verify
 * the full agent teams lifecycle: start_team → create tasks → spawn
 * teammates → teammates claim & complete tasks → lead reads messages →
 * end_team.
 *
 * IMPORTANT: `start_team` adds team tools via `addRuntimeTools()`, but those
 * tools are only visible in the NEXT `generate()` call (the tool set is
 * captured once per generateText invocation). So every test uses separate
 * generate() calls: one for start_team, a second for team_spawn/etc.
 *
 * Gated behind `RUN_E2E_TESTS=1` environment variable.
 * API key is loaded from `.env` file (AI_GATEWAY_API_KEY).
 *
 * Run with:
 *   RUN_E2E_TESTS=1 bun test tests/plugins/agent-teams/e2e.test.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createGateway } from "@ai-sdk/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../../../src/agent.js";
import { InMemoryTeamCoordinator } from "../../../src/plugins/agent-teams/coordinator.js";
import { TEAM_HOOKS } from "../../../src/plugins/agent-teams/hooks.js";
import { createAgentTeamsPlugin } from "../../../src/plugins/agent-teams/index.js";
import type { TeammateDefinition } from "../../../src/plugins/agent-teams/types.js";
import type { HookRegistration } from "../../../src/types.js";

// Load .env file manually (dotenv not available)
function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env");
  const env: Record<string, string> = {};
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
  } catch {
    // .env file not found
  }
  return env;
}

const shouldRun = process.env.RUN_E2E_TESTS === "1";
const envVars = shouldRun ? loadEnv() : {};
const apiKey = process.env.AI_GATEWAY_API_KEY ?? envVars.AI_GATEWAY_API_KEY ?? "";

const describeE2E = shouldRun ? describe : describe.skip;

/**
 * Helper: wait until a condition is true, polling every `intervalMs`.
 * Rejects after `timeoutMs` with a descriptive message.
 */
function waitFor(
  description: string,
  condition: () => boolean,
  { timeoutMs = 30_000, intervalMs = 500 } = {},
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

describeE2E("Agent Teams E2E Tests", () => {
  const gateway = createGateway({ apiKey });
  const model = gateway("anthropic/claude-haiku-4.5");

  const teammates: TeammateDefinition[] = [
    {
      role: "researcher",
      description: "Researches topics and provides concise summaries",
      agentOptions: {
        systemPrompt:
          "You are a researcher on a team. Follow this workflow exactly:\n" +
          "1. Call team_task_list to see available tasks\n" +
          "2. Call team_task_claim to claim a pending unblocked task\n" +
          "3. Do the research (you can use your knowledge)\n" +
          "4. Call team_task_complete with your result (a short summary)\n" +
          "5. Call team_message with to='lead' to report your findings\n" +
          "6. Call team_task_list again to check for more pending tasks\n" +
          "7. If no more pending tasks, stop.\n\n" +
          "Be concise. Complete tasks quickly. Always call team_task_complete before moving on.",
      },
      maxTurns: 15,
    },
  ];

  // Track agents for cleanup
  const agentsToDispose: Array<{ dispose(): Promise<void> }> = [];

  afterEach(async () => {
    for (const agent of agentsToDispose) {
      await agent.dispose().catch(() => {});
    }
    agentsToDispose.length = 0;
  });

  // ===========================================================================
  // Test 1: Full team lifecycle
  // ===========================================================================

  it(
    "full lifecycle: start_team → spawn teammate → teammate completes task → end_team",
    { timeout: 120_000 },
    async () => {
      const coordinator = new InMemoryTeamCoordinator();
      const teammateOutput: string[] = [];
      const teammateErrors: string[] = [];

      const plugin = createAgentTeamsPlugin({
        teammates: [
          {
            ...teammates[0]!,
            agentOptions: {
              ...teammates[0]!.agentOptions,
            },
          },
        ],
        coordinator,
        idleTimeoutMs: 15_000,
        onError: (id, error) => {
          teammateErrors.push(`${id}: ${error.message}`);
          console.error(`[E2E lifecycle] Teammate error: ${id}:`, error.message);
        },
      });

      const agent = createAgent({
        model,
        systemPrompt:
          "You are a team lead. Follow instructions EXACTLY as given.\n" +
          "Only call the tools you are instructed to call.\n" +
          "Do not add extra tools or steps beyond what is requested.",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });

      await agent.ready;
      agentsToDispose.push(agent);

      // Verify start_team is visible, team tools are not
      expect(agent.getActiveTools()["mcp__agent-teams__start_team"]).toBeDefined();
      expect(agent.getActiveTools().team_spawn).toBeUndefined();

      // Step 1: Start the team with one initial task
      console.log("[E2E lifecycle] Step 1: Starting team...");
      const result1 = await agent.generate({
        prompt:
          "Call start_team with reason 'Research task' and initial_tasks containing one task: " +
          'subject "TypeScript benefits", description "List 3 key benefits of TypeScript".',
        maxSteps: 3,
      });

      expect(result1.status).toBe("complete");
      console.log("[E2E lifecycle] Team started. Tasks:", coordinator.listTasks().length);

      // Team tools should now be available (for the next generate call)
      expect(agent.getActiveTools().team_spawn).toBeDefined();
      expect(coordinator.listTasks().length).toBeGreaterThanOrEqual(1);

      // Step 2: Spawn a researcher (separate generate call so team tools are visible)
      console.log("[E2E lifecycle] Step 2: Spawning teammate...");
      const result2 = await agent.generate({
        prompt:
          "Call team_spawn with role 'researcher' and initial_prompt " +
          "'You have tasks waiting. Call team_task_list, claim a task, complete it, " +
          "then message the lead with your results.'",
        maxSteps: 3,
      });

      expect(result2.status).toBe("complete");

      // Verify teammate was registered
      const mates = coordinator.listTeammates();
      console.log(
        "[E2E lifecycle] Teammates:",
        mates.map((m) => `${m.id} (${m.role})`),
      );
      expect(mates.length).toBeGreaterThanOrEqual(1);

      // Step 3: Wait for the teammate to complete the task
      console.log("[E2E lifecycle] Step 3: Waiting for task completion...");
      await waitFor(
        "teammate completes task",
        () => coordinator.listTasks({ status: "completed" }).length > 0,
        { timeoutMs: 60_000 },
      );

      const completedTasks = coordinator.listTasks({ status: "completed" });
      console.log(
        "[E2E lifecycle] Completed:",
        completedTasks.map((t) => t.subject),
      );
      expect(completedTasks.length).toBeGreaterThanOrEqual(1);
      expect(completedTasks[0]?.result).toBeTruthy();

      // Step 4: Lead reads messages and ends team
      console.log("[E2E lifecycle] Step 4: Ending team...");
      const result3 = await agent.generate({
        prompt: "Call team_read_messages, then call end_team with a summary of the results.",
        maxSteps: 6,
      });

      expect(result3.status).toBe("complete");

      // Team tools should be removed
      expect(agent.getActiveTools().team_spawn).toBeUndefined();
      expect(agent.getActiveTools().end_team).toBeUndefined();

      // start_team should still be available
      expect(agent.getActiveTools()["mcp__agent-teams__start_team"]).toBeDefined();

      console.log("[E2E lifecycle] Teammate errors:", teammateErrors);
      console.log("[E2E lifecycle] PASSED");
    },
  );

  // ===========================================================================
  // Test 2: start_team injects tools, end_team removes them
  // ===========================================================================

  it("start_team dynamically adds tools, end_team removes them", { timeout: 60_000 }, async () => {
    const plugin = createAgentTeamsPlugin({
      teammates,
      idleTimeoutMs: 2_000,
      onError: () => {},
    });

    const agent = createAgent({
      model,
      systemPrompt:
        "You are a team lead. When told to start a team, call start_team. " +
        "When told to end the team, call end_team. Follow instructions exactly.",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });

    await agent.ready;
    agentsToDispose.push(agent);

    // Before: no team tools
    expect(agent.getActiveTools().team_spawn).toBeUndefined();

    // Call start_team
    const result1 = await agent.generate({
      prompt: "Start a team. Reason: testing tool injection.",
      maxSteps: 3,
    });

    expect(result1.status).toBe("complete");

    // After start_team: team tools present
    const toolsActive = agent.getActiveTools();
    const expectedTools = [
      "team_spawn",
      "team_message",
      "team_shutdown",
      "team_list_teammates",
      "team_task_create",
      "team_task_list",
      "team_task_get",
      "team_read_messages",
      "end_team",
    ];
    for (const name of expectedTools) {
      expect(toolsActive[name]).toBeDefined();
    }

    console.log(
      "[E2E tools] Team tools injected:",
      Object.keys(toolsActive).filter((k) => expectedTools.includes(k)),
    );

    // Call end_team (separate generate call — end_team is now visible)
    const result2 = await agent.generate({
      prompt: "End the team now. Summary: tool injection test complete.",
      maxSteps: 3,
    });

    expect(result2.status).toBe("complete");

    // After end_team: team tools removed
    const toolsRemoved = agent.getActiveTools();
    for (const name of expectedTools) {
      expect(toolsRemoved[name]).toBeUndefined();
    }

    console.log("[E2E tools] Team tools removed successfully");
  });

  // ===========================================================================
  // Test 3: Teammate task coordination via coordinator state
  // ===========================================================================

  it(
    "teammate claims, works on, and completes tasks observable via coordinator",
    { timeout: 90_000 },
    async () => {
      const coordinator = new InMemoryTeamCoordinator();

      const plugin = createAgentTeamsPlugin({
        teammates,
        coordinator,
        idleTimeoutMs: 15_000,
        onError: (id, err) => console.error(`[E2E coord] ${id} error:`, err.message),
      });

      const agent = createAgent({
        model,
        systemPrompt:
          "You are a team lead. Follow instructions exactly.\n" +
          "Only call the tools you are instructed to call.",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });

      await agent.ready;
      agentsToDispose.push(agent);

      // Step 1: Start team with two tasks
      console.log("[E2E coord] Starting team with tasks...");
      await agent.generate({
        prompt:
          "Call start_team with reason 'Research task' and initial_tasks:\n" +
          '- subject: "Benefits of Rust", description: "List 3 benefits of Rust"\n' +
          '- subject: "Benefits of Go", description: "List 3 benefits of Go"',
        maxSteps: 3,
      });

      const allTasks = coordinator.listTasks();
      console.log(
        "[E2E coord] Tasks:",
        allTasks.map((t) => `${t.id}: ${t.subject} [${t.status}]`),
      );
      expect(allTasks.length).toBeGreaterThanOrEqual(2);

      // Step 2: Spawn a researcher (separate generate call)
      console.log("[E2E coord] Spawning teammate...");
      await agent.generate({
        prompt:
          "Call team_spawn with role 'researcher' and initial_prompt " +
          "'Check tasks and start working. Claim each pending task, complete it, then check for more.'",
        maxSteps: 3,
      });

      const mates = coordinator.listTeammates();
      console.log(
        "[E2E coord] Teammates:",
        mates.map((m) => `${m.id} (${m.role}): ${m.status}`),
      );
      expect(mates.length).toBeGreaterThanOrEqual(1);
      expect(mates[0]?.role).toBe("researcher");

      // Wait for at least one task to be completed
      console.log("[E2E coord] Waiting for task completion...");
      await waitFor(
        "at least one task completed",
        () => coordinator.listTasks({ status: "completed" }).length >= 1,
        { timeoutMs: 60_000 },
      );

      const completed = coordinator.listTasks({ status: "completed" });
      console.log(
        "[E2E coord] Completed tasks:",
        completed.map((t) => `${t.subject}: ${t.result?.slice(0, 80)}`),
      );
      expect(completed.length).toBeGreaterThanOrEqual(1);

      for (const task of completed) {
        expect(task.result).toBeTruthy();
        expect(task.assignee).toBeTruthy();
      }

      // Clean up
      await agent.generate({
        prompt: "Call end_team with summary: coordination test complete.",
        maxSteps: 3,
      });
    },
  );

  // ===========================================================================
  // Test 4: Hook observability with real LLM
  // ===========================================================================

  it("custom hooks fire during the team lifecycle", { timeout: 120_000 }, async () => {
    const hookEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const hookFn = async (input: { custom_event: string; payload: Record<string, unknown> }) => {
      hookEvents.push({ event: input.custom_event, payload: input.payload });
      return {};
    };

    const hooks: HookRegistration = {
      Custom: {
        [TEAM_HOOKS.TeammateSpawned]: [hookFn],
        [TEAM_HOOKS.TeammateStopped]: [hookFn],
        [TEAM_HOOKS.TeamTaskClaimed]: [hookFn],
        [TEAM_HOOKS.TeamTaskCompleted]: [hookFn],
        [TEAM_HOOKS.TeamMessageSent]: [hookFn],
      },
    };

    const coordinator = new InMemoryTeamCoordinator();

    const plugin = createAgentTeamsPlugin({
      teammates,
      coordinator,
      hooks,
      idleTimeoutMs: 15_000,
      onError: (id, err) => console.error(`[E2E hooks] ${id} error:`, err.message),
    });

    const agent = createAgent({
      model,
      systemPrompt:
        "You are a team lead. Follow instructions exactly.\n" +
        "Only call the tools you are instructed to call.",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });

    await agent.ready;
    agentsToDispose.push(agent);

    // Step 1: Start team with a task
    console.log("[E2E hooks] Starting team...");
    await agent.generate({
      prompt:
        "Call start_team with reason 'hook testing' and initial_tasks containing one task: " +
        'subject "Haiku task", description "Write a haiku about software testing".',
      maxSteps: 3,
    });

    // Step 2: Spawn teammate (separate generate call)
    console.log("[E2E hooks] Spawning teammate...");
    await agent.generate({
      prompt:
        "Call team_spawn with role 'researcher' and initial_prompt " +
        "'Claim the pending task, complete it with a haiku, then message the lead.'",
      maxSteps: 3,
    });

    // Wait for teammate to complete the task
    console.log("[E2E hooks] Waiting for task completion...");
    await waitFor(
      "teammate completes task",
      () => coordinator.listTasks({ status: "completed" }).length >= 1,
      { timeoutMs: 60_000 },
    );

    // Step 3: End the team
    console.log("[E2E hooks] Ending team...");
    await agent.generate({
      prompt: "Call team_read_messages, then call end_team with summary 'hooks test done'.",
      maxSteps: 6,
    });

    console.log(
      "[E2E hooks] Events fired:",
      hookEvents.map((e) => e.event),
    );

    const eventNames = hookEvents.map((e) => e.event);

    expect(eventNames).toContain(TEAM_HOOKS.TeammateSpawned);
    expect(eventNames).toContain(TEAM_HOOKS.TeamTaskClaimed);
    expect(eventNames).toContain(TEAM_HOOKS.TeamTaskCompleted);
    expect(eventNames).toContain(TEAM_HOOKS.TeammateStopped);

    // Verify hook payloads
    const spawnEvent = hookEvents.find((e) => e.event === TEAM_HOOKS.TeammateSpawned);
    expect(spawnEvent?.payload).toHaveProperty("role", "researcher");
    expect(spawnEvent?.payload).toHaveProperty("teammateId");

    const completeEvent = hookEvents.find((e) => e.event === TEAM_HOOKS.TeamTaskCompleted);
    expect(completeEvent?.payload).toHaveProperty("taskId");
    expect(completeEvent?.payload).toHaveProperty("teammateId");
  });

  // ===========================================================================
  // Test 5: Double start_team is rejected
  // ===========================================================================

  it("double start_team returns an error without crashing", { timeout: 60_000 }, async () => {
    const plugin = createAgentTeamsPlugin({
      teammates,
      idleTimeoutMs: 2_000,
      onError: () => {},
    });

    const agent = createAgent({
      model,
      systemPrompt:
        "You are a team lead. When told to start a team, call start_team. " +
        "Report the exact tool result back to the user.",
      plugins: [plugin],
      permissionMode: "bypassPermissions",
    });

    await agent.ready;
    agentsToDispose.push(agent);

    // First start_team should succeed
    const result1 = await agent.generate({
      prompt: "Start a team. Reason: first team.",
      maxSteps: 3,
    });
    expect(result1.status).toBe("complete");
    expect(agent.getActiveTools().end_team).toBeDefined();

    // Second start_team should be rejected
    const result2 = await agent.generate({
      prompt: "Start another team. Reason: second team. Report the exact tool result.",
      maxSteps: 3,
    });
    expect(result2.status).toBe("complete");
    if (result2.status === "complete") {
      expect(result2.text.toLowerCase()).toMatch(/already|active|first/);
    }

    // Original team tools should still be present
    expect(agent.getActiveTools().team_spawn).toBeDefined();

    // Clean up
    await agent.generate({
      prompt: "End the team. Summary: double start test.",
      maxSteps: 3,
    });
  });

  // ===========================================================================
  // Test 6: Bidirectional message coordination
  // ===========================================================================

  it(
    "lead sends message to idle teammate, teammate wakes up and replies",
    { timeout: 120_000 },
    async () => {
      const coordinator = new InMemoryTeamCoordinator();
      const teammateErrors: string[] = [];

      // Architecture note: HeadlessSessionRunner yields `waiting_for_input`
      // before processing the queued initial prompt. The teammate immediately
      // blocks on `coordinator.waitForMessage()`. If the timeout expires,
      // `session.stop()` is called and the teammate processes only ONE
      // generation cycle (the initial prompt) before stopping.
      //
      // To test bidirectional messaging, the lead must send a coordinator
      // message WHILE the teammate is in the first `waitForMessage` call —
      // before the idle timeout. This wakes the teammate, which then
      // processes both the initial prompt AND the lead's injected message
      // in separate generation cycles.

      const plugin = createAgentTeamsPlugin({
        teammates: [
          {
            role: "researcher",
            description: "Researches topics and provides concise summaries",
            agentOptions: {
              systemPrompt:
                "You are a researcher on a team. Follow this workflow exactly:\n" +
                "1. Call team_task_list to see available tasks\n" +
                "2. If there are pending tasks, call team_task_claim to claim one\n" +
                "3. Do the research (you can use your knowledge)\n" +
                "4. Call team_task_complete with your result\n" +
                "5. Call team_message with to='lead' to report your findings\n" +
                "6. Check for more tasks. If none, stop.\n\n" +
                "IMPORTANT: When you receive a message from the lead, respond by calling " +
                "team_message with to='lead' and your answer. Always respond to messages.\n\n" +
                "Be concise. Complete tasks quickly.",
            },
            maxTurns: 20,
          },
        ],
        coordinator,
        // Long timeout — the lead will wake the teammate via sendMessage
        // before this expires. After processing, the second idle period
        // will use this same timeout before the teammate stops.
        idleTimeoutMs: 15_000,
        onError: (id, error) => {
          teammateErrors.push(`${id}: ${error.message}`);
          console.error(`[E2E bidirectional] Teammate error: ${id}:`, error.message);
        },
      });

      const agent = createAgent({
        model,
        systemPrompt:
          "You are a team lead. Follow instructions EXACTLY as given.\n" +
          "Only call the tools you are instructed to call.\n" +
          "Do not add extra tools or steps beyond what is requested.",
        plugins: [plugin],
        permissionMode: "bypassPermissions",
      });

      await agent.ready;
      agentsToDispose.push(agent);

      // Step 1: Start team with a task
      console.log("[E2E bidirectional] Step 1: Starting team...");
      await agent.generate({
        prompt:
          "Call start_team with reason 'Bidirectional messaging test' and initial_tasks " +
          'containing one task: subject "AI Safety", description "Summarize key AI safety concerns in 2-3 sentences".',
        maxSteps: 3,
      });

      expect(coordinator.listTasks().length).toBeGreaterThanOrEqual(1);

      // Step 2: Spawn researcher
      console.log("[E2E bidirectional] Step 2: Spawning teammate...");
      await agent.generate({
        prompt:
          "Call team_spawn with role 'researcher' and initial_prompt " +
          "'Check for tasks. Claim and complete any pending tasks, then message the lead with your results. " +
          "Also respond to any messages from the lead.'",
        maxSteps: 3,
      });

      const mates = coordinator.listTeammates();
      expect(mates.length).toBe(1);
      const teammateId = mates[0].id;
      console.log(`[E2E bidirectional] Teammate spawned: ${teammateId}`);

      // Step 3: Wait for teammate to go idle (happens immediately — the
      // HeadlessSessionRunner blocks on waitForMessage before processing
      // the initial prompt). Then send a message to wake the teammate.
      console.log("[E2E bidirectional] Step 3: Waiting for teammate to go idle...");
      await waitFor(
        "teammate is idle",
        () => {
          const tm = coordinator.getTeammate(teammateId);
          return tm?.status === "idle";
        },
        { timeoutMs: 10_000 },
      );

      // Step 4: Lead sends a message to the teammate. This wakes the
      // teammate's waitForMessage. The teammate then processes:
      //   1) The initial prompt (queued session event — processed first)
      //   2) The lead's message (injected by HeadlessSessionRunner via
      //      session.sendMessage after waitForMessage resolves)
      console.log("[E2E bidirectional] Step 4: Lead sends message to teammate...");
      await agent.generate({
        prompt:
          `Call team_message with to='${teammateId}' and ` +
          "content='After completing the AI Safety task, please also answer: What is the single most important AI safety concern? Reply with a brief answer.'",
        maxSteps: 3,
      });

      // Verify the lead's message was sent
      const msgsForTeammate = coordinator.getMessages(teammateId, false);
      expect(msgsForTeammate.some((m) => m.from === "lead")).toBe(true);
      console.log("[E2E bidirectional] Lead message sent to teammate");

      // Step 5: Wait for the teammate to complete the task (from initial prompt)
      console.log("[E2E bidirectional] Step 5: Waiting for task completion...");
      await waitFor(
        "teammate completes task",
        () => coordinator.listTasks({ status: "completed" }).length >= 1,
        { timeoutMs: 60_000 },
      );
      console.log("[E2E bidirectional] Task completed");

      // Step 6: Wait for at least 2 messages from teammate to lead:
      //   1) Task completion report (from initial prompt processing)
      //   2) Reply to the lead's follow-up question (from injected message)
      console.log("[E2E bidirectional] Step 6: Waiting for teammate replies...");
      await waitFor(
        "teammate sends at least 2 messages to lead",
        () => coordinator.getMessages("lead", false).length >= 2,
        { timeoutMs: 60_000 },
      );

      const allMsgsForLead = coordinator.getMessages("lead", false);
      console.log(
        "[E2E bidirectional] Messages from teammate to lead:",
        allMsgsForLead.map((m) => `[${m.from}]: ${m.content.slice(0, 80)}`),
      );
      expect(allMsgsForLead.length).toBeGreaterThanOrEqual(2);

      // Step 7: Lead reads messages and ends team
      console.log("[E2E bidirectional] Step 7: Ending team...");
      await agent.generate({
        prompt: "Call team_read_messages, then call end_team with a summary of the conversation.",
        maxSteps: 6,
      });

      expect(agent.getActiveTools().team_spawn).toBeUndefined();
      console.log("[E2E bidirectional] Teammate errors:", teammateErrors);
      console.log("[E2E bidirectional] PASSED");
    },
  );
});
