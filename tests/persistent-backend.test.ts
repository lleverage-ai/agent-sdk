import { beforeEach, describe, expect, it } from "vitest";
import { isBackend } from "../src/backend.js";
import {
  createPersistentBackend,
  InMemoryStore,
  PersistentBackend,
} from "../src/backends/persistent.js";

describe("InMemoryStore", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  describe("basic operations", () => {
    it("stores and retrieves values", async () => {
      await store.put(["ns"], "key1", { value: "test" });

      const result = await store.get(["ns"], "key1");

      expect(result).toEqual({ value: "test" });
    });

    it("returns undefined for missing keys", async () => {
      const result = await store.get(["ns"], "missing");

      expect(result).toBeUndefined();
    });

    it("overwrites existing values", async () => {
      await store.put(["ns"], "key1", { value: "original" });
      await store.put(["ns"], "key1", { value: "updated" });

      const result = await store.get(["ns"], "key1");

      expect(result).toEqual({ value: "updated" });
    });

    it("deletes values", async () => {
      await store.put(["ns"], "key1", { value: "test" });
      await store.delete(["ns"], "key1");

      const result = await store.get(["ns"], "key1");

      expect(result).toBeUndefined();
    });

    it("lists values in namespace", async () => {
      await store.put(["ns", "sub"], "key1", { a: 1 });
      await store.put(["ns", "sub"], "key2", { b: 2 });
      await store.put(["other"], "key3", { c: 3 });

      const results = await store.list(["ns", "sub"]);

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.key).sort()).toEqual(["key1", "key2"]);
    });
  });

  describe("namespace isolation", () => {
    it("isolates data by namespace", async () => {
      await store.put(["ns1"], "key", { value: "ns1" });
      await store.put(["ns2"], "key", { value: "ns2" });

      expect(await store.get(["ns1"], "key")).toEqual({ value: "ns1" });
      expect(await store.get(["ns2"], "key")).toEqual({ value: "ns2" });
    });

    it("supports hierarchical namespaces", async () => {
      await store.put(["app", "users"], "user1", { name: "Alice" });
      await store.put(["app", "posts"], "post1", { title: "Hello" });

      const users = await store.list(["app", "users"]);
      const posts = await store.list(["app", "posts"]);

      expect(users).toHaveLength(1);
      expect(posts).toHaveLength(1);
    });
  });

  describe("data isolation", () => {
    it("returns deep copies on get", async () => {
      const original = { nested: { value: 1 } };
      await store.put(["ns"], "key", original);

      const retrieved = await store.get(["ns"], "key");
      (retrieved as { nested: { value: number } }).nested.value = 999;

      const second = await store.get(["ns"], "key");
      expect((second as { nested: { value: number } }).nested.value).toBe(1);
    });

    it("returns deep copies on list", async () => {
      await store.put(["ns"], "key", { nested: { value: 1 } });

      const [entry] = await store.list(["ns"]);
      (entry!.value as { nested: { value: number } }).nested.value = 999;

      const [second] = await store.list(["ns"]);
      expect((second!.value as { nested: { value: number } }).nested.value).toBe(1);
    });
  });

  describe("utility methods", () => {
    it("clears all data", async () => {
      await store.put(["ns1"], "key1", { a: 1 });
      await store.put(["ns2"], "key2", { b: 2 });

      store.clear();

      expect(store.size).toBe(0);
      expect(await store.get(["ns1"], "key1")).toBeUndefined();
    });

    it("reports size correctly", async () => {
      expect(store.size).toBe(0);

      await store.put(["ns"], "key1", { a: 1 });
      expect(store.size).toBe(1);

      await store.put(["ns"], "key2", { b: 2 });
      expect(store.size).toBe(2);

      await store.delete(["ns"], "key1");
      expect(store.size).toBe(1);
    });
  });
});

