/**
 * Security policy presets for agent configuration.
 *
 * This module provides security policy presets that bundle together backend configuration,
 * permission modes, and hook settings to enforce different security levels. The presets help
 * developers quickly configure agents for different environments (development, CI, production)
 * without manually configuring each security control.
 *
 * @example
 * ```typescript
 * import { createAgent } from "@lleverage-ai/agent-sdk";
 * import { applySecurityPolicy, SecurityPolicyPreset } from "@lleverage-ai/agent-sdk/security";
 *
 * // Create an agent with production security settings
 * const agent = createAgent({
 *   model,
 *   ...applySecurityPolicy("production"),
 * });
 *
 * // Or customize a preset
 * const customPolicy = applySecurityPolicy("ci", {
 *   backend: { timeout: 60000 },
 *   permissionMode: "plan",
 * });
 * ```
 *
 * @packageDocumentation
 */

import type { FilesystemBackendOptions } from "../backends/filesystem.js";
import { FilesystemBackend } from "../backends/filesystem.js";
import type { HookRegistration, PermissionMode } from "../types.js";

/**
 * File write patterns that should be blocked when acceptEdits mode is active.
 * These patterns match common shell operations that perform file writes,
 * which would bypass the file edit tool permission checks.
 *
 * @internal
 */
export const ACCEPT_EDITS_BLOCKED_PATTERNS: RegExp[] = [
  // Output redirection
  />/,
  // File deletion and movement
  /\brm\b/i,
  /\bmv\b/i,
  // File creation and modification
  /\btouch\b/i,
  /\bcp\b/i,
  // Directory operations
  /\bmkdir\b/i,
  /\brmdir\b/i,
  // File permissions
  /\bchmod\b/i,
  /\bchown\b/i,
  // Link creation
  /\bln\b/i,
  // Disk operations
  /\bdd\b/i,
  // Text editor invocations that might modify files
  /\b(nano|vi|vim|emacs|sed -i)\b/i,
  // Package managers that modify filesystem
  /\bnpm\s+(install|uninstall|update)/i,
  /\byarn\s+(add|remove)/i,
  /\bpip\s+(install|uninstall)/i,
];

/**
 * Security policy configuration that bundles backend, permission, and hook settings.
 *
 * This type combines multiple security controls into a single policy that can be
 * applied to an agent. Policies can be created from presets or customized.
 *
 * @example
 * ```typescript
 * const policy: SecurityPolicy = {
 *   backend: { allowDangerous: false, timeout: 30000 },
 *   permissionMode: "default",
 *   disallowedTools: ["bash"],
 *   hooks: { PreToolUse: [auditHook] },
 * };
 * ```
 *
 * @category Security
 */
export interface SecurityPolicy {
  /**
   * Backend configuration for command execution security.
   */
  backend?: FilesystemBackendOptions;

  /**
   * Permission mode for tool execution control.
   */
  permissionMode?: PermissionMode;

  /**
   * Tools that are explicitly disallowed.
   */
  disallowedTools?: string[];

  /**
   * Tools that are explicitly allowed (all others blocked).
   */
  allowedTools?: string[];

  /**
   * Hook registrations for lifecycle events.
   */
  hooks?: HookRegistration;

  /**
   * When true and permissionMode is "acceptEdits", automatically configures the
   * backend to block shell-based file operations (e.g., echo > file, rm, mv).
   * This prevents bash commands from bypassing the acceptEdits permission checks.
   *
   * @defaultValue true
   */
  blockShellFileOps?: boolean;
}

/**
 * Preset names for common security levels.
 *
 * - `development`: Permissive settings for rapid iteration
 * - `ci`: Restrictive settings for CI/CD environments
 * - `production`: Balanced settings for production deployments
 * - `readonly`: Maximum restrictions - no writes, no commands
 *
 * @category Security
 */
export type SecurityPolicyPreset = "development" | "ci" | "production" | "readonly";

