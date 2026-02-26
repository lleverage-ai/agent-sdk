/**
 * Subagent creation and task delegation.
 *
 * @packageDocumentation
 */

import { createAgent } from "./agent.js";
import type { Agent, HookRegistration, SubagentOptions } from "./types.js";

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
  if (!subagentHooks) {
    return parentHooks;
  }

  const merged: HookRegistration = {};

  // Merge tool lifecycle hooks (HookMatcher[])
  const toolEvents = ["PreToolUse", "PostToolUse", "PostToolUseFailure"] as const;
  for (const eventType of toolEvents) {
    const parentMatchers = parentHooks[eventType];
    const subagentMatchers = subagentHooks[eventType];
    if (parentMatchers || subagentMatchers) {
      merged[eventType] = [...(parentMatchers ?? []), ...(subagentMatchers ?? [])];
    }
  }

  // Merge generation lifecycle hooks (HookCallback[])
  const genEvents = ["PreGenerate", "PostGenerate", "PostGenerateFailure"] as const;
  for (const eventType of genEvents) {
    const parentCallbacks = parentHooks[eventType];
    const subagentCallbacks = subagentHooks[eventType];
    if (parentCallbacks || subagentCallbacks) {
      merged[eventType] = [...(parentCallbacks ?? []), ...(subagentCallbacks ?? [])];
    }
  }

  return merged;
}

/**
 * Filters parent hooks to only include specific events.
 * @internal
 */
function filterHookEvents(parentHooks: HookRegistration, events: string[]): HookRegistration {
  const filtered: HookRegistration = {};

  // Filter tool lifecycle hooks (HookMatcher[])
  const toolEvents = ["PreToolUse", "PostToolUse", "PostToolUseFailure"] as const;
  for (const event of toolEvents) {
    if (events.includes(event) && parentHooks[event]) {
      filtered[event] = parentHooks[event];
    }
  }

  // Filter generation lifecycle hooks (HookCallback[])
  const genEvents = ["PreGenerate", "PostGenerate", "PostGenerateFailure"] as const;
  for (const event of genEvents) {
    if (events.includes(event) && parentHooks[event]) {
      filtered[event] = parentHooks[event];
    }
  }

  // Filter session lifecycle hooks (HookCallback[])
  const sessionEvents = ["SessionStart", "SessionEnd"] as const;
  for (const event of sessionEvents) {
    if (events.includes(event) && parentHooks[event]) {
      filtered[event] = parentHooks[event];
    }
  }

  // Filter subagent lifecycle hooks (HookCallback[])
  const subagentEvents = ["SubagentStart", "SubagentStop"] as const;
  for (const event of subagentEvents) {
    if (events.includes(event) && parentHooks[event]) {
      filtered[event] = parentHooks[event];
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
