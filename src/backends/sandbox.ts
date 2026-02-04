/**
 * Sandbox backend for command execution.
 *
 * SandboxBackend provides isolated environments for running shell commands safely.
 * The base class provides a foundation for various sandbox implementations including
 * local processes, containers, or cloud sandboxes.
 *
 * This module provides:
 * - {@link BaseSandbox} - Abstract base class for all sandbox implementations
 * - {@link LocalSandbox} - Local shell execution with security controls
 *
 * @example
 * ```typescript
 * // Create a local sandbox for development
 * const sandbox = new LocalSandbox({
 *   cwd: process.cwd(),
 *   timeout: 30000,
 *   maxOutputSize: 1024 * 1024,
 * });
 *
 * // Execute a command
 * const result = await sandbox.execute("npm test");
 * console.log(`Exit code: ${result.exitCode}`);
 * console.log(`Output: ${result.output}`);
 *
 * // Use file operations
 * const files = await sandbox.lsInfo("./src");
 * ```
 *
 * @packageDocumentation
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type {
  BackendProtocol,
  EditResult,
  ExecuteResponse,
  FileData,
  FileInfo,
  FileUploadResponse,
  GrepMatch,
  SandboxBackendProtocol,
  WriteResult,
} from "../backend.js";
import {
  FileSizeLimitError,
  FilesystemBackend,
  PathTraversalError,
  SymlinkError,
} from "./filesystem.js";

// =============================================================================
// Error Classes
// =============================================================================

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

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration options for LocalSandbox.
 *
 * @example
 * ```typescript
 * const options: LocalSandboxOptions = {
 *   cwd: "/home/user/project",
 *   timeout: 60000,
 *   maxOutputSize: 1024 * 1024,
 *   blockedCommands: ["rm -rf /", "shutdown"],
 * };
 * ```
 *
 * @category Backend
 */
export interface LocalSandboxOptions {
  /**
   * Working directory for command execution.
   * @defaultValue process.cwd()
   */
  cwd?: string;

  /**
   * Default timeout in milliseconds for command execution.
   * @defaultValue 120000 (2 minutes)
   */
  timeout?: number;

  /**
   * Maximum output size in bytes before truncation.
   * @defaultValue 1048576 (1MB)
   */
  maxOutputSize?: number;

  /**
   * Shell to use for command execution.
   * @defaultValue "/bin/sh" on Unix, "cmd.exe" on Windows
   */
  shell?: string;

  /**
   * Environment variables to set for all commands.
   */
  env?: Record<string, string>;

  /**
   * Commands or patterns that are blocked from execution.
   * Supports simple string matching and regex patterns.
   */
  blockedCommands?: Array<string | RegExp>;

  /**
   * Only allow these commands to be executed.
   * If set, only commands matching these patterns are allowed.
   */
  allowedCommands?: Array<string | RegExp>;

  /**
   * Whether to allow potentially dangerous commands.
   * When false (default), certain dangerous patterns are blocked.
   * @defaultValue false
   */
  allowDangerous?: boolean;

  /**
   * Maximum file size in MB for file operations.
   * @defaultValue 10
   */
  maxFileSizeMb?: number;

  /**
   * Whether to follow symbolic links.
   * @defaultValue false
   */
  followSymlinks?: boolean;

  /**
   * Additional paths allowed for file operations.
   */
  allowedPaths?: string[];
}

// =============================================================================
// Default Dangerous Patterns
// =============================================================================

/**
 * Default patterns that are considered dangerous.
 * These are blocked unless allowDangerous is true.
 * @internal
 */
