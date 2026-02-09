/**
 * @lleverage-ai/agent-teams — Multi-agent team coordination layer.
 *
 * Built on top of @lleverage-ai/agent-sdk, this package provides file-based
 * inter-agent communication, shared task queues, cooperative shutdown,
 * plan approval, and team orchestration.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createAgent, createObservabilityPreset } from "@lleverage-ai/agent-sdk";
 * import { createTeamPlugin } from "@lleverage-ai/agent-teams";
 *
 * const obs = createObservabilityPreset({ name: "my-agent" });
 *
 * const teamPlugin = createTeamPlugin({
 *   teamName: "api-builder",
 *   baseDir: "/tmp/teams",
 *   agentId: "lead",
 *   role: "lead",
 *   agents: [
 *     { agentId: "lead", role: "lead", name: "Lead" },
 *     { agentId: "worker-1", role: "teammate", name: "Worker", entryScript: "./worker.ts" },
 *   ],
 *   tracer: obs.tracer,
 * });
 *
 * const agent = createAgent({
 *   model: anthropic("claude-sonnet-4"),
 *   plugins: [teamPlugin],
 *   hooks: obs.hooks,
 * });
 * ```
 *
 * @packageDocumentation
 */

// Plugin (recommended high-level API)
export { createTeamPlugin } from "./plugin.js";
export type { TeamPluginOptions } from "./plugin.js";

// Team orchestrator
export { AgentTeam, createAgentTeam } from "./team.js";

// Teammate runner
export {
  TeammateRunner,
  createTeammateRunner,
  runTeammate,
} from "./teammate.js";
export type { TeammateEvent } from "./teammate.js";

// Tools
export { createTeammateTool } from "./tools/teammate-tool.js";
export type { TeammateToolOptions } from "./tools/teammate-tool.js";
export { createTeamTaskTool } from "./tools/team-task-tool.js";
export type { TeamTaskToolOptions } from "./tools/team-task-tool.js";
export { createTeamMessageTool } from "./tools/team-message-tool.js";
export type { TeamMessageToolOptions } from "./tools/team-message-tool.js";

// Hooks
export { createTeamHooks } from "./hooks/team-hooks.js";
export type { TeamHooksOptions } from "./hooks/team-hooks.js";
export { fireTeamHook } from "./hooks/invoke.js";

// Observability
export { TeamSemanticAttributes } from "./observability/semantic-attributes.js";

// Transport primitives
export { FileTransport } from "./transport/file-transport.js";
export type { FileTransportOptions } from "./transport/file-transport.js";
export { acquireLock, createFileLock } from "./transport/file-lock.js";
export type { Transport, FileLockOptions, Lock } from "./transport/types.js";

// Mailbox
export { FileMailbox, createMailbox } from "./mailbox/mailbox.js";
export type { Mailbox } from "./mailbox/types.js";

// Task queue
export { FileTaskQueue, createSharedTaskQueue } from "./task-queue/shared-task-queue.js";
export type { SharedTaskQueue } from "./task-queue/types.js";

// Task graph visualization
export { buildTaskGraph, renderTaskGraphMermaid } from "./task-queue/graph.js";
export type {
  TaskGraphOptions,
  TaskGraph,
  TaskGraphNode,
  TaskGraphEdge,
} from "./task-queue/graph.js";

// Protocols
export {
  requestShutdown,
  broadcastShutdown,
  acknowledgeShutdown,
  isShutdownRequest,
  isShutdownAck,
} from "./protocols/shutdown.js";
export {
  submitPlan,
  approvePlan,
  rejectPlan,
  readPlan,
} from "./protocols/plan-approval.js";
export {
  notifyIdle,
  isIdleNotification,
} from "./protocols/idle-notification.js";

// Team config
export {
  getTeamDir,
  getTeamPaths,
  readTeamConfig,
  writeTeamConfig,
  createTeamConfig,
} from "./team-config.js";

// Types
export type {
  TeamAgentRole,
  TeamAgentIdentity,
  TeamAgentConfig,
  TeamConfig,
  TeamEvent,
  TeamMessageType,
  TeamMessage,
  TeamTaskStatus,
  TeamTask,
  TaskQueueState,
  TeamPlanStatus,
  TeamPlan,
  AgentState,
  AgentTeamOptions,
  TeammateRunnerOptions,
} from "./types.js";
export { TEAM_ENV_VARS } from "./types.js";
