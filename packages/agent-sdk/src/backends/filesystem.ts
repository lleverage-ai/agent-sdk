/**
 * Filesystem backend for disk persistence.
 *
 * FilesystemBackend provides file operations on the real filesystem with
 * security protections against directory traversal, symlink attacks, and
 * excessive file sizes.
 *
 * This backend is ideal for:
 * - Persistent agents that need to read/write real files
 * - Development environments
 * - Local tooling and automation
 *
 * @example
 * ```typescript
 * const backend = new FilesystemBackend({
 *   rootDir: process.cwd(),
 *   maxFileSizeMb: 10,
 * });
 *
 * // Read a file
 * const content = await backend.read("./src/index.ts");
 *
 * // Write a file
 * await backend.write("./output.txt", "Generated content");
 * ```
 *
 * @packageDocumentation
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  BackendProtocol,
  EditResult,
  ExecuteBackgroundOptions,
  ExecuteBackgroundResult,
  ExecuteResponse,
  FileData,
  FileInfo,
  FileUploadResponse,
  GrepMatch,
  WriteResult,
} from "../backend.js";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration options for FilesystemBackend.
 *
 * @example
 * ```typescript
 * // Basic filesystem backend (no bash)
 * const backend = new FilesystemBackend({
 *   rootDir: "/home/user/project",
 *   maxFileSizeMb: 5,
 * });
 *
 * // Filesystem backend with bash enabled
 * const backendWithBash = new FilesystemBackend({
 *   rootDir: "/home/user/project",
 *   enableBash: true,
 *   timeout: 30000,
 *   blockedCommands: ["rm -rf /"],
 * });
 * ```
 *
 * @category Backend
 */
export interface FilesystemBackendOptions {
  /**
   * Base directory for all operations.
   * All paths are resolved relative to this directory.
   * @defaultValue process.cwd()
   */
  rootDir?: string;

  /**
   * Maximum file size in megabytes for read operations.
   * Files larger than this will be rejected with an error.
   * @defaultValue 10
   */
  maxFileSizeMb?: number;

  /**
   * Whether to follow symbolic links.
   * When false (default), symlinks are rejected for security.
   * @defaultValue false
   */
  followSymlinks?: boolean;

  /**
   * Additional paths that are allowed outside rootDir.
   * Useful for accessing system paths like /tmp.
   */
  allowedPaths?: string[];

  // ===========================================================================
  // Bash Execution Options
  // ===========================================================================

  /**
   * Enable shell command execution via the `execute()` method.
   * When false (default), the backend only supports file operations.
   * @defaultValue false
   */
  enableBash?: boolean;

  /**
   * Default timeout in milliseconds for command execution.
   * Only used when enableBash is true.
   * @defaultValue 120000 (2 minutes)
   */
  timeout?: number;

  /**
   * Maximum output size in bytes before truncation.
   * Only used when enableBash is true.
   * @defaultValue 1048576 (1MB)
   */
  maxOutputSize?: number;

  /**
   * Shell to use for command execution.
   * Only used when enableBash is true.
   * @defaultValue "/bin/sh" on Unix, "cmd.exe" on Windows
   */
  shell?: string;

  /**
   * Environment variables to set for all commands.
   * Only used when enableBash is true.
   */
  env?: Record<string, string>;

  /**
   * Commands or patterns that are blocked from execution.
   * Supports simple string matching and regex patterns.
   * Only used when enableBash is true.
   */
  blockedCommands?: Array<string | RegExp>;

  /**
   * Only allow these commands to be executed.
   * If set, only commands matching these patterns are allowed.
   * Only used when enableBash is true.
   */
  allowedCommands?: Array<string | RegExp>;

