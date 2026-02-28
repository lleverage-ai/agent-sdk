import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTeamCoordinator } from "../../../src/plugins/agent-teams/coordinator.js";
import { TEAM_HOOKS } from "../../../src/plugins/agent-teams/hooks.js";
import type { HeadlessSessionRunner } from "../../../src/plugins/agent-teams/session-runner.js";
import { createLeadTools, createTeammateTools } from "../../../src/plugins/agent-teams/tools.js";
import type { TeammateDefinition } from "../../../src/plugins/agent-teams/types.js";
import type { Agent, HookRegistration } from "../../../src/types.js";

function createMockAgent(): Agent {
  return {
    generate: vi.fn(),
    resume: vi.fn(),
    options: { model: {} as any },
    addRuntimeTools: vi.fn(),
    removeRuntimeTools: vi.fn(),
  } as unknown as Agent;
}

function createMockRunner(running = true): HeadlessSessionRunner {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    sendMessage: vi.fn(),
    isRunning: vi.fn().mockReturnValue(running),
  } as unknown as HeadlessSessionRunner;
}

describe("Observability Hook Capture", () => {
  let coordinator: InMemoryTeamCoordinator;
  let agent: Agent;
  let runners: Map<string, HeadlessSessionRunner>;
  let teammates: TeammateDefinition[];

  beforeEach(() => {
    coordinator = new InMemoryTeamCoordinator();
    agent = createMockAgent();
    runners = new Map();
    teammates = [
      {
        role: "researcher",
        description: "Researches topics",
        agentOptions: { systemPrompt: "Research" },
      },
      {
        role: "coder",
        description: "Writes code",
        agentOptions: { systemPrompt: "Code" },
      },
    ];
  });

  afterEach(() => {
    coordinator.dispose();
  });

  it("team_spawn fires TeammateSpawned with correct payload", async () => {
    const payloads: Record<string, unknown>[] = [];
    const hooks: HookRegistration = {
      Custom: {
        [TEAM_HOOKS.TeammateSpawned]: [
          (input) => {
            payloads.push((input as any).payload);
          },
        ],
      },
    };

    const spawnTeammate = vi.fn().mockResolvedValue("researcher-abc");
    const tools = createLeadTools({
      coordinator,
      runners,
      teammates,
      hooks,
      agent,
      spawnTeammate,
      maxConcurrentTeammates: 5,
    });

    await tools.team_spawn.execute(
      { role: "researcher", initial_prompt: "Start researching" },
      {} as any,
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      teammateId: "researcher-abc",
      role: "researcher",
    });
  });

  it("team_task_create fires TeamTaskCreated with correct payload", async () => {
    const payloads: Record<string, unknown>[] = [];
    const hooks: HookRegistration = {
      Custom: {
        [TEAM_HOOKS.TeamTaskCreated]: [
          (input) => {
            payloads.push((input as any).payload);
          },
        ],
      },
    };

    const tools = createLeadTools({
      coordinator,
      runners,
      teammates,
      hooks,
      agent,
      spawnTeammate: vi.fn(),
      maxConcurrentTeammates: 5,
    });

    await tools.team_task_create.execute(
      { subject: "Write docs", description: "Write API docs" },
      {} as any,
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      taskId: "task-1",
      subject: "Write docs",
      createdBy: "lead",
    });
  });

  it("team_task_claim fires TeamTaskClaimed with correct payload", async () => {
    const payloads: Record<string, unknown>[] = [];
    const hooks: HookRegistration = {
      Custom: {
        [TEAM_HOOKS.TeamTaskClaimed]: [
          (input) => {
            payloads.push((input as any).payload);
          },
        ],
      },
    };

    const task = coordinator.createTask({
      subject: "Test task",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [],
    });

    const teammateId = "researcher-1";
    const tools = createTeammateTools({
      teammateId,
      coordinator,
      hooks,
      agentRef: { current: agent },
    });

    await tools.team_task_claim.execute({ task_id: task.id }, {} as any);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      taskId: task.id,
      teammateId: "researcher-1",
    });
  });

  it("team_task_complete fires TeamTaskCompleted with correct payload", async () => {
    const payloads: Record<string, unknown>[] = [];
    const hooks: HookRegistration = {
      Custom: {
        [TEAM_HOOKS.TeamTaskCompleted]: [
          (input) => {
            payloads.push((input as any).payload);
          },
        ],
      },
    };

    const task = coordinator.createTask({
      subject: "Test task",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [],
    });
    const teammateId = "coder-1";
    coordinator.claimTask(task.id, teammateId);

    const tools = createTeammateTools({
      teammateId,
      coordinator,
      hooks,
      agentRef: { current: agent },
    });

    await tools.team_task_complete.execute({ task_id: task.id, result: "Code written" }, {} as any);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      taskId: task.id,
      teammateId: "coder-1",
      result: "Code written",
    });
  });

  it("team_message fires TeamMessageSent with correct payload (lead)", async () => {
    const payloads: Record<string, unknown>[] = [];
    const hooks: HookRegistration = {
      Custom: {
        [TEAM_HOOKS.TeamMessageSent]: [
          (input) => {
            payloads.push((input as any).payload);
          },
        ],
      },
    };

    const tools = createLeadTools({
      coordinator,
      runners,
      teammates,
      hooks,
      agent,
      spawnTeammate: vi.fn(),
      maxConcurrentTeammates: 5,
    });

    await tools.team_message.execute(
      { to: "researcher-1", content: "How is progress?" },
      {} as any,
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      from: "lead",
      to: "researcher-1",
      content: "How is progress?",
    });
    expect(payloads[0].messageId).toBeDefined();
  });

  it("team_message fires TeamMessageSent with correct payload (teammate)", async () => {
    const payloads: Record<string, unknown>[] = [];
    const hooks: HookRegistration = {
      Custom: {
        [TEAM_HOOKS.TeamMessageSent]: [
          (input) => {
            payloads.push((input as any).payload);
          },
        ],
      },
    };

    const tools = createTeammateTools({
      teammateId: "coder-1",
      coordinator,
      hooks,
      agentRef: { current: agent },
    });

    await tools.team_message.execute({ to: "lead", content: "Task done" }, {} as any);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      from: "coder-1",
      to: "lead",
      content: "Task done",
    });
  });

  it("team_shutdown fires TeammateStopped with correct payload", async () => {
    const payloads: Record<string, unknown>[] = [];
    const hooks: HookRegistration = {
      Custom: {
        [TEAM_HOOKS.TeammateStopped]: [
          (input) => {
            payloads.push((input as any).payload);
          },
        ],
      },
    };

    const runner = createMockRunner(true);
    runners.set("researcher-1", runner);

    const tools = createLeadTools({
      coordinator,
      runners,
      teammates,
      hooks,
      agent,
      spawnTeammate: vi.fn(),
      maxConcurrentTeammates: 5,
    });

    await tools.team_shutdown.execute({ teammate_id: "researcher-1" }, {} as any);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({ teammateId: "researcher-1" });
  });

  it("full lifecycle captures all events in order", async () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];

    const hooks: HookRegistration = {
      Custom: Object.fromEntries(
        Object.values(TEAM_HOOKS).map((eventName) => [
          eventName,
          [
            (input: any) => {
              events.push({
                event: eventName,
                payload: input.payload,
              });
            },
          ],
        ]),
      ),
    };

    const spawnTeammate = vi.fn().mockResolvedValue("researcher-1");

    const leadTools = createLeadTools({
      coordinator,
      runners,
      teammates,
      hooks,
      agent,
      spawnTeammate,
      maxConcurrentTeammates: 5,
    });

    // 1. Create task
    await leadTools.team_task_create.execute(
      { subject: "Research TS", description: "Research TypeScript" },
      {} as any,
    );

    // 2. Spawn teammate
    await leadTools.team_spawn.execute({ role: "researcher", initial_prompt: "Start" }, {} as any);

    // 3. Teammate claims task
    const teammateTools = createTeammateTools({
      teammateId: "researcher-1",
      coordinator,
      hooks,
      agentRef: { current: agent },
    });

    await teammateTools.team_task_claim.execute({ task_id: "task-1" }, {} as any);

    // 4. Teammate completes task
    await teammateTools.team_task_complete.execute(
      { task_id: "task-1", result: "Research done" },
      {} as any,
    );

    // 5. Teammate sends message
    await teammateTools.team_message.execute({ to: "lead", content: "All done!" }, {} as any);

    // 6. Lead shuts down teammate
    runners.set("researcher-1", createMockRunner(true));
    await leadTools.team_shutdown.execute({ teammate_id: "researcher-1" }, {} as any);

    // Verify all event types were captured
    const eventNames = events.map((e) => e.event);
    expect(eventNames).toContain(TEAM_HOOKS.TeamTaskCreated);
    expect(eventNames).toContain(TEAM_HOOKS.TeammateSpawned);
    expect(eventNames).toContain(TEAM_HOOKS.TeamTaskClaimed);
    expect(eventNames).toContain(TEAM_HOOKS.TeamTaskCompleted);
    expect(eventNames).toContain(TEAM_HOOKS.TeamMessageSent);
    expect(eventNames).toContain(TEAM_HOOKS.TeammateStopped);

    // Verify order: create → spawn → claim → complete → message → shutdown
    expect(eventNames.indexOf(TEAM_HOOKS.TeamTaskCreated)).toBeLessThan(
      eventNames.indexOf(TEAM_HOOKS.TeammateSpawned),
    );
    expect(eventNames.indexOf(TEAM_HOOKS.TeammateSpawned)).toBeLessThan(
      eventNames.indexOf(TEAM_HOOKS.TeamTaskClaimed),
    );
    expect(eventNames.indexOf(TEAM_HOOKS.TeamTaskClaimed)).toBeLessThan(
      eventNames.indexOf(TEAM_HOOKS.TeamTaskCompleted),
    );
    expect(eventNames.indexOf(TEAM_HOOKS.TeamTaskCompleted)).toBeLessThan(
      eventNames.indexOf(TEAM_HOOKS.TeamMessageSent),
    );
    expect(eventNames.indexOf(TEAM_HOOKS.TeamMessageSent)).toBeLessThan(
      eventNames.indexOf(TEAM_HOOKS.TeammateStopped),
    );

    // Verify total event count
    expect(events).toHaveLength(6);
  });
});
