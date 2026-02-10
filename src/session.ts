/**
 * Agent Session for persistent, event-driven agent interactions.
 *
 * AgentSession provides a stateful wrapper around an Agent that:
 * - Maintains conversation history across multiple interactions
 * - Processes async events (background task completions, user messages)
 * - Automatically continues generation when background tasks complete
 * - Handles interrupts for user approval flows
 * - Integrates with checkpointing for state persistence
 *
 * @packageDocumentation
 */

import type { ModelMessage } from "ai";
import type { Interrupt } from "./checkpointer/types.js";
import type { BackgroundTask } from "./task-store/types.js";
import type { Agent, GenerateOptions } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Event types that can be processed by the session.
 */
export type SessionEvent =
  | { type: "user_message"; content: string }
  | { type: "task_completed"; task: BackgroundTask }
  | { type: "task_failed"; task: BackgroundTask }
  | { type: "interrupt_response"; interruptId: string; response: unknown }
  | { type: "stop" };

/**
 * Output events from the session.
 */
export type SessionOutput =
  | { type: "text_delta"; text: string }
  | { type: "generation_complete"; fullText: string }
  | { type: "interrupt"; interrupt: Interrupt }
  | { type: "error"; error: Error }
  | { type: "waiting_for_input" };

/**
 * Options for creating an AgentSession.
 */
export interface AgentSessionOptions {
  /** The agent to wrap */
  agent: Agent;

  /**
   * Thread ID for checkpointing and conversation persistence.
   * If provided, the session will use checkpointing for state recovery.
   */
  threadId?: string;

  /**
   * Whether to automatically process task completions.
   * When true, the session will generate a response when background tasks complete.
   * @default true
   */
  autoProcessTaskCompletions?: boolean;

  /**
   * Custom formatter for task completion messages.
   * @param task - The completed task
   * @returns The message to inject into the conversation
   */
  formatTaskCompletion?: (task: BackgroundTask) => string;

  /**
   * Custom formatter for task failure messages.
   * @param task - The failed task
   * @returns The message to inject into the conversation
   */
  formatTaskFailure?: (task: BackgroundTask) => string;

  /**
   * Initial messages to populate the conversation.
   * If threadId is provided and checkpointing is enabled, this may be
   * overridden by restored messages.
   */
  initialMessages?: ModelMessage[];

  /**
   * Maximum number of turns before stopping.
   * @default Infinity
   */
  maxTurns?: number;
}

// =============================================================================
// Default Formatters
// =============================================================================

const defaultFormatTaskCompletion = (task: BackgroundTask): string => {
  const command = task.metadata?.command ?? "unknown command";
  return `[Background task completed: ${task.id}]\nCommand: ${command}\nOutput:\n${task.result ?? "(no output)"}`;
};

const defaultFormatTaskFailure = (task: BackgroundTask): string => {
  const command = task.metadata?.command ?? "unknown command";
  return `[Background task failed: ${task.id}]\nCommand: ${command}\nError: ${task.error ?? "Unknown error"}`;
};

// =============================================================================
// AgentSession Class
// =============================================================================

/**
 * A stateful session for interacting with an agent.
 *
 * AgentSession wraps an Agent and provides:
 * - Automatic handling of background task completions
 * - Interrupt handling for approval flows
 * - Event-driven processing with an async iterator interface
 * - Conversation state management with optional checkpointing
 *
 * @example
 * ```typescript
 * const session = createAgentSession({
 *   agent,
 *   threadId: "user-123-session-1", // Enable checkpointing
 * });
 *
 * // Process events in a loop
 * for await (const output of session.run()) {
 *   switch (output.type) {
 *     case "text_delta":
 *       process.stdout.write(output.text);
 *       break;
 *     case "waiting_for_input":
 *       const input = await getUserInput();
 *       session.sendMessage(input);
 *       break;
 *     case "interrupt":
 *       const response = await handleInterrupt(output.interrupt);
 *       session.respondToInterrupt(output.interrupt.id, response);
 *       break;
 *     case "generation_complete":
 *       console.log("\n");
 *       break;
 *   }
 * }
 * ```
 *
 * @category Session
 */
export class AgentSession {
  private agent: Agent;
  private messages: ModelMessage[] = [];
  private eventQueue: SessionEvent[] = [];
  private running = false;
  private stopped = false;
  private eventResolve: (() => void) | null = null;
  private turnCount = 0;

  private threadId?: string;
  private autoProcessTaskCompletions: boolean;
  private formatTaskCompletion: (task: BackgroundTask) => string;
  private formatTaskFailure: (task: BackgroundTask) => string;
  private maxTurns: number;

