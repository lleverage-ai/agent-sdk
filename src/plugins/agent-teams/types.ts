/**
 * Type definitions for the Agent Teams plugin.
 *
 * @packageDocumentation
 */

import type { LanguageModel } from "ai";
import type { AgentOptions, HookRegistration } from "../../types.js";

// =============================================================================
// Team Task
// =============================================================================

/**
 * Status of a team task.
 *
 * @category Agent Teams
 */
export type TeamTaskStatus = "pending" | "in_progress" | "completed";

/**
 * A shared task with dependencies for team coordination.
 *
 * @category Agent Teams
 */
export interface TeamTask {
  /** Unique task identifier */
  id: string;
  /** Brief task title */
  subject: string;
  /** Detailed task description */
  description: string;
  /** Current task status */
  status: TeamTaskStatus;
  /** Teammate ID that claimed this task */
  assignee?: string;
  /** ID of the teammate/lead that created this task */
  createdBy: string;
  /** Task IDs that must complete before this task can start */
  blockedBy: string[];
  /** Task IDs that this task blocks (computed reverse dependency) */
  blocks: string[];
  /** Result or output after task completion */
  result?: string;
  /** ISO timestamp of task creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

// =============================================================================
// Team Message
// =============================================================================

/**
 * A mailbox message between team members.
 *
 * @category Agent Teams
 */
export interface TeamMessage {
  /** Unique message identifier */
  id: string;
  /** Sender teammate/lead ID */
  from: string;
  /** Recipient teammate ID (null for broadcast) */
  to: string | null;
  /** Message content */
  content: string;
  /** ISO timestamp */
  timestamp: string;
  /** Whether the recipient has read this message */
  read: boolean;
}

// =============================================================================
// Teammate
// =============================================================================

/**
 * Status of a teammate.
 *
 * @category Agent Teams
 */
export type TeammateStatus = "idle" | "working" | "stopped";

/**
 * Information about an active teammate.
 *
 * @category Agent Teams
 */
export interface TeammateInfo {
  /** Unique teammate identifier */
  id: string;
  /** Role name (e.g., "researcher", "coder") */
  role: string;
  /** Description of the teammate's capabilities */
  description: string;
  /** Current status */
  status: TeammateStatus;
  /** ID of the task currently being worked on */
  currentTaskId?: string;
  /** ISO timestamp when the teammate was spawned */
  spawnedAt: string;
}

// =============================================================================
// Team Coordinator
// =============================================================================

/**
 * Abstract coordination interface for team management.
 *
 * Handles teammate registration, task management with dependencies,
 * and inter-agent messaging.
 *
 * @category Agent Teams
 */
export interface TeamCoordinator {
  // Teammate management
  registerTeammate(info: TeammateInfo): void;
  removeTeammate(id: string): void;
  getTeammate(id: string): TeammateInfo | undefined;
  listTeammates(): TeammateInfo[];
  updateTeammateStatus(id: string, status: TeammateStatus, taskId?: string): void;

  // Task management
  createTask(task: Omit<TeamTask, "id" | "createdAt" | "updatedAt" | "blocks">): TeamTask;
  getTask(id: string): TeamTask | undefined;
  listTasks(filter?: { status?: TeamTaskStatus; assignee?: string }): TeamTask[];
  claimTask(taskId: string, teammateId: string): boolean;
  completeTask(taskId: string, result?: string): boolean;
  updateTask(
    taskId: string,
    updates: Partial<Pick<TeamTask, "subject" | "description" | "status" | "blockedBy">>,
  ): boolean;
  isTaskBlocked(taskId: string): boolean;

  // Messaging
  sendMessage(msg: Omit<TeamMessage, "id" | "timestamp" | "read">): TeamMessage;
  getMessages(recipientId: string, unreadOnly?: boolean): TeamMessage[];
  markRead(messageId: string): void;
  waitForMessage(agentId: string, timeoutMs?: number): Promise<TeamMessage[] | null>;

  // Lifecycle
  dispose(): void;
}

// =============================================================================
// Teammate Definition
// =============================================================================

/**
 * Template for spawnable teammates.
 *
 * Defines the role, capabilities, and agent configuration for a teammate type.
 *
 * @category Agent Teams
 */
export interface TeammateDefinition {
  /** Role name (e.g., "researcher", "coder") */
  role: string;
  /** Description of what this teammate does */
  description: string;
  /** Agent options for this teammate (systemPrompt, tools, plugins, etc.) */
  agentOptions: Partial<AgentOptions>;
  /** Model to use for this teammate */
  model?: LanguageModel;
  /** Maximum turns before the teammate stops */
  maxTurns?: number;
}

// =============================================================================
// Plugin Options
// =============================================================================

/**
 * Configuration options for the Agent Teams plugin.
 *
 * @category Agent Teams
 */
export interface AgentTeamsPluginOptions {
  /** Teammate definitions (templates for spawnable teammates) */
  teammates: TeammateDefinition[];
  /** Custom coordinator implementation (defaults to InMemoryTeamCoordinator) */
  coordinator?: TeamCoordinator;
  /** Hooks to merge into the agent's hook registration */
  hooks?: HookRegistration;
  /** Maximum concurrent teammates (default: Infinity) */
  maxConcurrentTeammates?: number;
}
