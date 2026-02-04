/**
 * Backend system for pluggable storage.
 *
 * This module provides the core interfaces and implementations for storage backends.
 * Backends abstract file operations, allowing the same agent code to work with
 * in-memory state, real filesystems, or persistent stores.
 *
 * @packageDocumentation
 */

// =============================================================================
// File Types
// =============================================================================

/**
 * Metadata for a file or directory entry.
 *
 * @example
 * ```typescript
 * const files: FileInfo[] = await backend.lsInfo("/src");
 * files.forEach(f => {
 *   console.log(`${f.path} - ${f.is_dir ? "dir" : f.size + " bytes"}`);
 * });
 * ```
 *
 * @category Backend
 */
export interface FileInfo {
  /** Path to the file or directory */
  path: string;

  /** True if this entry is a directory */
  is_dir?: boolean;

  /** Size in bytes (files only) */
  size?: number;

  /** ISO 8601 timestamp of last modification */
  modified_at?: string;
}

/**
 * File content storage format.
 *
 * Used by `readRaw()` to return file content with metadata.
 *
 * @category Backend
 */
export interface FileData {
  /** Lines of text content */
  content: string[];

  /** ISO 8601 timestamp when file was created */
  created_at: string;

  /** ISO 8601 timestamp of last modification */
  modified_at: string;
}

// =============================================================================
// Search Types
// =============================================================================

/**
 * A match from a grep search operation.
 *
 * @example
 * ```typescript
 * const matches = await backend.grepRaw("TODO:", "/src");
 * for (const match of matches) {
 *   console.log(`${match.path}:${match.line}: ${match.text}`);
 * }
 * ```
 *
 * @category Backend
 */
export interface GrepMatch {
  /** Path to the file containing the match */
  path: string;

  /** Line number (1-indexed) */
  line: number;

  /** The matching line text */
  text: string;
}

// =============================================================================
// Operation Result Types
// =============================================================================

/**
 * Result from a write operation.
 *
 * @category Backend
 */
export interface WriteResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Path that was written to */
  path?: string;
}

/**
 * Result from an edit operation.
 *
 * @category Backend
 */
export interface EditResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Path that was edited */
  path?: string;

  /** Number of occurrences replaced (when replace_all is true) */
  occurrences?: number;
}

// =============================================================================
// Backend Protocol
// =============================================================================

/**
 * Core backend protocol interface for file operations.
 *
 * All storage backends implement this interface, providing a consistent API
 * for file operations regardless of the underlying storage mechanism.
 *
 * Backends may optionally support command execution by implementing the
 * `execute()` method. Use {@link hasExecuteCapability} to check if a backend
 * supports execution before calling it.
 *
 * @example
 * ```typescript
 * // Using with StateBackend (in-memory)
 * const state = { todos: [], files: {} };
 * const backend: BackendProtocol = new StateBackend(state);
 *
 * // Using with FilesystemBackend (real filesystem with bash)
 * const backend: BackendProtocol = new FilesystemBackend({
 *   rootDir: process.cwd(),
 *   enableBash: true,
 * });
 *
 * // Operations work the same regardless of backend
 * const content = await backend.read("/src/index.ts");
 * const files = await backend.globInfo("**\/*.ts");
 *
 * // Check for execute capability
 * if (hasExecuteCapability(backend)) {
 *   const result = await backend.execute("echo hello");
 * }
 * ```
 *
 * @category Backend
 */
export interface BackendProtocol {
  /**
   * List files and directories with metadata.
   *
   * @param path - Directory path to list (non-recursive)
   * @returns Array of file/directory info
   *
   * @example
   * ```typescript
   * const entries = await backend.lsInfo("/src");
   * const dirs = entries.filter(e => e.is_dir);
   * const files = entries.filter(e => !e.is_dir);
   * ```
   */
  lsInfo(path: string): FileInfo[] | Promise<FileInfo[]>;

