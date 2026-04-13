import { parseMemoryFile } from "./frontmatter.js";
import { createMemoryPath, scopeDirectory } from "./path.js";
import type { MemoryPath, MemoryStore } from "./store/types.js";
import type { MemoryEntry, MemoryScope } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WikilinkRef = {
  raw: string;
  topic: string;
  displayText?: string;
  forceGlobal: boolean;
};

export type ResolveOptions = {
  scope: MemoryScope;
  projectSlug?: string;
  agentId?: string;
};

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

export async function resolveWikilink(
  ref: WikilinkRef,
  store: MemoryStore,
  options: ResolveOptions,
): Promise<MemoryEntry | null> {
  const filename = `${ref.topic}.md`;

  // If global: prefix, only check global scope
  if (ref.forceGlobal) {
    const globalDir = scopeDirectory("global");
    return tryRead(store, globalDir, filename);
  }

  // Otherwise, check the current scope first
  const primaryDir = scopeDirectory(options.scope, options.projectSlug, options.agentId);
  const entry = await tryRead(store, primaryDir, filename);
  if (entry !== null) {
    return entry;
  }

  // Fall back to global scope (unless already global)
  if (options.scope !== "global") {
    const globalDir = scopeDirectory("global");
    return tryRead(store, globalDir, filename);
  }

  return null;
}
