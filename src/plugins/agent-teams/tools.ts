/**
 * Team tools for lead and teammate agents.
 *
 * @packageDocumentation
 */

import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod";
import { invokeCustomHook } from "../../hooks.js";
import type { Agent, HookRegistration } from "../../types.js";
import { TEAM_HOOKS } from "./hooks.js";
import type { HeadlessSessionRunner } from "./session-runner.js";
import type { AgentRef, TeamCoordinator, TeammateDefinition } from "./types.js";

/**
 * Resolve the agent from an AgentRef, throwing a descriptive error if unset.
 * Used by teammate tools where the agent is created after tools are defined.
 */
function resolveAgent(agentRef: AgentRef): Agent {
  if (!agentRef.current) {
    throw new Error(
      "Agent reference is not set. This is a bug in agent-teams plugin initialization.",
    );
  }
  return agentRef.current;
}

// =============================================================================
// Lead Tools
// =============================================================================

/**
 * Creates the team management tools available to the team leader.
 *
 * These tools are dynamically added to the primary agent via
 * `addRuntimeTools()` when `start_team` is called, and removed
 * when `end_team` is called.
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
  agentRef: AgentRef;
}): ToolSet {
  const { teammateId, coordinator, hooks, agentRef } = options;

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
          resolveAgent(agentRef),
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
          resolveAgent(agentRef),
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
          resolveAgent(agentRef),
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