describe("PersistentBackend", () => {
  let store: InMemoryStore;
  let backend: PersistentBackend;

  beforeEach(() => {
    store = new InMemoryStore();
    backend = new PersistentBackend({ store });
  });

  describe("constructor", () => {
    it("creates a backend from store", () => {
      expect(backend).toBeInstanceOf(PersistentBackend);
    });

    it("implements BackendProtocol", () => {
      expect(isBackend(backend)).toBe(true);
    });

    it("supports namespace option", () => {
      const nsBackend = new PersistentBackend({
        store,
        namespace: "user-123",
      });

      expect(nsBackend).toBeInstanceOf(PersistentBackend);
    });
  });

  describe("write", () => {
    it("creates a new file", async () => {
      const result = await backend.write("/test.txt", "Hello, World!");

      expect(result.success).toBe(true);
      expect(result.path).toBe("/test.txt");
    });

    it("creates multiline files", async () => {
      await backend.write("/multi.txt", "Line 1\nLine 2\nLine 3");

      const raw = await backend.readRaw("/multi.txt");
      expect(raw.content).toEqual(["Line 1", "Line 2", "Line 3"]);
    });

    it("overwrites existing files", async () => {
      await backend.write("/test.txt", "Original");
      const original = await backend.readRaw("/test.txt");

      await backend.write("/test.txt", "Updated");
      const updated = await backend.readRaw("/test.txt");

      expect(updated.content).toEqual(["Updated"]);
      expect(updated.created_at).toBe(original.created_at);
    });

    it("normalizes paths without leading slash", async () => {
      const result = await backend.write("test.txt", "Content");

      expect(result.path).toBe("/test.txt");
      const content = await backend.read("/test.txt");
      expect(content).toContain("Content");
    });

    it("sets timestamps", async () => {
      await backend.write("/test.txt", "Content");

      const file = await backend.readRaw("/test.txt");
      expect(file.created_at).toBeDefined();
      expect(file.modified_at).toBeDefined();
      expect(new Date(file.created_at).getTime()).not.toBeNaN();
    });

    it("persists data to store", async () => {
      await backend.write("/test.txt", "Hello");

      // Verify data is in store
      const entries = await store.list(["filesystem"]);
      expect(entries).toHaveLength(1);
    });
  });

  describe("read", () => {
    it("reads file content with line numbers", async () => {
      await backend.write("/test.txt", "Line 1\nLine 2\nLine 3");

      const content = await backend.read("/test.txt");

      expect(content).toContain("1→Line 1");
      expect(content).toContain("2→Line 2");
      expect(content).toContain("3→Line 3");
    });

    it("throws for non-existent files", async () => {
      await expect(backend.read("/missing.txt")).rejects.toThrow("File not found");
    });

    it("supports offset parameter", async () => {
      await backend.write("/test.txt", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const content = await backend.read("/test.txt", 2);

      expect(content).not.toContain("Line 1");
      expect(content).not.toContain("Line 2");
      expect(content).toContain("3→Line 3");
    });

    it("supports limit parameter", async () => {
      await backend.write("/test.txt", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const content = await backend.read("/test.txt", 0, 2);

      expect(content).toContain("1→Line 1");
      expect(content).toContain("2→Line 2");
      expect(content).not.toContain("Line 3");
    });
  });

  describe("readRaw", () => {
    it("returns raw FileData", async () => {
      await backend.write("/test.txt", "Line 1\nLine 2");

      const data = await backend.readRaw("/test.txt");

      expect(data.content).toEqual(["Line 1", "Line 2"]);
      expect(data.created_at).toBeDefined();
      expect(data.modified_at).toBeDefined();
    });

    it("throws for non-existent files", async () => {
      await expect(backend.readRaw("/missing.txt")).rejects.toThrow("File not found");
    });

    it("returns deep copy", async () => {
      await backend.write("/test.txt", "Original");

      const data1 = await backend.readRaw("/test.txt");
      data1.content[0] = "Modified";

      const data2 = await backend.readRaw("/test.txt");
      expect(data2.content[0]).toBe("Original");
    });
  });

  describe("edit", () => {
    it("replaces text in file", async () => {
      await backend.write("/test.txt", "Hello World");

      const result = await backend.edit("/test.txt", "World", "Universe");

      expect(result.success).toBe(true);
      const content = await backend.read("/test.txt");
      expect(content).toContain("Hello Universe");
    });

    it("returns error for non-existent file", async () => {
      const result = await backend.edit("/missing.txt", "a", "b");

      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found");
    });

    it("returns error when string not found", async () => {
      await backend.write("/test.txt", "Hello World");

      const result = await backend.edit("/test.txt", "missing", "replacement");

      expect(result.success).toBe(false);
      expect(result.error).toContain("String not found");
    });

    it("fails on multiple occurrences by default", async () => {
      await backend.write("/test.txt", "hello hello hello");

      const result = await backend.edit("/test.txt", "hello", "hi");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Multiple occurrences");
      expect(result.occurrences).toBe(3);
    });

    it("replaces all occurrences with replaceAll=true", async () => {
      await backend.write("/test.txt", "hello hello hello");

      const result = await backend.edit("/test.txt", "hello", "hi", true);

      expect(result.success).toBe(true);
      expect(result.occurrences).toBe(3);
      const content = await backend.read("/test.txt");
      expect(content).toContain("hi hi hi");
    });

    it("updates modified_at timestamp", async () => {
      await backend.write("/test.txt", "Original");
      const before = await backend.readRaw("/test.txt");

      // Small delay to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      await backend.edit("/test.txt", "Original", "Modified");
      const after = await backend.readRaw("/test.txt");

      expect(after.modified_at).not.toBe(before.modified_at);
      expect(after.created_at).toBe(before.created_at);
    });
  });

  describe("lsInfo", () => {
    it("lists files in directory", async () => {
      await backend.write("/dir/file1.txt", "Content 1");
      await backend.write("/dir/file2.txt", "Content 2");

      const files = await backend.lsInfo("/dir");

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.path).sort()).toEqual(["/dir/file1.txt", "/dir/file2.txt"]);
    });

    it("lists subdirectories", async () => {
      await backend.write("/dir/subdir/file.txt", "Content");

      const files = await backend.lsInfo("/dir");

      expect(files).toHaveLength(1);
      expect(files[0]!.path).toBe("/dir/subdir");
      expect(files[0]!.is_dir).toBe(true);
    });

    it("returns empty array for empty directory", async () => {
      const files = await backend.lsInfo("/empty");

      expect(files).toEqual([]);
    });

    it("includes file metadata", async () => {
      await backend.write("/dir/file.txt", "Hello World");

      const files = await backend.lsInfo("/dir");

      expect(files[0]!.size).toBe(11); // "Hello World".length
      expect(files[0]!.modified_at).toBeDefined();
    });

    it("handles root directory", async () => {
      await backend.write("/file.txt", "Content");

      const files = await backend.lsInfo("/");

      expect(files).toHaveLength(1);
      expect(files[0]!.path).toBe("/file.txt");
    });
  });

  describe("globInfo", () => {
    beforeEach(async () => {
      await backend.write("/src/index.ts", "index");
      await backend.write("/src/utils/helper.ts", "helper");
      await backend.write("/src/utils/test.spec.ts", "test");
      await backend.write("/README.md", "readme");
    });

    it("matches simple patterns", async () => {
      const files = await backend.globInfo("*.md", "/");

      expect(files).toHaveLength(1);
      expect(files[0]!.path).toBe("/README.md");
    });

    it("matches with ** for any depth", async () => {
      const files = await backend.globInfo("**/*.ts", "/src");

      expect(files).toHaveLength(3);
    });

    it("matches with ? for single char", async () => {
      const files = await backend.globInfo("*.??", "/");

      expect(files).toHaveLength(1);
      expect(files[0]!.path).toBe("/README.md");
    });

    it("supports nested patterns", async () => {
      const files = await backend.globInfo("src/**/*.ts");

      expect(files).toHaveLength(3);
    });

    it("filters by extension", async () => {
      const files = await backend.globInfo("**/*.spec.ts", "/src");

      expect(files).toHaveLength(1);
      expect(files[0]!.path).toBe("/src/utils/test.spec.ts");
    });
  });

  describe("grepRaw", () => {
    beforeEach(async () => {
      await backend.write("/file1.txt", "Hello World\nGoodbye World");
      await backend.write("/file2.txt", "Hello Universe\nHello Galaxy");
      await backend.write("/dir/file3.txt", "Another World");
    });

    it("finds pattern matches", async () => {
      const matches = await backend.grepRaw("Hello");

      expect(matches).toHaveLength(3);
    });

    it("searches in specific path", async () => {
      const matches = await backend.grepRaw("World", "/dir");

      expect(matches).toHaveLength(1);
      expect(matches[0]!.path).toBe("/dir/file3.txt");
    });

    it("filters by glob pattern", async () => {
      // *.txt at root level won't match /file1.txt because of the leading slash
      // Files would need to be named file.txt (no leading slash) to match
      const matches = await backend.grepRaw("Hello", null, "*.txt");

      // Our test files are at paths like /file1.txt, /file2.txt
      // The glob *.txt matches against the full path, so /file1.txt doesn't match *.txt
      expect(matches).toHaveLength(0);
    });

    it("filters by glob pattern with **", async () => {
      const matches = await backend.grepRaw("Hello", null, "**/*.txt");

      // **/*.txt should match any .txt file at any depth
      expect(matches.length).toBeGreaterThan(0);
    });

    it("supports regex patterns", async () => {
      const matches = await backend.grepRaw("Hello (World|Universe)");

      expect(matches).toHaveLength(2);
    });

    it("returns line numbers (1-indexed)", async () => {
      const matches = await backend.grepRaw("Goodbye");

      expect(matches).toHaveLength(1);
      expect(matches[0]!.line).toBe(2);
    });
  });

  describe("namespace isolation", () => {
    it("isolates data by namespace", async () => {
      const backend1 = new PersistentBackend({ store, namespace: "user1" });
      const backend2 = new PersistentBackend({ store, namespace: "user2" });

      await backend1.write("/notes.txt", "User 1 notes");
      await backend2.write("/notes.txt", "User 2 notes");

      const content1 = await backend1.read("/notes.txt");
      const content2 = await backend2.read("/notes.txt");

      expect(content1).toContain("User 1 notes");
      expect(content2).toContain("User 2 notes");
    });

    it("does not leak data between namespaces", async () => {
      const backend1 = new PersistentBackend({ store, namespace: "user1" });
      const backend2 = new PersistentBackend({ store, namespace: "user2" });

      await backend1.write("/secret.txt", "Secret data");

      await expect(backend2.read("/secret.txt")).rejects.toThrow("File not found");
    });

    it("supports ls across namespaces", async () => {
      const backend1 = new PersistentBackend({ store, namespace: "user1" });
      const backend2 = new PersistentBackend({ store, namespace: "user2" });

      await backend1.write("/dir/file1.txt", "User 1");
      await backend2.write("/dir/file2.txt", "User 2");

      const files1 = await backend1.lsInfo("/dir");
      const files2 = await backend2.lsInfo("/dir");

      expect(files1).toHaveLength(1);
      expect(files1[0]!.path).toBe("/dir/file1.txt");
      expect(files2).toHaveLength(1);
      expect(files2[0]!.path).toBe("/dir/file2.txt");
    });

    it("supports glob across namespaces", async () => {
      const backend1 = new PersistentBackend({ store, namespace: "user1" });
      const backend2 = new PersistentBackend({ store, namespace: "user2" });

      await backend1.write("/src/app.ts", "App 1");
      await backend2.write("/src/app.ts", "App 2");
      await backend2.write("/src/lib.ts", "Lib 2");

      const files1 = await backend1.globInfo("**/*.ts");
      const files2 = await backend2.globInfo("**/*.ts");

      expect(files1).toHaveLength(1);
      expect(files2).toHaveLength(2);
    });
  });

  describe("path encoding", () => {
    it("handles special characters in paths", async () => {
      await backend.write("/file with spaces.txt", "Content");
      await backend.write("/file-with-dashes.txt", "Content");
      await backend.write("/file_with_underscores.txt", "Content");

      const content1 = await backend.read("/file with spaces.txt");
      const content2 = await backend.read("/file-with-dashes.txt");
      const content3 = await backend.read("/file_with_underscores.txt");

      expect(content1).toContain("Content");
      expect(content2).toContain("Content");
      expect(content3).toContain("Content");
    });

    it("handles unicode characters in paths", async () => {
      await backend.write("/日本語.txt", "Japanese");
      await backend.write("/émoji 🎉.txt", "Emoji");

      const content1 = await backend.read("/日本語.txt");
      const content2 = await backend.read("/émoji 🎉.txt");

      expect(content1).toContain("Japanese");
      expect(content2).toContain("Emoji");
    });

    it("handles deeply nested paths", async () => {
      const deepPath = "/a/b/c/d/e/f/g/h/i/j/file.txt";
      await backend.write(deepPath, "Deep content");

      const content = await backend.read(deepPath);
      expect(content).toContain("Deep content");
    });
  });
});

describe("createPersistentBackend", () => {
  it("creates a PersistentBackend instance", () => {
    const store = new InMemoryStore();
    const backend = createPersistentBackend({ store });

    expect(backend).toBeInstanceOf(PersistentBackend);
    expect(isBackend(backend)).toBe(true);
  });

  it("passes options correctly", async () => {
    const store = new InMemoryStore();
    const backend = createPersistentBackend({
      store,
      namespace: "test-ns",
    });

    await backend.write("/file.txt", "Test");

    // Verify namespace is used
    const entries = await store.list(["test-ns", "filesystem"]);
    expect(entries).toHaveLength(1);
  });
});