const DANGEROUS_PATTERNS: RegExp[] = [
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

// =============================================================================
// Base Sandbox Implementation
// =============================================================================

/**
 * Abstract base class for sandbox implementations.
 *
 * This class provides the foundation for various sandbox backends. Subclasses
 * must implement the core execution method, while file operations can optionally
 * be delegated to a wrapped backend.
 *
 * @example
 * ```typescript
 * class MyCloudSandbox extends BaseSandbox {
 *   async execute(command: string): Promise<ExecuteResponse> {
 *     // Implement cloud-based execution
 *     return await this.cloudProvider.runCommand(command);
 *   }
 * }
 * ```
 *
 * @category Backend
 */
export abstract class BaseSandbox implements SandboxBackendProtocol {
  /** Unique identifier for this sandbox instance */
  public readonly id: string;

  /** Wrapped backend for file operations */
  protected readonly fileBackend: BackendProtocol;

  /**
   * Create a new BaseSandbox.
   *
   * @param fileBackend - Backend to use for file operations
   * @param id - Optional unique identifier (auto-generated if not provided)
   */
  constructor(fileBackend: BackendProtocol, id?: string) {
    this.id = id ?? `sandbox-${randomUUID()}`;
    this.fileBackend = fileBackend;
  }

  // ===========================================================================
  // Abstract Methods - Must be implemented by subclasses
  // ===========================================================================

  /**
   * Execute a shell command in the sandbox.
   *
   * @param command - Shell command to execute
   * @returns Execution result with output and exit code
   */
  abstract execute(command: string): Promise<ExecuteResponse>;

  // ===========================================================================
  // File Operations - Delegated to file backend
  // ===========================================================================

  /**
   * List files and directories at the given path.
   */
  lsInfo(path: string): FileInfo[] | Promise<FileInfo[]> {
    return this.fileBackend.lsInfo(path);
  }

  /**
   * Read file content with line numbers.
   */
  read(filePath: string, offset?: number, limit?: number): string | Promise<string> {
    return this.fileBackend.read(filePath, offset, limit);
  }

  /**
   * Read raw file content as FileData.
   */
  readRaw(filePath: string): FileData | Promise<FileData> {
    return this.fileBackend.readRaw(filePath);
  }

  /**
   * Search for pattern matches using regex.
   */
  grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null,
  ): GrepMatch[] | string | Promise<GrepMatch[] | string> {
    return this.fileBackend.grepRaw(pattern, path, glob);
  }

  /**
   * Find files matching a glob pattern.
   */
  globInfo(pattern: string, path?: string): FileInfo[] | Promise<FileInfo[]> {
    return this.fileBackend.globInfo(pattern, path);
  }

  /**
   * Create or overwrite a file.
   */
  write(filePath: string, content: string): WriteResult | Promise<WriteResult> {
    return this.fileBackend.write(filePath, content);
  }

  /**
   * Edit a file by replacing text.
   */
  edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): EditResult | Promise<EditResult> {
    return this.fileBackend.edit(filePath, oldString, newString, replaceAll);
  }

  // ===========================================================================
  // File Upload/Download - Default implementations
  // ===========================================================================

  /**
   * Upload files to the sandbox.
   *
   * Default implementation writes files using the file backend.
   *
   * @param files - Array of [path, content] tuples
   * @returns Array of upload results
   */
  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    const results: FileUploadResponse[] = [];

    for (const [filePath, content] of files) {
      try {
        const textContent = new TextDecoder().decode(content);
        const result = await this.fileBackend.write(filePath, textContent);

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
   * Download files from the sandbox.
   *
   * Default implementation reads files using the file backend.
   *
   * @param paths - Paths to download
   * @returns Array of { path, content } objects
   */
  async downloadFiles(paths: string[]): Promise<Array<{ path: string; content: Uint8Array }>> {
    const results: Array<{ path: string; content: Uint8Array }> = [];

    for (const filePath of paths) {
      try {
        const fileData = await this.fileBackend.readRaw(filePath);
        const content = new TextEncoder().encode(fileData.content.join("\n"));
        results.push({ path: filePath, content });
      } catch {
        // Skip files we can't read
      }
    }

    return results;
  }
}

// =============================================================================
// Local Sandbox Implementation
// =============================================================================

/**
 * Local sandbox for shell command execution.
 *
 * Provides secure command execution with:
 * - Timeout enforcement
 * - Output size limits
 * - Command blocking/allowlisting
 * - Dangerous pattern detection
 *
 * File operations are delegated to a FilesystemBackend with the same security
 * protections (path traversal, symlink, file size).
 *
 * @example
 * ```typescript
 * const sandbox = new LocalSandbox({
 *   cwd: "/home/user/project",
 *   timeout: 30000,
 *   blockedCommands: ["rm -rf"],
 * });
 *
 * // Execute a command
 * const result = await sandbox.execute("ls -la");
 * console.log(result.output);
 *
 * // File operations work too
 * const files = await sandbox.lsInfo("./src");
 * ```
 *
 * @category Backend
 */
export class LocalSandbox extends BaseSandbox {
  private readonly cwd: string;
  private readonly timeout: number;
  private readonly maxOutputSize: number;
  private readonly shell: string;
  private readonly env: Record<string, string>;
  private readonly blockedCommands: Array<string | RegExp>;
  private readonly allowedCommands?: Array<string | RegExp>;
  private readonly allowDangerous: boolean;

  /**
   * Create a new LocalSandbox.
   *
   * @param options - Configuration options
   */
  constructor(options: LocalSandboxOptions = {}) {
    // Create filesystem backend for file operations
    const fileBackend = new FilesystemBackend({
      rootDir: options.cwd ?? process.cwd(),
      maxFileSizeMb: options.maxFileSizeMb ?? 10,
      followSymlinks: options.followSymlinks ?? false,
      allowedPaths: options.allowedPaths,
    });

    super(fileBackend);

    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.timeout = options.timeout ?? 120000; // 2 minutes default
    this.maxOutputSize = options.maxOutputSize ?? 1048576; // 1MB default
    this.shell = options.shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
    this.env = { ...process.env, ...options.env } as Record<string, string>;
    this.blockedCommands = options.blockedCommands ?? [];
    this.allowedCommands = options.allowedCommands;
    this.allowDangerous = options.allowDangerous ?? false;
  }

  /**
   * Execute a shell command.
   *
   * @param command - Shell command to execute
   * @returns Execution result with output and exit code
   * @throws {CommandBlockedError} If the command is blocked
   * @throws {CommandTimeoutError} If the command times out
   */
  async execute(command: string): Promise<ExecuteResponse> {
    // Validate command
    this.validateCommand(command);

    return new Promise((resolve) => {
      let output = "";
      let truncated = false;
      let resolved = false;

      const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];

      const child = spawn(this.shell, shellArgs, {
        cwd: this.cwd,
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

  // ===========================================================================
  // Command Validation
  // ===========================================================================

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
        this.matchesPattern(command, pattern),
      );
      if (!isAllowed) {
        throw new CommandBlockedError(command, "Command not in allowlist");
      }
    }

    // Check blocklist
    for (const pattern of this.blockedCommands) {
      if (this.matchesPattern(command, pattern)) {
        throw new CommandBlockedError(command, "Command matches blocked pattern");
      }
    }

    // Check dangerous patterns (unless explicitly allowed)
    if (!this.allowDangerous) {
      for (const pattern of DANGEROUS_PATTERNS) {
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
  private matchesPattern(command: string, pattern: string | RegExp): boolean {
    if (typeof pattern === "string") {
      return command.includes(pattern);
    }
    return pattern.test(command);
  }

  // ===========================================================================
  // Static Factory Methods
  // ===========================================================================

  /**
   * Create a LocalSandbox with restricted permissions.
   *
   * This factory creates a sandbox that only allows read-only commands.
   *
   * @param options - Base options
   * @returns A restricted LocalSandbox
   *
   * @example
   * ```typescript
   * const sandbox = LocalSandbox.readOnly({ cwd: "/home/user/project" });
   * await sandbox.execute("ls -la"); // OK
   * await sandbox.execute("rm file.txt"); // Throws CommandBlockedError
   * ```
   */
  static readOnly(
    options: Omit<LocalSandboxOptions, "allowedCommands" | "blockedCommands"> = {},
  ): LocalSandbox {
    return new LocalSandbox({
      ...options,
      blockedCommands: [
        // Block any write operations
        /\brm\b/i,
        /\bmv\b/i,
        /\bcp\b/i,
        /\btouch\b/i,
        /\bmkdir\b/i,
        /\brmdir\b/i,
        /\bchmod\b/i,
        /\bchown\b/i,
        /\bln\b/i,
        />/, // Redirect
        /\bdd\b/i,
        /\bwrite\b/i,
        /\bnpm\s+(install|uninstall|update|publish)/i,
        /\byarn\s+(add|remove|upgrade|publish)/i,
        /\bpip\s+(install|uninstall)/i,
        /\bgit\s+(push|commit|merge|rebase)/i,
      ],
    });
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a LocalSandbox with the specified options.
 *
 * @param options - Configuration options
 * @returns A new LocalSandbox instance
 *
 * @example
 * ```typescript
 * const sandbox = createLocalSandbox({
 *   cwd: "/home/user/project",
 *   timeout: 30000,
 * });
 * ```
 *
 * @category Backend
 */
export function createLocalSandbox(options?: LocalSandboxOptions): LocalSandbox {
  return new LocalSandbox(options);
}

// Re-export related types from backend
export { PathTraversalError, SymlinkError, FileSizeLimitError };
