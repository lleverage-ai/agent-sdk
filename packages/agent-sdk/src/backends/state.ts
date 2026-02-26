/**
 * In-memory state backend for ephemeral storage.
 *
 * StateBackend provides a virtual filesystem backed by in-memory data structures.
 * All operations are synchronous and data is lost when the process ends.
 *
 * This backend is ideal for:
 * - Single-session agents without persistence needs
 * - Testing and development
 * - Sandboxed environments
 *
 * @example
 * ```typescript
 * const state: AgentState = { todos: [], files: {} };
 * const backend = new StateBackend(state);
 *
 * // Or use the factory pattern
 * const backendFactory = createStateBackend();
 * const backend = backendFactory(state);
 * ```
 *
 * @packageDocumentation
 */

import type {
  BackendProtocol,
  EditResult,
  FileData,
  FileInfo,
  GrepMatch,
  WriteResult,
} from "../backend.js";

// =============================================================================
// Agent State Types
// =============================================================================

/**
 * Status of a todo item.
 *
 * @category Backend
 */
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

/**
 * A single todo item for task tracking.
 *
 * @example
 * ```typescript
 * const todo: TodoItem = {
 *   id: "todo-1",
 *   content: "Implement feature X",
 *   status: "in_progress",
 *   createdAt: "2026-01-30T10:00:00Z",
 * };
 * ```
 *
 * @category Backend
 */
export interface TodoItem {
  /** Unique identifier for this todo */
  id: string;

  /** Description of the task */
  content: string;

  /** Current status of the task */
  status: TodoStatus;

  /** ISO 8601 timestamp when the todo was created */
  createdAt: string;

  /** ISO 8601 timestamp when the todo was completed (if applicable) */
  completedAt?: string;
}

/**
 * Complete agent state including todos and virtual filesystem.
 *
 * This interface represents the full state that can be persisted,
 * shared between agents, or used with checkpointing.
 *
 * @example
 * ```typescript
 * const state: AgentState = {
 *   todos: [],
 *   files: {
 *     "/notes.md": {
 *       content: ["# Notes", "", "Initial notes here."],
 *       created_at: new Date().toISOString(),
 *       modified_at: new Date().toISOString(),
 *     },
 *   },
 * };
 * ```
 *
 * @category Backend
 */
export interface AgentState {
  /** Current todo list */
  todos: TodoItem[];

  /** Virtual filesystem (path -> content) */
  files: Record<string, FileData>;
}

// =============================================================================
// State Backend Implementation
// =============================================================================

/**
 * In-memory backend implementation using AgentState.
 *
 * All file operations are performed on the in-memory `state.files` map.
 * Changes are immediately visible but not persisted to disk.
 *
 * @example
 * ```typescript
 * // Create with existing state
 * const state: AgentState = { todos: [], files: {} };
 * const backend = new StateBackend(state);
 *
 * // Write a file
 * await backend.write("/hello.txt", "Hello, World!");
 *
 * // Read it back
 * const content = await backend.read("/hello.txt");
 * console.log(content); // "     1→Hello, World!"
 *
 * // State is updated directly
 * console.log(state.files["/hello.txt"].content); // ["Hello, World!"]
 * ```
 *
 * @category Backend
 */
export class StateBackend implements BackendProtocol {
  /**
   * Create a new StateBackend.
   *
   * @param state - The AgentState to use for storage
   */
  constructor(private readonly state: AgentState) {}

  /**
   * List files and directories at the given path.
   *
   * @param path - Directory path to list (non-recursive)
   * @returns Array of file/directory info
   */
  lsInfo(path: string): FileInfo[] {
    // Normalize and ensure trailing slash for directory matching
    let normalizedPath = this.normalizePath(path);
    if (!normalizedPath.endsWith("/")) {
      normalizedPath += "/";
    }
    // Handle root case
    if (normalizedPath === "//") {
      normalizedPath = "/";
    }

    const results: FileInfo[] = [];
    const seen = new Set<string>();

    for (const filePath of Object.keys(this.state.files)) {
      // Check if file is under the path
      if (!filePath.startsWith(normalizedPath)) {
        continue;
      }

      const relativePath = filePath.slice(normalizedPath.length);
      const segments = relativePath.split("/").filter(Boolean);

      if (segments.length === 0) {
        continue;
      }

      if (segments.length === 1) {
        // Direct child file
        const fileData = this.state.files[filePath]!;
        results.push({
          path: filePath,
          is_dir: false,
          size: fileData.content.join("\n").length,
          modified_at: fileData.modified_at,
        });
      } else {
        // Subdirectory - construct the directory path
        const dirName = segments[0];
        const dirPath = normalizedPath + dirName;

        if (!seen.has(dirPath)) {
          seen.add(dirPath);
          results.push({
            path: dirPath,
            is_dir: true,
          });
        }
      }
    }

    return results;
  }

