/**
 * Team tools for lead and teammate agents.
 *
 * @packageDocumentation
 */

import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod";
import { invokeCustomHook } from "../../hooks.js";
import type { Agent, ExtendedToolExecutionOptions, HookRegistration } from "../../types.js";
import { TEAM_HOOKS } from "./hooks.js";
import type { HeadlessSessionRunner } from "./session-runner.js";
import type { TeamCoordinator, TeammateDefinition } from "./types.js";

// =============================================================================
// Start Team Tool
// =============================================================================

/**
 * Creates the `start_team` tool that transitions the primary agent into team leader mode.
 *
 * When called, this tool:
 * 1. Creates a team leader agent that extends the primary agent's config with team management tools
 * 2. Calls `handoff(teamLeaderAgent)` to swap the active agent
 *
 * @category Agent Teams
 * @internal
 */
export function createStartTeamTool(options: {
  teammates: TeammateDefinition[];
  coordinator: TeamCoordinator;
  hooks?: HookRegistration;
  maxConcurrentTeammates?: number;
  createLeaderAgent: (
    reason: string,
    initialTasks?: Array<{ subject: string; description: string; blocked_by?: string[] }>,
  ) => Agent;
}) {
  return tool({
    description:
      "Start a team of specialized agents to work on a complex task in parallel. " +
      "Use this when the task benefits from multiple agents working concurrently.",
    inputSchema: z.object({
      reason: z.string().describe("Why a team is needed for this task"),
      initial_tasks: z
        .array(
          z.object({
            subject: z.string().describe("Brief task title"),
            description: z.string().describe("Detailed task description"),
            blocked_by: z.array(z.string()).optional().describe("Task subjects this depends on"),
          }),
        )
        .optional()
        .describe("Initial tasks to create for the team"),
    }),
    execute: async ({ reason, initial_tasks }, execOptions) => {
      const extOpts = execOptions as ExtendedToolExecutionOptions;

      // Create the team leader agent
      const leaderAgent = options.createLeaderAgent(reason, initial_tasks);

      // Build context message for the leader
      let context = `Team mode activated. Reason: ${reason}\n`;
      context += `Available teammate roles: ${options.teammates.map((t) => `${t.role} (${t.description})`).join(", ")}\n`;

      if (initial_tasks && initial_tasks.length > 0) {
        context += `\nInitial tasks have been created:\n`;
        for (const task of initial_tasks) {
          context += `- ${task.subject}: ${task.description}\n`;
        }
      }

      // Hand off to the team leader
      extOpts.handoff(leaderAgent, {
        context,
        resumable: true,
      });
    },
  });
}

// =============================================================================
// End Team Tool
// =============================================================================

/**
 * Creates the `end_team` tool that shuts down the team and hands back.
 *
 * @category Agent Teams
 * @internal
 */
export function createEndTeamTool(options: {
  coordinator: TeamCoordinator;
  runners: Map<string, HeadlessSessionRunner>;
  hooks?: HookRegistration;
  agent: Agent;
}) {
  return tool({
    description:
      "End the team session. Shuts down all active teammates and hands back to the primary agent. " +
      "Call this when all team work is complete.",
    inputSchema: z.object({
      summary: z.string().describe("Summary of team results to pass back to the primary agent"),
    }),
    execute: async ({ summary }, execOptions) => {
      const extOpts = execOptions as ExtendedToolExecutionOptions;

      // Stop all active teammates
      for (const [id, runner] of options.runners) {
        if (runner.isRunning()) {
          runner.stop();
        }
        await invokeCustomHook(
          options.hooks,
          TEAM_HOOKS.TeammateStopped,
          { teammateId: id },
          options.agent,
        );
      }
      options.runners.clear();

      // Dispose the coordinator
      options.coordinator.dispose();

      // Hand back to the primary agent
      extOpts.handback({ context: summary });
    },
  });
}

// =============================================================================
// Lead Tools
// =============================================================================

/**
 * Creates the full set of team management tools available to the team leader.
 *
 * @category Agent Teams
 * @internal
 */
