/**
 * Team task tools for interacting with the shared task queue.
 *
 * Available to any agent in a team. Provides claim, complete, fail, and list operations.
 *
 * @packageDocumentation
 */

import { tool } from "ai";
import { z } from "zod";
import type { HookRegistration, Tracer } from "@lleverage-ai/agent-sdk";
import type { SharedTaskQueue } from "../task-queue/types.js";
import { fireTeamHook } from "../hooks/invoke.js";
import { TeamSemanticAttributes } from "../observability/semantic-attributes.js";

export interface TeamTaskToolOptions {
  /** This agent's ID */
  agentId: string;
  /** Shared task queue instance */
  taskQueue: SharedTaskQueue;
  /** Optional hook registrations for firing team events */
  hooks?: HookRegistration;
  /** Optional tracer for creating spans */
  tracer?: Tracer;
  /** Optional session ID for hook context */
  sessionId?: string;
}

/** Create team task tools for an agent. */
export function createTeamTaskTool(options: TeamTaskToolOptions) {
  const { agentId, taskQueue, hooks, tracer, sessionId } = options;

  return {
    team_list_tasks: tool({
      description: "List all tasks in the shared team task queue with their current status.",
      inputSchema: z.object({
        status: z
          .enum(["pending", "blocked", "claimed", "completed", "failed"])
          .optional()
          .describe("Filter by status. Omit to list all tasks."),
      }),
      execute: async (params: { status?: "pending" | "blocked" | "claimed" | "completed" | "failed" }) => {
        const tasks = params.status
          ? await taskQueue.byStatus(params.status)
          : await taskQueue.list();
        if (tasks.length === 0) {
          return params.status ? `No ${params.status} tasks` : "No tasks in queue";
        }
        return tasks
          .map(
            (t) =>
              `[${t.id.slice(0, 8)}] ${t.title} (${t.status}${t.assignee ? `, assigned: ${t.assignee}` : ""})${t.dependencies.length > 0 ? ` [deps: ${t.dependencies.map((d) => d.slice(0, 8)).join(", ")}]` : ""}`,
          )
          .join("\n");
      },
    }),

    team_claim_task: tool({
      description:
        "Claim a specific pending task from the queue, or claim the next available task if no ID provided.",
      inputSchema: z.object({
        taskId: z
          .string()
          .optional()
          .describe("Task ID to claim. If omitted, claims the next available pending task."),
      }),
      execute: async (params: { taskId?: string }) => {
        const fn = async () => {
          const task = params.taskId
            ? await taskQueue.claim(params.taskId, agentId)
            : await taskQueue.claimNext(agentId);
          if (!task) {
            return params.taskId
              ? `Could not claim task ${params.taskId} — it may already be claimed or not exist`
              : "No pending tasks available to claim";
          }
          await fireTeamHook(hooks, "TeamTaskAssigned", {
            taskId: task.id,
            taskTitle: task.title,
            agentId,
          }, sessionId);
          return `Claimed task [${task.id.slice(0, 8)}]: ${task.title}\n\nDescription: ${task.description}`;
        };

        if (tracer?.enabled) {
          return tracer.withSpan("team.task_lifecycle", async (span) => {
            span.setAttribute(TeamSemanticAttributes.TEAM_AGENT_ID, agentId);
            if (params.taskId) {
              span.setAttribute(TeamSemanticAttributes.TEAM_TASK_ID, params.taskId);
            }
            return fn();
          });
        }
        return fn();
      },
    }),

    team_complete_task: tool({
      description: "Mark a claimed task as completed with optional result data.",
      inputSchema: z.object({
        taskId: z.string().describe("Task ID to complete"),
        result: z
          .string()
          .optional()
          .describe("Result summary or data from completing the task"),
      }),
      execute: async (params: { taskId: string; result?: string }) => {
        const fn = async () => {
          const task = await taskQueue.complete(params.taskId, agentId, params.result);
          if (!task) {
            return `Could not complete task ${params.taskId} — it may not be claimed by you`;
          }
          await fireTeamHook(hooks, "TeamTaskCompleted", {
            taskId: task.id,
            taskTitle: task.title,
            agentId,
            result: params.result,
          }, sessionId);
          return `Task [${task.id.slice(0, 8)}] marked as completed`;
        };

        if (tracer?.enabled) {
          return tracer.withSpan("team.task_lifecycle", async (span) => {
            span.setAttribute(TeamSemanticAttributes.TEAM_TASK_ID, params.taskId);
            span.setAttribute(TeamSemanticAttributes.TEAM_TASK_STATUS, "completed");
            span.setAttribute(TeamSemanticAttributes.TEAM_AGENT_ID, agentId);
            return fn();
          });
        }
        return fn();
      },
    }),

    team_fail_task: tool({
      description: "Mark a claimed task as failed with an error description.",
      inputSchema: z.object({
        taskId: z.string().describe("Task ID to mark as failed"),
        error: z.string().describe("Description of what went wrong"),
      }),
      execute: async (params: { taskId: string; error: string }) => {
        const fn = async () => {
          const task = await taskQueue.fail(params.taskId, agentId, params.error);
          if (!task) {
            return `Could not fail task ${params.taskId} — it may not be claimed by you`;
          }
          await fireTeamHook(hooks, "TeamTaskFailed", {
            taskId: task.id,
            taskTitle: task.title,
            agentId,
            error: params.error,
          }, sessionId);
          return `Task [${task.id.slice(0, 8)}] marked as failed: ${params.error}`;
        };

        if (tracer?.enabled) {
          return tracer.withSpan("team.task_lifecycle", async (span) => {
            span.setAttribute(TeamSemanticAttributes.TEAM_TASK_ID, params.taskId);
            span.setAttribute(TeamSemanticAttributes.TEAM_TASK_STATUS, "failed");
            span.setAttribute(TeamSemanticAttributes.TEAM_AGENT_ID, agentId);
            return fn();
          });
        }
        return fn();
      },
    }),
  };
}