  /**
   * Read file content with line numbers.
   *
   * @param filePath - Path to the file to read
   * @param offset - Starting line offset (0-indexed)
   * @param limit - Maximum number of lines to read
   * @returns Formatted content with line numbers
   */
  read(filePath: string, offset?: number, limit?: number): string {
    const normalizedPath = this.normalizePath(filePath);
    const fileData = this.state.files[normalizedPath];

    if (!fileData) {
      throw new Error(`File not found: ${filePath}`);
    }

    const startLine = offset ?? 0;
    const maxLines = limit ?? 2000;
    const lines = fileData.content.slice(startLine, startLine + maxLines);

    // Format with line numbers (matching the Read tool format)
    return lines
      .map((line, i) => {
        const lineNum = startLine + i + 1;
        const padding = " ".repeat(Math.max(0, 6 - String(lineNum).length));
        return `${padding}${lineNum}→${line}`;
      })
      .join("\n");
  }

  /**
   * Read raw file content as FileData.
   *
   * @param filePath - Path to the file to read
   * @returns Raw file data with content and timestamps (deep copy)
   */
  readRaw(filePath: string): FileData {
    const normalizedPath = this.normalizePath(filePath);
    const fileData = this.state.files[normalizedPath];

    if (!fileData) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Return a deep copy to prevent mutation
    return {
      content: [...fileData.content],
      created_at: fileData.created_at,
      modified_at: fileData.modified_at,
    };
  }

  /**
   * Search for pattern matches using regex.
   *
   * @param pattern - Regular expression pattern to search for
   * @param path - Directory to search in (defaults to root)
   * @param glob - Glob pattern to filter files (e.g., "*.ts")
   * @returns Array of matches
   */
  grepRaw(pattern: string, path?: string | null, glob?: string | null): GrepMatch[] {
    const regex = new RegExp(pattern);
    const searchPath = path ? this.normalizePath(path) : "/";
    const matches: GrepMatch[] = [];

    for (const [filePath, fileData] of Object.entries(this.state.files)) {
      // Check if file is under the search path
      if (!filePath.startsWith(searchPath)) {
        continue;
      }

      // Check glob pattern if provided
      if (glob && !this.matchesGlob(filePath, glob)) {
        continue;
      }

      // Search each line
      for (let i = 0; i < fileData.content.length; i++) {
        const line = fileData.content[i]!;
        if (regex.test(line)) {
          matches.push({
            path: filePath,
            line: i + 1, // 1-indexed
            text: line,
          });
        }
      }
    }

    return matches;
  }

  /**
   * Find files matching a glob pattern.
   *
   * @param pattern - Glob pattern (e.g., "**\/*.ts")
   * @param path - Base directory for the search
   * @returns Array of matching file info
   */
  globInfo(pattern: string, path?: string): FileInfo[] {
    // Normalize search path and ensure trailing slash for directory matching
    let searchPath = path ? this.normalizePath(path) : "/";
    if (!searchPath.endsWith("/")) {
      searchPath += "/";
    }
    if (searchPath === "//") {
      searchPath = "/";
    }

    const results: FileInfo[] = [];

    for (const [filePath, fileData] of Object.entries(this.state.files)) {
      // Check if file is under the search path
      if (!filePath.startsWith(searchPath)) {
        continue;
      }

      // Get the relative path for matching (without leading slash)
      let relativePath = filePath.slice(searchPath.length);
      // Remove leading slash if present
      if (relativePath.startsWith("/")) {
        relativePath = relativePath.slice(1);
      }

      if (this.matchesGlob(relativePath, pattern)) {
        results.push({
          path: filePath,
          is_dir: false,
          size: fileData.content.join("\n").length,
          modified_at: fileData.modified_at,
        });
      }
    }

    return results;
  }