  /**
   * Read file content with optional line numbers.
   *
   * Returns content formatted with line numbers for display, suitable for
   * showing to the model or user.
   *
   * @param filePath - Path to the file to read
   * @param offset - Starting line offset (0-indexed)
   * @param limit - Maximum number of lines to read
   * @returns Formatted content with line numbers
   *
   * @example
   * ```typescript
   * // Read first 50 lines
   * const content = await backend.read("/src/index.ts", 0, 50);
   *
   * // Read lines 100-200
   * const content = await backend.read("/src/index.ts", 100, 100);
   * ```
   */
  read(filePath: string, offset?: number, limit?: number): string | Promise<string>;

  /**
   * Read raw file content as FileData.
   *
   * Returns the content as an array of lines with timestamps, useful for
   * programmatic access to file content.
   *
   * @param filePath - Path to the file to read
   * @returns Raw file data with content and timestamps
   */
  readRaw(filePath: string): FileData | Promise<FileData>;

  /**
   * Search for pattern matches using regex.
   *
   * @param pattern - Regular expression pattern to search for
   * @param path - Directory to search in (defaults to root)
   * @param glob - Glob pattern to filter files (e.g., "*.ts")
   * @returns Array of matches or formatted string
   *
   * @example
   * ```typescript
   * // Search for TODO comments in TypeScript files
   * const matches = await backend.grepRaw(
   *   "TODO:",
   *   "/src",
   *   "*.ts"
   * );
   * ```
   */
  grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null,
  ): GrepMatch[] | string | Promise<GrepMatch[] | string>;

  /**
   * Find files matching a glob pattern.
   *
   * @param pattern - Glob pattern (e.g., "**\/*.ts", "src/**\/*.test.ts")
   * @param path - Base directory for the search
   * @returns Array of matching file info
   *
   * @example
   * ```typescript
   * // Find all TypeScript files
   * const tsFiles = await backend.globInfo("**\/*.ts", "/src");
   *
   * // Find all test files
   * const testFiles = await backend.globInfo("**\/*.test.ts");
   * ```
   */
  globInfo(pattern: string, path?: string): FileInfo[] | Promise<FileInfo[]>;

  /**
   * Create or overwrite a file.
   *
   * @param filePath - Path for the new file
   * @param content - Content to write
   * @returns Result indicating success or failure
   *
   * @example
   * ```typescript
   * const result = await backend.write(
   *   "/src/new-file.ts",
   *   "export const hello = 'world';\n"
   * );
   * if (!result.success) {
   *   console.error("Write failed:", result.error);
   * }
   * ```
   */
  write(filePath: string, content: string): WriteResult | Promise<WriteResult>;

  /**
   * Edit a file by replacing text.
   *
   * The `old_string` must be unique in the file unless `replace_all` is true.
   * This prevents accidental replacements of unintended matches.
   *
   * @param filePath - Path to the file to edit
   * @param oldString - Text to find and replace
   * @param newString - Replacement text
   * @param replaceAll - If true, replace all occurrences; if false, fail on non-unique match
   * @returns Result indicating success or failure
   *
   * @example
   * ```typescript
   * // Replace a single unique occurrence
   * const result = await backend.edit(
   *   "/src/config.ts",
   *   "export const DEBUG = false;",
   *   "export const DEBUG = true;"
   * );
   *
   * // Replace all occurrences
   * const result = await backend.edit(
   *   "/src/types.ts",
   *   "interface",
   *   "type",
   *   true
   * );
   * ```
   */
  edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): EditResult | Promise<EditResult>;

  // ===========================================================================
  // Optional: Command Execution
  // ===========================================================================

  /**
   * Optional unique identifier for this backend instance.
   * Useful for tracking and debugging when multiple backends are in use.
   */
  readonly id?: string;

  /**
   * Execute a shell command in the backend environment.
   *
   * This method is optional. Use {@link hasExecuteCapability} to check
   * if a backend supports command execution before calling this method.
   *
   * @param command - Shell command to execute
   * @returns Execution result with output and exit code
   *
   * @example
   * ```typescript
   * if (hasExecuteCapability(backend)) {
   *   const result = await backend.execute("ls -la /src");
   *   if (result.exitCode === 0) {
   *     console.log("Output:", result.output);
   *   }
   * }
   * ```
   */
  execute?(command: string): Promise<ExecuteResponse>;

  /**
   * Upload files to the backend.
   *
   * This method is optional and typically used with sandboxed or remote backends.
   *
   * @param files - Array of [path, content] tuples
   * @returns Array of upload results
   */
  uploadFiles?(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]>;

  /**
   * Download files from the backend.
   *
   * This method is optional and typically used with sandboxed or remote backends.
   *
   * @param paths - Paths to download
   * @returns Array of { path, content } objects
   */
  downloadFiles?(paths: string[]): Promise<Array<{ path: string; content: Uint8Array }>>;
}

