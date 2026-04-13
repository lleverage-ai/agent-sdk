/**
 * Memory tools for direct agent interaction with the memory store.
 *
 * @module
 */

import { parseMemoryFile, serialiseFrontmatter } from "../frontmatter.js";
import { MemoryIndex } from "../memory-index.js";
import { createMemoryPath, scopeDirectory } from "../path.js";
import type { MemoryPath, MemoryStore } from "../store/types.js";
import type { MemoryFrontmatter, MemoryScope, MemoryType } from "../types.js";

// ---------------------------------------------------------------------------
// Tool type
// ---------------------------------------------------------------------------

export type MemoryTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const VALID_TYPES = new Set<MemoryType>(["user", "feedback", "project", "reference"]);

function sanitiseFilename(raw: string): string {
  const lastSlash = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
  const cleaned = lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw;
  if (!cleaned.endsWith(".md")) {
    return `${cleaned}.md`;
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMemoryTools(
  store: MemoryStore,
  scope: MemoryScope,
  projectSlug?: string,
  agentId?: string,
): MemoryTool[] {
  const index = new MemoryIndex(store);

  // -------------------------------------------------------------------------
  // remember
  // -------------------------------------------------------------------------

  const remember: MemoryTool = {
    name: "remember",
    description:
      "Save a new memory to persistent storage. Use for important information that should persist across conversations.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable name for the memory." },
        description: {
          type: "string",
          description: "One-line description for recall and indexing.",
        },
        type: {
          type: "string",
          enum: ["user", "feedback", "project", "reference"],
          description: "Semantic category of the memory.",
        },
        content: { type: "string", description: "The memory content in markdown." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for filtering and search.",
        },
      },
      required: ["name", "description", "type", "content"],
    },
    execute: async (args) => {
      const name = args.name as string;
      const description = args.description as string;
      const memoryType = args.type as string;
      const content = args.content as string;
      const tags = Array.isArray(args.tags) ? (args.tags as string[]) : [];

      if (!name || !description || !content) {
        return "Error: name, description, and content are required.";
      }

      if (!VALID_TYPES.has(memoryType as MemoryType)) {
        return `Error: invalid type "${memoryType}". Must be one of: user, feedback, project, reference.`;
      }

      const filename = sanitiseFilename(
        `${memoryType}_${name
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "")}`,
      );
      const dir = scopeDirectory(scope, projectSlug, agentId);
      const path = createMemoryPath(`${dir}/${filename}`);

      const exists = await store.exists(path);
      if (exists) {
        return `Error: a memory at "${filename}" already exists. Use update_memory to modify it.`;
      }

      const now = new Date().toISOString();
      const frontmatter: MemoryFrontmatter = {
        name,
        description,
        type: memoryType as MemoryType,
        scope,
        tags,
        confidence: "high",
        source: "manual",
        created: now,
        modified: now,
      };

      const markdown = serialiseFrontmatter(frontmatter, content);
      await store.write(path, encoder.encode(markdown));

      await index.upsert({
        path: path as string,
        frontmatter,
        content,
        indexEntry: `- [${name}](${filename}) - ${description}`,
      });

      return `Memory "${name}" saved as ${filename}.`;
    },
  };

  // -------------------------------------------------------------------------
  // recall
  // -------------------------------------------------------------------------

  const recall: MemoryTool = {
    name: "recall",
    description: "Search persistent memory for relevant entries matching a query.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query to match against memory entries." },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return. Default: 5.",
        },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = args.query as string;
      const maxResults = typeof args.maxResults === "number" ? args.maxResults : 5;

      if (!query) {
        return "Error: query is required.";
      }

      const queryWords = new Set(
        query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2),
      );

      const dir = scopeDirectory(scope, projectSlug, agentId);
      let dirPath: MemoryPath;
      try {
        dirPath = createMemoryPath(dir);
      } catch {
        return "No memories found.";
      }

      const exists = await store.exists(dirPath);
      if (!exists) {
        return "No memories found.";
      }

      const files = await store.list(dirPath, { glob: "*.md" });
      const matches: { entry: ReturnType<typeof parseMemoryFile>; score: number }[] = [];

      for (const file of files) {
        if (file.isDirectory) continue;

        const data = await store.read(file.path);
        if (data === null) continue;

        const raw = decoder.decode(data);
        const entry = parseMemoryFile(file.path as string, raw);
        if (entry === null) continue;

        let score = 0;
        const nameWords = entry.frontmatter.name.toLowerCase();
        const descWords = entry.frontmatter.description.toLowerCase();
        const contentWords = entry.content.toLowerCase();

        for (const word of queryWords) {
          if (nameWords.includes(word)) score += 3;
          if (descWords.includes(word)) score += 2;
          if (contentWords.includes(word)) score += 1;
        }

        for (const tag of entry.frontmatter.tags) {
          if (queryWords.has(tag.toLowerCase())) score += 2;
        }

        if (score > 0) {
          matches.push({ entry, score });
        }
      }

      if (matches.length === 0) {
        return "No memories found matching the query.";
      }

      matches.sort((a, b) => b.score - a.score);
      const top = matches.slice(0, maxResults);

      const results = top.map(({ entry }) => {
        if (entry === null) return "";
        const { name, type, scope: entryScope, description } = entry.frontmatter;
        return `## ${name} (${type}, ${entryScope})\n${description}\n\n${entry.content}`;
      });

      return results.join("\n\n---\n\n");
    },
  };

  // -------------------------------------------------------------------------
  // forget
  // -------------------------------------------------------------------------

  const forget: MemoryTool = {
    name: "forget",
    description: "Remove a memory from persistent storage by its filename or name.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "The filename (e.g. feedback_no-em-dashes.md) or the human-readable name of the memory to remove.",
        },
      },
      required: ["name"],
    },
    execute: async (args) => {
      const nameArg = args.name as string;

      if (!nameArg) {
        return "Error: name is required.";
      }

      const dir = scopeDirectory(scope, projectSlug, agentId);
      let dirPath: MemoryPath;
      try {
        dirPath = createMemoryPath(dir);
      } catch {
        return `Error: memory "${nameArg}" not found.`;
      }

      const exists = await store.exists(dirPath);
      if (!exists) {
        return `Error: memory "${nameArg}" not found.`;
      }

      // Try direct filename match first
      const filename = sanitiseFilename(nameArg);
      const directPath = createMemoryPath(`${dir}/${filename}`);
      const directExists = await store.exists(directPath);

      if (directExists) {
        await store.delete(directPath);
        await index.remove(directPath as string);
        return `Memory "${filename}" removed.`;
      }

      // Search by human-readable name
      const files = await store.list(dirPath, { glob: "*.md" });
      for (const file of files) {
        if (file.isDirectory) continue;

        const data = await store.read(file.path);
        if (data === null) continue;

        const raw = decoder.decode(data);
        const entry = parseMemoryFile(file.path as string, raw);
        if (entry === null) continue;

        if (entry.frontmatter.name.toLowerCase() === nameArg.toLowerCase()) {
          await store.delete(file.path);
          await index.remove(file.path as string);
          const matchedFilename = (file.path as string).split("/").pop() ?? file.path;
          return `Memory "${matchedFilename}" removed.`;
        }
      }

      return `Error: memory "${nameArg}" not found.`;
    },
  };

  // -------------------------------------------------------------------------
  // update_memory
  // -------------------------------------------------------------------------

  const updateMemory: MemoryTool = {
    name: "update_memory",
    description: "Modify an existing memory's content or description.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "The filename (e.g. feedback_no-em-dashes.md) or the human-readable name of the memory to update.",
        },
        content: { type: "string", description: "New content for the memory." },
        description: { type: "string", description: "New description for the memory." },
      },
      required: ["name"],
    },
    execute: async (args) => {
      const nameArg = args.name as string;
      const newContent = typeof args.content === "string" ? args.content : undefined;
      const newDescription = typeof args.description === "string" ? args.description : undefined;

      if (!nameArg) {
        return "Error: name is required.";
      }

      if (newContent === undefined && newDescription === undefined) {
        return "Error: at least one of content or description must be provided.";
      }

      const dir = scopeDirectory(scope, projectSlug, agentId);
      let dirPath: MemoryPath;
      try {
        dirPath = createMemoryPath(dir);
      } catch {
        return `Error: memory "${nameArg}" not found.`;
      }

      const dirExists = await store.exists(dirPath);
      if (!dirExists) {
        return `Error: memory "${nameArg}" not found.`;
      }

      // Try direct filename match first, then name search
      let targetPath: MemoryPath | null = null;

      const filename = sanitiseFilename(nameArg);
      const directPath = createMemoryPath(`${dir}/${filename}`);
      if (await store.exists(directPath)) {
        targetPath = directPath;
      }

      if (targetPath === null) {
        const files = await store.list(dirPath, { glob: "*.md" });
        for (const file of files) {
          if (file.isDirectory) continue;

          const data = await store.read(file.path);
          if (data === null) continue;

          const raw = decoder.decode(data);
          const entry = parseMemoryFile(file.path as string, raw);
          if (entry === null) continue;

          if (entry.frontmatter.name.toLowerCase() === nameArg.toLowerCase()) {
            targetPath = file.path;
            break;
          }
        }
      }

      if (targetPath === null) {
        return `Error: memory "${nameArg}" not found.`;
      }

      // Read, merge, write back
      const data = await store.read(targetPath);
      if (data === null) {
        return `Error: could not read memory "${nameArg}".`;
      }

      const raw = decoder.decode(data);
      const entry = parseMemoryFile(targetPath as string, raw);
      if (entry === null) {
        return `Error: could not parse memory "${nameArg}".`;
      }

      const updatedFrontmatter: MemoryFrontmatter = {
        ...entry.frontmatter,
        modified: new Date().toISOString(),
      };

      if (newDescription !== undefined) {
        updatedFrontmatter.description = newDescription;
      }

      const updatedContent = newContent ?? entry.content;
      const markdown = serialiseFrontmatter(updatedFrontmatter, updatedContent);
      await store.write(targetPath, encoder.encode(markdown));

      const targetFilename = (targetPath as string).split("/").pop() ?? targetPath;
      await index.upsert({
        path: targetPath as string,
        frontmatter: updatedFrontmatter,
        content: updatedContent,
        indexEntry: `- [${updatedFrontmatter.name}](${targetFilename}) - ${updatedFrontmatter.description}`,
      });

      return `Memory "${updatedFrontmatter.name}" updated.`;
    },
  };

  return [remember, recall, forget, updateMemory];
}
