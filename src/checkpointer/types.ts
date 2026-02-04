/**
 * Type definitions for the checkpointer system.
 *
 * Checkpointers provide session persistence and resumption across conversations,
 * allowing agents to save and restore their state including message history,
 * todos, files, and pending tool approvals.
 *
 * @packageDocumentation
 */

import type { ModelMessage } from "ai";
import type { AgentState } from "../backends/state.js";

// =============================================================================
// Checkpoint Data Structure
// =============================================================================

/**
 * Base interrupt type - the shared mechanism for pausing agent execution.
 *
 * Interrupts allow the agent to pause execution and wait for external input.
 * This is a generalized pattern that supports:
 * - Tool approval requests (ApprovalInterrupt)
 * - User questions during tool execution
 * - Custom application-specific interrupts
 *
 * @example
 * ```typescript
 * const interrupt: Interrupt = {
 *   id: "int_abc123",
 *   threadId: "session-456",
 *   type: "approval",
 *   toolCallId: "call_abc123",
 *   toolName: "deleteFile",
 *   request: { toolName: "deleteFile", args: { path: "/important/file.txt" } },
 *   step: 5,
 *   createdAt: "2026-01-30T10:00:00Z",
 * };
 * ```
 *
 * @category Checkpointer
 */
export interface Interrupt<TRequest = unknown, TResponse = unknown> {
  /** Unique identifier for this interrupt */
  id: string;
  /** The thread this interrupt belongs to */
  threadId: string;
  /** Type of interrupt (e.g., "approval", "question", custom types) */
  type: string;
  /** The tool call ID if this interrupt is related to a tool call */
  toolCallId?: string;
  /** The tool name if this interrupt is related to a tool call */
  toolName?: string;
  /** The request data for this interrupt (type varies by interrupt type) */
  request: TRequest;
  /** The step number when the interrupt occurred */
  step: number;
  /** ISO 8601 timestamp when this interrupt was created */
  createdAt: string;
  /** The response to this interrupt (undefined = pending) */
  response?: TResponse;
}

/**
 * Request data for an approval interrupt.
 *
 * @category Checkpointer
 */
export interface ApprovalRequest {
  /** Name of the tool that requires approval */
  toolName: string;
  /** Arguments passed to the tool */
  args: unknown;
}

/**
 * Response data for an approval interrupt.
 *
 * @category Checkpointer
 */
export interface ApprovalResponse {
  /** Whether the tool call was approved */
  approved: boolean;
  /** Optional reason for the decision */
  reason?: string;
}

/**
 * Approval interrupt - a specialized interrupt for tool approval requests.
 *
 * When a tool requires user confirmation (via `canUseTool` returning "ask"),
 * the agent creates an approval interrupt and pauses execution.
 *
 * @example
 * ```typescript
 * const approval: ApprovalInterrupt = {
 *   id: "int_abc123",
 *   threadId: "session-456",
 *   type: "approval",
 *   toolCallId: "call_abc123",
 *   toolName: "deleteFile",
 *   request: { toolName: "deleteFile", args: { path: "/important/file.txt" } },
 *   step: 5,
 *   createdAt: "2026-01-30T10:00:00Z",
 * };
 * ```
 *
 * @category Checkpointer
 */
export interface ApprovalInterrupt extends Interrupt<ApprovalRequest, ApprovalResponse> {
  type: "approval";
  /** Tool call ID is required for approval interrupts */
  toolCallId: string;
  /** Tool name is required for approval interrupts */
  toolName: string;
}

/**
 * Complete snapshot of an agent session.
 *
 * A checkpoint captures the full state of a conversation, including:
 * - Message history for context continuity
 * - Agent state (todos, virtual files)
 * - Any pending interrupts (tool approvals, questions, etc.)
 *
 * @example
 * ```typescript
 * const checkpoint: Checkpoint = {
 *   threadId: "session-123",
 *   step: 5,
 *   messages: [
 *     { role: "user", content: "Hello" },
 *     { role: "assistant", content: "Hi there!" },
 *   ],
 *   state: { todos: [], files: {} },
 *   createdAt: "2026-01-30T10:00:00Z",
 *   updatedAt: "2026-01-30T10:05:00Z",
 * };
 * ```
 *
 * @category Checkpointer
 */