  /**
   * Whether to allow potentially dangerous commands.
   * When false (default), certain dangerous patterns are blocked.
   * Only used when enableBash is true.
   * @defaultValue false
   */
  allowDangerous?: boolean;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when a path traversal attack is detected.
 *
 * @category Backend
 */
export class PathTraversalError extends Error {
  constructor(
    public readonly attemptedPath: string,
    public readonly rootDir: string,
  ) {
    super(`Path traversal detected: "${attemptedPath}" escapes root directory "${rootDir}"`);
    this.name = "PathTraversalError";
  }
}

/**
 * Error thrown when a symlink is encountered and not allowed.
 *
 * @category Backend
 */
export class SymlinkError extends Error {
  constructor(public readonly path: string) {
    super(`Symbolic link not allowed: "${path}"`);
    this.name = "SymlinkError";
  }
}

/**
 * Error thrown when a file exceeds the size limit.
 *
 * @category Backend
 */
export class FileSizeLimitError extends Error {
  constructor(
    public readonly path: string,
    public readonly sizeMb: number,
    public readonly limitMb: number,
  ) {
    super(`File "${path}" (${sizeMb.toFixed(2)}MB) exceeds size limit of ${limitMb}MB`);
    this.name = "FileSizeLimitError";
  }
}

// =============================================================================
// Dangerous Command Patterns
// =============================================================================

/**
 * Default patterns that are considered dangerous.
 * These are blocked unless allowDangerous is true.
 *
 * @category Backend
 */
export const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  // Recursive force delete from root or home
  /rm\s+(-[a-z]*r[a-z]*\s+)?(-[a-z]*f[a-z]*\s+)?[/~]/i,
  /rm\s+(-[a-z]*f[a-z]*\s+)?(-[a-z]*r[a-z]*\s+)?[/~]/i,
  // Format/wipe commands
  /mkfs\./i,
  /dd\s+.*of=\/dev\//i,
  // Shutdown/reboot
  /shutdown/i,
  /reboot/i,
  /halt/i,
  /poweroff/i,
  // Fork bombs
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/,
  // Overwrite important files
  />\s*\/etc\/(passwd|shadow|sudoers)/i,
  // Downloading and executing
  /curl.*\|\s*(ba)?sh/i,
  /wget.*\|\s*(ba)?sh/i,
  // Chmod dangerous patterns
  /chmod\s+777\s+\//i,
  /chmod\s+-R\s+777/i,
  // Environment manipulation that could be dangerous
  /export\s+PATH\s*=\s*$/i,
];

/**
 * Error thrown when a command is blocked by security filters.
 *
 * @category Backend
 */
export class CommandBlockedError extends Error {
  constructor(
    public readonly command: string,
    public readonly reason: string,
  ) {
    super(`Command blocked: ${reason}`);
    this.name = "CommandBlockedError";
  }
}

/**
 * Error thrown when a command execution times out.
 *
 * @category Backend
 */
