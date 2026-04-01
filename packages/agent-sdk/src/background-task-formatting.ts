/**
 * Default prompt formatting for background task completions and failures.
 *
 * @packageDocumentation
 */

import type { BackgroundTask } from "./task-store/types.js";

function getTaskContextLines(task: BackgroundTask): string[] {
  const command = task.metadata?.command;

  if (typeof command === "string" && command.length > 0) {
    return [`Command: ${command}`];
  }

  return [`Subagent type: ${task.subagentType}`, `Task: ${task.description}`];
}

/**
 * Format a completed background task as a follow-up prompt.
 *
 * @param task - The completed task
 * @returns Prompt text describing the completed task
 * @internal
 */
export function formatDefaultTaskCompletionPrompt(task: BackgroundTask): string {
  return [
    `[Background task completed: ${task.id}]`,
    ...getTaskContextLines(task),
    `Output:\n${task.result ?? "(no output)"}`,
  ].join("\n");
}

/**
 * Format a failed background task as a follow-up prompt.
 *
 * @param task - The failed task
 * @returns Prompt text describing the failed task
 * @internal
 */
export function formatDefaultTaskFailurePrompt(task: BackgroundTask): string {
  return [
    `[Background task failed: ${task.id}]`,
    ...getTaskContextLines(task),
    `Error: ${task.error ?? "Unknown error"}`,
  ].join("\n");
}
