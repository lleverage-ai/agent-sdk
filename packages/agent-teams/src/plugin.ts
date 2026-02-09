/**
 * Team plugin factory.
 *
 * Creates an AgentPlugin that gives any agent team coordination capabilities.
 * The agent decides when to use team tools, just like it decides when to use
 * any other tool.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AgentPlugin, HookRegistration, Tracer } from "@lleverage-ai/agent-sdk";
import { FileTransport } from "./transport/file-transport.js";
import { createMailbox } from "./mailbox/mailbox.js";
import { createSharedTaskQueue } from "./task-queue/shared-task-queue.js";
import {
  createTeamConfig,
  getTeamPaths,
  writeTeamConfig,
} from "./team-config.js";
import { createTeammateTool } from "./tools/teammate-tool.js";
import { createTeamTaskTool } from "./tools/team-task-tool.js";
import { createTeamMessageTool } from "./tools/team-message-tool.js";
import { createTeamHooks, type TeamHooksOptions } from "./hooks/team-hooks.js";
import { fireTeamHook } from "./hooks/invoke.js";
import { TeamSemanticAttributes } from "./observability/semantic-attributes.js";
import type {
  TeamAgentConfig,
  TeamAgentRole,
  AgentState,
} from "./types.js";

export interface TeamPluginOptions {
  /** Team name */
  teamName: string;
  /** Base directory for coordination files */
  baseDir: string;
  /** Agent configurations */
  agents: TeamAgentConfig[];
  /** This agent's ID */
  agentId: string;
  /** This agent's role */
  role: TeamAgentRole;
  /** Optional tracer for span creation */
  tracer?: Tracer;
  /** Optional hook callbacks */
  hookCallbacks?: Partial<TeamHooksOptions>;
  /** Custom settings */
  settings?: Record<string, unknown>;
  /** Polling interval in ms. @default 500 */
  pollIntervalMs?: number;
  /** Heartbeat timeout in ms. @default 30000 */
  heartbeatTimeoutMs?: number;
}

/**
 * Create a team plugin that gives an agent team coordination capabilities.
 *
 * The returned plugin provides:
 * - **tools**: Role-appropriate team tools (lead gets management + task/message; teammates get task/message only)
 * - **hooks**: Generated from hookCallbacks via createTeamHooks()
 * - **skills**: Instructions for how to coordinate as a team member
 * - **setup(agent)**: Initializes coordination directory, writes team config, starts background monitoring
 */
export function createTeamPlugin(options: TeamPluginOptions): AgentPlugin {
  const {
    teamName,
    baseDir,
    agents,
    agentId,
    role,
    tracer,
    hookCallbacks,
    settings,
    pollIntervalMs = 500,
    heartbeatTimeoutMs = 30_000,
  } = options;

  const sessionId = randomUUID();
  const paths = getTeamPaths(baseDir, teamName);
  const transport = new FileTransport({ lockDir: paths.locksDir });
  const mailbox = createMailbox(transport, paths.messagesDir);
  const taskQueue = createSharedTaskQueue(transport, paths.tasks);

  // Generate hook registration from callbacks
  const pluginHooks: HookRegistration | undefined = hookCallbacks
    ? createTeamHooks(hookCallbacks as TeamHooksOptions)
    : undefined;

  // Build tools based on role
  const teammateIds = agents
    .filter((a) => a.role === "teammate")
    .map((a) => a.agentId);

  const toolOptions = {
    hooks: pluginHooks,
    tracer,
    sessionId,
  };

  const buildTools = () => {
    const taskTools = createTeamTaskTool({
      agentId,
      taskQueue,
      ...toolOptions,
    });

    const messageTools = createTeamMessageTool({
      agentId,
      mailbox,
      ...toolOptions,
    });

    if (role === "lead") {
      const leadTools = createTeammateTool({
        agentId,
        mailbox,
        taskQueue,
        transport,
        plansDir: paths.plansDir,
        teammateIds,
        ...toolOptions,
      });

      return {
        ...leadTools,
        ...taskTools,
        ...messageTools,
      };
    }

    return {
      ...taskTools,
      ...messageTools,
    };
  };

  // Heartbeat monitoring interval (for lead only)
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  return {
    name: "agent-teams",
    description: `Team coordination plugin for ${role} agent "${agentId}" in team "${teamName}"`,
    hooks: pluginHooks,
    tools: buildTools(),

    skills: [
      {
        name: "team-coordination",
        description: role === "lead"
          ? "You are the lead of a team. Use team_create_tasks to break work into tasks, team_send_message to coordinate, and team_check_status to monitor progress. When all work is done, use team_shutdown_all."
          : "You are a teammate. Use team_claim_task to pick up work, team_complete_task when done, team_fail_task if stuck, and team_send_message to communicate with the lead or other teammates.",
        instructions: role === "lead"
          ? [
            "Break complex work into independent tasks using team_create_tasks",
            "Monitor progress with team_check_status and team_list_tasks",
            "Use team_send_message to provide guidance to specific teammates",
            "Approve or reject plans submitted by teammates",
            "When all tasks are complete, use team_shutdown_all to end the session",
          ].join("\n")
          : [
            "Use team_claim_task to claim the next available task",
            "Complete the task using your available tools",
            "Use team_complete_task with a result summary when done",
            "Use team_fail_task if you cannot complete a task",
            "Use team_send_message to ask the lead for help or share progress",
          ].join("\n"),
      },
    ],

    async setup() {
      const setupFn = async () => {
        if (role === "lead") {
          // Initialize coordination directory and write team config
          const config = createTeamConfig(teamName, sessionId, agents, settings);
          await writeTeamConfig(transport, baseDir, teamName, config);

          // Start heartbeat monitoring for teammates
          heartbeatInterval = setInterval(async () => {
            for (const agent of agents.filter((a) => a.role === "teammate")) {
              const statePath = join(paths.stateDir, `${agent.agentId}.json`);
              const state = await transport.readJSON<AgentState>(statePath);
              if (state) {
                const elapsed = Date.now() - new Date(state.lastHeartbeat).getTime();
                if (state.status === "running" && elapsed > heartbeatTimeoutMs) {
                  await fireTeamHook(pluginHooks, "TeamTeammateCrashed", {
                    agentId: agent.agentId,
                    error: `No heartbeat for ${elapsed}ms`,
                  }, sessionId);
                }
              }
            }
          }, pollIntervalMs);
        } else {
          // Teammate: write initial heartbeat state
          const statePath = join(paths.stateDir, `${agentId}.json`);
          const state: AgentState = {
            agentId,
            status: "running",
            lastHeartbeat: new Date().toISOString(),
            pid: process.pid,
          };
          // Ensure state dir exists before writing
          try {
            await transport.ensureDir(paths.stateDir);
          } catch {
            // Directory may already exist from lead initialization
          }
          await transport.writeJSON(statePath, state);
        }
      };

      if (tracer?.enabled) {
        await tracer.withSpan("team.initialize", async (span) => {
          span.setAttribute(TeamSemanticAttributes.TEAM_NAME, teamName);
          span.setAttribute(TeamSemanticAttributes.TEAM_SESSION_ID, sessionId);
          span.setAttribute(TeamSemanticAttributes.TEAM_AGENT_ID, agentId);
          span.setAttribute(TeamSemanticAttributes.TEAM_AGENT_ROLE, role);
          await setupFn();
        });
      } else {
        await setupFn();
      }
    },
  };
}
