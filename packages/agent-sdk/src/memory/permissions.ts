/**
 * Memory permission management with approval persistence and change detection.
 *
 * Provides security features for the agent memory system:
 * - Approval persistence: Remember which paths the user has approved for loading
 * - Hash-based change detection: Detect when memory files have been modified
 * - Automatic revocation: Require re-approval when memory content changes
 *
 * @example
 * ```typescript
 * import { MemoryPermissionStore, createMemoryPermissionStore } from "@lleverage-ai/agent-sdk";
 *
 * const permStore = createMemoryPermissionStore("/path/to/.memory-permissions.json");
 *
 * // Check if a path is approved
 * const approved = await permStore.isApproved("/project/.deepagents/agent.md", contentHash);
 *
 * // Grant approval
 * await permStore.grantApproval("/project/.deepagents/agent.md", contentHash);
 *
 * // Revoke approval
 * await permStore.revokeApproval("/project/.deepagents/agent.md");
 * ```
 *
 * @packageDocumentation
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// =============================================================================
// Permission Types
// =============================================================================

/**
 * Approval record for a memory file.
 *
 * Tracks when a file was approved and its content hash at approval time.
 *
 * @category Memory
 */
export interface MemoryApproval {
  /**
   * Full path to the approved memory file.
   */
  path: string;

  /**
   * SHA-256 hash of the file content at approval time.
   */
  contentHash: string;

  /**
   * Timestamp when approval was granted (Unix ms).
   */
  approvedAt: number;

  /**
   * Optional user identifier who granted approval.
   */
  approvedBy?: string;
}

/**
 * Store interface for memory permissions.
 *
 * Implement this to provide custom storage backends.
 *
 * @category Memory
 */
export interface MemoryPermissionStore {
  /**
   * Check if a path is approved with a specific content hash.
   *
   * Returns true only if:
   * 1. The path has been approved
   * 2. The content hash matches the approved hash
   *
   * @param path - Path to check
   * @param contentHash - Current content hash
   * @returns True if approved and hash matches
   */
  isApproved(path: string, contentHash: string): Promise<boolean>;

  /**
   * Grant approval for a path with a specific content hash.
   *
   * If the path was previously approved with a different hash,
   * this updates the approval to the new hash.
   *
   * @param path - Path to approve
   * @param contentHash - Content hash at approval time
   * @param approvedBy - Optional user identifier
   */
  grantApproval(path: string, contentHash: string, approvedBy?: string): Promise<void>;

  /**
   * Revoke approval for a path.
   *
   * @param path - Path to revoke
   * @returns True if approval was revoked, false if it wasn't approved
   */
  revokeApproval(path: string): Promise<boolean>;

  /**
   * List all approved paths.
   *
   * @returns Array of approval records
   */
  listApprovals(): Promise<MemoryApproval[]>;

  /**
   * Clear all approvals.
   *
   * Useful for resetting permissions or testing.
   */
  clearAll(): Promise<void>;
}

// =============================================================================
// Hash Utilities
// =============================================================================

/**
 * Compute SHA-256 hash of a string.
 *
 * @param content - Content to hash
 * @returns Hex-encoded hash
 *
 * @example
 * ```typescript
 * const hash = computeContentHash("# My Memory\n\nContent here");
 * // Returns: "a1b2c3d4..."
 * ```
 *
 * @category Memory
 */
export function computeContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Compute content hash from a file path.
 *
 * @param filePath - Path to the file
 * @returns Hex-encoded hash, or undefined if file doesn't exist
 *
 * @example
 * ```typescript
 * const hash = await computeFileHash("/path/to/memory.md");
 * ```
 *
 * @category Memory
 */