  // Track pending interrupt for resumption
  private pendingInterrupt: Interrupt | null = null;

  constructor(options: AgentSessionOptions) {
    this.agent = options.agent;
    this.threadId = options.threadId;
    this.autoProcessTaskCompletions = options.autoProcessTaskCompletions ?? true;
    this.formatTaskCompletion = options.formatTaskCompletion ?? defaultFormatTaskCompletion;
    this.formatTaskFailure = options.formatTaskFailure ?? defaultFormatTaskFailure;
    this.messages = options.initialMessages ? [...options.initialMessages] : [];
    this.maxTurns = options.maxTurns ?? Infinity;

    // Subscribe to task manager events
    if (this.autoProcessTaskCompletions) {
      this.agent.taskManager.on("taskCompleted", (task) => {
        this.enqueueEvent({ type: "task_completed", task });
      });

      this.agent.taskManager.on("taskFailed", (task) => {
        this.enqueueEvent({ type: "task_failed", task });
      });

      // Note: We intentionally don't subscribe to taskKilled events.
      // When a user kills a task via kill_task, they already know about it
      // and the agent has already responded. No need for a follow-up generation.
    }
  }

  /**
   * Send a user message to the session.
   * The message will be queued and processed in the event loop.
   *
   * @param content - The user message content
   */
  sendMessage(content: string): void {
    this.enqueueEvent({ type: "user_message", content });
  }

  /**
   * Respond to a pending interrupt.
   *
   * @param interruptId - The ID of the interrupt to respond to
   * @param response - The response data
   */
  respondToInterrupt(interruptId: string, response: unknown): void {
    this.enqueueEvent({ type: "interrupt_response", interruptId, response });
  }

  /**
   * Stop the session event loop.
   */
  stop(): void {
    this.stopped = true;
    this.enqueueEvent({ type: "stop" });
  }

  /**
   * Get the current conversation messages.
   */
  getMessages(): ModelMessage[] {
    return [...this.messages];
  }

