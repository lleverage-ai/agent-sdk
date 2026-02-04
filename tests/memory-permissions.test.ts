/**
 * Tests for memory permission system with approval persistence and change detection.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeContentHash,
  computeFileHash,
  createInMemoryPermissionStore,
  createMemoryPermissionStore,
  type FileMemoryPermissionStore,
  type InMemoryPermissionStore,
} from "../src/index.js";

// =============================================================================
// Hash Utilities Tests
// =============================================================================

describe("Hash Utilities", () => {
  it("computes SHA-256 hash of string content", () => {
    const content = "# Test Memory\n\nSome content";
    const hash = computeContentHash(content);

    expect(hash).toMatch(/^[a-f0-9]{64}$/); // 64 hex chars
    expect(hash.length).toBe(64);
  });

  it("returns same hash for same content", () => {
    const content = "# Test";
    const hash1 = computeContentHash(content);
    const hash2 = computeContentHash(content);

    expect(hash1).toBe(hash2);
  });

  it("returns different hash for different content", () => {
    const hash1 = computeContentHash("# Test 1");
    const hash2 = computeContentHash("# Test 2");

    expect(hash1).not.toBe(hash2);
  });

  it("computes file hash from path", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
    const filePath = path.join(tmpDir, "test.md");

    await fs.writeFile(filePath, "# Test Memory", "utf-8");

    const hash = await computeFileHash(filePath);

    expect(hash).toBeDefined();
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("returns undefined for non-existent file", async () => {
    const hash = await computeFileHash("/nonexistent/file.md");
    expect(hash).toBeUndefined();
  });
});

// =============================================================================
// In-Memory Permission Store Tests
// =============================================================================

describe("InMemoryPermissionStore", () => {
  let store: InMemoryPermissionStore;

  beforeEach(() => {
    store = createInMemoryPermissionStore();
  });

  it("returns false for unapproved path", async () => {
    const approved = await store.isApproved("/test.md", "hash123");
    expect(approved).toBe(false);
  });

  it("grants approval for a path with hash", async () => {
    await store.grantApproval("/test.md", "hash123", "user1");

    const approved = await store.isApproved("/test.md", "hash123");
    expect(approved).toBe(true);
  });

  it("returns false when hash doesn't match", async () => {
    await store.grantApproval("/test.md", "hash123");

    const approved = await store.isApproved("/test.md", "different-hash");
    expect(approved).toBe(false);
  });

  it("updates approval when granted again with different hash", async () => {
    await store.grantApproval("/test.md", "hash1");
    await store.grantApproval("/test.md", "hash2");

    expect(await store.isApproved("/test.md", "hash1")).toBe(false);
    expect(await store.isApproved("/test.md", "hash2")).toBe(true);
  });

  it("revokes approval for a path", async () => {
    await store.grantApproval("/test.md", "hash123");

    const revoked = await store.revokeApproval("/test.md");
    expect(revoked).toBe(true);

    const approved = await store.isApproved("/test.md", "hash123");
    expect(approved).toBe(false);
  });

  it("returns false when revoking unapproved path", async () => {
    const revoked = await store.revokeApproval("/nonexistent.md");
    expect(revoked).toBe(false);
  });

  it("lists all approvals", async () => {
    await store.grantApproval("/test1.md", "hash1", "user1");
    await store.grantApproval("/test2.md", "hash2", "user2");

    const approvals = await store.listApprovals();
    expect(approvals).toHaveLength(2);

    const paths = approvals.map((a) => a.path);
    expect(paths).toContain("/test1.md");
    expect(paths).toContain("/test2.md");
  });

  it("includes approval metadata", async () => {
    const now = Date.now();
    await store.grantApproval("/test.md", "hash123", "user1");

    const approvals = await store.listApprovals();
    const approval = approvals[0];

    expect(approval.path).toBe("/test.md");
    expect(approval.contentHash).toBe("hash123");
    expect(approval.approvedBy).toBe("user1");
    expect(approval.approvedAt).toBeGreaterThanOrEqual(now);
  });

  it("clears all approvals", async () => {
    await store.grantApproval("/test1.md", "hash1");
    await store.grantApproval("/test2.md", "hash2");

    await store.clearAll();

    const approvals = await store.listApprovals();
    expect(approvals).toHaveLength(0);
  });
});

// =============================================================================
// File-Based Permission Store Tests
// =============================================================================

describe("FileMemoryPermissionStore", () => {
  let tmpDir: string;
  let permissionsFile: string;
  let store: FileMemoryPermissionStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-perms-"));
    permissionsFile = path.join(tmpDir, ".memory-permissions.json");
    store = createMemoryPermissionStore({ permissionsFilePath: permissionsFile });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates permissions file on first save", async () => {
    await store.grantApproval("/test.md", "hash123");

    const exists = await fs
      .access(permissionsFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("persists approvals to disk", async () => {
    await store.grantApproval("/test.md", "hash123", "user1");

    // Create new store instance to verify persistence
    const store2 = createMemoryPermissionStore({ permissionsFilePath: permissionsFile });
    const approved = await store2.isApproved("/test.md", "hash123");

    expect(approved).toBe(true);
  });

  it("loads existing approvals on first access", async () => {
    await store.grantApproval("/test.md", "hash123");

    // Create new store and verify it loads the data
    const store2 = createMemoryPermissionStore({ permissionsFilePath: permissionsFile });
    const approvals = await store2.listApprovals();

    expect(approvals).toHaveLength(1);
    expect(approvals[0].path).toBe("/test.md");
  });

  it("updates persisted approval when hash changes", async () => {
    await store.grantApproval("/test.md", "hash1");
    await store.grantApproval("/test.md", "hash2");

    const store2 = createMemoryPermissionStore({ permissionsFilePath: permissionsFile });
    expect(await store2.isApproved("/test.md", "hash1")).toBe(false);
    expect(await store2.isApproved("/test.md", "hash2")).toBe(true);
  });

  it("persists revocations to disk", async () => {
    await store.grantApproval("/test.md", "hash123");
    await store.revokeApproval("/test.md");

    const store2 = createMemoryPermissionStore({ permissionsFilePath: permissionsFile });
    const approved = await store2.isApproved("/test.md", "hash123");

    expect(approved).toBe(false);
  });

  it("handles non-existent file gracefully", async () => {
    const approved = await store.isApproved("/test.md", "hash123");
    expect(approved).toBe(false);
  });

  it("creates parent directories if needed", async () => {
    const nestedPath = path.join(tmpDir, "nested", "deep", ".memory-permissions.json");
    const store = createMemoryPermissionStore({
      permissionsFilePath: nestedPath,
      createDirs: true,
    });

    await store.grantApproval("/test.md", "hash123");

    const exists = await fs
      .access(nestedPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });
});

// =============================================================================
// Integration with loadAllMemory Tests
// =============================================================================

describe("Permission Store Integration", () => {
  let store: InMemoryPermissionStore;

  beforeEach(() => {
    store = createInMemoryPermissionStore();
  });

  it("remembers approved paths with hash verification", async () => {
    const path = "/project/.deepagents/agent.md";
    const content = "# Project Memory\n\nRules here";
    const hash = computeContentHash(content);

    // Grant approval
    await store.grantApproval(path, hash, "test-agent");

    // Verify approval is remembered
    const isApproved = await store.isApproved(path, hash);
    expect(isApproved).toBe(true);

    // Verify different hash is not approved
    const isDifferentApproved = await store.isApproved(path, "different-hash");
    expect(isDifferentApproved).toBe(false);
  });

  it("detects content changes via hash mismatch", async () => {
    const path = "/project/.deepagents/agent.md";
    const oldContent = "# Old Content";
    const newContent = "# New Content";
    const oldHash = computeContentHash(oldContent);
    const newHash = computeContentHash(newContent);

    // Approve with old content
    await store.grantApproval(path, oldHash, "test-agent");

    // Verify old hash is approved
    expect(await store.isApproved(path, oldHash)).toBe(true);

    // Verify new hash is not approved (content changed)
    expect(await store.isApproved(path, newHash)).toBe(false);

    // Verify we can find the old approval
    const approvals = await store.listApprovals();
    const oldApproval = approvals.find((a) => a.path === path);
    expect(oldApproval?.contentHash).toBe(oldHash);
  });

  it("supports re-approval after content changes", async () => {
    const path = "/project/.deepagents/agent.md";
    const oldHash = "hash1";
    const newHash = "hash2";

    // Initial approval
    await store.grantApproval(path, oldHash, "test-agent");
    expect(await store.isApproved(path, oldHash)).toBe(true);

    // Content changed, grant new approval
    await store.grantApproval(path, newHash, "test-agent");

    // Old hash no longer approved
    expect(await store.isApproved(path, oldHash)).toBe(false);

    // New hash is approved
    expect(await store.isApproved(path, newHash)).toBe(true);
  });

  it("persists approvals and revocations", async () => {
    const path1 = "/path1.md";
    const path2 = "/path2.md";

    await store.grantApproval(path1, "hash1");
    await store.grantApproval(path2, "hash2");

    expect(await store.listApprovals()).toHaveLength(2);

    await store.revokeApproval(path1);

    const remaining = await store.listApprovals();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].path).toBe(path2);
  });
});
