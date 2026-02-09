/**
 * AgentTeam — the lead-side team orchestrator.
 *
 * The AgentTeam spawns teammate processes, monitors heartbeats,
 * checks task queue completion, and yields team events.
 *
 * @packageDocumentation
 */

import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { HookRegistration, Tracer } from "@lleverage-ai/agent-sdk";
import { FileTransport } from "./transport/file-transport.js";
import { createMailbox } from "./mailbox/mailbox.js";
import { createSharedTaskQueue } from "./task-queue/shared-task-queue.js";
import {
  createTeamConfig,
  getTeamPaths,
  writeTeamConfig,
} from "./team-config.js";
import { createTeammateTool } from "./tools/teammate-tool.js";
import { createTeamMessageTool } from "./tools/team-message-tool.js";
import { createTeamTaskTool } from "./tools/team-task-tool.js";
import { isShutdownAck, isIdleNotification } from "./protocols/index.js";
import { fireTeamHook } from "./hooks/invoke.js";
import { TeamSemanticAttributes } from "./observability/semantic-attributes.js";
import type {
  AgentState,
  AgentTeamOptions,
  TeamAgentConfig,
  TeamEvent,
  TEAM_ENV_VARS,
} from "./types.js";

/**
 * AgentTeam orchestrates a team of agent processes.
 */
export class AgentTeam {
  private readonly transport: FileTransport;
  private readonly paths: ReturnType<typeof getTeamPaths>;
  private readonly sessionId: string;
  private readonly processes = new Map<string, ChildProcess>();
  private running = false;

  /** Optional hook registrations for firing team events */
  hooks?: HookRegistration;
  /** Optional tracer for creating spans */
  tracer?: Tracer;

  constructor(private readonly options: AgentTeamOptions) {
    this.sessionId = randomUUID();
    this.paths = getTeamPaths(options.baseDir, options.teamName);
    this.transport = new FileTransport({ lockDir: this.paths.locksDir });
  }

  /** Get the session ID for this team run. */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Get the mailbox. */
  getMailbox() {
    return createMailbox(this.transport, this.paths.messagesDir);
  }

  /** Get the shared task queue. */
  getTaskQueue() {
    return createSharedTaskQueue(this.transport, this.paths.tasks);
  }

  /** Get the lead agent ID. */
  getLeadAgentId(): string {
    const lead = this.options.agents.find((a) => a.role === "lead");
    return lead?.agentId ?? "lead";
  }

  /** Get lead-only teammate management tools. */
  getTeammateTools() {
    const leadId = this.getLeadAgentId();
    const teammateIds = this.options.agents
      .filter((a) => a.role === "teammate")
      .map((a) => a.agentId);

    return createTeammateTool({
      agentId: leadId,
      mailbox: this.getMailbox(),
      taskQueue: this.getTaskQueue(),
      transport: this.transport,
      plansDir: this.paths.plansDir,
      teammateIds,
      hooks: this.hooks,
      tracer: this.tracer,
      sessionId: this.sessionId,
    });
  }

  /** Get message tools for the lead. */
  getMessageTools() {
    return createTeamMessageTool({
      agentId: this.getLeadAgentId(),
      mailbox: this.getMailbox(),
      hooks: this.hooks,
      tracer: this.tracer,
      sessionId: this.sessionId,
    });
  }

  /** Get task tools for the lead. */
  getTaskTools() {
    return createTeamTaskTool({
      agentId: this.getLeadAgentId(),
      taskQueue: this.getTaskQueue(),
      hooks: this.hooks,
      tracer: this.tracer,
      sessionId: this.sessionId,
    });
  }

  /** Initialize the team: write config and create coordination directories. */
  async initialize(): Promise<void> {
    const config = createTeamConfig(
      this.options.teamName,
      this.sessionId,
      this.options.agents,
      this.options.settings,
    );
    await writeTeamConfig(
      this.transport,
      this.options.baseDir,
      this.options.teamName,
      config,
    );
  }

  /** Spawn a teammate child process. */
  spawnTeammate(agent: TeamAgentConfig): ChildProcess {
    if (!agent.entryScript) {
      throw new Error(`Agent ${agent.agentId} has no entryScript`);
    }

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      AGENT_TEAM_NAME: this.options.teamName,
      AGENT_TEAM_BASE_DIR: this.options.baseDir,
      AGENT_TEAM_AGENT_ID: agent.agentId,
      AGENT_TEAM_SESSION_ID: this.sessionId,
    };
    if (agent.systemPrompt) {
      env.AGENT_TEAM_SYSTEM_PROMPT = agent.systemPrompt;
    }

