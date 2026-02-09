/**
 * Team hooks that bridge agent-teams events to the core SDK hook system.
 *
 * These create HookRegistration objects that fire team lifecycle hook events
 * when team events occur.
 *
 * @packageDocumentation
 */

import type {
  HookCallback,
  HookRegistration,
} from "@lleverage-ai/agent-sdk";

export interface TeamHooksOptions {
  /** Callback for when a team message is received */
  onMessageReceived?: HookCallback;
  /** Callback for when a task is assigned to this agent */
  onTaskAssigned?: HookCallback;
  /** Callback for when a task is completed */
  onTaskCompleted?: HookCallback;
  /** Callback for when a task is created */
  onTaskCreated?: HookCallback;
  /** Callback for when a task fails */
  onTaskFailed?: HookCallback;
  /** Callback for when a teammate is spawned */
  onTeammateSpawned?: HookCallback;
  /** Callback for when a teammate crashes */
  onTeammateCrashed?: HookCallback;
  /** Callback for when a shutdown is requested */
  onShutdownRequested?: HookCallback;
  /** Callback for when shutdown is complete */
  onShutdownComplete?: HookCallback;
  /** Callback for when a plan is submitted */
  onPlanSubmitted?: HookCallback;
  /** Callback for when a plan is approved */
  onPlanApproved?: HookCallback;
  /** Callback for when a plan is rejected */
  onPlanRejected?: HookCallback;
}

/**
 * Create a HookRegistration that fires team lifecycle hooks.
 *
 * These hooks are fired by the agent-teams package (TeammateRunner/AgentTeam)
 * and are never fired by the core SDK itself.
 */
export function createTeamHooks(options: TeamHooksOptions): HookRegistration {
  const registration: HookRegistration = {};

  if (options.onMessageReceived) {
    registration.TeamMessageReceived = [options.onMessageReceived];
  }
  if (options.onTaskAssigned) {
    registration.TeamTaskAssigned = [options.onTaskAssigned];
  }
  if (options.onTaskCompleted) {
    registration.TeamTaskCompleted = [options.onTaskCompleted];
  }
  if (options.onTaskCreated) {
    registration.TeamTaskCreated = [options.onTaskCreated];
  }
  if (options.onTaskFailed) {
    registration.TeamTaskFailed = [options.onTaskFailed];
  }
  if (options.onTeammateSpawned) {
    registration.TeamTeammateSpawned = [options.onTeammateSpawned];
  }
  if (options.onTeammateCrashed) {
    registration.TeamTeammateCrashed = [options.onTeammateCrashed];
  }
  if (options.onShutdownRequested) {
    registration.TeamShutdownRequested = [options.onShutdownRequested];
  }
  if (options.onShutdownComplete) {
    registration.TeamShutdownComplete = [options.onShutdownComplete];
  }
  if (options.onPlanSubmitted) {
    registration.TeamPlanSubmitted = [options.onPlanSubmitted];
  }
  if (options.onPlanApproved) {
    registration.TeamPlanApproved = [options.onPlanApproved];
  }
  if (options.onPlanRejected) {
    registration.TeamPlanRejected = [options.onPlanRejected];
  }

  return registration;
}