export interface Checkpoint {
  /** Unique identifier for this conversation thread */
  threadId: string;

  /** Step number when this checkpoint was created */
  step: number;

  /** Full message history */
  messages: ModelMessage[];

  /** Agent state including todos and virtual filesystem */
  state: AgentState;

  /**
   * Pending interrupt if the agent was interrupted.
   */
  pendingInterrupt?: Interrupt;

  /** ISO 8601 timestamp when this checkpoint was first created */
  createdAt: string;

  /** ISO 8601 timestamp when this checkpoint was last updated */
  updatedAt: string;

  /** Optional metadata for custom data */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Checkpoint Saver Interface
// =============================================================================

/**
 * Options for creating a checkpoint saver.
 *
 * @category Checkpointer
 */
export interface CheckpointSaverOptions {
  /**
   * Namespace for isolating checkpoints.
   *
   * Useful for multi-tenant scenarios where different users or projects
   * need separate checkpoint storage.
   *
   * @defaultValue undefined (no namespace)
   */
  namespace?: string;
}

/**
 * Abstract storage interface for checkpoints.
 *
 * Implement this interface to create custom checkpoint storage backends
 * such as Redis, SQLite, cloud storage, or any other persistence layer.
 *
 * @example
 * ```typescript
 * class RedisCheckpointSaver implements BaseCheckpointSaver {
 *   constructor(private redis: RedisClient) {}
 *
 *   async save(checkpoint: Checkpoint): Promise<void> {
 *     const key = `checkpoint:${checkpoint.threadId}`;
 *     await this.redis.set(key, JSON.stringify(checkpoint));
 *   }
 *
 *   async load(threadId: string): Promise<Checkpoint | undefined> {
 *     const key = `checkpoint:${threadId}`;
 *     const data = await this.redis.get(key);
 *     return data ? JSON.parse(data) : undefined;
 *   }
 *
 *   // ... other methods
 * }
 * ```
 *
 * @category Checkpointer
 */
export interface BaseCheckpointSaver {
  /**
   * Save a checkpoint.
   *
   * If a checkpoint with the same `threadId` exists, it should be updated.
   *
   * @param checkpoint - The checkpoint to save
   */
  save(checkpoint: Checkpoint): Promise<void>;

  /**
   * Load a checkpoint by thread ID.
   *
   * @param threadId - The unique thread identifier
   * @returns The checkpoint if found, undefined otherwise
   */
  load(threadId: string): Promise<Checkpoint | undefined>;

  /**
   * List all thread IDs that have checkpoints.
   *
   * @returns Array of thread IDs
   */
  list(): Promise<string[]>;

  /**
   * Delete a checkpoint.
   *
   * @param threadId - The thread ID to delete
   * @returns True if a checkpoint was deleted, false if not found
   */
  delete(threadId: string): Promise<boolean>;

