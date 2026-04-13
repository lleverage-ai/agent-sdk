import { parseMemoryFile } from "./frontmatter.js";
import { basename, createMemoryPath, scopeDirectory } from "./path.js";
import type { MemoryPath, MemoryStore } from "./store/types.js";
import type { MemoryEntry, MemoryScope } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IndexItem = {
  name: string;
  filename: string;
  description: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDEX_FILENAME = "MEMORY.md";
const INDEX_LINE_REGEX = /^- \[([^\]]+)\]\(([^)]+)\) - (.+)$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function indexPath(scope: MemoryScope, projectSlug?: string, agentId?: string): MemoryPath {
  const dir = scopeDirectory(scope, projectSlug, agentId);
  return createMemoryPath(`${dir}/${INDEX_FILENAME}`);
}

function serialiseIndex(items: IndexItem[]): string {
  if (items.length === 0) {
    return "";
  }
  return (
    items.map((item) => `- [${item.name}](${item.filename}) - ${item.description}`).join("\n") +
    "\n"
  );
}

function parseIndexLine(line: string): IndexItem | null {
  const match = INDEX_LINE_REGEX.exec(line.trim());
  if (match === null) {
    return null;
  }
  return {
    name: match[1]!,
    filename: match[2]!,
    description: match[3]!,
  };
}

function scopeFromEntry(entry: MemoryEntry): {
  scope: MemoryScope;
  projectSlug?: string;
  agentId?: string;
} {
  const segments = entry.path.split("/");
  // Expected: memory/{scope-type}/...
  const scopeType = segments[1];

  switch (scopeType) {
    case "global":
      return { scope: "global" };
    case "project":
      return { scope: "project", projectSlug: segments[2] };
    case "agent":
      return { scope: "agent", agentId: segments[2] };
    default:
      return { scope: entry.frontmatter.scope };
  }
}

// ---------------------------------------------------------------------------
// MemoryIndex
// ---------------------------------------------------------------------------

export class MemoryIndex {
  constructor(private store: MemoryStore) {}

  async load(scope: MemoryScope, projectSlug?: string, agentId?: string): Promise<IndexItem[]> {
    const path = indexPath(scope, projectSlug, agentId);
    const data = await this.store.read(path);
    if (data === null) {
      return [];
    }

    const raw = decoder.decode(data);
    const items: IndexItem[] = [];

    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }
      const item = parseIndexLine(line);
      if (item !== null) {
        items.push(item);
      }
    }

    return items;
  }

  async rebuild(scope: MemoryScope, projectSlug?: string, agentId?: string): Promise<void> {
    const dir = scopeDirectory(scope, projectSlug, agentId);
    const dirPath = createMemoryPath(dir);
    const files = await this.store.list(dirPath, { recursive: false });

    const items: IndexItem[] = [];

    for (const file of files) {
      if (file.isDirectory) {
        continue;
      }

      const filename = basename(file.path);
      if (filename === INDEX_FILENAME || !filename.endsWith(".md")) {
        continue;
      }

      const data = await this.store.read(file.path);
      if (data === null) {
        continue;
      }

      const raw = decoder.decode(data);
      const fullPath = file.path as string;
      const entry = parseMemoryFile(fullPath, raw);
      if (entry === null) {
        continue;
      }

      items.push({
        name: entry.frontmatter.name,
        filename,
        description: entry.frontmatter.description,
      });
    }

    items.sort((a, b) => a.name.localeCompare(b.name));

    const path = indexPath(scope, projectSlug, agentId);
    await this.store.write(path, encoder.encode(serialiseIndex(items)));
  }

  async upsert(entry: MemoryEntry): Promise<void> {
    const { scope, projectSlug, agentId } = scopeFromEntry(entry);
    const items = await this.load(scope, projectSlug, agentId);

    const segments = entry.path.split("/");
    const filename = segments[segments.length - 1]!;

    const newItem: IndexItem = {
      name: entry.frontmatter.name,
      filename,
      description: entry.frontmatter.description,
    };

    const existingIndex = items.findIndex((item) => item.filename === filename);
    if (existingIndex !== -1) {
      items[existingIndex] = newItem;
    } else {
      items.push(newItem);
    }

    items.sort((a, b) => a.name.localeCompare(b.name));

    const path = indexPath(scope, projectSlug, agentId);
    await this.store.write(path, encoder.encode(serialiseIndex(items)));
  }

  async remove(path: string): Promise<void> {
    const segments = path.split("/");
    const filename = segments[segments.length - 1]!;
    const scopeType = segments[1];

    let scope: MemoryScope;
    let projectSlug: string | undefined;
    let agentId: string | undefined;

    switch (scopeType) {
      case "global":
        scope = "global";
        break;
      case "project":
        scope = "project";
        projectSlug = segments[2];
        break;
      case "agent":
        scope = "agent";
        agentId = segments[2];
        break;
      default:
        return;
    }

    const items = await this.load(scope, projectSlug, agentId);
    const filtered = items.filter((item) => item.filename !== filename);

    if (filtered.length === items.length) {
      return;
    }

    const idxPath = indexPath(scope, projectSlug, agentId);
    await this.store.write(idxPath, encoder.encode(serialiseIndex(filtered)));
  }
}
