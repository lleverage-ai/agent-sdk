/**
 * Subagent creation and task delegation.
 *
 * @packageDocumentation
 */

import { createAgent } from "./agent.js";
import { mergeHooks as mergeHookRegistrations } from "./middleware/apply.js";
import type { Agent, HookEvent, HookRegistration, SubagentOptions } from "./types.js";

/**
 * Creates a subagent that inherits configuration from a parent agent.
 *
 * Subagents are specialized agents that can be spawned by a parent agent
 * to handle specific tasks. They can inherit the parent's model or use
 * their own, and can have their own tools, plugins, and configuration.
 *
 * **Hook Inheritance**:
 * By default, subagents inherit all hooks from their parent agent. You can control
 * this behavior with the `inheritHooks` option:
 * - `true` (default): Inherit all parent hooks
 * - `false`: No inheritance, use only subagent's own hooks
 * - `string[]`: Inherit only specific hook events
 *
 * **Tool Filtering Security**:
 * When `allowedTools` is specified, subagent gets access to only those tools.
 * A warning is logged if dangerous tools (bash, write, edit, rm, etc.) are included
 * without explicit opt-in via `inheritHooks: false` or specific hook controls.
 *
 * @param parentAgent - The parent agent to inherit configuration from
 * @param options - Configuration options for the subagent
 * @returns A new agent instance configured as a subagent
 *
 * @example
 * ```typescript
 * import { createAgent, createSubagent } from "@lleverage-ai/agent-sdk";
 * import { anthropic } from "@ai-sdk/anthropic";
 * import { tool } from "ai";
 * import { z } from "zod";
 *
 * const mainAgent = createAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   systemPrompt: "You are a helpful assistant.",
 *   hooks: {
 *     PreToolUse: [{
 *       callback: async (input) => {
 *         console.log("Parent hook:", input.tool_name);
 *         return {};
 *       },
 *     }],
 *   },
 * });
 *
 * // Create a specialized subagent for code review
 * const reviewerAgent = createSubagent(mainAgent, {
 *   name: "code-reviewer",
 *   description: "Reviews code for quality and best practices",
 *   systemPrompt: "You are an expert code reviewer.",
 *   inheritHooks: true, // Inherits parent's PreToolUse hook
 *   tools: {
 *     analyze: tool({
 *       description: "Analyze code",
 *       inputSchema: z.object({ code: z.string() }),
 *       execute: async ({ code }) => analyzeCode(code),
 *     }),
 *   },
 * });
 *
 * const result = await reviewerAgent.generate({
 *   prompt: "Review this function: function add(a, b) { return a + b; }",
 * });
 * ```
 *
 * @category Subagents
 */
export function createSubagent(parentAgent: Agent, options: SubagentOptions): Agent {
  // Determine hook inheritance
  const inheritHooks = options.inheritHooks ?? true; // Default to inheriting
  let mergedHooks: HookRegistration | undefined = options.hooks;

  if (inheritHooks && parentAgent.options.hooks) {
    // Inherit hooks from parent
    if (inheritHooks === true) {
      // Inherit all hooks
      mergedHooks = mergeHooks(parentAgent.options.hooks, options.hooks);
    } else if (Array.isArray(inheritHooks)) {
      // Inherit only specific hook events
      const filteredParentHooks = filterHookEvents(parentAgent.options.hooks, inheritHooks);
      mergedHooks = mergeHooks(filteredParentHooks, options.hooks);
    }
  }

  // Check for dangerous tools without explicit security controls
  if (options.allowedTools) {
    checkDangerousToolAccess(options.allowedTools, mergedHooks, options.name, inheritHooks);
  }

  return createAgent({
    model: options.model ?? parentAgent.options.model,
    systemPrompt: options.systemPrompt,
    maxSteps: options.maxSteps,
    plugins: options.plugins,
    tools: options.tools,
    skills: options.skills,
    hooks: mergedHooks,
    allowedTools: options.allowedTools,
    disabledCoreTools: options.disabledCoreTools,
    permissionMode: options.permissionMode,
    canUseTool: options.canUseTool,
    disallowedTools: options.disallowedTools,
  });
}

/**
 * Dangerous tools that should trigger warnings if accessible without explicit security.
 * @internal
 */
const DANGEROUS_TOOLS = new Set([
  "bash",
  "write",
  "edit",
  "rm",
  "mv",
  "cp",
  "chmod",
  "exec",
  "shell",
  "execute",
]);

/**
 * Merges parent and subagent hooks.
 * Subagent hooks are added after parent hooks (subagent hooks fire last).
 * @internal
 */
function mergeHooks(
  parentHooks: HookRegistration,
  subagentHooks: HookRegistration | undefined,
): HookRegistration {
  return mergeHookRegistrations(parentHooks, subagentHooks);
}

/**
 * Filters parent hooks to only include specific events.
 * @internal
 */
function filterHookEvents(parentHooks: HookRegistration, events: HookEvent[]): HookRegistration {
  const filtered: HookRegistration = {};

  const requestedEvents = new Set(events);
  const source = parentHooks as Record<string, unknown>;
  const target = filtered as Record<string, unknown>;

  for (const event of requestedEvents) {
    const value = source[event];
    if (value !== undefined) {
      target[event] = value;
    }
  }

  return filtered;
}

/**
 * Checks if dangerous tools are accessible without explicit security controls.
 * Logs a warning if found.
 * @internal
 */
function checkDangerousToolAccess(
  allowedTools: string[],
  hooks: HookRegistration | undefined,
  subagentName: string,
  inheritHooks: boolean | string[],
): void {
  const dangerousToolsFound = allowedTools.filter((tool) => DANGEROUS_TOOLS.has(tool));

  if (dangerousToolsFound.length === 0) {
    return; // No dangerous tools, all good
  }

  // Check if there are security controls in place
  const hasToolHooks = hooks?.PreToolUse !== undefined && hooks.PreToolUse.length > 0;
  const explicitNoInheritance = inheritHooks === false;

  if (!hasToolHooks && !explicitNoInheritance) {
    console.warn(
      `[Agent SDK] Subagent "${subagentName}" has access to dangerous tools [${dangerousToolsFound.join(", ")}] without explicit security controls. ` +
        `Consider:\n` +
        `  - Setting inheritHooks: false to isolate from parent permissions\n` +
        `  - Adding PreToolUse hooks for permission checking\n` +
        `  - Using permissionMode: "plan" to prevent execution\n` +
        `  - Using canUseTool callback for runtime approval`,
    );
  }
}

// Note: createTaskTool has been moved to ./tools/task.ts with enhanced functionality
// Use the one from ./tools/index.js instead
