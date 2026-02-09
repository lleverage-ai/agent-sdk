/**
 * Custom hook event constants for the Agent Teams plugin.
 *
 * @packageDocumentation
 */

/**
 * Custom hook event names used by the Agent Teams plugin.
 *
 * Subscribe to these events via `HookRegistration.Custom` or `onCustom()`.
 *
 * @category Agent Teams
 */
export const TEAM_HOOKS = {
  /** Fired when a new teammate is spawned */
  TeammateSpawned: "team:TeammateSpawned",
  /** Fired when a teammate enters idle state */
  TeammateIdle: "team:TeammateIdle",
  /** Fired when a teammate is stopped */
  TeammateStopped: "team:TeammateStopped",
  /** Fired when a new team task is created */
  TeamTaskCreated: "team:TeamTaskCreated",
  /** Fired when a teammate claims a task */
  TeamTaskClaimed: "team:TeamTaskClaimed",
  /** Fired when a task is completed */
  TeamTaskCompleted: "team:TeamTaskCompleted",
  /** Fired when a message is sent between teammates */
  TeamMessageSent: "team:TeamMessageSent",
} as const;