  /**
   * Create or overwrite a file.
   *
   * @param filePath - Path for the new file
   * @param content - Content to write
   * @returns Result indicating success or failure
   */
  write(filePath: string, content: string): WriteResult {
    const normalizedPath = this.normalizePath(filePath);
    const now = new Date().toISOString();

    const existingFile = this.state.files[normalizedPath];

    this.state.files[normalizedPath] = {
      content: content.split("\n"),
      created_at: existingFile?.created_at ?? now,
      modified_at: now,
    };

    return {
      success: true,
      path: normalizedPath,
    };
  }

  /**
   * Edit a file by replacing text.
   *
   * @param filePath - Path to the file to edit
   * @param oldString - Text to find and replace
   * @param newString - Replacement text
   * @param replaceAll - If true, replace all occurrences
   * @returns Result indicating success or failure
   */
  edit(filePath: string, oldString: string, newString: string, replaceAll?: boolean): EditResult {
    const normalizedPath = this.normalizePath(filePath);
    const fileData = this.state.files[normalizedPath];

    if (!fileData) {
      return {
        success: false,
        error: `File not found: ${filePath}`,
        path: normalizedPath,
      };
    }

    const fullContent = fileData.content.join("\n");
    const occurrences = fullContent.split(oldString).length - 1;

    if (occurrences === 0) {
      return {
        success: false,
        error: `String not found in file: "${oldString.slice(0, 50)}${oldString.length > 50 ? "..." : ""}"`,
        path: normalizedPath,
      };
    }

    if (occurrences > 1 && !replaceAll) {
      return {
        success: false,
        error: `Multiple occurrences (${occurrences}) found. Use replace_all=true to replace all.`,
        path: normalizedPath,
        occurrences,
      };
    }

    const newContent = replaceAll
      ? fullContent.replaceAll(oldString, newString)
      : fullContent.replace(oldString, newString);

    this.state.files[normalizedPath] = {
      ...fileData,
      content: newContent.split("\n"),
      modified_at: new Date().toISOString(),
    };

    return {
      success: true,
      path: normalizedPath,
      occurrences: replaceAll ? occurrences : 1,
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Normalize a path to ensure consistent format.
   * @internal
   */
  private normalizePath(path: string): string {
    // Ensure path starts with /
    let normalized = path.startsWith("/") ? path : `/${path}`;

    // Remove trailing slash for files
    if (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }

    // Collapse multiple slashes
    normalized = normalized.replace(/\/+/g, "/");

    return normalized;
  }

  /**
   * Check if a path matches a glob pattern.
   * Supports basic glob patterns: *, **, ?
   * @internal
   */
  private matchesGlob(path: string, pattern: string): boolean {
    // Convert glob to regex using placeholder approach to avoid
    // replacement conflicts with regex special chars
    let regexPattern = pattern
      // Escape special regex chars except * and ?
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      // ** followed by / matches any path segments including empty
      .replace(/\*\*\//g, "<<<GLOBSTAR_SLASH>>>")
      // ** at end matches any remaining path
      .replace(/\*\*/g, "<<<GLOBSTAR>>>")
      // * matches anything except /
      .replace(/\*/g, "[^/]*")
      // ? matches single char except /
      .replace(/\?/g, "[^/]")
      // Now restore globstars with actual regex
      .replace(/<<<GLOBSTAR_SLASH>>>/g, "(?:.*/)?")
      .replace(/<<<GLOBSTAR>>>/g, ".*");

    // Anchor the pattern
    regexPattern = `^${regexPattern}$`;

    return new RegExp(regexPattern).test(path);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a StateBackend factory function.
 *
 * This is useful when you need to defer backend creation until state is available,
 * such as when integrating with the agent system.
 *
 * @returns A factory function that creates a StateBackend from AgentState
 *
 * @example
 * ```typescript
 * const backendFactory = createStateBackend();
 *
 * // Later, when state is available:
 * const state: AgentState = { todos: [], files: {} };
 * const backend = backendFactory(state);
 * ```
 *
 * @category Backend
 */
export function createStateBackend(): (state: AgentState) => StateBackend {
  return (state: AgentState) => new StateBackend(state);
}

/**
 * Create a new empty AgentState.
 *
 * Convenience function to create a fresh state for testing or initialization.
 *
 * @returns A new AgentState with empty todos and files
 *
 * @example
 * ```typescript
 * const state = createAgentState();
 * const backend = new StateBackend(state);
 * ```
 *
 * @category Backend
 */
export function createAgentState(): AgentState {
  return {
    todos: [],
    files: {},
  };
}
