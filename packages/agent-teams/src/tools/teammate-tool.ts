/**
 * Lead-only tools for managing teammates.
 *
 * Provides tools for the lead agent to create tasks, send messages,
 * broadcast, trigger shutdown, and manage plans.
 *
 * @packageDocumentation
 */

import { tool } from "ai";
import { z } from "zod";
import type { HookRegistration, Tracer } from "@lleverage-ai/agent-sdk";
import type { Mailbox } from "../mailbox/types.js";
import type { SharedTaskQueue } from "../task-queue/types.js";
import type { Transport } from "../transport/types.js";
import { broadcastShutdown, requestShutdown } from "../protocols/shutdown.js";
import { approvePlan, rejectPlan } from "../protocols/plan-approval.js";
import { fireTeamHook } from "../hooks/invoke.js";
import { TeamSemanticAttributes } from "../observability/semantic-attributes.js";

export interface TeammateToolOptions {
  /** Lead agent's ID */
  agentId: string;
  /** Mailbox instance */
  mailbox: Mailbox;
  /** Shared task queue instance */
  taskQueue: SharedTaskQueue;
  /** Transport for reading/writing plan files */
  transport: Transport;
  /** Path to the plans directory */
  plansDir: string;
  /** IDs of all teammate agents (excluding lead) */
  teammateIds: string[];
  /** Optional hook registrations for firing team events */
  hooks?: HookRegistration;
  /** Optional tracer for creating spans */
  tracer?: Tracer;
  /** Optional session ID for hook context */
  sessionId?: string;
}

const taskInputSchema = z.object({
  title: z.string().describe("Short task title"),
  description: z.string().describe("Detailed instructions for the task"),
  dependencies: z
    .array(z.string())
    .optional()
    .describe("Task IDs that must complete before this task can start"),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Arbitrary metadata"),
});

/** Create lead-only tools for managing teammates. */
export function createTeammateTool(options: TeammateToolOptions) {
  const { agentId, mailbox, taskQueue, transport, plansDir, teammateIds, hooks, tracer, sessionId } = options;

  return {
    team_create_tasks: tool({
      description:
        "Create one or more tasks in the shared task queue for teammates to claim and execute.",
      inputSchema: z.object({
        tasks: z.array(taskInputSchema),
      }),
      execute: async (params: {
        tasks: Array<{
          title: string;
          description: string;
          dependencies?: string[];
          metadata?: Record<string, unknown>;
        }>;
      }) => {
        const fn = async () => {
          const created = await taskQueue.createMany(
            params.tasks.map((t) => ({
              title: t.title,
              description: t.description,
              dependencies: t.dependencies ?? [],
              metadata: t.metadata,
            })),
          );

          for (const task of created) {
            await fireTeamHook(hooks, "TeamTaskCreated", {
              taskId: task.id,
              taskTitle: task.title,
              taskStatus: task.status,
            }, sessionId);
          }

          return created
            .map((t) => `Created task [${t.id.slice(0, 8)}]: ${t.title} (${t.status})`)
            .join("\n");
        };

        if (tracer?.enabled) {
          return tracer.withSpan("team.create_tasks", async (span) => {
            span.setAttribute(TeamSemanticAttributes.TEAM_TASK_COUNT, params.tasks.length);
            span.setAttribute(TeamSemanticAttributes.TEAM_AGENT_ID, agentId);
            return fn();
          });
        }
        return fn();
      },
    }),

    team_shutdown_teammate: tool({
      description: "Request a specific teammate to shut down cooperatively.",
      inputSchema: z.object({
        targetAgentId: z.string().describe("Agent ID of the teammate to shut down"),
        reason: z.string().optional().describe("Reason for shutdown"),
      }),
      execute: async (params: { targetAgentId: string; reason?: string }) => {
        const fn = async () => {
          await requestShutdown(mailbox, agentId, params.targetAgentId, params.reason);
          await fireTeamHook(hooks, "TeamShutdownRequested", {
            targetAgentId: params.targetAgentId,
            reason: params.reason,
          }, sessionId);
          return `Shutdown request sent to ${params.targetAgentId}`;
        };

        if (tracer?.enabled) {
          return tracer.withSpan("team.shutdown", async (span) => {
            span.setAttribute(TeamSemanticAttributes.TEAM_AGENT_ID, params.targetAgentId);
            return fn();
          });
        }
        return fn();
      },
    }),

    team_shutdown_all: tool({
      description: "Broadcast a shutdown request to all teammates.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Reason for shutdown"),
      }),
      execute: async (params: { reason?: string }) => {
        const fn = async () => {
          await broadcastShutdown(mailbox, agentId, params.reason);
          await fireTeamHook(hooks, "TeamShutdownRequested", {
            targetAgentId: "__all__",
            reason: params.reason,
          }, sessionId);
          return `Shutdown broadcast sent to all teammates: ${teammateIds.join(", ")}`;
        };

        if (tracer?.enabled) {
          return tracer.withSpan("team.shutdown", async (span) => {
            span.setAttribute(TeamSemanticAttributes.TEAM_AGENT_ID, "__all__");
            return fn();
          });
        }
        return fn();
      },
    }),

    team_approve_plan: tool({
      description: "Approve a plan submitted by a teammate.",
      inputSchema: z.object({
        planId: z.string().describe("Plan ID to approve"),
      }),
      execute: async (params: { planId: string }) => {
        const plan = await approvePlan(transport, mailbox, plansDir, agentId, params.planId);
        if (!plan) return `Plan ${params.planId} not found or already decided`;
        await fireTeamHook(hooks, "TeamPlanApproved", {
          planId: params.planId,
          planTitle: plan.title,
        }, sessionId);
        return `Plan "${plan.title}" approved`;
      },
    }),

    team_reject_plan: tool({
      description: "Reject a plan submitted by a teammate with a reason.",
      inputSchema: z.object({
        planId: z.string().describe("Plan ID to reject"),
        reason: z.string().describe("Why the plan is being rejected"),
      }),
      execute: async (params: { planId: string; reason: string }) => {
        const plan = await rejectPlan(
          transport, mailbox, plansDir, agentId, params.planId, params.reason,
        );
        if (!plan) return `Plan ${params.planId} not found or already decided`;
        await fireTeamHook(hooks, "TeamPlanRejected", {
          planId: params.planId,
          planTitle: plan.title,
          reason: params.reason,
        }, sessionId);
        return `Plan "${plan.title}" rejected: ${params.reason}`;
      },
    }),

    team_check_status: tool({
      description: "Check the overall status of all team tasks.",
      inputSchema: z.object({}),
      execute: async () => {
        const tasks = await taskQueue.list();
        const counts = {
          pending: 0,
          blocked: 0,
          claimed: 0,
          completed: 0,
          failed: 0,
        };
        for (const t of tasks) {
          counts[t.status]++;
        }
        const allDone = await taskQueue.allDone();
        return [
          `Tasks: ${tasks.length} total`,
          `  Pending: ${counts.pending}`,
          `  Blocked: ${counts.blocked}`,
          `  Claimed: ${counts.claimed}`,
          `  Completed: ${counts.completed}`,
          `  Failed: ${counts.failed}`,
          allDone ? "All tasks are done!" : "Tasks still in progress",
        ].join("\n");
      },
    }),
  };
}
