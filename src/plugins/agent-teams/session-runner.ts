/**
 * Headless session runner for teammate agents.
 *
 * Runs an AgentSession in the background without a human operator.
 *
 * @packageDocumentation
 */

import { invokeCustomHook } from "../../hooks.js";
import { AgentSession } from "../../session.js";
import type { Agent, HookRegistration } from "../../types.js";
import { TEAM_HOOKS } from "./hooks.js";
import type { TeamCoordinator } from "./types.js";

/**
 * Options for creating a HeadlessSessionRunner.
 *
 * @category Agent Teams
 */
export interface HeadlessSessionRunnerOptions {
  /** The teammate agent */
  agent: Agent;
  /** Unique teammate ID */
  teammateId: string;
  /** Team coordinator for message checking */
  coordinator: TeamCoordinator;
  /** Initial prompt to send to the agent */
  initialPrompt: string;
  /** Hook registration for custom events */
  hooks?: HookRegistration;
  /** Maximum turns before stopping */
  maxTurns?: number;
  /** Callback for output text */
  onOutput?: (text: string) => void;
  /** Callback when teammate enters idle state */
  onIdle?: (teammateId: string) => void;
}

/**
 * Runs a teammate's AgentSession in the background without a human operator.
 *
 * The runner:
 * 1. Creates an AgentSession with the agent
 * 2. Sends the initial prompt
 * 3. When the session waits for input, checks the coordinator mailbox
 * 4. Injects messages as new prompts or waits for messages
 *
 * @category Agent Teams
 */
export class HeadlessSessionRunner {
  private session: AgentSession;
  private running = false;
  private stopped = false;
  private teammateId: string;
  private coordinator: TeamCoordinator;
  private initialPrompt: string;
  private hooks?: HookRegistration;
  private agent: Agent;
  private maxTurns: number;
  private onOutput?: (text: string) => void;
  private onIdle?: (teammateId: string) => void;

  constructor(options: HeadlessSessionRunnerOptions) {
    this.teammateId = options.teammateId;
    this.coordinator = options.coordinator;
    this.initialPrompt = options.initialPrompt;
    this.hooks = options.hooks;
    this.agent = options.agent;
    this.maxTurns = options.maxTurns ?? 50;
    this.onOutput = options.onOutput;
    this.onIdle = options.onIdle;

    this.session = new AgentSession({
      agent: options.agent,
      maxTurns: this.maxTurns,
    });
  }

  /**
   * Start the headless session runner.
   *
   * This runs the session loop, sending the initial prompt and then
   * processing messages from the coordinator mailbox.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopped = false;

    // Send initial prompt
    this.session.sendMessage(this.initialPrompt);

    try {
      for await (const output of this.session.run()) {
        if (this.stopped) break;

        switch (output.type) {
          case "text_delta":
            this.onOutput?.(output.text);
            break;

          case "generation_complete":
            this.coordinator.updateTeammateStatus(this.teammateId, "working");
            break;

          case "waiting_for_input": {
            // Check for unread messages
            const messages = this.coordinator.getMessages(this.teammateId, true);

            if (messages.length > 0) {
              // Mark as read and inject
              const formattedMessages = messages
                .map((m) => {
                  this.coordinator.markRead(m.id);
                  return `[Message from ${m.from}]: ${m.content}`;
                })
                .join("\n");

              this.session.sendMessage(formattedMessages);
            } else {
              // Update status to idle
              this.coordinator.updateTeammateStatus(this.teammateId, "idle");

              // Fire idle hook
              await invokeCustomHook(
                this.hooks,
                TEAM_HOOKS.TeammateIdle,
                { teammateId: this.teammateId },
                this.agent,
              );

              // Wait for messages with timeout
              const newMessages = await this.coordinator.waitForMessage(this.teammateId, 30000);

              if (this.stopped) break;

              if (newMessages && newMessages.length > 0) {
                const formatted = newMessages
                  .map((m) => {
                    this.coordinator.markRead(m.id);
                    return `[Message from ${m.from}]: ${m.content}`;
                  })
                  .join("\n");

                this.session.sendMessage(formatted);
              } else {
                // No messages after timeout - notify idle callback
                this.onIdle?.(this.teammateId);
                // Stop the session if truly idle
                this.session.stop();
              }
            }
            break;
          }

          case "agent_handoff":
            // Teammate agents shouldn't normally handoff, but handle gracefully
            break;

          case "interrupt":
            // Auto-approve in headless mode (no human operator)
            this.session.respondToInterrupt(output.interrupt.id, {
              approved: true,
            });
            break;

          case "error":
            // Log error and continue
            console.error(`[team:${this.teammateId}] Error:`, output.error);
            break;
        }
      }
    } finally {
      this.running = false;
      this.coordinator.updateTeammateStatus(this.teammateId, "stopped");
    }
  }

  /**
   * Send a message to the teammate by injecting it into the session.
   */
  sendMessage(content: string): void {
    if (!this.running) return;
    this.session.sendMessage(`[Message from lead]: ${content}`);
  }

  /**
   * Stop the headless session runner.
   */
  stop(): void {
    this.stopped = true;
    this.session.stop();
  }

  /**
   * Check if the runner is currently active.
   */
  isRunning(): boolean {
    return this.running;
  }
}
