/**
 * Prompt formatting for recalled memories and memory policy.
 *
 * @module
 */

import type { SurfacedMemory } from "../pipeline/types.js";

/**
 * Formats recalled memories into a system prompt section.
 *
 * Each memory is rendered as a markdown heading with metadata and its content.
 * Returns an empty string when no memories are provided.
 */
export function formatMemorySection(memories: SurfacedMemory[]): string {
  if (memories.length === 0) {
    return "";
  }

  const lines: string[] = [
    "# Recalled Memories",
    "",
    "The following memories were recalled as potentially relevant to this conversation.",
    "Use them to inform your responses, but verify they are still accurate.",
    "",
  ];

  for (const { entry } of memories) {
    const { name, type, scope } = entry.frontmatter;
    lines.push(`## ${name} (${type}, ${scope})`);
    lines.push("");
    lines.push(entry.content);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Returns standing instructions for how the agent should interact with memory.
 *
 * Injected into the system prompt so the agent knows when and how to save,
 * update, and remove memories using the available tools.
 */
export function formatMemoryPolicy(): string {
  return `# Memory Policy

You have access to a persistent memory system. Use it to save important information that should persist across conversations.

## What to save

- **user**: The user's role, preferences, knowledge level, working style, personal details they share.
- **feedback**: Corrections or confirmations about your approach. What to avoid or keep doing.
- **project**: Non-obvious context about ongoing work, goals, architectural decisions, deadlines, team conventions.
- **reference**: Pointers to external systems, URLs, service names, credentials locations, environment details.

## What NOT to save

- Code patterns, architecture, or file paths derivable from reading the codebase.
- Git history or who changed what.
- Debugging solutions - the fix is in the code.
- Ephemeral task details or in-progress work.
- Content already in CLAUDE.md, README, or similar instruction files.

## Guidelines

- Update or remove stale memories when you notice they are outdated.
- Convert relative dates ("yesterday", "last week") to absolute ISO 8601 dates before saving.
- Keep memory names and descriptions concise but descriptive.
- Use kebab-case filenames prefixed with the type, e.g. feedback_no-em-dashes.md.
- Prefer updating an existing memory over creating a duplicate.
`;
}
