/**
 * Subagent creation and task delegation.
 *
 * @packageDocumentation
 */

import { createAgent } from "./agent.js";
import {
  applyMiddleware,
  mergeHooks as mergeHookRegistrations,
} from "./middleware/apply.js";
import type {
  Agent,
  HookCallback,
  HookMatcher,
  HookRegistration,
  InheritableHookEvent,
  SubagentOptions,
} from "./types.js";

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
  const parentHooks = normalizeHookRegistration(resolveAgentHooks(parentAgent));
  const subagentHooks = normalizeHookRegistration(options.hooks);
  let mergedHooks: HookRegistration | undefined = subagentHooks;

  if (inheritHooks && parentHooks) {
    // Inherit hooks from parent
    if (inheritHooks === true) {
      // Inherit all hooks
      mergedHooks = mergeHookRegistrations(parentHooks, subagentHooks);
    } else if (Array.isArray(inheritHooks)) {
      // Inherit only specific hook events
      const filteredParentHooks = filterHookEvents(parentHooks, inheritHooks);
      mergedHooks = mergeHookRegistrations(filteredParentHooks, subagentHooks);
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

const INHERITABLE_HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PreGenerate",
  "PostGenerate",
  "PostGenerateFailure",
  "GenerationRetryDecision",
  "SessionStart",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
  "MCPConnectionFailed",
  "MCPConnectionRestored",
  "ToolRegistered",
  "ToolLoadError",
  "PreCompact",
  "PostCompact",
  "InterruptRequested",
  "InterruptResolved",
  "Custom",
] as const satisfies readonly InheritableHookEvent[];

type RawToolHookMatcher =
  | HookMatcher
  | {
      callback: HookCallback;
      matcher?: string;
      timeout?: number;
    };

/**
 * Normalizes public/raw tool hook entries into the internal HookMatcher shape.
 * @internal
 */
function normalizeToolHooks(
  matchers: HookRegistration["PreToolUse"] | undefined,
): HookMatcher[] | undefined {
  if (!matchers) {
    return undefined;
  }

  return (matchers as RawToolHookMatcher[]).map((matcher) =>
    "hooks" in matcher
      ? matcher
      : {
          matcher: matcher.matcher,
          hooks: [matcher.callback],
          timeout: matcher.timeout,
        },
  );
}

/**
 * Normalizes hook registrations so canonical merge utilities receive the
 * internal tool-hook representation.
 * @internal
 */
function normalizeHookRegistration(
  hooks: HookRegistration | undefined,
): HookRegistration | undefined {
  if (!hooks) {
    return undefined;
  }

  return {
    ...hooks,
    PreToolUse: normalizeToolHooks(hooks.PreToolUse),
    PostToolUse: normalizeToolHooks(hooks.PostToolUse),
    PostToolUseFailure: normalizeToolHooks(hooks.PostToolUseFailure),
  };
}

function resolveAgentHooks(agent: Agent): HookRegistration | undefined {
  const middlewareHooks = applyMiddleware(agent.options.middleware ?? []);
  const pluginHooks = (agent.options.plugins ?? []).flatMap((plugin) =>
    plugin.hooks ? [plugin.hooks] : [],
  );

  const mergedHooks = mergeHookRegistrations(middlewareHooks, ...pluginHooks, agent.options.hooks);
  return Object.keys(mergedHooks).length > 0 ? mergedHooks : undefined;
}

function isInheritableHookEvent(event: string): event is InheritableHookEvent {
  return (INHERITABLE_HOOK_EVENTS as readonly string[]).includes(event);
}

/**
 * Filters parent hooks to only include specific events.
 * @internal
 */
function filterHookEvents(
  parentHooks: HookRegistration,
  events: InheritableHookEvent[],
): HookRegistration {
  const filtered: HookRegistration = {};

  const requestedEvents = new Set(events);

  for (const event of requestedEvents) {
    if (!isInheritableHookEvent(event)) {
      continue;
    }

    const value = parentHooks[event];
    if (value !== undefined) {
      filtered[event] = value;
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
