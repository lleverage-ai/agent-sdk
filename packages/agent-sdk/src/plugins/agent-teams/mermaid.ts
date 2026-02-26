/**
 * Mermaid diagram generation for team task dependency graphs.
 *
 * @packageDocumentation
 */

import type { TeamTask } from "./types.js";

/**
 * Converts an array of team tasks into a mermaid `graph TD` diagram string.
 *
 * Nodes are labeled with the task subject and a status icon.
 * Edges represent `blockedBy` dependencies (blocker → blocked).
 * CSS classes are applied per status for visual styling.
 *
 * @param tasks - The tasks to visualize
 * @returns A valid mermaid diagram string
 *
 * @example
 * ```typescript
 * const tasks = coordinator.listTasks();
 * const diagram = tasksToMermaid(tasks);
 * console.log(diagram);
 * // graph TD
 * //   task-1["Research TypeScript ✓"]
 * //   task-2["Write Code ⏳"]
 * //   task-1 --> task-2
 * //   ...
 * ```
 *
 * @category Agent Teams
 */
export function tasksToMermaid(tasks: TeamTask[]): string {
  if (tasks.length === 0) return "graph TD\n  empty[No tasks]";

  const lines: string[] = ["graph TD"];

  // Node definitions
  for (const task of tasks) {
    const statusIcon =
      task.status === "completed" ? " ✓" : task.status === "in_progress" ? " ⏳" : "";
    const label = `${task.subject}${statusIcon}`.replace(/"/g, "&quot;");
    lines.push(`  ${task.id}["${label}"]`);
  }

  // Edges: blocker --> blocked
  for (const task of tasks) {
    for (const depId of task.blockedBy) {
      lines.push(`  ${depId} --> ${task.id}`);
    }
  }

  // Status-based styling
  lines.push("");
  lines.push("  classDef completed fill:#90EE90,stroke:#333");
  lines.push("  classDef in_progress fill:#FFD700,stroke:#333");
  lines.push("  classDef pending fill:#D3D3D3,stroke:#333");

  const byStatus: Record<string, string[]> = {
    completed: [],
    in_progress: [],
    pending: [],
  };
  for (const task of tasks) {
    byStatus[task.status]?.push(task.id);
  }
  for (const [status, ids] of Object.entries(byStatus)) {
    if (ids.length > 0) {
      lines.push(`  class ${ids.join(",")} ${status}`);
    }
  }

  return lines.join("\n");
}
