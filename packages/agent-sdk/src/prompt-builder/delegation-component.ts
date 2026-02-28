/**
 * Delegation prompt component for guiding subagent usage.
 *
 * @packageDocumentation
 */

import type { PromptComponent } from "./index.js";

/**
 * Default delegation instructions added to the system prompt when subagents are available.
 *
 * @category Prompt Builder
 */
export const DEFAULT_DELEGATION_INSTRUCTIONS = `# Task Delegation

When accomplishing a goal that requires multiple intermediate steps, delegate
the intermediate work to a subagent using the \`task\` tool. This keeps your
context focused on the final result.

**When to delegate:**
- Multi-step tool workflows (search → read → analyze → summarize)
- Operations that produce large intermediate outputs
- Tasks requiring specialized plugin tools
- Any work where you only need the final result

**How to delegate:**
- Use task(description, subagent_type) with a clear description of what you need
- The subagent runs with its own context and returns only the result
- Call task multiple times in one step for parallel execution`;

/**
 * Prompt component that provides delegation guidance when subagents are available.
 *
 * Priority: 75 (above tools-listing at 70, below identity at 100).
 * Condition: `ctx.custom?.hasSubagents === true`.
 *
 * @example
 * ```typescript
 * const builder = new PromptBuilder().register(delegationComponent);
 * ```
 *
 * @category Prompt Builder
 */
export const delegationComponent: PromptComponent = {
  name: "delegation-instructions",
  priority: 75,
  condition: (ctx) => ctx.custom?.hasSubagents === true,
  render: (ctx) => {
    // Allow custom delegation instructions to override default
    const custom = ctx.custom?.delegationInstructions;
    if (typeof custom === "string") {
      return custom || ""; // Empty string disables delegation instructions
    }
    return DEFAULT_DELEGATION_INSTRUCTIONS;
  },
};
