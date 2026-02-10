import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTeamCoordinator } from "../../../src/plugins/agent-teams/coordinator.js";
import { TEAM_HOOKS } from "../../../src/plugins/agent-teams/hooks.js";
import type { HeadlessSessionRunner } from "../../../src/plugins/agent-teams/session-runner.js";
import { createLeadTools, createTeammateTools } from "../../../src/plugins/agent-teams/tools.js";
import type { TeammateDefinition } from "../../../src/plugins/agent-teams/types.js";
import type { Agent } from "../../../src/types.js";

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

describe("Team Tools", () => {
  let coordinator: InMemoryTeamCoordinator;

  beforeEach(() => {
    coordinator = new InMemoryTeamCoordinator();
  });

  afterEach(() => {
    coordinator.dispose();
  });

  // ===========================================================================
  // Lead Tools
  // ===========================================================================

  describe("createLeadTools", () => {
    let runners: Map<string, HeadlessSessionRunner>;
    let agent: Agent;
    let teammates: TeammateDefinition[];
    let spawnTeammate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      runners = new Map();
      agent = createMockAgent();
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
      spawnTeammate = vi.fn().mockResolvedValue("researcher-abc123");
    });

    function getLeadTools() {
      return createLeadTools({
        coordinator,
        runners,
        teammates,
        agent,
        spawnTeammate,
        maxConcurrentTeammates: 3,
      });
    }

    describe("team_spawn", () => {
      it("spawns a teammate successfully", async () => {
        const tools = getLeadTools();
        const result = await tools.team_spawn.execute(
          { role: "researcher", initial_prompt: "Research TypeScript" },
          {} as any,
        );

        expect(spawnTeammate).toHaveBeenCalledWith("researcher", "Research TypeScript");
        expect(result).toContain("researcher-abc123");
        expect(result).toContain("spawned");
      });

      it("rejects unknown role", async () => {
        const tools = getLeadTools();
        const result = await tools.team_spawn.execute(
          { role: "unknown", initial_prompt: "test" },
          {} as any,
        );

        expect(result).toContain("Unknown role");
        expect(spawnTeammate).not.toHaveBeenCalled();
      });

      it("enforces max concurrent limit", async () => {
        // Add 3 running teammates
        runners.set("tm-1", createMockRunner(true));
        runners.set("tm-2", createMockRunner(true));
        runners.set("tm-3", createMockRunner(true));

        const tools = getLeadTools();
        const result = await tools.team_spawn.execute(
          { role: "researcher", initial_prompt: "test" },
          {} as any,
        );

        expect(result).toContain("maximum concurrent");
        expect(spawnTeammate).not.toHaveBeenCalled();
      });

      it("fires TeammateSpawned hook", async () => {
        const hookFn = vi.fn();
        const tools = createLeadTools({
          coordinator,
          runners,
          teammates,
          hooks: {
            Custom: { [TEAM_HOOKS.TeammateSpawned]: [hookFn] },
          },
          agent,
          spawnTeammate,
          maxConcurrentTeammates: 3,
        });

        await tools.team_spawn.execute({ role: "researcher", initial_prompt: "test" }, {} as any);

        expect(hookFn).toHaveBeenCalledTimes(1);
      });
    });

    describe("team_message", () => {
      it("sends a direct message", async () => {
        const tools = getLeadTools();
        const result = await tools.team_message.execute(
          { to: "tm-1", content: "Hello teammate" },
          {} as any,
        );

        expect(result).toContain("Message sent");
        const messages = coordinator.getMessages("tm-1");
        expect(messages).toHaveLength(1);
        expect(messages[0].content).toBe("Hello teammate");
      });

      it("sends a broadcast message", async () => {
        const tools = getLeadTools();
        const result = await tools.team_message.execute(
          { to: null, content: "Team update" },
          {} as any,
        );

        expect(result).toContain("Message sent");
      });

      it("fires TeamMessageSent hook", async () => {
        const hookFn = vi.fn();
        const tools = createLeadTools({
          coordinator,
          runners,
          teammates,
          hooks: {
            Custom: { [TEAM_HOOKS.TeamMessageSent]: [hookFn] },
          },
          agent,
          spawnTeammate,
          maxConcurrentTeammates: 3,
        });

        await tools.team_message.execute({ to: "tm-1", content: "test" }, {} as any);

        expect(hookFn).toHaveBeenCalledTimes(1);
      });
    });

    describe("team_shutdown", () => {
      it("stops a running teammate", async () => {
        const runner = createMockRunner(true);
        runners.set("tm-1", runner);

        const tools = getLeadTools();
        const result = await tools.team_shutdown.execute({ teammate_id: "tm-1" }, {} as any);

        expect(runner.stop).toHaveBeenCalled();
        expect(runners.has("tm-1")).toBe(false);
        expect(result).toContain("stopped");
      });

      it("returns error for unknown teammate", async () => {
        const tools = getLeadTools();
        const result = await tools.team_shutdown.execute({ teammate_id: "nonexistent" }, {} as any);

        expect(result).toContain("not found");
      });
    });

    describe("team_list_teammates", () => {
      it("lists registered teammates", async () => {
        coordinator.registerTeammate({
          id: "tm-1",
          role: "researcher",
          description: "Researches topics",
          status: "working",
          spawnedAt: new Date().toISOString(),
          currentTaskId: "task-1",
        });

        const tools = getLeadTools();
        const result = await tools.team_list_teammates.execute({}, {} as any);

        expect(result).toContain("tm-1");
        expect(result).toContain("researcher");
        expect(result).toContain("working");
        expect(result).toContain("task-1");
      });

      it("returns message when no teammates", async () => {
        const tools = getLeadTools();
        const result = await tools.team_list_teammates.execute({}, {} as any);
        expect(result).toContain("No active");
      });
    });

    describe("team_task_create", () => {
      it("creates a task", async () => {
        const tools = getLeadTools();
        const result = await tools.team_task_create.execute(
          {
            subject: "Research TS",
            description: "Research TypeScript generics",
            blocked_by: undefined,
          },
          {} as any,
        );

        expect(result).toContain("Task created");
        expect(result).toContain("Research TS");

        const tasks = coordinator.listTasks();
        expect(tasks).toHaveLength(1);
        expect(tasks[0].subject).toBe("Research TS");
      });

      it("creates a task with dependencies", async () => {
        const task1 = coordinator.createTask({
          subject: "Prereq",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });

        const tools = getLeadTools();
        await tools.team_task_create.execute(
          {
            subject: "Dependent",
            description: "Depends on prereq",
            blocked_by: [task1.id],
          },
          {} as any,
        );

        const tasks = coordinator.listTasks();
        const dependent = tasks.find((t) => t.subject === "Dependent");
        expect(dependent?.blockedBy).toContain(task1.id);
      });

      it("fires TeamTaskCreated hook", async () => {
        const hookFn = vi.fn();
        const tools = createLeadTools({
          coordinator,
          runners,
          teammates,
          hooks: {
            Custom: { [TEAM_HOOKS.TeamTaskCreated]: [hookFn] },
          },
          agent,
          spawnTeammate,
          maxConcurrentTeammates: 3,
        });

        await tools.team_task_create.execute(
          { subject: "Test", description: "Test task" },
          {} as any,
        );

        expect(hookFn).toHaveBeenCalledTimes(1);
      });
    });

    describe("team_task_list", () => {
      it("lists tasks with status filter", async () => {
        coordinator.createTask({
          subject: "Pending",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });
        const task2 = coordinator.createTask({
          subject: "In Progress",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });
        coordinator.claimTask(task2.id, "tm-1");

        const tools = getLeadTools();
        const pendingResult = await tools.team_task_list.execute(
          { status: "pending", assignee: undefined },
          {} as any,
        );
        expect(pendingResult).toContain("Pending");
        expect(pendingResult).not.toContain("In Progress");
      });

      it("returns message when no tasks", async () => {
        const tools = getLeadTools();
        const result = await tools.team_task_list.execute(
          { status: undefined, assignee: undefined },
          {} as any,
        );
        expect(result).toContain("No tasks");
      });
    });

    describe("team_task_get", () => {
      it("returns task details as JSON", async () => {
        const task = coordinator.createTask({
          subject: "Test Task",
          description: "Detailed description",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });

        const tools = getLeadTools();
        const result = await tools.team_task_get.execute({ task_id: task.id }, {} as any);

        const parsed = JSON.parse(result as string);
        expect(parsed.subject).toBe("Test Task");
        expect(parsed.description).toBe("Detailed description");
      });

      it("returns not found for unknown task", async () => {
        const tools = getLeadTools();
        const result = await tools.team_task_get.execute({ task_id: "nonexistent" }, {} as any);
        expect(result).toContain("not found");
      });
    });

    describe("team_read_messages", () => {
      it("reads unread messages to the lead", async () => {
        coordinator.sendMessage({
          from: "tm-1",
          to: "lead",
          content: "Results ready",
        });

        const tools = getLeadTools();
        const result = await tools.team_read_messages.execute({}, {} as any);

        expect(result).toContain("Results ready");
        expect(result).toContain("tm-1");

        // Messages should now be marked read
        const unread = coordinator.getMessages("lead", true);
        expect(unread).toHaveLength(0);
      });

      it("returns message when no unread messages", async () => {
        const tools = getLeadTools();
        const result = await tools.team_read_messages.execute({}, {} as any);
        expect(result).toContain("No unread");
      });
    });
  });

  // ===========================================================================
  // Teammate Tools
  // ===========================================================================

  describe("createTeammateTools", () => {
    const teammateId = "researcher-1";
    let agent: Agent;

    beforeEach(() => {
      agent = createMockAgent();
    });

    function getTeammateTools() {
      return createTeammateTools({
        teammateId,
        coordinator,
        agentRef: { current: agent },
      });
    }

    describe("team_message", () => {
      it("sends a message from the teammate", async () => {
        const tools = getTeammateTools();
        const result = await tools.team_message.execute(
          { to: "lead", content: "Task done" },
          {} as any,
        );

        expect(result).toContain("Message sent");

        const messages = coordinator.getMessages("lead");
        expect(messages).toHaveLength(1);
        expect(messages[0].from).toBe(teammateId);
        expect(messages[0].content).toBe("Task done");
      });
    });

    describe("team_task_list", () => {
      it("lists available tasks", async () => {
        coordinator.createTask({
          subject: "Available Task",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });

        const tools = getTeammateTools();
        const result = await tools.team_task_list.execute({ status: undefined }, {} as any);

        expect(result).toContain("Available Task");
      });

      it("shows blocked status", async () => {
        const prereq = coordinator.createTask({
          subject: "Prereq",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });

        coordinator.createTask({
          subject: "Blocked Task",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [prereq.id],
        });

        const tools = getTeammateTools();
        const result = await tools.team_task_list.execute({ status: undefined }, {} as any);

        expect(result).toContain("BLOCKED");
      });
    });

    describe("team_task_claim", () => {
      it("claims a pending task", async () => {
        const task = coordinator.createTask({
          subject: "Claim Me",
          description: "Do this work",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });

        const tools = getTeammateTools();
        const result = await tools.team_task_claim.execute({ task_id: task.id }, {} as any);

        expect(result).toContain("Claimed");
        expect(result).toContain("Claim Me");

        const updated = coordinator.getTask(task.id);
        expect(updated?.assignee).toBe(teammateId);
        expect(updated?.status).toBe("in_progress");
      });

      it("updates teammate status on claim", async () => {
        coordinator.registerTeammate({
          id: teammateId,
          role: "researcher",
          description: "Researches topics",
          status: "idle",
          spawnedAt: new Date().toISOString(),
        });

        const task = coordinator.createTask({
          subject: "Task",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });

        const tools = getTeammateTools();
        await tools.team_task_claim.execute({ task_id: task.id }, {} as any);

        const tmInfo = coordinator.getTeammate(teammateId);
        expect(tmInfo?.status).toBe("working");
        expect(tmInfo?.currentTaskId).toBe(task.id);
      });

      it("reports error for already claimed task", async () => {
        const task = coordinator.createTask({
          subject: "Task",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });
        coordinator.claimTask(task.id, "other-tm");

        const tools = getTeammateTools();
        const result = await tools.team_task_claim.execute({ task_id: task.id }, {} as any);

        expect(result).toContain("already claimed");
      });

      it("reports error for blocked task", async () => {
        const prereq = coordinator.createTask({
          subject: "Prereq",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });

        const blocked = coordinator.createTask({
          subject: "Blocked",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [prereq.id],
        });

        const tools = getTeammateTools();
        const result = await tools.team_task_claim.execute({ task_id: blocked.id }, {} as any);

        expect(result).toContain("blocked by");
      });

      it("reports error for unknown task", async () => {
        const tools = getTeammateTools();
        const result = await tools.team_task_claim.execute({ task_id: "nonexistent" }, {} as any);

        expect(result).toContain("not found");
      });

      it("fires TeamTaskClaimed hook", async () => {
        const hookFn = vi.fn();
        const tools = createTeammateTools({
          teammateId,
          coordinator,
          hooks: {
            Custom: { [TEAM_HOOKS.TeamTaskClaimed]: [hookFn] },
          },
          agentRef: { current: agent },
        });

        const task = coordinator.createTask({
          subject: "Task",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });

        await tools.team_task_claim.execute({ task_id: task.id }, {} as any);

        expect(hookFn).toHaveBeenCalledTimes(1);
      });
    });

    describe("team_task_complete", () => {
      it("completes a claimed task", async () => {
        coordinator.registerTeammate({
          id: teammateId,
          role: "researcher",
          description: "Researches topics",
          status: "working",
          spawnedAt: new Date().toISOString(),
        });

        const task = coordinator.createTask({
          subject: "Task",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });
        coordinator.claimTask(task.id, teammateId);

        const tools = getTeammateTools();
        const result = await tools.team_task_complete.execute(
          { task_id: task.id, result: "All done" },
          {} as any,
        );

        expect(result).toContain("completed");
        expect(result).toContain("All done");

        const updated = coordinator.getTask(task.id);
        expect(updated?.status).toBe("completed");
        expect(updated?.result).toBe("All done");
      });

      it("updates teammate status to idle on completion", async () => {
        coordinator.registerTeammate({
          id: teammateId,
          role: "researcher",
          description: "Researches topics",
          status: "working",
          spawnedAt: new Date().toISOString(),
        });

        const task = coordinator.createTask({
          subject: "Task",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });
        coordinator.claimTask(task.id, teammateId);

        const tools = getTeammateTools();
        await tools.team_task_complete.execute({ task_id: task.id, result: "Done" }, {} as any);

        const tmInfo = coordinator.getTeammate(teammateId);
        expect(tmInfo?.status).toBe("idle");
      });

      it("reports error for unknown or already completed task", async () => {
        const tools = getTeammateTools();
        const result = await tools.team_task_complete.execute(
          { task_id: "nonexistent", result: undefined },
          {} as any,
        );

        expect(result).toContain("Cannot complete");
      });

      it("fires TeamTaskCompleted hook", async () => {
        const hookFn = vi.fn();
        const tools = createTeammateTools({
          teammateId,
          coordinator,
          hooks: {
            Custom: { [TEAM_HOOKS.TeamTaskCompleted]: [hookFn] },
          },
          agentRef: { current: agent },
        });

        const task = coordinator.createTask({
          subject: "Task",
          description: "",
          status: "pending",
          createdBy: "lead",
          blockedBy: [],
        });
        coordinator.claimTask(task.id, teammateId);

        await tools.team_task_complete.execute({ task_id: task.id, result: "Done" }, {} as any);

        expect(hookFn).toHaveBeenCalledTimes(1);
      });
    });

    describe("team_read_messages", () => {
      it("reads unread messages for the teammate", async () => {
        coordinator.sendMessage({
          from: "lead",
          to: teammateId,
          content: "Check this out",
        });

        const tools = getTeammateTools();
        const result = await tools.team_read_messages.execute({}, {} as any);

        expect(result).toContain("Check this out");
        expect(result).toContain("lead");

        // Messages should now be marked read
        const unread = coordinator.getMessages(teammateId, true);
        expect(unread).toHaveLength(0);
      });

      it("returns message when no unread messages", async () => {
        const tools = getTeammateTools();
        const result = await tools.team_read_messages.execute({}, {} as any);
        expect(result).toContain("No unread");
      });
    });

    describe("team_list_teammates", () => {
      it("lists all team members", async () => {
        coordinator.registerTeammate({
          id: "tm-1",
          role: "researcher",
          description: "Researches topics",
          status: "working",
          spawnedAt: new Date().toISOString(),
        });
        coordinator.registerTeammate({
          id: "tm-2",
          role: "coder",
          description: "Writes code",
          status: "idle",
          spawnedAt: new Date().toISOString(),
        });

        const tools = getTeammateTools();
        const result = await tools.team_list_teammates.execute({}, {} as any);

        expect(result).toContain("tm-1");
        expect(result).toContain("researcher");
        expect(result).toContain("tm-2");
        expect(result).toContain("coder");
      });
    });
  });
});
