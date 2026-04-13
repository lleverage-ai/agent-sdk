import { parseMemoryFile } from "./frontmatter.js";
import { createMemoryPath, scopeDirectory } from "./path.js";
import type { MemoryPath, MemoryStore } from "./store/types.js";
import type { MemoryEntry, MemoryScope, MemoryType } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMORY_TYPE_PREFIXES: MemoryType[] = ["user", "feedback", "project", "reference"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A parsed `[[wikilink]]` reference extracted from markdown content. */
export interface WikilinkRef {
  /** The raw matched text including brackets, e.g. `[[topic]]`. */
  raw: string;
  /** The kebab-cased topic identifier. */
  topic: string;
  /** Optional display text from `[[topic|Display Text]]` syntax. */
  displayText?: string;
  /** Whether the `global:` prefix was used. */
  forceGlobal: boolean;
}

/** Options for resolving a wikilink against the memory store. */
export interface ResolveOptions {
  /** The scope to search first. */
  scope: MemoryScope;
  /** Project identifier when scope is "project". */
  projectSlug?: string;
  /** Agent identifier when scope is "agent". */
  agentId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/g;

function toKebabCase(topic: string): string {
  return topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function tryRead(
  store: MemoryStore,
  directory: string,
  filename: string,
): Promise<MemoryEntry | null> {
  const fullPath = `${directory}/${filename}`;
  let path: MemoryPath;
  try {
    path = createMemoryPath(fullPath);
  } catch {
    return null;
  }

  const data = await store.read(path);
  if (data === null) {
    return null;
  }

  const raw = new TextDecoder().decode(data);
  return parseMemoryFile(fullPath, raw);
}

async function tryReadWithPrefixes(
  store: MemoryStore,
  directory: string,
  filename: string,
  prefixedFilenames: string[],
): Promise<MemoryEntry | null> {
  // Try exact filename first
  const entry = await tryRead(store, directory, filename);
  if (entry !== null) {
    return entry;
  }

  // Try type-prefixed variants (e.g. user_topic.md, feedback_topic.md)
  for (const prefixed of prefixedFilenames) {
    const prefixedEntry = await tryRead(store, directory, prefixed);
    if (prefixedEntry !== null) {
      return prefixedEntry;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts all `[[wikilink]]` references from markdown content.
 *
 * Supports display text (`[[topic|Display Text]]`) and global scope
 * prefixes (`[[global:topic]]`).
 *
 * @param content - The markdown content to scan
 * @returns An array of parsed wikilink references
 */
export function extractWikilinks(content: string): WikilinkRef[] {
  const results: WikilinkRef[] = [];
  let match: RegExpExecArray | null;

  // Reset the regex state for each call
  const regex = new RegExp(WIKILINK_REGEX.source, WIKILINK_REGEX.flags);

  match = regex.exec(content);
  while (match !== null) {
    const inner = match[1]!;
    const raw = match[0]!;

    let topicPart = inner;
    let displayText: string | undefined;

    // Handle display text: [[topic|Display Text]]
    const pipeIndex = inner.indexOf("|");
    if (pipeIndex !== -1) {
      topicPart = inner.slice(0, pipeIndex);
      displayText = inner.slice(pipeIndex + 1).trim();
    }

    // Handle global prefix: [[global:topic]]
    const forceGlobal = topicPart.startsWith("global:");
    if (forceGlobal) {
      topicPart = topicPart.slice("global:".length);
    }

    const topic = toKebabCase(topicPart);

    if (topic.length > 0) {
      results.push({
        raw,
        topic,
        ...(displayText !== undefined ? { displayText } : {}),
        forceGlobal,
      });
    }
    match = regex.exec(content);
  }

  return results;
}

/**
 * Resolves a wikilink reference against the memory store.
 *
 * Searches scoped directories (agent → project → global) for a matching
 * memory file. Returns `null` if no match is found.
 *
 * @param ref - The wikilink reference to resolve
 * @param store - The memory store to search
 * @param options - Scope options (scope, projectSlug, agentId)
 * @returns The resolved MemoryEntry, or `null` if not found
 */
export async function resolveWikilink(
  ref: WikilinkRef,
  store: MemoryStore,
  options: ResolveOptions,
): Promise<MemoryEntry | null> {
  const filename = `${ref.topic}.md`;
  const prefixedFilenames = MEMORY_TYPE_PREFIXES.map((t) => `${t}_${ref.topic}.md`);

  // If global: prefix, only check global scope
  if (ref.forceGlobal) {
    const globalDir = scopeDirectory("global");
    return tryReadWithPrefixes(store, globalDir, filename, prefixedFilenames);
  }

  // Otherwise, check the current scope first
  const primaryDir = scopeDirectory(options.scope, options.projectSlug, options.agentId);
  const entry = await tryReadWithPrefixes(store, primaryDir, filename, prefixedFilenames);
  if (entry !== null) {
    return entry;
  }

  // Fall back to global scope (unless already global)
  if (options.scope !== "global") {
    const globalDir = scopeDirectory("global");
    return tryReadWithPrefixes(store, globalDir, filename, prefixedFilenames);
  }

  return null;
}
