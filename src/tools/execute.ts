/**
 * Bash tool for running shell commands in a sandbox.
 *
 * This tool wraps the SandboxBackendProtocol to provide command execution
 * to agents. It includes timeout support, output truncation, and optional
 * command approval for dangerous operations.
 *
 * @packageDocumentation
 */

import { tool } from "ai";
import { z } from "zod";
import type { ExecuteResponse, SandboxBackendProtocol } from "../backend.js";

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
  /** The sandbox to use for command execution */
  sandbox: SandboxBackendProtocol;

  /**
   * Default timeout in milliseconds for command execution.
   * Can be overridden per-call.
   * @defaultValue 120000 (2 minutes)
   */
  timeout?: number;

  /**
   * Commands or patterns that are blocked from execution.
   * Supports simple string matching and regex patterns.
   * Note: The sandbox itself may have additional blocking rules.
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
 * import { createBashTool, LocalSandbox } from "@lleverage-ai/agent-sdk";
 *
 * const sandbox = new LocalSandbox({ cwd: process.cwd() });
 * const bash = createBashTool({
 *   sandbox,
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
    sandbox,
    timeout = DEFAULT_TIMEOUT_MS,
    blockedCommands = [],
    allowedCommands,
    requireApproval = [],
    onApprovalRequest,
    maxOutputSize = MAX_OUTPUT_SIZE_CHARS,
  } = options;

  return tool({
    description:
      "Execute a shell command. Returns stdout/stderr output, exit code, and whether output was truncated.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute"),
      timeout: z.number().optional().describe(`Timeout in milliseconds (default: ${timeout})`),
    }),
    execute: async ({
      command,
      timeout: commandTimeout,
    }: {
      command: string;
      timeout?: number;
    }): Promise<BashResult> => {
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

      // Check if approval is required
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

      try {
        // Execute command through sandbox
        const result = await sandbox.execute(command);

        // Format output
        return formatBashResult(result, maxOutputSize);
      } catch (error) {
        // Handle sandbox-level errors (e.g., CommandBlockedError)
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
