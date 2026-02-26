/**
 * Tests for the checkpointer system.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Checkpoint } from "../src/index.js";
import {
  // Types and helpers
  createCheckpoint,
  createFileSaver,
  createKeyValueStoreSaver,
  createMemorySaver,
  // File Saver
  FileSaver,
  // KeyValueStore for testing
  InMemoryStore,
  isCheckpoint,
  // KeyValueStore Saver
  KeyValueStoreSaver,
  // Memory Saver
  MemorySaver,
  updateCheckpoint,
} from "../src/index.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestCheckpoint(threadId: string, overrides?: Partial<Checkpoint>): Checkpoint {
  return {
    threadId,
    step: 0,
    messages: [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there!" },
    ],
    state: { todos: [], files: {} },
    createdAt: "2026-01-30T10:00:00Z",
    updatedAt: "2026-01-30T10:00:00Z",
    ...overrides,
  };
}

// =============================================================================
// Type Guards and Helpers Tests
// =============================================================================

describe("Checkpoint Types and Helpers", () => {
  describe("createCheckpoint", () => {
    it("should create a checkpoint with required fields", () => {
      const checkpoint = createCheckpoint({
        threadId: "test-1",
        messages: [{ role: "user", content: "Hello" }],
        state: { todos: [], files: {} },
      });

      expect(checkpoint.threadId).toBe("test-1");
      expect(checkpoint.messages).toHaveLength(1);
      expect(checkpoint.step).toBe(0);
      expect(checkpoint.createdAt).toBeDefined();
      expect(checkpoint.updatedAt).toBeDefined();
    });

    it("should preserve optional fields", () => {
      const checkpoint = createCheckpoint({
        threadId: "test-2",
        messages: [],
        state: { todos: [], files: {} },
        step: 5,
        metadata: { key: "value" },
      });

      expect(checkpoint.step).toBe(5);
      expect(checkpoint.metadata).toEqual({ key: "value" });
    });

    it("should set timestamps automatically", () => {
      const before = new Date().toISOString();
      const checkpoint = createCheckpoint({
        threadId: "test-3",
        messages: [],
        state: { todos: [], files: {} },
      });
      const after = new Date().toISOString();

      expect(checkpoint.createdAt >= before).toBe(true);
      expect(checkpoint.createdAt <= after).toBe(true);
      expect(checkpoint.updatedAt).toBe(checkpoint.createdAt);
    });
  });

  describe("updateCheckpoint", () => {
    it("should update fields while preserving threadId and createdAt", () => {
      const original = createTestCheckpoint("test-1");
      const updated = updateCheckpoint(original, {
        step: 5,
        messages: [{ role: "user", content: "New message" }],
      });

      expect(updated.threadId).toBe("test-1");
      expect(updated.createdAt).toBe(original.createdAt);
      expect(updated.step).toBe(5);
      expect(updated.messages).toHaveLength(1);
      expect(updated.updatedAt).not.toBe(original.updatedAt);
    });

    it("should update updatedAt timestamp", () => {
      const original = createTestCheckpoint("test-1");
      const before = new Date().toISOString();
      const updated = updateCheckpoint(original, { step: 1 });
      const after = new Date().toISOString();

      expect(updated.updatedAt >= before).toBe(true);
      expect(updated.updatedAt <= after).toBe(true);
    });

    it("should handle metadata updates", () => {
      const original = createTestCheckpoint("test-1", {
        metadata: { foo: "bar" },
      });
      const updated = updateCheckpoint(original, {
        metadata: { foo: "baz", extra: 123 },
      });

      expect(updated.metadata).toEqual({ foo: "baz", extra: 123 });
    });
  });

  describe("isCheckpoint", () => {
    it("should return true for valid checkpoint", () => {
      const checkpoint = createTestCheckpoint("test-1");
      expect(isCheckpoint(checkpoint)).toBe(true);
    });

    it("should return false for null", () => {
      expect(isCheckpoint(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isCheckpoint(undefined)).toBe(false);
    });

    it("should return false for primitive", () => {
      expect(isCheckpoint("string")).toBe(false);
      expect(isCheckpoint(123)).toBe(false);
    });

    it("should return false for missing threadId", () => {
      expect(
        isCheckpoint({
          step: 0,
          messages: [],
          state: { todos: [], files: {} },
          createdAt: "2026-01-30T10:00:00Z",
          updatedAt: "2026-01-30T10:00:00Z",
        }),
      ).toBe(false);
    });

    it("should return false for invalid step type", () => {
      expect(
        isCheckpoint({
          threadId: "test",
          step: "0",
          messages: [],
          state: { todos: [], files: {} },
          createdAt: "2026-01-30T10:00:00Z",
          updatedAt: "2026-01-30T10:00:00Z",
        }),
      ).toBe(false);
    });

    it("should return false for non-array messages", () => {
      expect(
        isCheckpoint({
          threadId: "test",
          step: 0,
          messages: "not an array",
          state: { todos: [], files: {} },
          createdAt: "2026-01-30T10:00:00Z",
          updatedAt: "2026-01-30T10:00:00Z",
        }),
      ).toBe(false);
    });
  });
});

// =============================================================================
// MemorySaver Tests
// =============================================================================

describe("MemorySaver", () => {
  let saver: MemorySaver;

  beforeEach(() => {
    saver = new MemorySaver();
  });

  describe("basic operations", () => {
    it("should save and load a checkpoint", async () => {
      const checkpoint = createTestCheckpoint("session-1");
      await saver.save(checkpoint);

      const loaded = await saver.load("session-1");
      expect(loaded).toEqual(checkpoint);
    });

    it("should return undefined for non-existent checkpoint", async () => {
      const loaded = await saver.load("non-existent");
      expect(loaded).toBeUndefined();
    });

    it("should overwrite existing checkpoint", async () => {
      const checkpoint1 = createTestCheckpoint("session-1", { step: 0 });
      const checkpoint2 = createTestCheckpoint("session-1", { step: 5 });

      await saver.save(checkpoint1);
      await saver.save(checkpoint2);

      const loaded = await saver.load("session-1");
      expect(loaded?.step).toBe(5);
    });

    it("should check existence correctly", async () => {
      expect(await saver.exists("session-1")).toBe(false);

      await saver.save(createTestCheckpoint("session-1"));
      expect(await saver.exists("session-1")).toBe(true);
    });

    it("should delete checkpoint", async () => {
      await saver.save(createTestCheckpoint("session-1"));
      expect(await saver.exists("session-1")).toBe(true);

      const deleted = await saver.delete("session-1");
      expect(deleted).toBe(true);
      expect(await saver.exists("session-1")).toBe(false);
    });

    it("should return false when deleting non-existent", async () => {
      const deleted = await saver.delete("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("list", () => {
    it("should list all thread IDs", async () => {
      await saver.save(createTestCheckpoint("session-1"));
      await saver.save(createTestCheckpoint("session-2"));
      await saver.save(createTestCheckpoint("session-3"));

      const threads = await saver.list();
      expect(threads).toHaveLength(3);
      expect(threads).toContain("session-1");
      expect(threads).toContain("session-2");
      expect(threads).toContain("session-3");
    });

    it("should return empty array when no checkpoints", async () => {
      const threads = await saver.list();
      expect(threads).toEqual([]);
    });
  });

  describe("namespace isolation", () => {
    it("should isolate checkpoints by namespace", async () => {
      const saver1 = new MemorySaver({ namespace: "user-1" });
      const saver2 = new MemorySaver({ namespace: "user-2" });

      await saver1.save(createTestCheckpoint("session-1"));
      await saver2.save(createTestCheckpoint("session-1"));

      expect(await saver1.list()).toEqual(["session-1"]);
      expect(await saver2.list()).toEqual(["session-1"]);

      // Deleting from one namespace doesn't affect the other
      await saver1.delete("session-1");
      expect(await saver1.exists("session-1")).toBe(false);
      expect(await saver2.exists("session-1")).toBe(true);
    });
  });

  describe("data isolation", () => {
    it("should return deep copies (not references)", async () => {
      const checkpoint = createTestCheckpoint("session-1");
      await saver.save(checkpoint);

      // Mutate original
      checkpoint.step = 999;

      const loaded = await saver.load("session-1");
      expect(loaded?.step).toBe(0); // Should not be affected
    });

    it("should protect stored data from external mutation", async () => {
      await saver.save(createTestCheckpoint("session-1"));

      const loaded1 = await saver.load("session-1");
      loaded1!.step = 999;

      const loaded2 = await saver.load("session-1");
      expect(loaded2?.step).toBe(0); // Should not be affected
    });
  });

  describe("utility methods", () => {
    it("should track size correctly", async () => {
      expect(saver.size).toBe(0);

      await saver.save(createTestCheckpoint("session-1"));
      expect(saver.size).toBe(1);

      await saver.save(createTestCheckpoint("session-2"));
      expect(saver.size).toBe(2);

      await saver.delete("session-1");
      expect(saver.size).toBe(1);
    });

    it("should clear all checkpoints", async () => {
      await saver.save(createTestCheckpoint("session-1"));
      await saver.save(createTestCheckpoint("session-2"));

      saver.clear();

      expect(saver.size).toBe(0);
      expect(await saver.list()).toEqual([]);
    });

    it("should only clear own namespace", async () => {
      const saver1 = new MemorySaver({ namespace: "ns1" });
      const saver2 = new MemorySaver({ namespace: "ns2" });

      await saver1.save(createTestCheckpoint("session-1"));
      await saver2.save(createTestCheckpoint("session-1"));

      saver1.clear();

      expect(saver1.size).toBe(0);
      expect(saver2.size).toBe(1);
    });
  });

  describe("initial checkpoints", () => {
    it("should accept initial checkpoints", async () => {
      const saver = new MemorySaver({
        initialCheckpoints: [createTestCheckpoint("session-1"), createTestCheckpoint("session-2")],
      });

      expect(saver.size).toBe(2);
      expect(await saver.exists("session-1")).toBe(true);
      expect(await saver.exists("session-2")).toBe(true);
    });
  });

  describe("factory function", () => {
    it("should create saver via factory", async () => {
      const saver = createMemorySaver();
      await saver.save(createTestCheckpoint("test"));
      expect(await saver.exists("test")).toBe(true);
    });

    it("should accept options via factory", async () => {
      const saver = createMemorySaver({ namespace: "test-ns" });
      await saver.save(createTestCheckpoint("session-1"));
      expect(await saver.list()).toEqual(["session-1"]);
    });
  });
});

// =============================================================================
// FileSaver Tests
// =============================================================================

describe("FileSaver", () => {
  let tempDir: string;
  let saver: FileSaver;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "checkpointer-test-"));
    saver = new FileSaver({ dir: tempDir });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("basic operations", () => {
    it("should save and load a checkpoint", async () => {
      const checkpoint = createTestCheckpoint("session-1");
      await saver.save(checkpoint);

      const loaded = await saver.load("session-1");
      expect(loaded).toEqual(checkpoint);
    });

    it("should create directory if it doesn't exist", async () => {
      const nestedDir = path.join(tempDir, "nested", "deep");
      const nestedSaver = new FileSaver({ dir: nestedDir });

      await nestedSaver.save(createTestCheckpoint("session-1"));

      const stats = await fs.stat(nestedDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should return undefined for non-existent checkpoint", async () => {
      const loaded = await saver.load("non-existent");
      expect(loaded).toBeUndefined();
    });

    it("should overwrite existing checkpoint", async () => {
      const checkpoint1 = createTestCheckpoint("session-1", { step: 0 });
      const checkpoint2 = createTestCheckpoint("session-1", { step: 5 });

      await saver.save(checkpoint1);
      await saver.save(checkpoint2);

      const loaded = await saver.load("session-1");
      expect(loaded?.step).toBe(5);
    });

    it("should check existence correctly", async () => {
      expect(await saver.exists("session-1")).toBe(false);

      await saver.save(createTestCheckpoint("session-1"));
      expect(await saver.exists("session-1")).toBe(true);
    });

    it("should delete checkpoint", async () => {
      await saver.save(createTestCheckpoint("session-1"));
      expect(await saver.exists("session-1")).toBe(true);

      const deleted = await saver.delete("session-1");
      expect(deleted).toBe(true);
      expect(await saver.exists("session-1")).toBe(false);
    });

    it("should return false when deleting non-existent", async () => {
      const deleted = await saver.delete("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("file format", () => {
    it("should store checkpoints as JSON files", async () => {
      await saver.save(createTestCheckpoint("session-1"));

      const filePath = saver.getFilePath("session-1");
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.threadId).toBe("session-1");
    });

    it("should use pretty printing by default", async () => {
      await saver.save(createTestCheckpoint("session-1"));

      const filePath = saver.getFilePath("session-1");
      const content = await fs.readFile(filePath, "utf-8");

      // Pretty printed JSON has newlines
      expect(content).toContain("\n");
    });

    it("should support compact JSON", async () => {
      const compactSaver = new FileSaver({ dir: tempDir, pretty: false });
      await compactSaver.save(createTestCheckpoint("session-2"));

      const filePath = compactSaver.getFilePath("session-2");
      const content = await fs.readFile(filePath, "utf-8");

      // Compact JSON is a single line
      expect(content.split("\n")).toHaveLength(1);
    });

    it("should use .json extension by default", async () => {
      await saver.save(createTestCheckpoint("session-1"));

      const filePath = saver.getFilePath("session-1");
      expect(filePath).toMatch(/\.json$/);
    });

    it("should support custom extension", async () => {
      const customSaver = new FileSaver({
        dir: tempDir,
        extension: ".checkpoint",
      });
      await customSaver.save(createTestCheckpoint("session-1"));

      const filePath = customSaver.getFilePath("session-1");
      expect(filePath).toMatch(/\.checkpoint$/);
    });
  });

  describe("filename sanitization", () => {
    it("should sanitize thread IDs for safe filenames", async () => {
      // Thread ID with special characters
      await saver.save(createTestCheckpoint("user/session:123"));

      const loaded = await saver.load("user/session:123");
      expect(loaded).toBeDefined();
      expect(loaded?.threadId).toBe("user/session:123");
    });

    it("should handle thread IDs with spaces", async () => {
      await saver.save(createTestCheckpoint("session with spaces"));

      const loaded = await saver.load("session with spaces");
      expect(loaded).toBeDefined();
    });
  });

  describe("list", () => {
    it("should list all thread IDs", async () => {
      await saver.save(createTestCheckpoint("session-1"));
      await saver.save(createTestCheckpoint("session-2"));
      await saver.save(createTestCheckpoint("session-3"));

      const threads = await saver.list();
      expect(threads).toHaveLength(3);
      expect(threads).toContain("session-1");
      expect(threads).toContain("session-2");
      expect(threads).toContain("session-3");
    });

    it("should return empty array when no checkpoints", async () => {
      const threads = await saver.list();
      expect(threads).toEqual([]);
    });

    it("should return empty array when directory doesn't exist yet", async () => {
      const nonExistentSaver = new FileSaver({
        dir: path.join(tempDir, "non-existent"),
      });
      const threads = await nonExistentSaver.list();
      expect(threads).toEqual([]);
    });
  });

  describe("namespace isolation", () => {
    it("should isolate checkpoints by namespace", async () => {
      const saver1 = new FileSaver({ dir: tempDir, namespace: "user-1" });
      const saver2 = new FileSaver({ dir: tempDir, namespace: "user-2" });

      await saver1.save(createTestCheckpoint("session-1"));
      await saver2.save(createTestCheckpoint("session-1"));

      expect(await saver1.list()).toEqual(["session-1"]);
      expect(await saver2.list()).toEqual(["session-1"]);

      // Both files exist with different names
      const files = await fs.readdir(tempDir);
      expect(files).toHaveLength(2);
    });
  });

  describe("validation", () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it("should return undefined for invalid JSON", async () => {
      const filePath = saver.getFilePath("invalid");
      await saver.save(createTestCheckpoint("dummy")); // Ensure dir exists
      await fs.writeFile(filePath, "not json", "utf-8");

      await expect(saver.load("invalid")).rejects.toThrow();
    });

    it("should return undefined for invalid checkpoint structure", async () => {
      const filePath = saver.getFilePath("invalid-structure");
      await saver.save(createTestCheckpoint("dummy")); // Ensure dir exists
      await fs.writeFile(filePath, JSON.stringify({ foo: "bar" }), "utf-8");

      const loaded = await saver.load("invalid-structure");
      expect(loaded).toBeUndefined();
    });
  });

  describe("factory function", () => {
    it("should create saver via factory", async () => {
      const saver = createFileSaver({ dir: tempDir });
      await saver.save(createTestCheckpoint("test"));
      expect(await saver.exists("test")).toBe(true);
    });
  });
});

// =============================================================================
// KeyValueStoreSaver Tests
// =============================================================================

describe("KeyValueStoreSaver", () => {
  let store: InMemoryStore;
  let saver: KeyValueStoreSaver;

  beforeEach(() => {
    store = new InMemoryStore();
    saver = new KeyValueStoreSaver({ store });
  });

  describe("basic operations", () => {
    it("should save and load a checkpoint", async () => {
      const checkpoint = createTestCheckpoint("session-1");
      await saver.save(checkpoint);

      const loaded = await saver.load("session-1");
      expect(loaded).toEqual(checkpoint);
    });

    it("should return undefined for non-existent checkpoint", async () => {
      const loaded = await saver.load("non-existent");
      expect(loaded).toBeUndefined();
    });

    it("should overwrite existing checkpoint", async () => {
      const checkpoint1 = createTestCheckpoint("session-1", { step: 0 });
      const checkpoint2 = createTestCheckpoint("session-1", { step: 5 });

      await saver.save(checkpoint1);
      await saver.save(checkpoint2);

      const loaded = await saver.load("session-1");
      expect(loaded?.step).toBe(5);
    });

    it("should check existence correctly", async () => {
      expect(await saver.exists("session-1")).toBe(false);

      await saver.save(createTestCheckpoint("session-1"));
      expect(await saver.exists("session-1")).toBe(true);
    });

    it("should delete checkpoint", async () => {
      await saver.save(createTestCheckpoint("session-1"));
      expect(await saver.exists("session-1")).toBe(true);

      const deleted = await saver.delete("session-1");
      expect(deleted).toBe(true);
      expect(await saver.exists("session-1")).toBe(false);
    });

    it("should return false when deleting non-existent", async () => {
      const deleted = await saver.delete("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("list", () => {
    it("should list all thread IDs", async () => {
      await saver.save(createTestCheckpoint("session-1"));
      await saver.save(createTestCheckpoint("session-2"));
      await saver.save(createTestCheckpoint("session-3"));

      const threads = await saver.list();
      expect(threads).toHaveLength(3);
      expect(threads).toContain("session-1");
      expect(threads).toContain("session-2");
      expect(threads).toContain("session-3");
    });

    it("should return empty array when no checkpoints", async () => {
      const threads = await saver.list();
      expect(threads).toEqual([]);
    });
  });

  describe("namespace isolation", () => {
    it("should isolate checkpoints by namespace", async () => {
      const saver1 = new KeyValueStoreSaver({ store, namespace: "user-1" });
      const saver2 = new KeyValueStoreSaver({ store, namespace: "user-2" });

      await saver1.save(createTestCheckpoint("session-1"));
      await saver2.save(createTestCheckpoint("session-1"));

      expect(await saver1.list()).toEqual(["session-1"]);
      expect(await saver2.list()).toEqual(["session-1"]);

      // Deleting from one namespace doesn't affect the other
      await saver1.delete("session-1");
      expect(await saver1.exists("session-1")).toBe(false);
      expect(await saver2.exists("session-1")).toBe(true);
    });
  });

  describe("storage structure", () => {
    it("should store checkpoints at [checkpoints, threadId]", async () => {
      await saver.save(createTestCheckpoint("session-1"));

      // Verify in underlying store
      const stored = await store.get(["checkpoints"], "session-1");
      expect(stored).toBeDefined();
      expect((stored as Checkpoint).threadId).toBe("session-1");
    });

    it("should store namespaced checkpoints at [namespace, checkpoints, threadId]", async () => {
      const namespacedSaver = new KeyValueStoreSaver({
        store,
        namespace: "my-namespace",
      });
      await namespacedSaver.save(createTestCheckpoint("session-1"));

      // Verify in underlying store
      const stored = await store.get(["my-namespace", "checkpoints"], "session-1");
      expect(stored).toBeDefined();
      expect((stored as Checkpoint).threadId).toBe("session-1");
    });
  });

  describe("factory function", () => {
    it("should create saver via factory", async () => {
      const saver = createKeyValueStoreSaver({ store });
      await saver.save(createTestCheckpoint("test"));
      expect(await saver.exists("test")).toBe(true);
    });

    it("should accept options via factory", async () => {
      const saver = createKeyValueStoreSaver({
        store,
        namespace: "test-ns",
      });
      await saver.save(createTestCheckpoint("session-1"));
      expect(await saver.list()).toEqual(["session-1"]);
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Checkpointer Integration", () => {
  it("should handle interrupt data correctly", async () => {
    const saver = new MemorySaver();

    const checkpoint = createTestCheckpoint("session-1", {
      interrupt: {
        toolCall: {
          toolCallId: "call-123",
          toolName: "deleteFile",
          args: { path: "/important.txt" },
        },
        step: 3,
      },
    });

    await saver.save(checkpoint);
    const loaded = await saver.load("session-1");

    expect(loaded?.interrupt).toBeDefined();
    expect(loaded?.interrupt?.toolCall.toolName).toBe("deleteFile");
    expect(loaded?.interrupt?.step).toBe(3);
  });

  it("should handle complex message history", async () => {
    const saver = new MemorySaver();

    const checkpoint = createTestCheckpoint("session-1", {
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me help you" },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search",
              args: { query: "test" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "search",
              result: { results: ["item1", "item2"] },
            },
          ],
        },
        { role: "assistant", content: "Here are the results" },
      ],
    });

    await saver.save(checkpoint);
    const loaded = await saver.load("session-1");

    expect(loaded?.messages).toHaveLength(4);
  });

  it("should handle agent state with todos and files", async () => {
    const saver = new MemorySaver();

    const checkpoint = createTestCheckpoint("session-1", {
      state: {
        todos: [
          {
            id: "todo-1",
            content: "Complete task",
            status: "in_progress",
            createdAt: "2026-01-30T10:00:00Z",
          },
        ],
        files: {
          "/notes.md": {
            content: ["# Notes", "Some content"],
            created_at: "2026-01-30T10:00:00Z",
            modified_at: "2026-01-30T10:00:00Z",
          },
        },
      },
    });

    await saver.save(checkpoint);
    const loaded = await saver.load("session-1");

    expect(loaded?.state.todos).toHaveLength(1);
    expect(loaded?.state.todos[0].content).toBe("Complete task");
    expect(loaded?.state.files["/notes.md"]).toBeDefined();
    expect(loaded?.state.files["/notes.md"].content).toEqual(["# Notes", "Some content"]);
  });

  it("should work across all saver types", async () => {
    const checkpoint = createTestCheckpoint("cross-saver-test", {
      step: 10,
      metadata: { source: "integration-test" },
    });

    // Test MemorySaver
    const memorySaver = new MemorySaver();
    await memorySaver.save(checkpoint);
    expect((await memorySaver.load("cross-saver-test"))?.step).toBe(10);

    // Test FileSaver
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "checkpointer-cross-"));
    try {
      const fileSaver = new FileSaver({ dir: tempDir });
      await fileSaver.save(checkpoint);
      expect((await fileSaver.load("cross-saver-test"))?.step).toBe(10);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    // Test KeyValueStoreSaver
    const store = new InMemoryStore();
    const kvSaver = new KeyValueStoreSaver({ store });
    await kvSaver.save(checkpoint);
    expect((await kvSaver.load("cross-saver-test"))?.step).toBe(10);
  });
});
