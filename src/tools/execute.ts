/**
 * Bash tool for running shell commands.
 *
 * This tool wraps backends with execute capability to provide command execution
 * to agents. It includes timeout support, output truncation, and optional
 * command approval for dangerous operations.
 *
 * @packageDocumentation
 */

import { tool } from "ai";
import { z } from "zod";
import type { BackendProtocol, ExecutableBackend, ExecuteResponse } from "../backend.js";
import { hasExecuteCapability } from "../backend.js";
import type { TaskManager } from "../task-manager.js";
import { createBackgroundTask, updateBackgroundTask } from "../task-store/types.js";

// =============================================================================
// Constants
// =============================================================================

/** Default timeout for command execution (2 minutes) */
const DEFAULT_TIMEOUT_MS = 120000;

/** Character count threshold for output truncation warning (~20k tokens) */
const LARGE_OUTPUT_WARNING_CHARS = 80_000;

/** Maximum output size before truncation (same as in tools, ~30k chars) */
const MAX_OUTPUT_SIZE_CHARS = 120_000;

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a bash tool.
 *
 * @category Tools
 */
export interface BashToolOptions {
  /**
   * The backend to use for command execution.
   * Must have execute capability (use `hasExecuteCapability()` to check).
   */
  backend: ExecutableBackend | BackendProtocol;

  /**
   * Default timeout in milliseconds for command execution.
   * Can be overridden per-call.
   * @defaultValue 120000 (2 minutes)
   */
  timeout?: number;

  /**
   * Commands or patterns that are blocked from execution.
   * Supports simple string matching and regex patterns.
   * Note: The backend itself may have additional blocking rules.
   */
  blockedCommands?: Array<string | RegExp>;

  /**
   * Only allow these commands to be executed.
   * If set, only commands starting with these prefixes are allowed.
   */
  allowedCommands?: Array<string | RegExp>;

  /**
   * Commands that require approval before execution.
   * The approval callback must return true to proceed.
   */
  requireApproval?: Array<string | RegExp>;

  /**
   * Callback to request approval for dangerous commands.
   * If not provided, commands requiring approval will be blocked.
   */
  onApprovalRequest?: (command: string, reason: string) => Promise<boolean>;

  /**
   * Maximum output size in characters before truncation.
   * @defaultValue 120000
   */
  maxOutputSize?: number;

  /**
   * Task manager for tracking background commands.
   * Required for run_in_background support.
   */
  taskManager?: TaskManager;

  /**
   * Maximum runtime for background commands in milliseconds.
   * Background commands that exceed this will be killed.
   * @defaultValue 600000 (10 minutes)
   */
  backgroundMaxRuntime?: number;
}

/**
 * Result of command execution.
 *
 * @category Tools
 */
export interface BashResult {
  /** Whether the command executed successfully (exit code 0) */
  success: boolean;
  /** Command output (stdout + stderr combined) */
  output: string;
  /** Exit code (null if timed out or not available) */
  exitCode: number | null;
  /** Whether the output was truncated */
  truncated: boolean;
  /** Error message if command was blocked or failed to start */
  error?: string;
}

/**
 * Result of starting a background command.
 *
 * @category Tools
 */
export interface BashBackgroundResult {
  /** Task ID for tracking the background command */
  taskId: string;
  /** Current status */
  status: "running";
  /** Informational message */
  message: string;
}

/** Default maximum runtime for background commands (10 minutes) */
const DEFAULT_BACKGROUND_MAX_RUNTIME_MS = 600000;

/** Task ID counter for uniqueness */
let bashTaskIdCounter = 0;

// =============================================================================
// Bash Tool
// =============================================================================

/**
 * Creates a tool for executing shell commands in a sandbox.
 *
 * This tool provides secure command execution with:
 * - Timeout enforcement
 * - Output size limits
 * - Command blocking/allowlisting at tool level
 * - Optional approval for dangerous commands
 *
 * @param options - Configuration options
 * @returns An AI SDK compatible tool for shell execution
 *
 * @example
 * ```typescript
 * import { createBashTool, FilesystemBackend } from "@lleverage-ai/agent-sdk";
 *
 * const backend = new FilesystemBackend({
 *   rootDir: process.cwd(),
 *   enableBash: true,
 * });
 * const bash = createBashTool({
 *   backend,
 *   timeout: 30000,
 *   blockedCommands: ["rm -rf /"],
 * });
 *
 * const agent = createAgent({
 *   model,
 *   tools: { bash },
 * });
 * ```
 *
 * @category Tools
 */