export class CommandTimeoutError extends Error {
  constructor(
    public readonly command: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Command timed out after ${timeoutMs}ms: "${command.slice(0, 100)}${command.length > 100 ? "..." : ""}"`,
    );
    this.name = "CommandTimeoutError";
  }
}

// =============================================================================
// Filesystem Backend Implementation
// =============================================================================

/**
 * Filesystem backend implementation for real disk operations.
 *
 * Provides secure file operations with protections against:
 * - Directory traversal attacks (../ paths)
 * - Symlink attacks
 * - Excessive file sizes
 *
 * Optionally supports shell command execution when `enableBash` is true.
 *
 * @example
 * ```typescript
 * // Basic usage - file operations only
 * const backend = new FilesystemBackend({
 *   rootDir: "/home/user/project",
 *   maxFileSizeMb: 10,
 * });
 *
 * // With bash enabled
 * const backend = new FilesystemBackend({
 *   rootDir: "/home/user/project",
 *   enableBash: true,
 *   timeout: 30000,
 * });
 *
 * // List files
 * const files = await backend.lsInfo("./src");
 *
 * // Read with line numbers
 * const content = await backend.read("./src/index.ts");
 *
 * // Search for patterns
 * const matches = await backend.grepRaw("TODO", "./src", "*.ts");
 *
 * // Execute commands (if enableBash is true)
 * if (hasExecuteCapability(backend)) {
 *   const result = await backend.execute("npm test");
 * }
 * ```
 *
 * @category Backend
 */
export class FilesystemBackend implements BackendProtocol {
  /** Unique identifier for this backend instance */
  public readonly id: string;

  private readonly rootDir: string;
  private readonly maxFileSizeMb: number;
  private readonly followSymlinks: boolean;
  private readonly allowedPaths: Set<string>;

  // Bash execution options
  private readonly enableBash: boolean;
  private readonly timeout: number;
  private readonly maxOutputSize: number;
  private readonly shell: string;
  private readonly env: Record<string, string>;
  private readonly blockedCommands: Array<string | RegExp>;
  private readonly allowedCommands?: Array<string | RegExp>;
  private readonly allowDangerous: boolean;

  /**
   * Create a new FilesystemBackend.
   *
   * @param options - Configuration options
   */
  constructor(options: FilesystemBackendOptions = {}) {
    // Generate unique ID
    this.id = `fs-${randomUUID()}`;

    // Resolve symlinks in rootDir to handle cases like /tmp -> /private/tmp on macOS
    // This ensures symlink checks within rootDir work correctly
    const resolvedRoot = path.resolve(options.rootDir ?? process.cwd());
    try {
      this.rootDir = fsSync.realpathSync(resolvedRoot);
    } catch {
      // If rootDir doesn't exist yet, use the resolved path
      this.rootDir = resolvedRoot;
    }
    this.maxFileSizeMb = options.maxFileSizeMb ?? 10;
    this.followSymlinks = options.followSymlinks ?? false;
    // Also resolve symlinks in allowedPaths for consistency
    this.allowedPaths = new Set(
      (options.allowedPaths ?? []).map((p) => {
        const resolved = path.resolve(p);
        try {
          return fsSync.realpathSync(resolved);
        } catch {
          return resolved;
        }
      }),
    );

    // Initialize bash execution options
    this.enableBash = options.enableBash ?? false;
    this.timeout = options.timeout ?? 120000; // 2 minutes default
    this.maxOutputSize = options.maxOutputSize ?? 1048576; // 1MB default
    this.shell = options.shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
    this.env = { ...process.env, ...options.env } as Record<string, string>;
    this.blockedCommands = options.blockedCommands ?? [];
    this.allowedCommands = options.allowedCommands;
    this.allowDangerous = options.allowDangerous ?? false;
  }

  /**
   * List files and directories at the given path.
   *
   * @param dirPath - Directory path to list (non-recursive)
   * @returns Array of file/directory info
   */
  async lsInfo(dirPath: string): Promise<FileInfo[]> {
    const resolvedPath = await this.resolvePath(dirPath);
    const results: FileInfo[] = [];

    try {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(resolvedPath, entry.name);

        // Skip symlinks if not following them
        if (entry.isSymbolicLink() && !this.followSymlinks) {
          continue;
        }

        try {
          const stat = await fs.stat(entryPath);
          const relativePath = this.makeRelativePath(entryPath);

          results.push({
            path: relativePath,
            is_dir: stat.isDirectory(),
            size: stat.isDirectory() ? undefined : stat.size,
            modified_at: stat.mtime.toISOString(),
          });
        } catch {
          // Skip entries we can't stat (permission errors, etc.)
        }
      }
    } catch (error) {
      if (this.isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
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
  async read(filePath: string, offset?: number, limit?: number): Promise<string> {
    const resolvedPath = await this.resolvePath(filePath);
    await this.validateFileAccess(resolvedPath);

    const content = await fs.readFile(resolvedPath, "utf-8");
    const allLines = content.split("\n");

    const startLine = offset ?? 0;
    const maxLines = limit ?? 2000;
    const lines = allLines.slice(startLine, startLine + maxLines);

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
   * @returns Raw file data with content and timestamps
   */
  async readRaw(filePath: string): Promise<FileData> {
    const resolvedPath = await this.resolvePath(filePath);
    await this.validateFileAccess(resolvedPath);

    const [content, stat] = await Promise.all([
      fs.readFile(resolvedPath, "utf-8"),
      fs.stat(resolvedPath),
    ]);

    return {
      content: content.split("\n"),
      created_at: stat.birthtime.toISOString(),
      modified_at: stat.mtime.toISOString(),
    };
  }

  /**
   * Search for pattern matches using regex.
   *
   * @param pattern - Regular expression pattern to search for
   * @param searchPath - Directory to search in (defaults to root)
   * @param glob - Glob pattern to filter files (e.g., "*.ts")
   * @returns Array of matches
   */
  async grepRaw(
    pattern: string,
    searchPath?: string | null,
    glob?: string | null,
  ): Promise<GrepMatch[]> {
    const basePath = searchPath ? await this.resolvePath(searchPath) : this.rootDir;
    const regex = new RegExp(pattern);
    const matches: GrepMatch[] = [];

    // Get all files recursively
    const files = await this.walkDirectory(basePath, glob ?? undefined);

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (regex.test(line)) {
            matches.push({
              path: this.makeRelativePath(filePath),
              line: i + 1, // 1-indexed
              text: line,
            });
          }
        }
      } catch {
        // Skip files we can't read
      }
    }

    return matches;
  }

  /**
   * Find files matching a glob pattern.
   *
   * @param pattern - Glob pattern (e.g., "**\/*.ts")
   * @param basePath - Base directory for the search
   * @returns Array of matching file info
   */
  async globInfo(pattern: string, basePath?: string): Promise<FileInfo[]> {
    const searchDir = basePath ? await this.resolvePath(basePath) : this.rootDir;
    const results: FileInfo[] = [];

    // Get all files and filter by pattern
    const files = await this.walkDirectory(searchDir);

    for (const filePath of files) {
      const relativePath = path.relative(searchDir, filePath);
      if (this.matchesGlob(relativePath, pattern)) {
        try {
          const stat = await fs.stat(filePath);
          results.push({
            path: this.makeRelativePath(filePath),
            is_dir: false,
            size: stat.size,
            modified_at: stat.mtime.toISOString(),
          });
        } catch {
          // Skip files we can't stat
        }
      }
    }

    return results;
  }

  /**
   * Create or overwrite a file.
   *
   * @param filePath - Path for the file
   * @param content - Content to write
   * @returns Result indicating success or failure
   */
  async write(filePath: string, content: string): Promise<WriteResult> {
    try {
      const resolvedPath = await this.resolvePath(filePath);

      // Ensure parent directory exists
      const parentDir = path.dirname(resolvedPath);
      await fs.mkdir(parentDir, { recursive: true });

      await fs.writeFile(resolvedPath, content, "utf-8");

      return {
        success: true,
        path: this.makeRelativePath(resolvedPath),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        path: filePath,
      };
    }
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
  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<EditResult> {
    try {
      const resolvedPath = await this.resolvePath(filePath);
      await this.validateFileAccess(resolvedPath);

      const content = await fs.readFile(resolvedPath, "utf-8");
      const occurrences = content.split(oldString).length - 1;

      if (occurrences === 0) {
        return {
          success: false,
          error: `String not found in file: "${oldString.slice(0, 50)}${oldString.length > 50 ? "..." : ""}"`,
          path: this.makeRelativePath(resolvedPath),
        };
      }

      if (occurrences > 1 && !replaceAll) {
        return {
          success: false,
          error: `Multiple occurrences (${occurrences}) found. Use replace_all=true to replace all.`,
          path: this.makeRelativePath(resolvedPath),
          occurrences,
        };
      }

      const newContent = replaceAll
        ? content.replaceAll(oldString, newString)
        : content.replace(oldString, newString);

      await fs.writeFile(resolvedPath, newContent, "utf-8");

      return {
        success: true,
        path: this.makeRelativePath(resolvedPath),
        occurrences: replaceAll ? occurrences : 1,
      };
    } catch (error) {
      if (error instanceof PathTraversalError || error instanceof SymlinkError) {
        return {
          success: false,
          error: error.message,
          path: filePath,
        };
      }
      if (this.isNodeError(error) && error.code === "ENOENT") {
        return {
          success: false,
          error: `File not found: ${filePath}`,
          path: filePath,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        path: filePath,
      };
    }
  }

  // ===========================================================================
  // Command Execution Methods
  // ===========================================================================

  /**
   * Execute a shell command.
   *
   * Only available when `enableBash` is true in the constructor options.
   *
   * @param command - Shell command to execute
   * @returns Execution result with output and exit code
   * @throws {Error} If bash is not enabled
   * @throws {CommandBlockedError} If the command is blocked
   */
  async execute(command: string): Promise<ExecuteResponse> {
    if (!this.enableBash) {
      throw new Error(
        "Bash execution is not enabled. Create FilesystemBackend with enableBash: true",
      );
    }

    // Validate command
    this.validateCommand(command);

    return new Promise((resolve) => {
      let output = "";
      let truncated = false;
      let resolved = false;

      const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];

      const child = spawn(this.shell, shellArgs, {
        cwd: this.rootDir,
        env: this.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const handleOutput = (data: Buffer) => {
        if (truncated) return;

        const chunk = data.toString();
        if (output.length + chunk.length > this.maxOutputSize) {
          output += chunk.slice(0, this.maxOutputSize - output.length);
          truncated = true;
        } else {
          output += chunk;
        }
      };

      child.stdout?.on("data", handleOutput);
      child.stderr?.on("data", handleOutput);

      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill("SIGTERM");
          // Give it a moment to terminate gracefully
          setTimeout(() => {
            child.kill("SIGKILL");
          }, 1000);

          resolve({
            output: `${output}\n[Command timed out after ${this.timeout}ms]`,
            exitCode: null,
            truncated,
          });
        }
      }, this.timeout);

      child.on("close", (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve({
            output,
            exitCode: code,
            truncated,
          });
        }
      });

      child.on("error", (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve({
            output: `Error: ${error.message}`,
            exitCode: 1,
            truncated: false,
          });
        }
      });
    });
  }

  /**
   * Execute a shell command in the background (non-blocking).
   *
   * Returns immediately with a handle to the running process.
   * Use the callbacks to receive output and completion events.
   *
   * @param options - Execution options including command and callbacks
   * @returns Handle to the running process with abort capability
   * @throws {Error} If bash is not enabled
   * @throws {CommandBlockedError} If the command is blocked
   */
  executeBackground(options: ExecuteBackgroundOptions): ExecuteBackgroundResult {
    const { command, onOutput, onComplete, onError, timeout } = options;

    if (!this.enableBash) {
      throw new Error(
        "Bash execution is not enabled. Create FilesystemBackend with enableBash: true",
      );
    }

    // Validate command (throws if blocked)
    this.validateCommand(command);

    let output = "";
    let truncated = false;
    let aborted = false;

    const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];

    const child = spawn(this.shell, shellArgs, {
      cwd: this.rootDir,
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const handleOutput = (data: Buffer) => {
      if (truncated) return;

      const chunk = data.toString();
      if (output.length + chunk.length > this.maxOutputSize) {
        output += chunk.slice(0, this.maxOutputSize - output.length);
        truncated = true;
      } else {
        output += chunk;
      }

      // Notify callback with chunk
      if (onOutput) {
        onOutput(chunk);
      }
    };

    child.stdout?.on("data", handleOutput);
    child.stderr?.on("data", handleOutput);

    // Optional timeout
    let timeoutId: NodeJS.Timeout | undefined;
    if (timeout) {
      timeoutId = setTimeout(() => {
        if (!aborted && child.exitCode === null) {
          aborted = true;
          child.kill("SIGTERM");
          setTimeout(() => {
            if (child.exitCode === null) {
              child.kill("SIGKILL");
            }
          }, 1000);

          if (onComplete) {
            onComplete({
              output: `${output}\n[Command timed out after ${timeout}ms]`,
              exitCode: null,
              truncated,
            });
          }
        }
      }, timeout);
    }

    child.on("close", (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (!aborted && onComplete) {
        onComplete({
          output,
          exitCode: code,
          truncated,
        });
      }
    });

    child.on("error", (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (!aborted && onError) {
        onError(error);
      }
    });

    // Return handle for aborting
    const abort = () => {
      if (!aborted && child.exitCode === null) {
        aborted = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) {
            child.kill("SIGKILL");
          }
        }, 1000);
      }
    };

    return { process: child, abort };
  }

  /**
   * Upload files to the backend.
   *
   * @param files - Array of [path, content] tuples
   * @returns Array of upload results
   */
  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    const results: FileUploadResponse[] = [];

    for (const [filePath, content] of files) {
      try {
        const textContent = new TextDecoder().decode(content);
        const result = await this.write(filePath, textContent);

        results.push({
          path: filePath,
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        results.push({
          path: filePath,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Download files from the backend.
   *
   * @param paths - Paths to download
   * @returns Array of { path, content } objects
   */
  async downloadFiles(paths: string[]): Promise<Array<{ path: string; content: Uint8Array }>> {
    const results: Array<{ path: string; content: Uint8Array }> = [];

    for (const filePath of paths) {
      try {
        const fileData = await this.readRaw(filePath);
        const content = new TextEncoder().encode(fileData.content.join("\n"));
        results.push({ path: filePath, content });
      } catch {
        // Skip files we can't read
      }
    }

    return results;
  }

  /**
   * Validate a command before execution.
   *
   * @param command - Command to validate
   * @throws {CommandBlockedError} If the command is blocked
   * @internal
   */
  private validateCommand(command: string): void {
    // Check allowlist first (if configured)
    if (this.allowedCommands && this.allowedCommands.length > 0) {
      const isAllowed = this.allowedCommands.some((pattern) =>
        this.matchesCommandPattern(command, pattern),
      );
      if (!isAllowed) {
        throw new CommandBlockedError(command, "Command not in allowlist");
      }
    }

    // Check blocklist
    for (const pattern of this.blockedCommands) {
      if (this.matchesCommandPattern(command, pattern)) {
        throw new CommandBlockedError(command, "Command matches blocked pattern");
      }
    }

    // Check dangerous patterns (unless explicitly allowed)
    if (!this.allowDangerous) {
      for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
        if (pattern.test(command)) {
          throw new CommandBlockedError(
            command,
            `Command matches dangerous pattern: ${pattern.source.slice(0, 50)}`,
          );
        }
      }
    }
  }

  /**
   * Check if a command matches a pattern.
   * @internal
   */
  private matchesCommandPattern(command: string, pattern: string | RegExp): boolean {
    if (typeof pattern === "string") {
      return command.includes(pattern);
    }
    return pattern.test(command);
  }

  // ===========================================================================
  // Security Methods
  // ===========================================================================

  /**
   * Resolve a path and validate it's within the allowed boundaries.
   *
   * @param inputPath - Path to resolve
   * @returns Resolved absolute path
   * @throws {PathTraversalError} If path escapes root directory
   * @throws {SymlinkError} If path contains a symlink and followSymlinks is false
   * @internal
   */
  private async resolvePath(inputPath: string): Promise<string> {
    let resolved: string;

    // Check if this is an absolute path that might be in allowedPaths
    if (path.isAbsolute(inputPath)) {
      // Resolve symlinks in the path for consistent comparison with allowedPaths
      // (which were also resolved during construction)
      let normalizedAbsolute = path.resolve(inputPath);
      try {
        normalizedAbsolute = await fs.realpath(normalizedAbsolute);
      } catch {
        // Path doesn't exist yet, use the resolved path
      }
      if (this.isPathInAllowedPaths(normalizedAbsolute)) {
        resolved = normalizedAbsolute;
      } else {
        // Treat paths starting with "/" as relative to rootDir
        // This matches the behavior of StateBackend where "/" means the virtual root
        const relativePath = inputPath.startsWith("/") ? inputPath.slice(1) : inputPath;
        resolved = path.resolve(this.rootDir, relativePath);
      }
    } else {
      // Relative path - resolve relative to rootDir
      resolved = path.resolve(this.rootDir, inputPath);
    }

    // Check if path is within rootDir or allowed paths
    if (!this.isPathAllowed(resolved)) {
      throw new PathTraversalError(inputPath, this.rootDir);
    }

    // Check for symlinks in the path components if not following them
    if (!this.followSymlinks) {
      await this.checkSymlinks(resolved);
    }

    return resolved;
  }

  /**
   * Check if a resolved path is within allowed boundaries.
   * @internal
   */
  private isPathAllowed(resolved: string): boolean {
    // Check if within root directory
    const relative = path.relative(this.rootDir, resolved);
    const isWithinRoot = !relative.startsWith("..") && !path.isAbsolute(relative);

    if (isWithinRoot) {
      return true;
    }

    // Check if within any allowed path
    return this.isPathInAllowedPaths(resolved);
  }

  /**
   * Check if a resolved path is within any of the allowed paths.
   * @internal
   */
  private isPathInAllowedPaths(resolved: string): boolean {
    for (const allowedPath of this.allowedPaths) {
      const relativeToAllowed = path.relative(allowedPath, resolved);
      const isWithinAllowed =
        !relativeToAllowed.startsWith("..") && !path.isAbsolute(relativeToAllowed);
      if (isWithinAllowed) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check for symlinks in path components.
   * @throws {SymlinkError} If a symlink is found
   * @internal
   */
  private async checkSymlinks(targetPath: string): Promise<void> {
    // Use '/' for splitting as Node normalizes paths, then handle platform paths
    const normalizedPath = targetPath.replace(/\\/g, "/");
    const parts = normalizedPath.split("/").filter(Boolean);
    let currentPath = "/";

    for (const part of parts) {
      currentPath = path.join(currentPath, part);
      try {
        const lstat = await fs.lstat(currentPath);
        if (lstat.isSymbolicLink()) {
          throw new SymlinkError(currentPath);
        }
      } catch (error) {
        // Path component doesn't exist yet, that's OK for write operations
        if (this.isNodeError(error) && error.code === "ENOENT") {
          break;
        }
        if (error instanceof SymlinkError) {
          throw error;
        }
        // Other errors (permission, etc.) - continue checking
      }
    }
  }

  /**
   * Validate file access checking size limits and symlinks.
   * @throws {FileSizeLimitError} If file exceeds size limit
   * @throws {SymlinkError} If file is a symlink and not allowed
   * @internal
   */
  private async validateFileAccess(filePath: string): Promise<void> {
    const stat = await fs.stat(filePath);

    // Check file size
    const sizeMb = stat.size / (1024 * 1024);
    if (sizeMb > this.maxFileSizeMb) {
      throw new FileSizeLimitError(filePath, sizeMb, this.maxFileSizeMb);
    }

    // Check if symlink (using lstat)
    if (!this.followSymlinks) {
      const lstat = await fs.lstat(filePath);
      if (lstat.isSymbolicLink()) {
        throw new SymlinkError(filePath);
      }
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Convert an absolute path to a relative path from rootDir.
   * @internal
   */
  private makeRelativePath(absolutePath: string): string {
    const relative = path.relative(this.rootDir, absolutePath);
    // Ensure it starts with / for consistency
    return `/${relative.replace(/\\/g, "/")}`;
  }

  /**
   * Walk a directory recursively and return all file paths.
   * @internal
   */
  private async walkDirectory(dir: string, globPattern?: string): Promise<string[]> {
    const results: string[] = [];

    const walk = async (currentDir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);

          // Skip symlinks if not following
          if (entry.isSymbolicLink() && !this.followSymlinks) {
            continue;
          }

          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            // If glob pattern provided, filter by extension (simple filtering)
            if (globPattern) {
              const relativePath = path.relative(dir, fullPath);
              if (this.matchesGlob(relativePath, globPattern)) {
                results.push(fullPath);
              }
            } else {
              results.push(fullPath);
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    await walk(dir);
    return results;
  }

  /**
   * Check if a path matches a glob pattern.
   * Supports basic glob patterns: *, **, ?
   * @internal
   */
  private matchesGlob(filePath: string, pattern: string): boolean {
    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, "/");
    const normalizedPattern = pattern.replace(/\\/g, "/");

    // Convert glob to regex
    let regexPattern = normalizedPattern
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
      // Restore globstars
      .replace(/<<<GLOBSTAR_SLASH>>>/g, "(?:.*/)?")
      .replace(/<<<GLOBSTAR>>>/g, ".*");

    // Anchor the pattern
    regexPattern = `^${regexPattern}$`;

    return new RegExp(regexPattern).test(normalizedPath);
  }

  /**
   * Type guard for Node.js errors with code property.
   * @internal
   */
  private isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return (
      error instanceof Error &&
      "code" in error &&
      typeof (error as NodeJS.ErrnoException).code === "string"
    );
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a FilesystemBackend with the specified options.
 *
 * @param options - Configuration options
 * @returns A new FilesystemBackend instance
 *
 * @example
 * ```typescript
 * const backend = createFilesystemBackend({
 *   rootDir: "/home/user/project",
 *   maxFileSizeMb: 5,
 * });
 * ```
 *
 * @category Backend
 */
export function createFilesystemBackend(options?: FilesystemBackendOptions): FilesystemBackend {
  return new FilesystemBackend(options);
}
