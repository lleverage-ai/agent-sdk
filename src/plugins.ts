/**
 * Plugin definition helpers.
 *
 * @packageDocumentation
 */

import type { AgentPlugin, PluginOptions } from "./types.js";

/**
 * Creates a plugin that extends agent functionality.
 *
 * Plugins bundle related tools and skills together for easy reuse
 * across multiple agents. They can also include setup logic that runs when
 * the plugin is loaded into an agent.
 *
 * @param options - Configuration options for the plugin
 * @returns A plugin definition object
 *
 * @example
 * ```typescript
 * import { definePlugin } from "@lleverage-ai/agent-sdk";
 * import { tool } from "ai";
 * import { z } from "zod";
 *
 * const gitPlugin = definePlugin({
 *   name: "git",
 *   description: "Git operations for version control",
 *   tools: {
 *     gitStatus: tool({
 *       description: "Get the current git status",
 *       inputSchema: z.object({}),
 *       execute: async () => {
 *         // Run git status...
 *         return "On branch main, nothing to commit";
 *       },
 *     }),
 *     gitCommit: tool({
 *       description: "Create a git commit",
 *       inputSchema: z.object({
 *         message: z.string().describe("Commit message"),
 *       }),
 *       execute: async ({ message }) => {
 *         // Run git commit...
 *         return `Committed with message: ${message}`;
 *       },
 *     }),
 *   },
 *   setup: async (agent) => {
 *     console.log(`Git plugin loaded into agent ${agent.id}`);
 *   },
 * });
 * ```
 *
 * @category Plugins
 */
export function definePlugin(options: PluginOptions): AgentPlugin {
  return {
    name: options.name,
    description: options.description,
    setup: options.setup,
    tools: options.tools,
    mcpServer: options.mcpServer,
    skills: options.skills,
    hooks: options.hooks,
    deferred: options.deferred,
    subagent: options.subagent,
  };
}
