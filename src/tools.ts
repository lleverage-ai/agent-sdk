/**
 * Skill definition helpers.
 *
 * Tools should be defined using AI SDK's `tool()` function directly.
 * This module provides helpers for skills which provide contextual
 * instructions and guidance for agents.
 *
 * @packageDocumentation
 */

import type { SkillDefinition, SkillOptions, ToolSet } from "./types.js";

/**
 * Creates a skill definition for providing contextual instructions to agents.
 *
 * Skills serve multiple purposes:
 * - **Tool guidance**: Bundle with plugin tools to explain how to use them
 * - **Instructions only**: Load dynamic instructions without tools
 * - **Progressive disclosure**: Include tools that load on-demand
 *
 * @param options - Configuration options for the skill
 * @returns A skill definition object
 *
 * @example
 * ```typescript
 * import { defineSkill, definePlugin } from "@lleverage-ai/agent-sdk";
 *
 * // Skill that provides guidance for using plugin tools
 * const dataSkill = defineSkill({
 *   name: "data-exploration",
 *   description: "Query and visualize data",
 *   prompt: `You have access to data exploration tools.
 * Available tables: products, users, sales.
 * Always use getSchema first to see column types.`,
 * });
 *
 * // Bundle skill with tools in a plugin
 * const dataPlugin = definePlugin({
 *   name: "data-explorer",
 *   tools: { getSchema, queryData },
 *   skills: [dataSkill],
 * });
 *
 * // Skill with no tools - just loads instructions
 * const guidelinesSkill = defineSkill({
 *   name: "guidelines",
 *   description: "Project coding standards",
 *   prompt: "Follow TypeScript strict mode and use named exports.",
 * });
 *
 * // Skill with tools for progressive disclosure
 * const analyzeSkill = defineSkill({
 *   name: "analyze",
 *   description: "Deep code analysis",
 *   prompt: "Perform detailed code analysis.",
 *   tools: {
 *     lint: tool({
 *       description: "Run linter",
 *       inputSchema: z.object({ path: z.string() }),
 *       execute: async ({ path }) => runLinter(path),
 *     }),
 *   },
 * });
 * ```
 *
 * @category Tools
 */
export function defineSkill(options: SkillOptions): SkillDefinition {
  return {
    name: options.name,
    description: options.description,
    prompt: options.prompt,
    tools: options.tools,
  };
}

/**
 * Helper type for tools that can be provided to skills.
 * Re-exported from AI SDK for convenience.
 *
 * @category Tools
 */
export type { ToolSet };