  /**
   * Get the current turn count.
   */
  getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * Check if the session is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Run the session event loop.
   *
   * This is an async generator that yields output events as they occur.
   * The loop will:
   * 1. Wait for events (user messages, task completions, interrupt responses)
   * 2. Process events by generating agent responses
   * 3. Yield output chunks as they're generated
   * 4. Handle interrupts by yielding interrupt events and waiting for responses
   *
   * @yields Session output events
   *
   * @example
   * ```typescript
   * for await (const output of session.run()) {
   *   switch (output.type) {
   *     case "text_delta":
   *       process.stdout.write(output.text);
   *       break;
   *     case "waiting_for_input":
   *       const input = await readline.question("You: ");
   *       session.sendMessage(input);
   *       break;
   *     case "interrupt":
   *       // Handle approval request, user question, etc.
   *       const response = await handleInterrupt(output.interrupt);
   *       session.respondToInterrupt(output.interrupt.id, response);
   *       break;
   *     case "generation_complete":
   *       console.log("\n");
   *       break;
   *     case "error":
   *       console.error("Error:", output.error);
   *       break;
   *   }
   * }
   * ```
   */
  async *run(): AsyncGenerator<SessionOutput, void, unknown> {
    if (this.running) {
      throw new Error("Session is already running");
    }

    this.running = true;
    this.stopped = false;

    try {
      while (!this.stopped && this.turnCount < this.maxTurns) {
        // Signal that we're waiting for input
        yield { type: "waiting_for_input" };

        // Wait for an event
        const event = await this.waitForEvent();

        if (!event || event.type === "stop") {
          break;
        }

        // Process the event
        yield* this.processEvent(event);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Process a single event and yield output.
   */
  private async *processEvent(event: SessionEvent): AsyncGenerator<SessionOutput, void, unknown> {
    // Skip task events for tasks already consumed via task_output.
    // When task_output observes a terminal task, it removes it from TaskManager.
    // If the task is gone by the time the session processes the queued event, skip it.
    if (event.type === "task_completed" || event.type === "task_failed") {
      if (!this.agent.taskManager.getTask(event.task.id)) {
        return;
      }
    }

    // Handle interrupt response specially - resume the generation
    if (event.type === "interrupt_response") {
      if (!this.pendingInterrupt) {
        yield {
          type: "error",
          error: new Error("No pending interrupt to respond to"),
        };
        return;
      }

      // Resume the generation with the interrupt response
      yield* this.resumeFromInterrupt(event.interruptId, event.response);
      return;
    }

    // Convert event to prompt
    let prompt: string;

    switch (event.type) {
      case "user_message":
        prompt = event.content;
        break;

      case "task_completed":
        prompt = this.formatTaskCompletion(event.task);
        this.agent.taskManager.removeTask(event.task.id);
        break;

      case "task_failed":
        prompt = this.formatTaskFailure(event.task);
        this.agent.taskManager.removeTask(event.task.id);
        break;

      default:
        return;
    }

    // Generate response
    yield* this.generate(prompt);
  }

  /**
   * Generate a response for a prompt.
   */
  private async *generate(prompt: string): AsyncGenerator<SessionOutput, void, unknown> {
    try {
      const generateOptions: GenerateOptions = {
        prompt,
        messages: this.messages.length > 0 ? this.messages : undefined,
        threadId: this.threadId,
      };

      const result = await this.agent.generate(generateOptions);

      if (result.status === "interrupted") {
        // Store the pending interrupt for later resumption
        this.pendingInterrupt = result.interrupt;

        // Yield partial text if available
        if (result.partial?.text) {
          yield { type: "text_delta", text: result.partial.text };
        }

        // Yield the interrupt for the caller to handle
        yield { type: "interrupt", interrupt: result.interrupt };
        return;
      }

      // Generation complete
      this.turnCount++;

      // Update conversation history
      this.messages.push({ role: "user", content: prompt });
      this.messages.push({ role: "assistant", content: result.text });

      // Yield the full text (for non-streaming path)
      yield { type: "text_delta", text: result.text };
      yield { type: "generation_complete", fullText: result.text };
    } catch (error) {
      yield {
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Resume generation after an interrupt.
   */
  private async *resumeFromInterrupt(
    interruptId: string,
    response: unknown,
  ): AsyncGenerator<SessionOutput, void, unknown> {
    if (!this.threadId) {
      yield {
        type: "error",
        error: new Error("Cannot resume from interrupt without a threadId"),
      };
      return;
    }

    try {
      const result = await this.agent.resume(this.threadId, interruptId, response);

      this.pendingInterrupt = null;

      if (result.status === "interrupted") {
        // Another interrupt - store it and yield
        this.pendingInterrupt = result.interrupt;

        if (result.partial?.text) {
          yield { type: "text_delta", text: result.partial.text };
        }

        yield { type: "interrupt", interrupt: result.interrupt };
        return;
      }

      // Generation complete
      this.turnCount++;

      // Update conversation history (interrupt response was handled internally)
      this.messages.push({ role: "assistant", content: result.text });

      yield { type: "text_delta", text: result.text };
      yield { type: "generation_complete", fullText: result.text };
    } catch (error) {
      yield {
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Enqueue an event for processing.
   */
  private enqueueEvent(event: SessionEvent): void {
    this.eventQueue.push(event);

    // Wake up the event loop if it's waiting
    if (this.eventResolve) {
      this.eventResolve();
      this.eventResolve = null;
    }
  }

  /**
   * Wait for the next event.
   */
  private async waitForEvent(): Promise<SessionEvent | undefined> {
    // Check if there's already an event in the queue
    if (this.eventQueue.length > 0) {
      return this.eventQueue.shift();
    }

    // Wait for an event to be enqueued
    await new Promise<void>((resolve) => {
      this.eventResolve = resolve;
    });

    return this.eventQueue.shift();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new agent session.
 *
 * @param options - Session options
 * @returns A new AgentSession instance
 *
 * @example
 * ```typescript
 * import { createAgent, createAgentSession } from "@lleverage-ai/agent-sdk";
 *
 * const agent = createAgent({
 *   model: "anthropic/claude-sonnet-4",
 *   systemPrompt: "You are a helpful assistant.",
 *   backend: new FilesystemBackend({ rootDir: ".", enableBash: true }),
 * });
 *
 * const session = createAgentSession({
 *   agent,
 *   threadId: "session-1", // Enable checkpointing
 * });
 *
 * // Run the session
 * for await (const output of session.run()) {
 *   switch (output.type) {
 *     case "text_delta":
 *       process.stdout.write(output.text);
 *       break;
 *     case "waiting_for_input":
 *       const input = await getUserInput();
 *       if (input === "exit") {
 *         session.stop();
 *       } else {
 *         session.sendMessage(input);
 *       }
 *       break;
 *     case "interrupt":
 *       const response = await handleApproval(output.interrupt);
 *       session.respondToInterrupt(output.interrupt.id, response);
 *       break;
 *   }
 * }
 * ```
 *
 * @category Session
 */
export function createAgentSession(options: AgentSessionOptions): AgentSession {
  return new AgentSession(options);
}