// =============================================================================
// Sandbox Backend Protocol
// =============================================================================

/**
 * Response from command execution.
 *
 * @category Backend
 */
export interface ExecuteResponse {
  /** Combined stdout and stderr output */
  output: string;

  /** Exit code from the command (null if terminated) */
  exitCode: number | null;

  /** Whether output was truncated due to size limits */
  truncated: boolean;
}

/**
 * Response from file upload operation.
 *
 * @category Backend
 */
export interface FileUploadResponse {
  /** Path where the file was uploaded */
  path: string;

  /** Whether the upload succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value implements the BackendProtocol interface.
 *
 * @param value - Value to check
 * @returns True if value is a BackendProtocol
 *
 * @example
 * ```typescript
 * function processBackend(backend: unknown) {
 *   if (isBackend(backend)) {
 *     const files = await backend.lsInfo("/");
 *   }
 * }
 * ```
 *
 * @category Backend
 */
export function isBackend(value: unknown): value is BackendProtocol {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.lsInfo === "function" &&
    typeof obj.read === "function" &&
    typeof obj.readRaw === "function" &&
    typeof obj.grepRaw === "function" &&
    typeof obj.globInfo === "function" &&
    typeof obj.write === "function" &&
    typeof obj.edit === "function"
  );
}

/**
 * Backend with execute capability.
 *
 * This type represents a BackendProtocol that has the `execute()` method available.
 * Use {@link hasExecuteCapability} to narrow a BackendProtocol to this type.
 *
 * @category Backend
 */
export interface ExecutableBackend extends BackendProtocol {
  /** Unique identifier for this backend instance */
  readonly id: string;

  /** Execute a shell command */
  execute(command: string): Promise<ExecuteResponse>;
}

/**
 * Check if a backend supports command execution.
 *
 * Use this to safely narrow a BackendProtocol to one that supports the `execute()` method.
 * This is the recommended way to check for execute capability.
 *
 * @param backend - Backend to check
 * @returns True if the backend supports execute()
 *
 * @example
 * ```typescript
 * function maybeRunCommand(backend: BackendProtocol, command: string) {
 *   if (hasExecuteCapability(backend)) {
 *     return backend.execute(command);
 *   }
 *   throw new Error("Backend does not support command execution");
 * }
 *
 * // With FilesystemBackend that has bash enabled
 * const backend = new FilesystemBackend({
 *   rootDir: process.cwd(),
 *   enableBash: true,
 * });
 *
 * if (hasExecuteCapability(backend)) {
 *   const result = await backend.execute("npm test");
 * }
 * ```
 *
 * @category Backend
 */
export function hasExecuteCapability(
  backend: BackendProtocol | null | undefined,
): backend is ExecutableBackend {
  if (!backend || typeof backend !== "object") {
    return false;
  }
  const obj = backend as unknown as Record<string, unknown>;
  return typeof obj.id === "string" && typeof obj.execute === "function";
}
