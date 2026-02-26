import { beforeEach, describe, expect, it } from "vitest";
import {
  type AgentState,
  CompositeBackend,
  createAgentState,
  createCompositeBackend,
  type GrepMatch,
  StateBackend,
} from "../src/index.js";

describe("CompositeBackend", () => {
  let defaultState: AgentState;
  let memoriesState: AgentState;
  let cacheState: AgentState;
  let defaultBackend: StateBackend;
  let memoriesBackend: StateBackend;
  let cacheBackend: StateBackend;
  let compositeBackend: CompositeBackend;

  beforeEach(() => {
    defaultState = createAgentState();
    memoriesState = createAgentState();
    cacheState = createAgentState();

    defaultBackend = new StateBackend(defaultState);
    memoriesBackend = new StateBackend(memoriesState);
    cacheBackend = new StateBackend(cacheState);

    compositeBackend = new CompositeBackend(defaultBackend, {
      "/memories/": memoriesBackend,
      "/cache/": cacheBackend,
    });
  });

  // ===========================================================================
  // Routing Tests
  // ===========================================================================

  describe("routing", () => {
    it("routes to correct backend based on path prefix", async () => {
      // Write to different backends
      await compositeBackend.write("/memories/notes.md", "user notes");
      await compositeBackend.write("/cache/temp.txt", "cached data");
      await compositeBackend.write("/other/file.txt", "other data");

      // Verify files are in correct backends
      expect(memoriesState.files["/notes.md"]).toBeDefined();
      expect(cacheState.files["/temp.txt"]).toBeDefined();
      expect(defaultState.files["/other/file.txt"]).toBeDefined();

      // Verify files are NOT in wrong backends
      expect(defaultState.files["/memories/notes.md"]).toBeUndefined();
      expect(defaultState.files["/cache/temp.txt"]).toBeUndefined();
    });

    it("uses longest-prefix matching", async () => {
      const nestedState = createAgentState();
      const nestedBackend = new StateBackend(nestedState);

      const backend = new CompositeBackend(defaultBackend, {
        "/memories/": memoriesBackend,
        "/memories/archived/": nestedBackend,
      });

      await backend.write("/memories/current.txt", "current");
      await backend.write("/memories/archived/old.txt", "old");

      // Current should be in memoriesBackend
      expect(memoriesState.files["/current.txt"]).toBeDefined();
      // Archived should be in nestedBackend (longer prefix match)
      expect(nestedState.files["/old.txt"]).toBeDefined();
      // Neither should be in each other
      expect(memoriesState.files["/archived/old.txt"]).toBeUndefined();
      expect(nestedState.files["/current.txt"]).toBeUndefined();
    });

    it("routes to default backend for unmatched paths", async () => {
      await compositeBackend.write("/unmatched/path.txt", "content");
      expect(defaultState.files["/unmatched/path.txt"]).toBeDefined();
    });

    it("handles root path correctly", async () => {
      await compositeBackend.write("/root-file.txt", "root content");
      expect(defaultState.files["/root-file.txt"]).toBeDefined();
    });

    it("normalizes paths with missing leading slash", async () => {
      await compositeBackend.write("memories/file.txt", "content");
      expect(memoriesState.files["/file.txt"]).toBeDefined();
    });

    it("normalizes route prefixes without trailing slash", () => {
      const backend = new CompositeBackend(defaultBackend, {
        "/memories": memoriesBackend, // No trailing slash
      });

      const routes = backend.getRoutes();
      expect(routes[0]!.prefix).toBe("/memories/");
    });
  });

  // ===========================================================================
  // Write Tests
  // ===========================================================================

  describe("write", () => {
    it("writes to correct backend and returns success", async () => {
      const result = await compositeBackend.write("/memories/doc.md", "# Document");

      expect(result.success).toBe(true);
      expect(result.path).toBe("/memories/doc.md");
      expect(memoriesState.files["/doc.md"]?.content).toEqual(["# Document"]);
    });

    it("maps path in result back to composite path", async () => {
      const result = await compositeBackend.write("/cache/data.json", '{"key": "value"}');

      expect(result.path).toBe("/cache/data.json");
    });
  });

  // ===========================================================================
  // Read Tests
  // ===========================================================================

  describe("read", () => {
    beforeEach(async () => {
      await compositeBackend.write("/memories/file.txt", "line1\nline2\nline3");
      await compositeBackend.write("/default/file.txt", "default content");
    });

    it("reads from correct backend", async () => {
      const content = await compositeBackend.read("/memories/file.txt");
      expect(content).toContain("line1");
      expect(content).toContain("line2");
    });

    it("supports offset and limit", async () => {
      const content = await compositeBackend.read("/memories/file.txt", 1, 1);
      expect(content).toContain("line2");
      expect(content).not.toContain("line1");
      expect(content).not.toContain("line3");
    });

    it("throws when file not found", async () => {
      await expect(compositeBackend.read("/memories/nonexistent.txt")).rejects.toThrow();
    });
  });

  // ===========================================================================
  // ReadRaw Tests
  // ===========================================================================

  describe("readRaw", () => {
    beforeEach(async () => {
      await compositeBackend.write("/cache/raw.txt", "raw content");
    });

    it("reads raw file data from correct backend", async () => {
      const data = await compositeBackend.readRaw("/cache/raw.txt");
      expect(data.content).toEqual(["raw content"]);
      expect(data.created_at).toBeDefined();
      expect(data.modified_at).toBeDefined();
    });
  });

  // ===========================================================================
  // Edit Tests
  // ===========================================================================

  describe("edit", () => {
    beforeEach(async () => {
      await compositeBackend.write("/memories/editable.txt", "hello world hello");
    });

    it("edits file in correct backend", async () => {
      const result = await compositeBackend.edit("/memories/editable.txt", "world", "universe");

      expect(result.success).toBe(true);
      expect(result.path).toBe("/memories/editable.txt");
      expect(memoriesState.files["/editable.txt"]?.content).toEqual(["hello universe hello"]);
    });

    it("replaces all occurrences when replaceAll is true", async () => {
      const result = await compositeBackend.edit("/memories/editable.txt", "hello", "hi", true);

      expect(result.success).toBe(true);
      expect(result.occurrences).toBe(2);
      expect(memoriesState.files["/editable.txt"]?.content).toEqual(["hi world hi"]);
    });

    it("returns error for file not found", async () => {
      const result = await compositeBackend.edit("/memories/nonexistent.txt", "old", "new");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  // ===========================================================================
  // LsInfo Tests
  // ===========================================================================

  describe("lsInfo", () => {
    beforeEach(async () => {
      await compositeBackend.write("/memories/file1.txt", "content1");
      await compositeBackend.write("/memories/subdir/file2.txt", "content2");
    });

    it("lists files from correct backend", async () => {
      const files = await compositeBackend.lsInfo("/memories");

      expect(files).toHaveLength(2);
      const paths = files.map((f) => f.path);
      expect(paths).toContain("/memories/file1.txt");
      // Should show subdir as directory
      expect(files.some((f) => f.is_dir && f.path === "/memories/subdir")).toBe(true);
    });

    it("maps paths back to composite paths", async () => {
      const files = await compositeBackend.lsInfo("/memories");

      for (const file of files) {
        expect(file.path.startsWith("/memories")).toBe(true);
      }
    });
  });

  // ===========================================================================
  // GlobInfo Tests
  // ===========================================================================

  describe("globInfo", () => {
    beforeEach(async () => {
      await compositeBackend.write("/memories/doc.md", "# Memories");
      await compositeBackend.write("/memories/notes.txt", "notes");
      await compositeBackend.write("/cache/temp.md", "# Cache");
      await compositeBackend.write("/default/file.md", "# Default");
    });

    it("finds files in specific backend when path provided", async () => {
      const files = await compositeBackend.globInfo("*.md", "/memories");

      expect(files).toHaveLength(1);
      expect(files[0]!.path).toBe("/memories/doc.md");
    });

    it("aggregates results from all backends when searching root", async () => {
      const files = await compositeBackend.globInfo("**/*.md", "/");

      const paths = files.map((f) => f.path);
      expect(paths).toContain("/memories/doc.md");
      expect(paths).toContain("/cache/temp.md");
      expect(paths).toContain("/default/file.md");
    });

    it("maps paths back to composite paths", async () => {
      const files = await compositeBackend.globInfo("**/*.md");

      for (const file of files) {
        expect(file.path.startsWith("/")).toBe(true);
      }
    });
  });

  // ===========================================================================
  // GrepRaw Tests
  // ===========================================================================

  describe("grepRaw", () => {
    beforeEach(async () => {
      await compositeBackend.write("/memories/notes.md", "TODO: remember this");
      await compositeBackend.write("/cache/data.txt", "TODO: cache update");
      await compositeBackend.write("/default/file.txt", "TODO: default task");
    });

    it("searches in specific backend when path targets route", async () => {
      const matches = (await compositeBackend.grepRaw("TODO", "/memories")) as GrepMatch[];

      expect(matches).toHaveLength(1);
      expect(matches[0]!.path).toBe("/memories/notes.md");
    });

    it("aggregates results from all backends when searching root", async () => {
      const matches = (await compositeBackend.grepRaw("TODO", "/")) as GrepMatch[];

      const paths = matches.map((m) => m.path);
      expect(paths).toContain("/memories/notes.md");
      expect(paths).toContain("/cache/data.txt");
      expect(paths).toContain("/default/file.txt");
    });

    it("supports glob filter", async () => {
      const matches = (await compositeBackend.grepRaw("TODO", "/", "*.md")) as GrepMatch[];

      expect(matches.every((m) => m.path.endsWith(".md"))).toBe(true);
    });

    it("maps paths back to composite paths", async () => {
      const matches = (await compositeBackend.grepRaw("TODO")) as GrepMatch[];

      for (const match of matches) {
        expect(match.path.startsWith("/")).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Utility Method Tests
  // ===========================================================================

  describe("utility methods", () => {
    it("getBackendForPath returns correct backend", () => {
      expect(compositeBackend.getBackendForPath("/memories/file.txt")).toBe(memoriesBackend);
      expect(compositeBackend.getBackendForPath("/cache/file.txt")).toBe(cacheBackend);
      expect(compositeBackend.getBackendForPath("/other/file.txt")).toBe(defaultBackend);
    });

    it("getRoutes returns all routes sorted by prefix length", () => {
      const routes = compositeBackend.getRoutes();
      expect(routes).toHaveLength(2);
      // Both have same length, so order may vary
      const prefixes = routes.map((r) => r.prefix);
      expect(prefixes).toContain("/memories/");
      expect(prefixes).toContain("/cache/");
    });

    it("getDefaultBackend returns the default backend", () => {
      expect(compositeBackend.getDefaultBackend()).toBe(defaultBackend);
    });
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe("createCompositeBackend", () => {
    it("creates a CompositeBackend from options", async () => {
      const backend = createCompositeBackend({
        defaultBackend: defaultBackend,
        routes: {
          "/data/": memoriesBackend,
        },
      });

      await backend.write("/data/file.txt", "content");
      expect(memoriesState.files["/file.txt"]).toBeDefined();
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("handles empty routes", async () => {
      const backend = new CompositeBackend(defaultBackend, {});

      await backend.write("/any/path.txt", "content");
      expect(defaultState.files["/any/path.txt"]).toBeDefined();
    });

    it("handles deeply nested paths", async () => {
      await compositeBackend.write("/memories/a/b/c/d/deep.txt", "deep content");

      expect(memoriesState.files["/a/b/c/d/deep.txt"]).toBeDefined();

      const content = await compositeBackend.read("/memories/a/b/c/d/deep.txt");
      expect(content).toContain("deep content");
    });

    it("handles paths with special characters in content", async () => {
      await compositeBackend.write("/memories/special.txt", "path: /memories/test\nroute: /cache/");

      const content = await compositeBackend.read("/memories/special.txt");
      expect(content).toContain("/memories/test");
    });

    it("handles concurrent operations to different backends", async () => {
      const writes = [
        compositeBackend.write("/memories/1.txt", "m1"),
        compositeBackend.write("/memories/2.txt", "m2"),
        compositeBackend.write("/cache/1.txt", "c1"),
        compositeBackend.write("/cache/2.txt", "c2"),
        compositeBackend.write("/default/1.txt", "d1"),
      ];

      await Promise.all(writes);

      expect(memoriesState.files["/1.txt"]).toBeDefined();
      expect(memoriesState.files["/2.txt"]).toBeDefined();
      expect(cacheState.files["/1.txt"]).toBeDefined();
      expect(cacheState.files["/2.txt"]).toBeDefined();
      expect(defaultState.files["/default/1.txt"]).toBeDefined();
    });

    it("handles route prefix that equals path exactly", async () => {
      const files = await compositeBackend.lsInfo("/memories");
      expect(Array.isArray(files)).toBe(true);
    });

    it("handles multiple slashes in path", async () => {
      await compositeBackend.write("/memories//double//slash.txt", "content");
      // Should normalize the path
      expect(
        memoriesState.files["/double/slash.txt"] || memoriesState.files["//double//slash.txt"],
      ).toBeDefined();
    });
  });

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe("integration", () => {
    it("works with realistic file organization", async () => {
      // Setup a realistic scenario
      await compositeBackend.write("/memories/preferences.json", '{"theme": "dark"}');
      await compositeBackend.write("/memories/history/2026-01-30.md", "# Session History");
      await compositeBackend.write("/cache/api-response.json", '{"data": []}');
      await compositeBackend.write("/project/src/index.ts", "export {};");
      await compositeBackend.write("/project/package.json", '{"name": "test"}');

      // Find all JSON files
      const jsonFiles = await compositeBackend.globInfo("**/*.json");
      const jsonPaths = jsonFiles.map((f) => f.path);
      expect(jsonPaths).toContain("/memories/preferences.json");
      expect(jsonPaths).toContain("/cache/api-response.json");
      expect(jsonPaths).toContain("/project/package.json");

      // Grep for exports
      const exports = (await compositeBackend.grepRaw("export", "/")) as GrepMatch[];
      expect(exports.some((m) => m.path === "/project/src/index.ts")).toBe(true);

      // Edit a file
      const editResult = await compositeBackend.edit(
        "/memories/preferences.json",
        '"dark"',
        '"light"',
      );
      expect(editResult.success).toBe(true);

      // Verify edit
      const prefs = await compositeBackend.read("/memories/preferences.json");
      expect(prefs).toContain('"light"');
    });
  });
});
