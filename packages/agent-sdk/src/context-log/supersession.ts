/**
 * Supersession and retraction rules for projection.
 *
 * @packageDocumentation
 */

import type { ContextEntryInput } from "./types.js";

/**
 * Returns the active entries of a path, in order: the current value of each
 * slot and every non-runtime entry.
 *
 * An entry is dropped when a later entry on the path names it in
 * `supersedes`, whether or not the later entry is a retraction. Retractions
 * themselves are dropped too. Every other entry, including user, assistant
 * and tool result entries, is kept unchanged.
 *
 * Use it to inspect a stream's current context or to plan a compaction
 * (log-mode compaction keeps only active entries). Do not use it to build a
 * projection: dropping a superseded entry rewrites the projected prefix from
 * its position, which loses the provider's prompt cache every time a slot
 * changes. The default adapter keeps superseded entries in place (from
 * version `2`) and only versions created before then project through this
 * function.
 *
 * Accepts committed entries or bare entry inputs (for example a projection
 * adapter's input, which ends with entries that are not committed yet).
 *
 * @param path - The complete path, in position order (every page, not one)
 * @returns The entries to project, in position order
 *
 * @example
 * ```typescript
 * // Supersession can reach across pages, so pass the complete path once.
 * const path: ContextEntry[] = [];
 * for (let after: number | null = 0; after !== null; ) {
 *   const page = await store.readPath(head, { after });
 *   path.push(...page.entries);
 *   after = page.nextAfter;
 * }
 * const visible = activeContextEntries(path);
 * ```
 *
 * @experimental
 * @category Context Log
 */
export function activeContextEntries<T extends ContextEntryInput>(path: readonly T[]): T[] {
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
