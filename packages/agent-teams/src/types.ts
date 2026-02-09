/**
 * Core types for the agent-teams coordination layer.
 *
 * @packageDocumentation
 */

// =============================================================================
// Team Identity
// =============================================================================

/** Role of an agent within a team. */
export type TeamAgentRole = "lead" | "teammate";

/** Identity of an agent within a team. */
export interface TeamAgentIdentity {
  /** Unique ID for this agent within the team */
  agentId: string;
  /** Role of this agent */
  role: TeamAgentRole;
  /** Human-readable name */
  name?: string;
  /** Description of this agent's specialization */
  description?: string;
}

// =============================================================================
// Team Configuration
// =============================================================================

/** Agent entry in team config. */
export interface TeamAgentConfig extends TeamAgentIdentity {
  /** Path to the teammate entry script (for spawning). Ignored for lead. */
  entryScript?: string;
  /** System prompt override for this agent */
  systemPrompt?: string;
}

/** Persisted team configuration stored in config.json. */
export interface TeamConfig {
  /** Team name */
  teamName: string;
  /** Session ID for this team run */
  sessionId: string;
  /** Agents in the team (including lead) */
  agents: TeamAgentConfig[];
  /** Timestamp when team was created */
  createdAt: string;
  /** Custom settings */
  settings?: Record<string, unknown>;
}

// =============================================================================
// Team Events
// =============================================================================

/** Events emitted by the team orchestrator. */
export type TeamEvent =
  | { type: "teammate_spawned"; agentId: string; pid: number }
  | { type: "teammate_exited"; agentId: string; exitCode: number | null }
  | { type: "teammate_crashed"; agentId: string; error: string }
  | { type: "task_created"; taskId: string }
  | { type: "task_claimed"; taskId: string; agentId: string }
  | { type: "task_completed"; taskId: string; agentId: string }
  | { type: "task_failed"; taskId: string; agentId: string; error: string }
  | { type: "all_tasks_done" }
  | { type: "message_sent"; from: string; to: string }
  | { type: "broadcast_sent"; from: string }
  | { type: "shutdown_requested"; agentId: string }
  | { type: "shutdown_complete" }
  | { type: "plan_submitted"; planId: string; agentId: string }
  | { type: "plan_approved"; planId: string }
  | { type: "plan_rejected"; planId: string; reason: string };

// =============================================================================
// Messages
// =============================================================================

/** Types of messages that can be sent between agents. */
export type TeamMessageType =
  | "text"
  | "task_assignment"
  | "task_update"
  | "plan_submission"
  | "plan_decision"
  | "shutdown_request"
  | "shutdown_ack"
  | "idle_notification"
  | "custom";

/** A message between agents. */
export interface TeamMessage {
  /** Unique message ID */
  id: string;
  /** Sender agent ID */
  from: string;
  /** Recipient agent ID (or "__broadcast__" for broadcast) */
  to: string;
  /** Message type */
  type: TeamMessageType;
  /** Message payload */
  payload: unknown;
  /** ISO timestamp */
  timestamp: string;
}

// =============================================================================
// Tasks
// =============================================================================

/** Status of a team task. */
export type TeamTaskStatus = "pending" | "blocked" | "claimed" | "completed" | "failed";

/** A task in the shared task queue. */
export interface TeamTask {
  /** Unique task ID */
  id: string;
  /** Human-readable title */
  title: string;
  /** Detailed description / instructions */
  description: string;
  /** Current status */
  status: TeamTaskStatus;
  /** Agent ID that claimed this task */
  assignee?: string;
  /** Task IDs that must complete before this task can start */
  dependencies: string[];
  /** Result data on completion */
  result?: unknown;
  /** Error message on failure */
  error?: string;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when last updated */
  updatedAt: string;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

/** Task queue state persisted to tasks.json. */
export interface TaskQueueState {
  tasks: TeamTask[];
  updatedAt: string;
}

// =============================================================================
// Plans
// =============================================================================

/** Status of a plan submission. */
export type TeamPlanStatus = "pending" | "approved" | "rejected";

/** A plan submitted by a teammate for lead approval. */
export interface TeamPlan {
  /** Unique plan ID */
  id: string;
  /** Agent ID that submitted the plan */
  submittedBy: string;
  /** Plan title */
  title: string;
  /** Plan description / details */
  description: string;
  /** Current status */
  status: TeamPlanStatus;
  /** Rejection reason (if rejected) */
  rejectionReason?: string;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp when decided */
  decidedAt?: string;
}

// =============================================================================
// Agent State (heartbeat)
// =============================================================================

/** Agent runtime state persisted to state/{agentId}.json. */
export interface AgentState {
  agentId: string;
  status: "running" | "idle" | "stopped";
  /** Currently claimed task ID */
  currentTask?: string;
  /** ISO timestamp of last heartbeat */
  lastHeartbeat: string;
  /** PID of the agent process */
  pid: number;
}

// =============================================================================
// Options
// =============================================================================

/** Options for creating an AgentTeam (lead-side orchestrator). */
export interface AgentTeamOptions {
  /** Team name */
  teamName: string;
  /** Base directory for coordination files */
  baseDir: string;
  /** Agent definitions for the team */
  agents: TeamAgentConfig[];
  /** Polling interval in ms for the lead loop. @default 500 */
  pollIntervalMs?: number;
  /** Heartbeat timeout in ms before considering an agent crashed. @default 30000 */
  heartbeatTimeoutMs?: number;
  /** Custom settings to include in team config */
  settings?: Record<string, unknown>;
}

/** Options for creating a TeammateRunner (teammate-side). */
export interface TeammateRunnerOptions {
  /** Team name */
  teamName: string;
  /** Base directory for coordination files */
  baseDir: string;
  /** This agent's ID */
  agentId: string;
  /** Session ID for this team run */
  sessionId: string;
  /** System prompt for this teammate */
  systemPrompt?: string;
  /** Polling interval in ms for the teammate loop. @default 500 */
  pollIntervalMs?: number;
  /** Heartbeat interval in ms. @default 5000 */
  heartbeatIntervalMs?: number;
}

// =============================================================================
// Environment Variables
// =============================================================================

/** Environment variables passed to teammate child processes. */
export const TEAM_ENV_VARS = {
  TEAM_NAME: "AGENT_TEAM_NAME",
  BASE_DIR: "AGENT_TEAM_BASE_DIR",
  AGENT_ID: "AGENT_TEAM_AGENT_ID",
  SESSION_ID: "AGENT_TEAM_SESSION_ID",
  SYSTEM_PROMPT: "AGENT_TEAM_SYSTEM_PROMPT",
  TRACE_ID: "AGENT_TEAM_TRACE_ID",
  PARENT_SPAN_ID: "AGENT_TEAM_PARENT_SPAN_ID",
} as const;