export function createLeadTools(options: {
  coordinator: TeamCoordinator;
  runners: Map<string, HeadlessSessionRunner>;
  teammates: TeammateDefinition[];
  hooks?: HookRegistration;
  agent: Agent;
  spawnTeammate: (role: string, initialPrompt: string) => Promise<string>;
  maxConcurrentTeammates: number;
}): ToolSet {
  const { coordinator, runners, hooks, agent } = options;

  return {
    team_spawn: tool({
      description: "Spawn a teammate by role to work on tasks.",
      inputSchema: z.object({
        role: z.string().describe("The role of the teammate to spawn"),
        initial_prompt: z.string().describe("Initial instructions for the teammate"),
      }),
      execute: async ({ role, initial_prompt }) => {
        const activeCount = Array.from(runners.values()).filter((r) => r.isRunning()).length;
        if (activeCount >= options.maxConcurrentTeammates) {
          return `Cannot spawn: maximum concurrent teammates (${options.maxConcurrentTeammates}) reached`;
        }

        const def = options.teammates.find((t) => t.role === role);
        if (!def) {
          return `Unknown role "${role}". Available roles: ${options.teammates.map((t) => t.role).join(", ")}`;
        }

        const teammateId = await options.spawnTeammate(role, initial_prompt);

        await invokeCustomHook(hooks, TEAM_HOOKS.TeammateSpawned, { teammateId, role }, agent);

        return `Teammate "${teammateId}" (${role}) spawned and working.`;
      },
    }),

    team_message: tool({
      description: "Send a message to a specific teammate or broadcast to all teammates.",
      inputSchema: z.object({
        to: z.string().nullable().describe("Teammate ID to send to, or null for broadcast"),
        content: z.string().describe("Message content"),
      }),
      execute: async ({ to, content }) => {
        const msg = coordinator.sendMessage({
          from: "lead",
          to,
          content,
        });

        await invokeCustomHook(
          hooks,
          TEAM_HOOKS.TeamMessageSent,
          { messageId: msg.id, from: "lead", to, content },
          agent,
        );

        return `Message sent (${msg.id})`;
      },
    }),

    team_shutdown: tool({
      description: "Stop a specific teammate.",
      inputSchema: z.object({
        teammate_id: z.string().describe("ID of the teammate to stop"),
      }),
      execute: async ({ teammate_id }) => {
        const runner = runners.get(teammate_id);
        if (!runner) {
          return `Teammate "${teammate_id}" not found`;
        }

        runner.stop();
        runners.delete(teammate_id);

        await invokeCustomHook(
          hooks,
          TEAM_HOOKS.TeammateStopped,
          { teammateId: teammate_id },
          agent,
        );

        return `Teammate "${teammate_id}" stopped`;
      },
    }),

    team_list_teammates: tool({
      description: "List all teammates and their current status.",
      inputSchema: z.object({}),
      execute: async () => {
        const teammates = coordinator.listTeammates();
        if (teammates.length === 0) {
          return "No active teammates";
        }
        return teammates
          .map(
            (t) =>
              `${t.id} (${t.role}): ${t.status}${t.currentTaskId ? ` [task: ${t.currentTaskId}]` : ""}`,
          )
          .join("\n");
      },
    }),

    team_task_create: tool({
      description: "Create a new task for the team.",
      inputSchema: z.object({
        subject: z.string().describe("Brief task title"),
        description: z.string().describe("Detailed task description"),
        blocked_by: z
          .array(z.string())
          .optional()
          .describe("Task IDs that must complete before this task can start"),
      }),
      execute: async ({ subject, description, blocked_by }) => {
        const task = coordinator.createTask({
          subject,
          description,
          status: "pending",
          createdBy: "lead",
          blockedBy: blocked_by ?? [],
        });

        await invokeCustomHook(
          hooks,
          TEAM_HOOKS.TeamTaskCreated,
          { taskId: task.id, subject, createdBy: "lead" },
          agent,
        );

        return `Task created: ${task.id} - ${subject}`;
      },
    }),

    team_task_list: tool({
      description: "List all team tasks with optional filters.",
      inputSchema: z.object({
        status: z
          .enum(["pending", "in_progress", "completed"])
          .optional()
          .describe("Filter by status"),
        assignee: z.string().optional().describe("Filter by assignee teammate ID"),
      }),
      execute: async ({ status, assignee }) => {
        const tasks = coordinator.listTasks({ status, assignee });
        if (tasks.length === 0) {
          return "No tasks found";
        }
        return tasks
          .map(
            (t) =>
              `${t.id}: [${t.status}] ${t.subject}${t.assignee ? ` (assigned: ${t.assignee})` : ""}${t.blockedBy.length > 0 ? ` [blocked by: ${t.blockedBy.join(", ")}]` : ""}`,
          )
          .join("\n");
      },
    }),

    team_task_get: tool({
      description: "Get detailed information about a specific task.",
      inputSchema: z.object({
        task_id: z.string().describe("Task ID to look up"),
      }),
      execute: async ({ task_id }) => {
        const task = coordinator.getTask(task_id);
        if (!task) {
          return `Task "${task_id}" not found`;
        }
        return JSON.stringify(task, null, 2);
      },
    }),

    team_read_messages: tool({
      description: "Read unread messages sent to the lead.",
      inputSchema: z.object({}),
      execute: async () => {
        const messages = coordinator.getMessages("lead", true);
        if (messages.length === 0) {
          return "No unread messages";
        }

        // Mark all as read
        for (const msg of messages) {
          coordinator.markRead(msg.id);
        }

        return messages.map((m) => `[${m.from}]: ${m.content}`).join("\n");
      },
    }),

    end_team: createEndTeamTool({
      coordinator,
      runners,
      hooks,
      agent,
    }),
  };
}

