/**
 * Team hook invocation helper.
 *
 * Fires team lifecycle hooks without requiring an Agent instance.
 * Team hooks are observation-only — they cannot return permission decisions.
 *
 * @packageDocumentation
 */

import type {
  HookCallback,
  HookEvent,
  HookRegistration,
} from "@lleverage-ai/agent-sdk";

/**
 * Fire all registered callbacks for a team hook event.
 *
 * Builds a minimal HookInput with base fields and event-specific data,
 * then invokes all registered callbacks. Errors are caught and logged
 * to avoid breaking the main flow.
 */
export async function fireTeamHook(
  hooks: HookRegistration | undefined,
  event: HookEvent,
  data: Record<string, unknown>,
  sessionId?: string,
): Promise<void> {
  if (!hooks) return;

  const callbacks = hooks[event as keyof HookRegistration] as HookCallback[] | undefined;
  if (!callbacks || callbacks.length === 0) return;

  const input = {
    hook_event_name: event,
    session_id: sessionId ?? "",
    cwd: process.cwd(),
    ...data,
  };

  // Create a minimal context — team hooks are observation-only
  const context = {
    signal: AbortSignal.timeout(60_000),
    agent: null as unknown as import("@lleverage-ai/agent-sdk").Agent,
    retryAttempt: 0,
  };

  for (const callback of callbacks) {
    try {
      await callback(input as Parameters<HookCallback>[0], null, context);
    } catch (err) {
      // Team hooks are observation-only — don't let failures break the flow
      console.error(`[agent-teams] Hook ${event} callback failed:`, err);
    }
  }
}