  /**
   * Check if a checkpoint exists.
   *
   * @param threadId - The thread ID to check
   * @returns True if the checkpoint exists
   */
  exists(threadId: string): Promise<boolean>;
}

// =============================================================================
// Checkpoint Events
// =============================================================================

/**
 * Event emitted when a checkpoint is saved.
 *
 * @category Checkpointer
 */
export interface CheckpointSavedEvent {
  type: "checkpoint-saved";
  threadId: string;
  step: number;
}

/**
 * Event emitted when a checkpoint is loaded.
 *
 * @category Checkpointer
 */
export interface CheckpointLoadedEvent {
  type: "checkpoint-loaded";
  threadId: string;
  step: number;
  messagesCount: number;
}

/**
 * Union type of all checkpoint events.
 *
 * @category Checkpointer
 */
export type CheckpointEvent = CheckpointSavedEvent | CheckpointLoadedEvent;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new checkpoint with the given data.
 *
 * This is a convenience function that ensures timestamps are set correctly.
 *
 * @param data - Partial checkpoint data (threadId and messages required)
 * @returns A complete checkpoint object
 *
 * @example
 * ```typescript
 * const checkpoint = createCheckpoint({
 *   threadId: "session-123",
 *   messages: [...],
 *   state: { todos: [], files: {} },
 * });
 * ```
 *
 * @category Checkpointer
 */
export function createCheckpoint(
  data: Pick<Checkpoint, "threadId" | "messages" | "state"> &
    Partial<Omit<Checkpoint, "threadId" | "messages" | "state">>,
): Checkpoint {
  const now = new Date().toISOString();
  return {
    step: 0,
    createdAt: now,
    updatedAt: now,
    ...data,
  };
}

/**
 * Update an existing checkpoint with new data.
 *
 * Automatically updates the `updatedAt` timestamp and increments step.
 *
 * @param checkpoint - The existing checkpoint
 * @param updates - Partial updates to apply
 * @returns A new checkpoint object with updates applied
 *
 * @example
 * ```typescript
 * const updated = updateCheckpoint(checkpoint, {
 *   messages: [...newMessages],
 *   step: checkpoint.step + 1,
 * });
 * ```
 *
 * @category Checkpointer
 */
export function updateCheckpoint(
  checkpoint: Checkpoint,
  updates: Partial<Omit<Checkpoint, "threadId" | "createdAt">>,
): Checkpoint {
  return {
    ...checkpoint,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Type guard to check if an object is a valid Checkpoint.
 *
 * @param value - The value to check
 * @returns True if the value is a valid Checkpoint
 *
 * @category Checkpointer
 */
export function isCheckpoint(value: unknown): value is Checkpoint {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.threadId === "string" &&
    typeof obj.step === "number" &&
    Array.isArray(obj.messages) &&
    typeof obj.state === "object" &&
    obj.state !== null &&
    typeof obj.createdAt === "string" &&
    typeof obj.updatedAt === "string"
  );
}

/**
 * Type guard to check if an object is a valid Interrupt.
 *
 * @param value - The value to check
 * @returns True if the value is a valid Interrupt
 *
 * @category Checkpointer
 */
export function isInterrupt(value: unknown): value is Interrupt {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "string" &&
    typeof obj.threadId === "string" &&
    typeof obj.type === "string" &&
    typeof obj.step === "number" &&
    typeof obj.createdAt === "string" &&
    obj.request !== undefined
  );
}

/**
 * Type guard to check if an interrupt is an ApprovalInterrupt.
 *
 * @param interrupt - The interrupt to check
 * @returns True if the interrupt is an ApprovalInterrupt
 *
 * @category Checkpointer
 */
export function isApprovalInterrupt(interrupt: Interrupt): interrupt is ApprovalInterrupt {
  return (
    interrupt.type === "approval" &&
    typeof interrupt.toolCallId === "string" &&
    typeof interrupt.toolName === "string"
  );
}

/**
 * Create a new interrupt with the given data.
 *
 * @param data - Partial interrupt data (id, threadId, type, and request required)
 * @returns A complete interrupt object
 *
 * @category Checkpointer
 */
export function createInterrupt<TRequest = unknown, TResponse = unknown>(
  data: Pick<Interrupt<TRequest, TResponse>, "id" | "threadId" | "type" | "request"> &
    Partial<Omit<Interrupt<TRequest, TResponse>, "id" | "threadId" | "type" | "request">>,
): Interrupt<TRequest, TResponse> {
  return {
    step: 0,
    createdAt: new Date().toISOString(),
    ...data,
  };
}

/**
 * Create an approval interrupt for a tool call.
 *
 * @param data - The approval interrupt data
 * @returns A complete ApprovalInterrupt object
 *
 * @category Checkpointer
 */
export function createApprovalInterrupt(data: {
  id: string;
  threadId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  step?: number;
}): ApprovalInterrupt {
  return {
    id: data.id,
    threadId: data.threadId,
    type: "approval",
    toolCallId: data.toolCallId,
    toolName: data.toolName,
    request: {
      toolName: data.toolName,
      args: data.args,
    },
    step: data.step ?? 0,
    createdAt: new Date().toISOString(),
  };
}
