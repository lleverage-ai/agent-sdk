/**
 * Memory loading functions for agent memory system.
 *
 * Implements the two-tier memory architecture:
 * - **User-Level Memory**: `~/.deepagents/{agentId}/agent.md`
 * - **Project-Level Memory**: `[git-root]/.deepagents/agent.md`
 *
 * Also supports loading additional memory files from the user's agent directory.
 *
 * @example
 * ```typescript
 * import {
 *   loadAgentMemory,
 *   loadAdditionalMemoryFiles,
 *   buildMemorySection,
 * } from "@lleverage-ai/agent-sdk";
 *
 * // Load user-level memory
 * const userMemory = await loadAgentMemory("~/.deepagents/my-agent/agent.md");
 *
 * // Load all additional files from user directory
 * const additional = await loadAdditionalMemoryFiles("~/.deepagents/my-agent");
 *
 * // Build a formatted memory section for the prompt
 * const section = buildMemorySection(userMemory, projectMemory, additional);
 * ```
 *
 * @packageDocumentation
 */

import { exec } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { FilesystemMemoryStore } from "./filesystem-store.js";
import type { MemoryPermissionStore } from "./permissions.js";
import { computeContentHash } from "./permissions.js";
import type { MemoryDocument, MemoryMetadata, MemoryStore } from "./store.js";

const execAsync = promisify(exec);

// =============================================================================
// Memory Loading Options
// =============================================================================

/**
 * Options for loading agent memory.
 *
 * @category Memory
 */
export interface LoadAgentMemoryOptions {
  /**
   * Custom memory store to use.
   * Defaults to FilesystemMemoryStore.
   */
  store?: MemoryStore;

  /**
   * Override home directory for ~ expansion.
   */
  homeDir?: string;
}

/**
 * Options for loading additional memory files.
 *
 * @category Memory
 */
export interface LoadAdditionalMemoryOptions {
  /**
   * Custom memory store to use.
   * Defaults to FilesystemMemoryStore.
   */
  store?: MemoryStore;

  /**
   * File to exclude (usually agent.md).
   * @defaultValue ["agent.md"]
   */
  exclude?: string[];

  /**
   * Override home directory for ~ expansion.
   */
  homeDir?: string;
}

/**
 * Result from loading additional memory files.
 *
 * @category Memory
 */
export interface AdditionalMemoryFile {
  /**
   * Filename without path.
   */
  filename: string;

  /**
   * Full content of the file.
   */
  content: string;

  /**
   * Parsed metadata from frontmatter.
   */
  metadata: MemoryMetadata;
}

// =============================================================================
// Memory Loading Functions
// =============================================================================

/**
 * Load a single agent memory file.
 *
 * Reads the file, parses YAML frontmatter, and returns the document.
 *
 * @param filePath - Path to the memory file
 * @param options - Loading options
 * @returns The memory content, or undefined if not found
 *
 * @example
 * ```typescript
 * const memory = await loadAgentMemory("~/.deepagents/my-agent/agent.md");
 * if (memory) {
 *   console.log(memory.content);
 * }
 * ```
 *
 * @category Memory
 */
export async function loadAgentMemory(
  filePath: string,
  options?: LoadAgentMemoryOptions,
): Promise<MemoryDocument | undefined> {
  const store = options?.store ?? new FilesystemMemoryStore({ homeDir: options?.homeDir });

  return store.read(filePath);
}

/**
 * Load all additional memory files from a directory.
 *
 * Scans the directory for .md files (excluding agent.md by default)
 * and returns their content.
 *
 * @param dirPath - Path to the agent memory directory
 * @param options - Loading options
 * @returns Array of additional memory file content
 *
 * @example
 * ```typescript
 * const files = await loadAdditionalMemoryFiles("~/.deepagents/my-agent");
 * for (const file of files) {
 *   console.log(`${file.filename}: ${file.content.slice(0, 100)}...`);
 * }
 * ```
 *
 * @category Memory
 */
export async function loadAdditionalMemoryFiles(
  dirPath: string,
  options?: LoadAdditionalMemoryOptions,
): Promise<AdditionalMemoryFile[]> {
  const store = options?.store ?? new FilesystemMemoryStore({ homeDir: options?.homeDir });
  const exclude = options?.exclude ?? ["agent.md"];

  try {
    const files = await store.list(dirPath);
    const results: AdditionalMemoryFile[] = [];

    for (const filePath of files) {
      const filename = path.basename(filePath);

      // Skip excluded files
      if (exclude.includes(filename)) {
        continue;
      }

      const doc = await store.read(filePath);
      if (doc) {
        results.push({
          filename,
          content: doc.content,
          metadata: doc.metadata,
        });
      }
    }

    return results;
  } catch {
    // Directory doesn't exist or can't be read
    return [];
  }
}