// =============================================================================
// Teammate Tools
// =============================================================================

/**
 * Creates tools available to teammates for task management and communication.
 *
 * @category Agent Teams
 * @internal
 */
export function createTeammateTools(options: {
  teammateId: string;
  coordinator: TeamCoordinator;
  hooks?: HookRegistration;
  agent: Agent;
}): ToolSet {
  const { teammateId, coordinator, hooks, agent } = options;

  return {
    team_message: tool({
      description: "Send a message to the lead or another teammate.",
      inputSchema: z.object({
        to: z
          .string()
          .nullable()
          .describe("Recipient ID ('lead' or teammate ID, null for broadcast)"),
        content: z.string().describe("Message content"),
      }),
      execute: async ({ to, content }) => {
        const msg = coordinator.sendMessage({
          from: teammateId,
          to,
          content,
        });

        await invokeCustomHook(
          hooks,
          TEAM_HOOKS.TeamMessageSent,
          { messageId: msg.id, from: teammateId, to, content },
          agent,
        );

        return `Message sent (${msg.id})`;
      },
    }),

    team_list_teammates: tool({
      description: "List all team members and their status.",
      inputSchema: z.object({}),
      execute: async () => {
        const teammates = coordinator.listTeammates();
        if (teammates.length === 0) {
          return "No active teammates";
        }
        return teammates
          .map(
            (t) =>
              `${t.id} (${t.role}): ${t.status}${t.currentTaskId ? ` [task: ${t.currentTaskId}]` : ""}`,
          )
          .join("\n");
      },
    }),

    team_task_list: tool({
      description: "List available tasks.",
      inputSchema: z.object({
        status: z
          .enum(["pending", "in_progress", "completed"])
          .optional()
          .describe("Filter by status"),
      }),
      execute: async ({ status }) => {
        const tasks = coordinator.listTasks({ status });
        if (tasks.length === 0) {
          return "No tasks found";
        }
        return tasks
          .map(
            (t) =>
              `${t.id}: [${t.status}] ${t.subject}${t.assignee ? ` (${t.assignee})` : ""}${coordinator.isTaskBlocked(t.id) ? " [BLOCKED]" : ""}`,
          )
          .join("\n");
      },
    }),

    team_task_claim: tool({
      description: "Claim a pending unblocked task to work on.",
      inputSchema: z.object({
        task_id: z.string().describe("ID of the task to claim"),
      }),
      execute: async ({ task_id }) => {
        const claimed = coordinator.claimTask(task_id, teammateId);
        if (!claimed) {
          const task = coordinator.getTask(task_id);
          if (!task) return `Task "${task_id}" not found`;
          if (task.assignee) return `Task "${task_id}" is already claimed by ${task.assignee}`;
          if (coordinator.isTaskBlocked(task_id))
            return `Task "${task_id}" is blocked by: ${task.blockedBy.join(", ")}`;
          return `Cannot claim task "${task_id}"`;
        }

        coordinator.updateTeammateStatus(teammateId, "working", task_id);

        await invokeCustomHook(
          hooks,
          TEAM_HOOKS.TeamTaskClaimed,
          { taskId: task_id, teammateId },
          agent,
        );

        const task = coordinator.getTask(task_id);
        return `Claimed task ${task_id}: ${task?.subject}\nDescription: ${task?.description}`;
      },
    }),

    team_task_complete: tool({
      description: "Mark a claimed task as completed with results.",
      inputSchema: z.object({
        task_id: z.string().describe("ID of the task to complete"),
        result: z.string().optional().describe("Result or output of the completed task"),
      }),
      execute: async ({ task_id, result }) => {
        const completed = coordinator.completeTask(task_id, result);
        if (!completed) {
          return `Cannot complete task "${task_id}" - may not exist or already completed`;
        }

        coordinator.updateTeammateStatus(teammateId, "idle");

        await invokeCustomHook(
          hooks,
          TEAM_HOOKS.TeamTaskCompleted,
          { taskId: task_id, teammateId, result },
          agent,
        );

        return `Task ${task_id} completed${result ? `: ${result}` : ""}`;
      },
    }),

    team_read_messages: tool({
      description: "Read unread messages.",
      inputSchema: z.object({}),
      execute: async () => {
        const messages = coordinator.getMessages(teammateId, true);
        if (messages.length === 0) {
          return "No unread messages";
        }

        for (const msg of messages) {
          coordinator.markRead(msg.id);
        }

        return messages.map((m) => `[${m.from}]: ${m.content}`).join("\n");
      },
    }),
  };
}
