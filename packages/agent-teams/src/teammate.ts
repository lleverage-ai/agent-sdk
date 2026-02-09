/**
 * Teammate runner — the teammate-side event loop.
 *
 * The TeammateRunner polls the mailbox and task queue, processes messages,
 * claims and executes tasks, sends heartbeats, and handles cooperative shutdown.
 *
 * Each teammate runs in its own Node.js child process. The user provides
 * a teammate entry script that creates an Agent and calls `runTeammate()`.
 *
 * @packageDocumentation
 */

import { join } from "node:path";
import type { Agent } from "@lleverage-ai/agent-sdk";
import { FileTransport } from "./transport/file-transport.js";
import { createMailbox } from "./mailbox/mailbox.js";
import { createSharedTaskQueue } from "./task-queue/shared-task-queue.js";
import { getTeamPaths, readTeamConfig } from "./team-config.js";
import { createTeamMessageTool } from "./tools/team-message-tool.js";
import { createTeamTaskTool } from "./tools/team-task-tool.js";
import { isShutdownRequest, acknowledgeShutdown } from "./protocols/shutdown.js";
import { notifyIdle } from "./protocols/idle-notification.js";
import type {
  AgentState,
  TeamMessage,
  TeammateRunnerOptions,
  TEAM_ENV_VARS,
} from "./types.js";

/**
 * TeammateRunner manages the teammate-side event loop.
 */
export class TeammateRunner {
  private running = false;
  private readonly transport: FileTransport;
  private readonly paths: ReturnType<typeof getTeamPaths>;

  constructor(private readonly options: TeammateRunnerOptions) {
    this.paths = getTeamPaths(options.baseDir, options.teamName);
    this.transport = new FileTransport({ lockDir: this.paths.locksDir });
  }

  /** Get the mailbox for this teammate. */
  getMailbox() {
    return createMailbox(this.transport, this.paths.messagesDir);
  }

  /** Get the shared task queue. */
  getTaskQueue() {
    return createSharedTaskQueue(this.transport, this.paths.tasks);
  }

  /** Get team message tools for this agent. */
  getMessageTools() {
    return createTeamMessageTool({
      agentId: this.options.agentId,
      mailbox: this.getMailbox(),
    });
  }

  /** Get team task tools for this agent. */
  getTaskTools() {
    return createTeamTaskTool({
      agentId: this.options.agentId,
      taskQueue: this.getTaskQueue(),
    });
  }

  /** Update this agent's heartbeat state. */
  private async updateHeartbeat(status: AgentState["status"], currentTask?: string): Promise<void> {
    const statePath = join(this.paths.stateDir, `${this.options.agentId}.json`);
    const state: AgentState = {
      agentId: this.options.agentId,
      status,
      currentTask,
      lastHeartbeat: new Date().toISOString(),
      pid: process.pid,
    };
    await this.transport.writeJSON(statePath, state);
  }

  /** Find the lead agent ID from the team config. */
  private async getLeadAgentId(): Promise<string> {
    const config = await readTeamConfig(this.transport, this.options.baseDir, this.options.teamName);
    const lead = config?.agents.find((a) => a.role === "lead");
    return lead?.agentId ?? "lead";
  }

