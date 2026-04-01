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

**Foreground vs background:**
- Use foreground delegation by default when you need the result before you can take the next important step
- Use \`run_in_background\` only for genuinely independent work you can let finish later while you continue coordinating
- If work is independent, launch multiple \`task\` calls in the same step so they can run in parallel
- After backgrounding work, continue with other useful work instead of waiting or repeatedly checking status

**How to delegate:**
- Call the \`task\` tool with \`description\` and \`subagent_type\`, plus optional fields like \`max_turns\` or \`run_in_background\`
- Make each delegated task self-contained: include the goal, relevant context, constraints, and the output you want back
- The subagent runs with its own context and returns only the result
- Use \`task_output\` only when you specifically need manual status inspection or intermediate output`;

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