export async function computeFileHash(filePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return computeContentHash(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

// =============================================================================
// File-Based Permission Store
// =============================================================================

/**
 * Options for FileMemoryPermissionStore.
 *
 * @category Memory
 */
export interface FileMemoryPermissionStoreOptions {
  /**
   * Path to the permissions file.
   *
   * @defaultValue ~/.deepagents/.memory-permissions.json
   */
  permissionsFilePath?: string;

  /**
   * Create parent directories if they don't exist.
   *
   * @defaultValue true
   */
  createDirs?: boolean;
}

/**
 * File-based implementation of MemoryPermissionStore.
 *
 * Stores approvals in a JSON file on disk.
 *
 * @example
 * ```typescript
 * const store = new FileMemoryPermissionStore({
 *   permissionsFilePath: "/home/user/.deepagents/.memory-permissions.json",
 * });
 *
 * // Grant approval
 * await store.grantApproval("/project/.deepagents/agent.md", contentHash, "user");
 *
 * // Check if approved
 * const approved = await store.isApproved("/project/.deepagents/agent.md", contentHash);
 * ```
 *
 * @category Memory
 */
export class FileMemoryPermissionStore implements MemoryPermissionStore {
  private readonly permissionsFilePath: string;
  private readonly createDirs: boolean;
  private approvals: Map<string, MemoryApproval> = new Map();
  private loaded = false;

  /**
   * Create a new FileMemoryPermissionStore.
   *
   * @param options - Configuration options
   */
  constructor(options: FileMemoryPermissionStoreOptions = {}) {
    const homeDir = process.env.HOME ?? "~";
    this.permissionsFilePath =
      options.permissionsFilePath ?? path.join(homeDir, ".deepagents", ".memory-permissions.json");
    this.createDirs = options.createDirs ?? true;
  }

  /**
   * Load approvals from disk if not already loaded.
   *
   * @internal
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const content = await fs.readFile(this.permissionsFilePath, "utf-8");
      const data = JSON.parse(content) as MemoryApproval[];

      this.approvals.clear();
      for (const approval of data) {
        this.approvals.set(approval.path, approval);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      // File doesn't exist yet, start with empty approvals
    }

    this.loaded = true;
  }

  /**
   * Save approvals to disk.
   *
   * @internal
   */
  private async save(): Promise<void> {
    await this.ensureLoaded();

    if (this.createDirs) {
      const dir = path.dirname(this.permissionsFilePath);
      await fs.mkdir(dir, { recursive: true });
    }

    const data = Array.from(this.approvals.values());
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(this.permissionsFilePath, content, "utf-8");
  }

  /**
   * Check if a path is approved with a specific content hash.
   */
  async isApproved(path: string, contentHash: string): Promise<boolean> {
    await this.ensureLoaded();

    const approval = this.approvals.get(path);
    if (!approval) return false;

    // Approval is valid only if hash matches
    return approval.contentHash === contentHash;
  }

  /**
   * Grant approval for a path with a specific content hash.
   */
  async grantApproval(path: string, contentHash: string, approvedBy?: string): Promise<void> {
    await this.ensureLoaded();

    this.approvals.set(path, {
      path,
      contentHash,
      approvedAt: Date.now(),
      approvedBy,
    });

    await this.save();
  }

  /**
   * Revoke approval for a path.
   */
  async revokeApproval(path: string): Promise<boolean> {
    await this.ensureLoaded();

    const hadApproval = this.approvals.has(path);
    this.approvals.delete(path);

    if (hadApproval) {
      await this.save();
    }

    return hadApproval;
  }

  /**
   * List all approved paths.
   */
  async listApprovals(): Promise<MemoryApproval[]> {
    await this.ensureLoaded();
    return Array.from(this.approvals.values());
  }

  /**
   * Clear all approvals.
   */
  async clearAll(): Promise<void> {
    await this.ensureLoaded();

    this.approvals.clear();
    await this.save();
  }
}

// =============================================================================
// In-Memory Permission Store (for testing)
// =============================================================================

/**
 * In-memory implementation of MemoryPermissionStore for testing.
 *
 * Approvals are stored in memory and not persisted.
 *
 * @example
 * ```typescript
 * const store = new InMemoryPermissionStore();
 *
 * await store.grantApproval("/test.md", hash);
 * const approved = await store.isApproved("/test.md", hash);
 * ```
 *
 * @category Memory
 */
export class InMemoryPermissionStore implements MemoryPermissionStore {
  private approvals: Map<string, MemoryApproval> = new Map();

  /**
   * Check if a path is approved with a specific content hash.
   */
  async isApproved(path: string, contentHash: string): Promise<boolean> {
    const approval = this.approvals.get(path);
    if (!approval) return false;
    return approval.contentHash === contentHash;
  }

  /**
   * Grant approval for a path with a specific content hash.
   */
  async grantApproval(path: string, contentHash: string, approvedBy?: string): Promise<void> {
    this.approvals.set(path, {
      path,
      contentHash,
      approvedAt: Date.now(),
      approvedBy,
    });
  }

  /**
   * Revoke approval for a path.
   */
  async revokeApproval(path: string): Promise<boolean> {
    return this.approvals.delete(path);
  }

  /**
   * List all approved paths.
   */
  async listApprovals(): Promise<MemoryApproval[]> {
    return Array.from(this.approvals.values());
  }

  /**
   * Clear all approvals.
   */
  async clearAll(): Promise<void> {
    this.approvals.clear();
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new FileMemoryPermissionStore.
 *
 * @param options - Configuration options
 * @returns A new FileMemoryPermissionStore instance
 *
 * @example
 * ```typescript
 * const store = createMemoryPermissionStore({
 *   permissionsFilePath: "/path/to/.memory-permissions.json",
 * });
 * ```
 *
 * @category Memory
 */
export function createMemoryPermissionStore(
  options?: FileMemoryPermissionStoreOptions,
): FileMemoryPermissionStore {
  return new FileMemoryPermissionStore(options);
}

/**
 * Create a new InMemoryPermissionStore.
 *
 * @returns A new InMemoryPermissionStore instance
 *
 * @example
 * ```typescript
 * const store = createInMemoryPermissionStore();
 * ```
 *
 * @category Memory
 */
export function createInMemoryPermissionStore(): InMemoryPermissionStore {
  return new InMemoryPermissionStore();
}