/**
 * Apply a security policy preset to agent options.
 *
 * This function returns a partial AgentOptions object that can be spread into
 * createAgent(). It configures the backend, permission mode, tool restrictions,
 * and hooks according to the selected preset.
 *
 * When permissionMode is "acceptEdits" and blockShellFileOps is true (default),
 * the backend will be automatically configured to block shell-based file operations
 * like `echo > file`, `rm`, `mv`, etc. This prevents bash commands from bypassing
 * the acceptEdits permission checks.
 *
 * @param preset - The security preset to apply
 * @param overrides - Optional policy overrides to customize the preset
 * @returns Partial agent options with security settings applied
 *
 * @example
 * ```typescript
 * // Apply production preset
 * const agent = createAgent({
 *   model,
 *   ...applySecurityPolicy("production"),
 * });
 *
 * // Apply CI preset with custom timeout
 * const ciAgent = createAgent({
 *   model,
 *   ...applySecurityPolicy("ci", {
 *     backend: { timeout: 120000 },
 *   }),
 * });
 *
 * // Apply readonly preset for audit-only agent
 * const auditAgent = createAgent({
 *   model,
 *   ...applySecurityPolicy("readonly"),
 * });
 *
 * // Use acceptEdits mode with shell file operation blocking
 * const editAgent = createAgent({
 *   model,
 *   ...applySecurityPolicy("development", {
 *     permissionMode: "acceptEdits",
 *     blockShellFileOps: true, // default, blocks bash file ops
 *   }),
 * });
 * ```
 *
 * @category Security
 */
export function applySecurityPolicy(
  preset: SecurityPolicyPreset,
  overrides?: Partial<SecurityPolicy>,
): {
  backend: FilesystemBackend;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  hooks?: HookRegistration;
} {
  // Get base policy for preset
  const basePolicy = getPresetPolicy(preset);

  // Merge with overrides
  const policy: SecurityPolicy = {
    backend: { ...basePolicy.backend, ...overrides?.backend },
    permissionMode: overrides?.permissionMode ?? basePolicy.permissionMode,
    allowedTools: overrides?.allowedTools ?? basePolicy.allowedTools,
    disallowedTools: overrides?.disallowedTools ?? basePolicy.disallowedTools,
    hooks: overrides?.hooks ?? basePolicy.hooks,
    blockShellFileOps: overrides?.blockShellFileOps ?? basePolicy.blockShellFileOps ?? true,
  };

  // If acceptEdits mode is enabled and blockShellFileOps is true,
  // add shell file operation patterns to blocked commands
  if (policy.permissionMode === "acceptEdits" && policy.blockShellFileOps) {
    const existingBlocked = policy.backend?.blockedCommands ?? [];
    policy.backend = {
      ...policy.backend,
      blockedCommands: [...existingBlocked, ...ACCEPT_EDITS_BLOCKED_PATTERNS],
    };
  }

  // Create filesystem backend with bash enabled
  const backend = new FilesystemBackend({
    enableBash: true,
    ...policy.backend,
  });

  // Return agent options
  return {
    backend,
    permissionMode: policy.permissionMode,
    allowedTools: policy.allowedTools,
    disallowedTools: policy.disallowedTools,
    hooks: policy.hooks,
  };
}

/**
 * Get the security policy configuration for a preset.
 * @internal
 */
function getPresetPolicy(preset: SecurityPolicyPreset): SecurityPolicy {
  switch (preset) {
    case "development":
      return getDevelopmentPolicy();
    case "ci":
      return getCiPolicy();
    case "production":
      return getProductionPolicy();
    case "readonly":
      return getReadOnlyPolicy();
    default:
      throw new Error(`Unknown security preset: ${preset}`);
  }
}

/**
 * Development preset - permissive settings for rapid iteration.
 *
 * Features:
 * - Allows all commands (including dangerous ones)
 * - 2 minute timeout
 * - No tool restrictions
 * - Default permission mode (prompts for unclear cases)
 *
 * @internal
 */
function getDevelopmentPolicy(): SecurityPolicy {
  return {
    backend: {
      allowDangerous: true,
      timeout: 120000,
      maxFileSizeMb: 100,
    },
    permissionMode: "default",
  };
}

/**
 * CI preset - restrictive settings for automated testing.
 *
 * Features:
 * - Blocks dangerous commands (rm -rf, shutdown, etc.)
 * - 5 minute timeout (for long test suites)
 * - Blocks network-related operations
 * - Plan mode (no tool execution, analysis only)
 *
 * @internal
 */
