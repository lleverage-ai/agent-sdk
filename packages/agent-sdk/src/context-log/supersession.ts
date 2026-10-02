/**
 * Supersession and retraction rules for projection.
 *
 * @packageDocumentation
 */

import type { ContextEntry } from "./types.js";

/**
 * Returns the entries of a path that a projection should emit, in order.
 *
 * An entry is dropped when a later entry on the path names it in
 * `supersedes`, whether or not the later entry is a retraction. Retractions
 * themselves are never emitted. Every other entry, including user, assistant
 * and tool result entries, is kept unchanged.
 *
 * @param path - The full path, in position order
 * @returns The entries to project, in position order
 *
 * @example
 * ```typescript
 * const page = await store.readPath(head);
 * const visible = activeContextEntries(page.entries);
 * ```
 *
 * @experimental
 * @category Context Log
 */
export function activeContextEntries(path: readonly ContextEntry[]): ContextEntry[] {
  const superseded = new Set<string>();
  for (const entry of path) {
    if (entry.kind === "runtime_context" && entry.supersedes !== undefined) {
      superseded.add(entry.supersedes);
    }
  }
  return path.filter(
    (entry) =>
      !superseded.has(entry.key) &&
      !(entry.kind === "runtime_context" && entry.retraction === true),
  );
}
