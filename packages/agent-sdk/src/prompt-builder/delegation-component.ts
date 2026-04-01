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

Delegate work to a subagent when that will keep your own context focused on the
user's goal.

**When to delegate:**
- Multi-step workflows with substantial intermediate output
- Specialized work where you mainly need the result, not the full process
- Independent tasks that can run in parallel
- Work that would otherwise distract from coordinating the overall goal

**When not to delegate:**
- Simple tasks you can complete directly
- Work that needs tight back-and-forth with the user in the current turn
- Urgent blocking work where waiting on delegation would add unnecessary overhead

**How to delegate:**
- Call the \`task\` tool with \`description\` and \`subagent_type\`, plus optional fields like \`max_turns\` or \`run_in_background\`, using a clear objective, constraints, and desired output
- The subagent runs with its own context and returns only the result
- Call task multiple times in one step for independent parallel work`;

/**
 * Prompt component that provides delegation guidance when subagents are available.
 *
 * Priority: 75 (below identity at 100 and above memory/permission guidance).
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