function getCiPolicy(): SecurityPolicy {
  return {
    backend: {
      allowDangerous: false,
      timeout: 300000, // 5 minutes
      maxFileSizeMb: 50,
      blockedCommands: [
        // Network operations that might be unstable in CI
        /curl/i,
        /wget/i,
        /git\s+push/i,
        /npm\s+publish/i,
        /docker\s+push/i,
      ],
    },
    permissionMode: "plan", // No tool execution in CI
    disallowedTools: [
      "bash", // Block direct bash access
      "execute", // Block generic execute
    ],
  };
}

/**
 * Production preset - balanced settings for production deployments.
 *
 * Features:
 * - Blocks dangerous commands
 * - 1 minute timeout (fail fast)
 * - Limited file operations (10MB max)
 * - Default permission mode with tool restrictions
 * - Blocks destructive operations
 *
 * @internal
 */
function getProductionPolicy(): SecurityPolicy {
  return {
    backend: {
      allowDangerous: false,
      timeout: 60000, // 1 minute
      maxFileSizeMb: 10,
      blockedCommands: [
        // Block package management (immutable production)
        /npm\s+(install|uninstall|update|publish)/i,
        /yarn\s+(add|remove|upgrade|publish)/i,
        /pip\s+(install|uninstall)/i,
        // Block git writes
        /git\s+(push|commit|merge|rebase)/i,
      ],
    },
    permissionMode: "default",
    disallowedTools: [
      "write", // Block file writes
      "edit", // Block file edits
    ],
  };
}

/**
 * Read-only preset - maximum restrictions for audit-only agents.
 *
 * Features:
 * - Blocks all write and modification commands
 * - 30 second timeout
 * - Very limited file operations (read-only, 5MB max)
 * - Plan mode (no tool execution)
 * - Blocks all write operations
 *
 * @internal
 */
function getReadOnlyPolicy(): SecurityPolicy {
  return {
    backend: {
      allowDangerous: false,
      timeout: 30000, // 30 seconds
      maxFileSizeMb: 5,
      blockedCommands: [
        /\brm\b/i,
        /\bmv\b/i,
        /\bcp\b/i,
        /\btouch\b/i,
        /\bmkdir\b/i,
        /\brmdir\b/i,
        /\bchmod\b/i,
        /\bchown\b/i,
        /\bln\b/i,
        />/,
        /\bdd\b/i,
        /\bwrite\b/i,
        /\bnpm\s+(install|uninstall|update|publish)/i,
        /\byarn\s+(add|remove|upgrade|publish)/i,
        /\bpip\s+(install|uninstall)/i,
        /\bgit\s+(push|commit|merge|rebase)/i,
      ],
    },
    permissionMode: "plan", // No tool execution
    disallowedTools: ["bash", "execute", "write", "edit"],
    allowedTools: ["read", "glob", "grep", "ls"],
  };
}

/**
 * Helper function to get backend options that block shell-based file operations.
 * Use this when you want to enable "acceptEdits" permission mode while preventing
 * bash commands from bypassing the file edit restrictions.
 *
 * @param baseOptions - Optional base backend options to extend
 * @returns Backend options with file operation blocking enabled
 *
 * @example
 * ```typescript
 * import { FilesystemBackend } from "@lleverage-ai/agent-sdk";
 * import { getBackendOptionsForAcceptEdits } from "@lleverage-ai/agent-sdk/security";
 *
 * const agent = createAgent({
 *   model,
 *   backend: new FilesystemBackend(getBackendOptionsForAcceptEdits({ enableBash: true })),
 *   permissionMode: "acceptEdits",
 * });
 * ```
 *
 * @category Security
 */
export function getBackendOptionsForAcceptEdits(
  baseOptions?: FilesystemBackendOptions,
): FilesystemBackendOptions {
  const existingBlocked = baseOptions?.blockedCommands ?? [];
  return {
    ...baseOptions,
    blockedCommands: [...existingBlocked, ...ACCEPT_EDITS_BLOCKED_PATTERNS],
  };
}