    // Propagate trace context via env vars
    if (this.tracer?.enabled) {
      const activeSpan = this.tracer.getActiveSpan();
      if (activeSpan) {
        env.AGENT_TEAM_TRACE_ID = activeSpan.traceId;
        env.AGENT_TEAM_PARENT_SPAN_ID = activeSpan.spanId;
      }
    }

    const child = spawn(process.execPath, [agent.entryScript], {
      env,
      stdio: "pipe",
    });

    this.processes.set(agent.agentId, child);

    // Fire hook for teammate spawned
    fireTeamHook(this.hooks, "TeamTeammateSpawned", {
      agentId: agent.agentId,
      pid: child.pid,
    }, this.sessionId);

    return child;
  }

  /** Spawn all teammate processes. */
  async spawnAll(): Promise<Map<string, ChildProcess>> {
    const teammates = this.options.agents.filter((a) => a.role === "teammate");
    for (const agent of teammates) {
      this.spawnTeammate(agent);
    }
    return this.processes;
  }

  /**
   * Run the lead event loop.
   *
   * Loop: check heartbeats → check task queue → check lead mailbox →
   * yield events → sleep → repeat
   */
  async *run(): AsyncGenerator<TeamEvent, void, unknown> {
    this.running = true;
    const pollInterval = this.options.pollIntervalMs ?? 500;
    const heartbeatTimeout = this.options.heartbeatTimeoutMs ?? 30_000;
    const mailbox = this.getMailbox();
    const taskQueue = this.getTaskQueue();
    const leadId = this.getLeadAgentId();

    // Monitor child process exits
    for (const [agentId, child] of this.processes) {
      child.on("exit", (code) => {
        // Will be picked up in the heartbeat check
      });
    }

    while (this.running) {
      // Check heartbeats — detect crashed teammates
      for (const agent of this.options.agents.filter((a) => a.role === "teammate")) {
        const statePath = join(this.paths.stateDir, `${agent.agentId}.json`);
        const state = await this.transport.readJSON<AgentState>(statePath);
        if (state) {
          const elapsed = Date.now() - new Date(state.lastHeartbeat).getTime();
          if (state.status === "running" && elapsed > heartbeatTimeout) {
            await fireTeamHook(this.hooks, "TeamTeammateCrashed", {
              agentId: agent.agentId,
              error: `No heartbeat for ${elapsed}ms`,
            }, this.sessionId);
            yield {
              type: "teammate_crashed",
              agentId: agent.agentId,
              error: `No heartbeat for ${elapsed}ms`,
            };
          }
        }
      }

      // Check task queue
      const allDone = await taskQueue.allDone();
      if (allDone) {
        yield { type: "all_tasks_done" };
      }

      // Check lead mailbox
      const messages = await mailbox.readAll(leadId);
      for (const msg of messages) {
        if (isShutdownAck(msg)) {
          yield { type: "teammate_exited", agentId: msg.from, exitCode: 0 };
        } else if (isIdleNotification(msg)) {
          // Teammate is idle — could assign more work
        } else if (msg.type === "plan_submission") {
          const payload = msg.payload as { planId: string; title?: string };
          await fireTeamHook(this.hooks, "TeamPlanSubmitted", {
            planId: payload.planId,
            agentId: msg.from,
          }, this.sessionId);
          yield {
            type: "plan_submitted",
            planId: payload.planId,
            agentId: msg.from,
          };
        } else {
          yield { type: "message_sent", from: msg.from, to: leadId };
        }
      }

      // Sleep
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    await fireTeamHook(this.hooks, "TeamShutdownComplete", {}, this.sessionId);
    yield { type: "shutdown_complete" };
  }

  /** Stop the lead event loop and all child processes. */
  async stop(): Promise<void> {
    this.running = false;
    for (const [_agentId, child] of this.processes) {
      child.kill("SIGTERM");
    }
    this.processes.clear();
  }
}

/**
 * Create a new AgentTeam.
 */
export function createAgentTeam(options: AgentTeamOptions): AgentTeam {
  return new AgentTeam(options);
}