export function createBashTool(options: BashToolOptions) {
  const {
    backend,
    timeout = DEFAULT_TIMEOUT_MS,
    blockedCommands = [],
    allowedCommands,
    requireApproval = [],
    onApprovalRequest,
    maxOutputSize = MAX_OUTPUT_SIZE_CHARS,
    taskManager,
    backgroundMaxRuntime = DEFAULT_BACKGROUND_MAX_RUNTIME_MS,
  } = options;

  // Validate backend has execute capability
  if (!hasExecuteCapability(backend)) {
    throw new Error(
      "Backend does not have execute capability. " +
        "Use FilesystemBackend with enableBash: true, or provide a backend with execute() method.",
    );
  }

  const executor: ExecutableBackend = backend;

  return tool({
    description:
      "Execute a shell command. Returns stdout/stderr output, exit code, and whether output was truncated. " +
      "Use run_in_background for long-running commands to avoid blocking.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute"),
      timeout: z.number().optional().describe(`Timeout in milliseconds (default: ${timeout})`),
      run_in_background: z
        .boolean()
        .optional()
        .describe(
          "Run command in background without blocking. Returns task ID for status/output retrieval via task_output tool.",
        ),
    }),
    execute: async ({
      command,
      timeout: commandTimeout,
      run_in_background,
    }: {
      command: string;
      timeout?: number;
      run_in_background?: boolean;
    }): Promise<BashResult | BashBackgroundResult> => {
      // Validate command at tool level
      const validationError = validateCommand(command, blockedCommands, allowedCommands);
      if (validationError) {
        return {
          success: false,
          output: "",
          exitCode: null,
          truncated: false,
          error: validationError,
        };
      }

      // Check if approval is required (happens before background execution)
      const approvalReason = needsApproval(command, requireApproval);
      if (approvalReason) {
        if (!onApprovalRequest) {
          return {
            success: false,
            output: "",
            exitCode: null,
            truncated: false,
            error: `Command requires approval: ${approvalReason}. No approval callback configured.`,
          };
        }

        const approved = await onApprovalRequest(command, approvalReason);
        if (!approved) {
          return {
            success: false,
            output: "",
            exitCode: null,
            truncated: false,
            error: `Command execution denied: ${approvalReason}`,
          };
        }
      }

      // Background execution
      if (run_in_background) {
        if (!taskManager) {
          return {
            success: false,
            output: "",
            exitCode: null,
            truncated: false,
            error:
              "Background execution requires a TaskManager. This should be provided automatically by the agent.",
          };
        }

        const taskId = `bash-${++bashTaskIdCounter}-${Date.now()}`;
        const commandPreview = command.length > 100 ? `${command.slice(0, 100)}...` : command;

        const task = createBackgroundTask({
          id: taskId,
          subagentType: "bash",
          description: `Running: ${commandPreview}`,
          status: "running",
          metadata: { command },
        });

        try {
          // Start background execution
          const { process, abort } = executor.executeBackground({
            command,
            timeout: backgroundMaxRuntime,
            onOutput: (chunk) => {
              // Update task with current output
              const currentTask = taskManager.getTask(taskId);
              if (currentTask) {
                const currentOutput = (currentTask.metadata?.currentOutput as string) || "";
                const newOutput = currentOutput + chunk;
                const truncated = newOutput.length > maxOutputSize;
                taskManager.updateTask(taskId, {
                  metadata: {
                    ...currentTask.metadata,
                    currentOutput: truncated ? newOutput.slice(0, maxOutputSize) : newOutput,
                    truncated,
                  },
                });
              }
            },
            onComplete: (result) => {
              const formattedResult = formatBashResult(result, maxOutputSize);
              taskManager.updateTask(taskId, {
                status: formattedResult.success ? "completed" : "failed",
                result: formattedResult.output,
                error: formattedResult.error,
                completedAt: new Date().toISOString(),
                metadata: {
                  command,
                  exitCode: formattedResult.exitCode,
                  truncated: formattedResult.truncated,
                },
              });
            },
            onError: (error) => {
              taskManager.updateTask(taskId, {
                status: "failed",
                error: error.message,
                completedAt: new Date().toISOString(),
              });
            },
          });

          // Register with task manager
          taskManager.registerTask(task, { process });

          return {
            taskId,
            status: "running",
            message: `Command started in background. Use task_output with task_id "${taskId}" to check status or retrieve output.`,
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            exitCode: null,
            truncated: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // Foreground execution (blocking)
      try {
        const result = await executor.execute(command);
        return formatBashResult(result, maxOutputSize);
      } catch (error) {
        return {
          success: false,
          output: "",
          exitCode: null,
          truncated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Validate a command against blocked/allowed patterns.
 * @internal
 */
function validateCommand(
  command: string,
  blockedCommands: Array<string | RegExp>,
  allowedCommands?: Array<string | RegExp>,
): string | null {
  // Empty command check
  if (!command.trim()) {
    return "Command cannot be empty";
  }

  // Check allowlist first (if configured)
  if (allowedCommands && allowedCommands.length > 0) {
    const isAllowed = allowedCommands.some((pattern) => matchesPattern(command, pattern));
    if (!isAllowed) {
      return "Command not in allowlist";
    }
  }

  // Check blocklist
  for (const pattern of blockedCommands) {
    if (matchesPattern(command, pattern)) {
      return `Command matches blocked pattern`;
    }
  }

  return null;
}

/**
 * Check if a command needs approval.
 * @internal
 */
function needsApproval(command: string, requireApproval: Array<string | RegExp>): string | null {
  for (const pattern of requireApproval) {
    if (matchesPattern(command, pattern)) {
      const patternStr = typeof pattern === "string" ? pattern : pattern.source.slice(0, 50);
      return `matches pattern: ${patternStr}`;
    }
  }
  return null;
}

/**
 * Check if a command matches a pattern.
 * @internal
 */
function matchesPattern(command: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") {
    return command.includes(pattern);
  }
  return pattern.test(command);
}

/**
 * Format the execution result for display.
 * @internal
 */
function formatBashResult(result: ExecuteResponse, maxOutputSize: number): BashResult {
  let output = result.output;
  let truncated = result.truncated;

  // Apply tool-level truncation if needed
  if (output.length > maxOutputSize) {
    output = `${output.slice(0, maxOutputSize)}\n\n[Output truncated at ${maxOutputSize} characters]`;
    truncated = true;
  }

  // Add warning for large output
  if (output.length > LARGE_OUTPUT_WARNING_CHARS && !truncated) {
    const estimatedTokens = Math.round(output.length / 4);
    output = `[Warning: Large output (~${estimatedTokens} tokens)]\n\n${output}`;
  }

  return {
    success: result.exitCode === 0,
    output,
    exitCode: result.exitCode,
    truncated,
  };
}
