import { InvalidPathError } from "./store/types.js";
import type { MemoryScope } from "./types.js";

export type { MemoryPath } from "./store/types.js";

type MemoryPath = import("./store/types.js").MemoryPath;

const INVALID_PATTERNS = [
  { test: (s: string) => s.length === 0, reason: "path must not be empty" },
  { test: (s: string) => s.startsWith("/"), reason: "path must not start with a slash" },
  { test: (s: string) => s.endsWith("/"), reason: "path must not end with a slash" },
  { test: (s: string) => s.includes("\\"), reason: "path must not contain backslashes" },
  { test: (s: string) => s.includes("//"), reason: "path must not contain empty segments" },
  { test: (s: string) => s.startsWith("."), reason: "path must not start with a dot" },
  {
    test: (s: string) => s.split("/").some((seg) => seg === ".."),
    reason: "path must not contain '..' segments",
  },
] as const;

export function createMemoryPath(raw: string): MemoryPath {
  const trimmed = raw.trim();

  for (const { test, reason } of INVALID_PATTERNS) {
    if (test(trimmed)) {
      throw new InvalidPathError(trimmed, reason);
    }
  }

  return trimmed as MemoryPath;
}

export function isValidPath(raw: string): boolean {
  try {
    createMemoryPath(raw);
    return true;
  } catch {
    return false;
  }
}

export function joinPaths(...segments: string[]): MemoryPath {
  const joined = segments
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("/");

  return createMemoryPath(joined);
}

export function parentPath(path: MemoryPath): MemoryPath | null {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return null;
  }
  return path.slice(0, lastSlash) as MemoryPath;
}

export function basename(path: MemoryPath): string {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return path;
  }
  return path.slice(lastSlash + 1);
}

/**
 * Returns the scope-specific directory path for memory storage.
 *
 * @param scope - The memory scope (global, project, or agent)
 * @param projectSlug - Required when scope is "project"
 * @param agentId - Required when scope is "agent"
 * @returns The directory path string
 */
export function scopeDirectory(scope: MemoryScope, projectSlug?: string, agentId?: string): string {
  switch (scope) {
    case "global":
      return "memory/global";
    case "project":
      return `memory/project/${projectSlug}`;
    case "agent":
      return `memory/agent/${agentId}`;
  }
}