// =============================================================================
// Git Root Detection
// =============================================================================

/**
 * Find the git root directory from a given path.
 *
 * @param fromPath - Starting path to search from
 * @returns The git root path, or undefined if not in a git repo
 *
 * @example
 * ```typescript
 * const gitRoot = await findGitRoot("/path/to/project/src/file.ts");
 * // Returns "/path/to/project" if that's the git root
 * ```
 *
 * @category Memory
 */
export async function findGitRoot(fromPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync("git rev-parse --show-toplevel", {
      cwd: fromPath,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Get the project memory path based on git root.
 *
 * @param workingDirectory - Current working directory
 * @returns Path to project memory file, or undefined if not in git repo
 *
 * @example
 * ```typescript
 * const projectMemoryPath = await getProjectMemoryPath("/path/to/project");
 * // Returns "/path/to/project/.deepagents/agent.md"
 * ```
 *
 * @category Memory
 */
export async function getProjectMemoryPath(workingDirectory: string): Promise<string | undefined> {
  const gitRoot = await findGitRoot(workingDirectory);
  if (!gitRoot) {
    return undefined;
  }

  return path.join(gitRoot, ".deepagents", "agent.md");
}

/**
 * Get the user memory path for an agent.
 *
 * @param agentId - The agent identifier
 * @param homeDir - Optional home directory override
 * @returns Path to user memory file
 *
 * @example
 * ```typescript
 * const userMemoryPath = getUserMemoryPath("my-agent");
 * // Returns "/home/user/.deepagents/my-agent/agent.md"
 * ```
 *
 * @category Memory
 */
export function getUserMemoryPath(agentId: string, homeDir?: string): string {
  const home = homeDir ?? process.env.HOME ?? "~";
  return path.join(home, ".deepagents", agentId, "agent.md");
}

/**
 * Get the user agent directory for an agent.
 *
 * @param agentId - The agent identifier
 * @param homeDir - Optional home directory override
 * @returns Path to user agent directory
 *
 * @category Memory
 */
export function getUserAgentDir(agentId: string, homeDir?: string): string {
  const home = homeDir ?? process.env.HOME ?? "~";
  return path.join(home, ".deepagents", agentId);
}

// =============================================================================
// Memory Section Builder
// =============================================================================

/**
 * Options for building the memory section.
 *
 * @category Memory
 */
export interface BuildMemorySectionOptions {
  /**
   * Header for the user memory section.
   * @defaultValue "# User Memory"
   */
  userHeader?: string;

  /**
   * Header for the project memory section.
   * @defaultValue "# Project Memory"
   */
  projectHeader?: string;

  /**
   * Header for additional files section.
   * @defaultValue "# Additional Context"
   */
  additionalHeader?: string;

  /**
   * Include file names as subheaders for additional files.
   * @defaultValue true
   */
  includeFilenames?: boolean;
}

/**
 * Build a formatted memory section for injection into prompts.
 *
 * Combines user memory, project memory, and additional files into
 * a single formatted string suitable for system prompt injection.
 *
 * @param userMemory - User-level memory document
 * @param projectMemory - Project-level memory document
 * @param additionalFiles - Additional memory files
 * @param options - Formatting options
 * @returns Formatted memory section string
 *
 * @example
 * ```typescript
 * const userMemory = await loadAgentMemory("~/.deepagents/agent/agent.md");
 * const projectMemory = await loadAgentMemory("/project/.deepagents/agent.md");
 * const additional = await loadAdditionalMemoryFiles("~/.deepagents/agent");
 *
 * const section = buildMemorySection(userMemory, projectMemory, additional);
 * const systemPrompt = `You are a helpful assistant.\n\n${section}`;
 * ```
 *
 * @category Memory
 */
export function buildMemorySection(
  userMemory: MemoryDocument | undefined,
  projectMemory: MemoryDocument | undefined,
  additionalFiles: AdditionalMemoryFile[],
  options?: BuildMemorySectionOptions,
): string {
  const userHeader = options?.userHeader ?? "# User Memory";
  const projectHeader = options?.projectHeader ?? "# Project Memory";
  const additionalHeader = options?.additionalHeader ?? "# Additional Context";
  const includeFilenames = options?.includeFilenames ?? true;

  const sections: string[] = [];

  // Add user memory
  if (userMemory?.content) {
    sections.push(`${userHeader}\n\n${userMemory.content}`);
  }

  // Add project memory
  if (projectMemory?.content) {
    sections.push(`${projectHeader}\n\n${projectMemory.content}`);
  }

  // Add additional files
  if (additionalFiles.length > 0) {
    const additionalContent = additionalFiles
      .map((file) => {
        if (includeFilenames) {
          return `## ${file.filename}\n\n${file.content}`;
        }
        return file.content;
      })
      .join("\n\n");

    sections.push(`${additionalHeader}\n\n${additionalContent}`);
  }

  return sections.join("\n\n---\n\n");
}

// =============================================================================
// Full Memory Loading
// =============================================================================

/**
 * Audit event emitted when memory is loaded.
 *
 * @category Memory
 */
export interface MemoryAuditEvent {
  /**
   * Event type.
   */
  type:
    | "memory_loaded"
    | "memory_approval_requested"
    | "memory_approval_denied"
    | "memory_content_changed";

  /**
   * Path to the memory file.
   */
  path: string;

  /**
   * Content hash of the memory file.
   */
  contentHash: string;

  /**
   * Whether the load was approved.
   */
  approved: boolean;

  /**
   * Timestamp (Unix ms).
   */
  timestamp: number;

  /**
   * Agent ID that loaded the memory.
   */
  agentId: string;

  /**
   * Previous content hash (for change detection).
   */
  previousHash?: string;
}

/**
 * Options for loading all agent memory.
 *
 * @category Memory
 */
export interface LoadAllMemoryOptions {
  /**
   * Unique identifier for the agent.
   */
  agentId: string;

  /**
   * Working directory for project memory detection.
   * @defaultValue process.cwd()
   */
  workingDirectory?: string;

  /**
   * Custom home directory override.
   */
  homeDir?: string;

  /**
   * Custom memory store.
   */
  store?: MemoryStore;

  /**
   * Memory permission store for approval persistence.
   *
   * When provided, approval decisions are persisted and checked on each load.
   * If the file content has changed since approval, re-approval is required.
   */
  permissionStore?: MemoryPermissionStore;

  /**
   * Callback to request project memory approval.
   *
   * Project-level memory may contain sensitive instructions.
   * Use this callback to implement approval workflows.
   *
   * When permissionStore is provided:
   * - This callback is only invoked if the file is not approved or has changed
   * - Approval is automatically persisted when granted
   */
  requestProjectApproval?: (
    projectPath: string,
    contentHash: string,
    previousHash?: string,
  ) => Promise<boolean>;

  /**
   * Callback for audit events.
   *
   * Called when memory is loaded, approval is requested, or content changes are detected.
   * Use this to integrate with audit logging systems or hooks.
   */
  onAuditEvent?: (event: MemoryAuditEvent) => void | Promise<void>;
}

/**
 * Result from loading all agent memory.
 *
 * @category Memory
 */
export interface LoadAllMemoryResult {
  /**
   * User-level memory document.
   */
  userMemory: MemoryDocument | undefined;

  /**
   * Project-level memory document.
   */
  projectMemory: MemoryDocument | undefined;

  /**
   * Additional memory files.
   */
  additionalFiles: AdditionalMemoryFile[];

  /**
   * Whether project memory was approved.
   */
  projectApproved: boolean;

  /**
   * Built memory section for prompt injection.
   */
  memorySection: string;
}

/**
 * Load all agent memory (user, project, and additional files).
 *
 * This is the main entry point for loading agent memory.
 * It handles the two-tier architecture, approval workflow, and change detection.
 *
 * @param options - Loading options
 * @returns Complete memory loading result
 *
 * @example Basic usage
 * ```typescript
 * const memory = await loadAllMemory({
 *   agentId: "my-agent",
 *   workingDirectory: "/path/to/project",
 *   requestProjectApproval: async (path, hash, previousHash) => {
 *     if (previousHash) {
 *       console.log(`Memory file ${path} has changed!`);
 *     }
 *     return confirm(`Load project memory from ${path}?`);
 *   },
 * });
 *
 * // Use in system prompt
 * const systemPrompt = `You are a helpful assistant.\n\n${memory.memorySection}`;
 * ```
 *
 * @example With permission persistence and audit logging
 * ```typescript
 * import { createMemoryPermissionStore } from "@lleverage-ai/agent-sdk";
 *
 * const permStore = createMemoryPermissionStore();
 *
 * const memory = await loadAllMemory({
 *   agentId: "my-agent",
 *   permissionStore: permStore,
 *   requestProjectApproval: async (path, hash, previousHash) => {
 *     // Only called if not approved or content changed
 *     return confirm(`Approve ${path}?`);
 *   },
 *   onAuditEvent: (event) => {
 *     console.log("Memory audit:", event);
 *   },
 * });
 * ```
 *
 * @category Memory
 */
export async function loadAllMemory(options: LoadAllMemoryOptions): Promise<LoadAllMemoryResult> {
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const store = options.store ?? new FilesystemMemoryStore({ homeDir: options.homeDir });

  // Load user memory
  const userMemoryPath = getUserMemoryPath(options.agentId, options.homeDir);
  const userMemory = await store.read(userMemoryPath);

  // Load additional files from user directory
  const userAgentDir = getUserAgentDir(options.agentId, options.homeDir);
  const additionalFiles = await loadAdditionalMemoryFiles(userAgentDir, {
    store,
    homeDir: options.homeDir,
  });

  // Load project memory (with approval, persistence, and change detection)
  let projectMemory: MemoryDocument | undefined;
  let projectApproved = false;

  const projectMemoryPath = await getProjectMemoryPath(workingDirectory);
  if (projectMemoryPath) {
    const exists = await store.exists(projectMemoryPath);
    if (exists) {
      // Read the content to compute hash
      const tempDoc = await store.read(projectMemoryPath);
      if (tempDoc) {
        const currentHash = computeContentHash(tempDoc.content);

        // Check permission store if provided
        let needsApproval = true;
        let previousHash: string | undefined;

        if (options.permissionStore) {
          const alreadyApproved = await options.permissionStore.isApproved(
            projectMemoryPath,
            currentHash,
          );

          if (alreadyApproved) {
            // Already approved with current hash
            needsApproval = false;
            projectApproved = true;
          } else {
            // Check if it was approved with a different hash (content changed)
            const allApprovals = await options.permissionStore.listApprovals();
            const existingApproval = allApprovals.find((a) => a.path === projectMemoryPath);
            if (existingApproval) {
              previousHash = existingApproval.contentHash;

              // Emit audit event for content change
              if (options.onAuditEvent) {
                await options.onAuditEvent({
                  type: "memory_content_changed",
                  path: projectMemoryPath,
                  contentHash: currentHash,
                  approved: false,
                  timestamp: Date.now(),
                  agentId: options.agentId,
                  previousHash,
                });
              }
            }
          }
        }

        // Request approval if needed
        if (needsApproval && options.requestProjectApproval) {
          // Emit audit event for approval request
          if (options.onAuditEvent) {
            await options.onAuditEvent({
              type: "memory_approval_requested",
              path: projectMemoryPath,
              contentHash: currentHash,
              approved: false,
              timestamp: Date.now(),
              agentId: options.agentId,
              previousHash,
            });
          }

          projectApproved = await options.requestProjectApproval(
            projectMemoryPath,
            currentHash,
            previousHash,
          );

          // Persist approval decision if granted
          if (projectApproved && options.permissionStore) {
            await options.permissionStore.grantApproval(
              projectMemoryPath,
              currentHash,
              options.agentId,
            );
          }

          // Emit audit event for approval decision
          if (options.onAuditEvent) {
            await options.onAuditEvent({
              type: projectApproved ? "memory_loaded" : "memory_approval_denied",
              path: projectMemoryPath,
              contentHash: currentHash,
              approved: projectApproved,
              timestamp: Date.now(),
              agentId: options.agentId,
              previousHash,
            });
          }
        } else if (!needsApproval) {
          // Already approved via permission store
          if (options.onAuditEvent) {
            await options.onAuditEvent({
              type: "memory_loaded",
              path: projectMemoryPath,
              contentHash: currentHash,
              approved: true,
              timestamp: Date.now(),
              agentId: options.agentId,
            });
          }
        } else {
          // No approval callback, auto-approve
          projectApproved = true;

          if (options.onAuditEvent) {
            await options.onAuditEvent({
              type: "memory_loaded",
              path: projectMemoryPath,
              contentHash: currentHash,
              approved: true,
              timestamp: Date.now(),
              agentId: options.agentId,
            });
          }
        }

        if (projectApproved) {
          projectMemory = tempDoc;
        }
      }
    }
  }

  // Build memory section
  const memorySection = buildMemorySection(userMemory, projectMemory, additionalFiles);

  return {
    userMemory,
    projectMemory,
    additionalFiles,
    projectApproved,
    memorySection,
  };
}
