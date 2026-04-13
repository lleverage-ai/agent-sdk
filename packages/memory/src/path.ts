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

/**
 * Validates and brands a raw string as a safe {@link MemoryPath}.
 *
 * @param raw - The raw path string to validate
 * @returns A branded MemoryPath
 * @throws {InvalidPathError} If the path fails validation
 */
export function createMemoryPath(raw: string): MemoryPath {
  const trimmed = raw.trim();

  for (const { test, reason } of INVALID_PATTERNS) {
    if (test(trimmed)) {
      throw new InvalidPathError(trimmed, reason);
    }
  }

  return trimmed as MemoryPath;
}

/**
 * Returns whether a raw string is a valid memory path.
 *
 * @param raw - The raw path string to check
 * @returns `true` if the path passes all validation rules
 */
export function isValidPath(raw: string): boolean {
  try {
    createMemoryPath(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Joins path segments and validates the result as a {@link MemoryPath}.
 *
 * @param segments - Path segments to join with `/`
 * @returns A validated MemoryPath
 * @throws {InvalidPathError} If the joined path fails validation
 */
export function joinPaths(...segments: string[]): MemoryPath {
  const joined = segments
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("/");

  return createMemoryPath(joined);
}

/**
 * Returns the parent directory of a memory path, or `null` if at the root.
 *
 * @param path - The memory path
 * @returns The parent path or `null`
 */
export function parentPath(path: MemoryPath): MemoryPath | null {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return null;
  }
  return path.slice(0, lastSlash) as MemoryPath;
}

/**
 * Returns the filename component of a memory path.
 *
 * @param path - The memory path
 * @returns The last segment of the path
 */
export function basename(path: MemoryPath): string {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return path;
  }
  return path.slice(lastSlash + 1);
}

/**
 * Strips path traversal from a filename and ensures it ends with `.md`.
 *
 * @param raw - The raw filename to sanitise
 * @returns A safe `.md` filename
 */
export function sanitiseFilename(raw: string): string {
  const lastSlash = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
  const cleaned = lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw;
  if (!cleaned.endsWith(".md")) {
    return `${cleaned}.md`;
  }
  return cleaned;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/i;

function validateSlug(value: string | undefined, label: string): string {
  if (!value || value.length === 0) {
    throw new InvalidPathError(value ?? "", `${label} must not be empty`);
  }
  if (!SLUG_PATTERN.test(value)) {
    throw new InvalidPathError(value, `${label} contains invalid characters`);
  }
  return value;
}

/**
 * Returns the scope-specific directory path for memory storage.
 *
 * @param scope - The memory scope (global, project, or agent)
 * @param projectSlug - Required when scope is "project"
 * @param agentId - Required when scope is "agent"
 * @returns The directory path string
 *
 * @throws {InvalidPathError} If projectSlug or agentId is missing or contains invalid characters
 */
export function scopeDirectory(scope: MemoryScope, projectSlug?: string, agentId?: string): string {
  switch (scope) {
    case "global":
      return "memory/global";
    case "project":
      return `memory/project/${validateSlug(projectSlug, "projectSlug")}`;
    case "agent":
      return `memory/agent/${validateSlug(agentId, "agentId")}`;
  }
}