  /**
   * Run the teammate event loop.
   *
   * Loop: heartbeat → poll mailbox → check for shutdown → check task queue →
   * claim & yield → notify idle → sleep → repeat
   */
  async *run(): AsyncGenerator<TeammateEvent, void, unknown> {
    this.running = true;
    const pollInterval = this.options.pollIntervalMs ?? 500;
    const heartbeatInterval = this.options.heartbeatIntervalMs ?? 5_000;
    let lastHeartbeat = 0;
    const mailbox = this.getMailbox();
    const taskQueue = this.getTaskQueue();
    const leadId = await this.getLeadAgentId();

    await this.updateHeartbeat("running");

    while (this.running) {
      // Heartbeat
      const now = Date.now();
      if (now - lastHeartbeat >= heartbeatInterval) {
        await this.updateHeartbeat("running");
        lastHeartbeat = now;
      }

      // Poll mailbox
      const messages = await mailbox.readAll(this.options.agentId);
      for (const msg of messages) {
        if (isShutdownRequest(msg)) {
          yield { type: "shutdown_requested", message: msg };
          await acknowledgeShutdown(mailbox, this.options.agentId, msg.from);
          await this.updateHeartbeat("stopped");
          this.running = false;
          return;
        }
        yield { type: "message_received", message: msg };
      }

      // Check task queue — try to claim next available task
      const task = await taskQueue.claimNext(this.options.agentId);
      if (task) {
        await this.updateHeartbeat("running", task.id);
        yield { type: "task_claimed", taskId: task.id, task };
      } else {
        // No tasks available — check if all done
        const allDone = await taskQueue.allDone();
        const pending = await taskQueue.byStatus("pending");
        if (allDone || (pending.length === 0 && !(await taskQueue.byStatus("claimed")).length)) {
          yield { type: "idle" };
          await notifyIdle(mailbox, this.options.agentId, leadId);
          await this.updateHeartbeat("idle");
        }
      }

      // Sleep
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    await this.updateHeartbeat("stopped");
  }

  /** Stop the event loop. */
  stop(): void {
    this.running = false;
  }
}

/** Events yielded by the teammate runner. */
export type TeammateEvent =
  | { type: "message_received"; message: TeamMessage }
  | { type: "task_claimed"; taskId: string; task: import("./types.js").TeamTask }
  | { type: "shutdown_requested"; message: TeamMessage }
  | { type: "idle" };

/**
 * Create a TeammateRunner from options.
 */
export function createTeammateRunner(options: TeammateRunnerOptions): TeammateRunner {
  return new TeammateRunner(options);
}

/**
 * Convenience function to run a teammate from environment variables.
 *
 * Reads AGENT_TEAM_NAME, AGENT_TEAM_BASE_DIR, AGENT_TEAM_AGENT_ID,
 * AGENT_TEAM_SESSION_ID, and AGENT_TEAM_SYSTEM_PROMPT from the environment.
 *
 * This is the primary entry point for teammate scripts:
 *
 * ```typescript
 * import { createAgent } from "@lleverage-ai/agent-sdk";
 * import { runTeammate } from "@lleverage-ai/agent-teams";
 *
 * const agent = createAgent({ model, systemPrompt, tools });
 * await runTeammate({ agent });
 * ```
 */
export async function runTeammate(opts: { agent: Agent }): Promise<void> {
  const teamName = process.env.AGENT_TEAM_NAME;
  const baseDir = process.env.AGENT_TEAM_BASE_DIR;
  const agentId = process.env.AGENT_TEAM_AGENT_ID;
  const sessionId = process.env.AGENT_TEAM_SESSION_ID;
  const systemPrompt = process.env.AGENT_TEAM_SYSTEM_PROMPT;

  if (!teamName || !baseDir || !agentId || !sessionId) {
    throw new Error(
      "Missing required environment variables: AGENT_TEAM_NAME, AGENT_TEAM_BASE_DIR, AGENT_TEAM_AGENT_ID, AGENT_TEAM_SESSION_ID",
    );
  }

  const runner = createTeammateRunner({
    teamName,
    baseDir,
    agentId,
    sessionId,
    systemPrompt,
  });

  // Add team tools to the agent
  const messageTools = runner.getMessageTools();
  const taskTools = runner.getTaskTools();

  // Run the event loop, processing each event
  for await (const event of runner.run()) {
    switch (event.type) {
      case "task_claimed": {
        // Execute the task using the agent
        const result = await opts.agent.generate({
          prompt: `You have been assigned the following task:\n\nTitle: ${event.task.title}\nDescription: ${event.task.description}\n\nComplete this task using the available tools. When done, use team_complete_task to mark it complete.`,
        });
        break;
      }
      case "message_received":
        // Messages are available via the read_messages tool
        break;
      case "shutdown_requested":
        return;
      case "idle":
        // Wait for more work
        break;
    }
  }
}
