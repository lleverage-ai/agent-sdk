import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isBackend } from "../src/backend.js";
import {
  createFilesystemBackend,
  FileSizeLimitError,
  FilesystemBackend,
  PathTraversalError,
  SymlinkError,
} from "../src/backends/filesystem.js";

describe("FilesystemBackend", () => {
  let testDir: string;
  let backend: FilesystemBackend;

  beforeAll(async () => {
    // Create a temporary directory for tests
    // Use realpath to resolve symlinks (e.g., /tmp -> /private/tmp on macOS)
    testDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "fs-backend-test-")));
  });

  afterAll(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clear test directory
    const entries = await fs.readdir(testDir);
    for (const entry of entries) {
      await fs.rm(path.join(testDir, entry), { recursive: true, force: true });
    }

    backend = new FilesystemBackend({ rootDir: testDir });
  });

  describe("constructor", () => {
    it("creates a backend with default options", () => {
      const backend = new FilesystemBackend();
      expect(backend).toBeInstanceOf(FilesystemBackend);
    });

    it("creates a backend with custom rootDir", () => {
      const backend = new FilesystemBackend({ rootDir: testDir });
      expect(backend).toBeInstanceOf(FilesystemBackend);
    });

    it("implements BackendProtocol", () => {
      expect(isBackend(backend)).toBe(true);
    });
  });

  describe("write", () => {
    it("creates a new file", async () => {
      const result = await backend.write("/test.txt", "Hello, World!");

      expect(result.success).toBe(true);
      expect(result.path).toBe("/test.txt");

      const content = await fs.readFile(path.join(testDir, "test.txt"), "utf-8");
      expect(content).toBe("Hello, World!");
    });

    it("creates multiline files", async () => {
      const result = await backend.write("/multi.txt", "Line 1\nLine 2\nLine 3");

      expect(result.success).toBe(true);

      const content = await fs.readFile(path.join(testDir, "multi.txt"), "utf-8");
      expect(content).toBe("Line 1\nLine 2\nLine 3");
    });

    it("overwrites existing files", async () => {
      await backend.write("/test.txt", "Original");
      await backend.write("/test.txt", "Updated");

      const content = await fs.readFile(path.join(testDir, "test.txt"), "utf-8");
      expect(content).toBe("Updated");
    });

    it("creates parent directories automatically", async () => {
      const result = await backend.write("/nested/deep/file.txt", "Content");

      expect(result.success).toBe(true);

      const content = await fs.readFile(path.join(testDir, "nested", "deep", "file.txt"), "utf-8");
      expect(content).toBe("Content");
    });

    it("normalizes paths", async () => {
      const result = await backend.write("test.txt", "Content");

      expect(result.success).toBe(true);
      expect(result.path).toBe("/test.txt");
    });
  });

  describe("read", () => {
    it("reads file content with line numbers", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "Line 1\nLine 2\nLine 3");

      const content = await backend.read("/test.txt");

      expect(content).toContain("1→Line 1");
      expect(content).toContain("2→Line 2");
      expect(content).toContain("3→Line 3");
    });

    it("throws for non-existent files", async () => {
      await expect(backend.read("/missing.txt")).rejects.toThrow();
    });

    it("supports offset parameter", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const content = await backend.read("/test.txt", 2);

      expect(content).not.toContain("Line 1");
      expect(content).not.toContain("Line 2");
      expect(content).toContain("3→Line 3");
      expect(content).toContain("4→Line 4");
    });

    it("supports limit parameter", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const content = await backend.read("/test.txt", 0, 2);

      expect(content).toContain("1→Line 1");
      expect(content).toContain("2→Line 2");
      expect(content).not.toContain("Line 3");
    });

    it("supports offset and limit together", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const content = await backend.read("/test.txt", 1, 2);

      expect(content).not.toContain("Line 1");
      expect(content).toContain("2→Line 2");
      expect(content).toContain("3→Line 3");
      expect(content).not.toContain("Line 4");
    });
  });

  describe("readRaw", () => {
    it("returns FileData structure", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "Line 1\nLine 2");

      const data = await backend.readRaw("/test.txt");

      expect(data.content).toEqual(["Line 1", "Line 2"]);
      expect(data.created_at).toBeDefined();
      expect(data.modified_at).toBeDefined();
    });

    it("throws for non-existent files", async () => {
      await expect(backend.readRaw("/missing.txt")).rejects.toThrow();
    });
  });

  describe("edit", () => {
    it("replaces text in a file", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "Hello, World!");

      const result = await backend.edit("/test.txt", "World", "TypeScript");

      expect(result.success).toBe(true);
      expect(result.occurrences).toBe(1);

      const content = await fs.readFile(path.join(testDir, "test.txt"), "utf-8");
      expect(content).toBe("Hello, TypeScript!");
    });

    it("fails when string not found", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "Hello, World!");

      const result = await backend.edit("/test.txt", "Python", "TypeScript");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("fails for non-existent files", async () => {
      const result = await backend.edit("/missing.txt", "old", "new");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("fails when multiple occurrences without replaceAll", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "foo foo foo");

      const result = await backend.edit("/test.txt", "foo", "bar");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Multiple occurrences");
      expect(result.occurrences).toBe(3);
    });

    it("replaces all occurrences with replaceAll=true", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "foo foo foo");

      const result = await backend.edit("/test.txt", "foo", "bar", true);

      expect(result.success).toBe(true);
      expect(result.occurrences).toBe(3);

      const content = await fs.readFile(path.join(testDir, "test.txt"), "utf-8");
      expect(content).toBe("bar bar bar");
    });

    it("handles multiline replacements", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "Line 1\nLine 2\nLine 3");

      const result = await backend.edit("/test.txt", "Line 2\nLine 3", "New Content");

      expect(result.success).toBe(true);

      const content = await fs.readFile(path.join(testDir, "test.txt"), "utf-8");
      expect(content).toBe("Line 1\nNew Content");
    });
  });

  describe("lsInfo", () => {
    it("lists files in a directory", async () => {
      await fs.mkdir(path.join(testDir, "src"));
      await fs.writeFile(path.join(testDir, "src", "index.ts"), "export {}");
      await fs.writeFile(path.join(testDir, "src", "types.ts"), "interface Foo {}");

      const files = await backend.lsInfo("/src");

      expect(files).toHaveLength(2);
      expect(files.some((f) => f.path === "/src/index.ts")).toBe(true);
      expect(files.some((f) => f.path === "/src/types.ts")).toBe(true);
    });

    it("lists subdirectories", async () => {
      await fs.mkdir(path.join(testDir, "src"));
      await fs.mkdir(path.join(testDir, "src", "utils"));
      await fs.writeFile(path.join(testDir, "src", "index.ts"), "export {}");
      await fs.writeFile(path.join(testDir, "src", "utils", "helpers.ts"), "export {}");

      const entries = await backend.lsInfo("/src");

      expect(entries.some((e) => e.path === "/src/index.ts")).toBe(true);
      expect(entries.some((e) => e.path === "/src/utils" && e.is_dir)).toBe(true);
    });

    it("returns empty array for empty directory", async () => {
      await fs.mkdir(path.join(testDir, "empty"));

      const files = await backend.lsInfo("/empty");

      expect(files).toEqual([]);
    });

    it("returns empty array for non-existent directory", async () => {
      const files = await backend.lsInfo("/nonexistent");

      expect(files).toEqual([]);
    });

    it("includes file size", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "Hello!");

      const files = await backend.lsInfo("/");

      const testFile = files.find((f) => f.path === "/test.txt");
      expect(testFile).toBeDefined();
      expect(testFile?.size).toBe(6); // "Hello!".length
    });

    it("includes modified timestamp", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "Content");

      const files = await backend.lsInfo("/");

      const testFile = files.find((f) => f.path === "/test.txt");
      expect(testFile?.modified_at).toBeDefined();
    });
  });

  describe("globInfo", () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(testDir, "src"));
      await fs.mkdir(path.join(testDir, "src", "utils"));
      await fs.mkdir(path.join(testDir, "tests"));

      await fs.writeFile(path.join(testDir, "src", "index.ts"), "export {}");
      await fs.writeFile(path.join(testDir, "src", "types.ts"), "export type {}");
      await fs.writeFile(path.join(testDir, "src", "utils", "helpers.ts"), "export {}");
      await fs.writeFile(path.join(testDir, "tests", "index.test.ts"), "test()");
      await fs.writeFile(path.join(testDir, "README.md"), "# Readme");
    });

    it("matches simple wildcard patterns", async () => {
      const matches = await backend.globInfo("*.ts", "/src");

      expect(matches).toHaveLength(2);
      expect(matches.some((m) => m.path === "/src/index.ts")).toBe(true);
      expect(matches.some((m) => m.path === "/src/types.ts")).toBe(true);
    });

    it("matches globstar patterns", async () => {
      const matches = await backend.globInfo("**/*.ts");

      expect(matches).toHaveLength(4);
      expect(matches.some((m) => m.path === "/src/index.ts")).toBe(true);
      expect(matches.some((m) => m.path === "/src/utils/helpers.ts")).toBe(true);
      expect(matches.some((m) => m.path === "/tests/index.test.ts")).toBe(true);
    });

    it("matches specific extensions", async () => {
      const matches = await backend.globInfo("**/*.md");

      expect(matches).toHaveLength(1);
      expect(matches[0].path).toBe("/README.md");
    });

    it("respects base path", async () => {
      const matches = await backend.globInfo("**/*.ts", "/tests");

      expect(matches).toHaveLength(1);
      expect(matches[0].path).toBe("/tests/index.test.ts");
    });

    it("returns empty array when no matches", async () => {
      const matches = await backend.globInfo("**/*.py");

      expect(matches).toEqual([]);
    });
  });

  describe("grepRaw", () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(testDir, "src"));
      await fs.mkdir(path.join(testDir, "tests"));

      await fs.writeFile(
        path.join(testDir, "src", "index.ts"),
        "// TODO: implement\nexport function hello() {\n  return 'hello';\n}",
      );
      await fs.writeFile(
        path.join(testDir, "src", "types.ts"),
        "// Types file\nexport interface Foo {\n  bar: string;\n}",
      );
      await fs.writeFile(
        path.join(testDir, "tests", "index.test.ts"),
        "// TODO: add more tests\ntest('hello', () => {});",
      );
    });

    it("finds pattern matches", async () => {
      const matches = await backend.grepRaw("TODO:");

      expect(matches).toHaveLength(2);
      expect(matches.some((m) => m.path === "/src/index.ts")).toBe(true);
      expect(matches.some((m) => m.path === "/tests/index.test.ts")).toBe(true);
    });

    it("returns line numbers (1-indexed)", async () => {
      const matches = await backend.grepRaw("TODO:");

      const srcMatch = matches.find((m) => m.path === "/src/index.ts");
      expect(srcMatch?.line).toBe(1);
    });

    it("returns matching line text", async () => {
      const matches = await backend.grepRaw("TODO:");

      expect(matches.some((m) => m.text.includes("TODO: implement"))).toBe(true);
    });

    it("respects path filter", async () => {
      const matches = await backend.grepRaw("TODO:", "/src");

      expect(matches).toHaveLength(1);
      expect(matches[0].path).toBe("/src/index.ts");
    });

    it("respects glob filter", async () => {
      const matches = await backend.grepRaw("export", null, "**/*.ts");

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.every((m) => m.path.endsWith(".ts"))).toBe(true);
    });

    it("supports regex patterns", async () => {
      const matches = await backend.grepRaw("export (function|interface)");

      expect(matches).toHaveLength(2);
    });

    it("returns empty array when no matches", async () => {
      const matches = await backend.grepRaw("nonexistent pattern");

      expect(matches).toEqual([]);
    });
  });
});

describe("FilesystemBackend Security", () => {
  let testDir: string;
  let backend: FilesystemBackend;

  beforeAll(async () => {
    // Use realpath to resolve symlinks (e.g., /tmp -> /private/tmp on macOS)
    testDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "fs-backend-security-")));
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const entries = await fs.readdir(testDir);
    for (const entry of entries) {
      await fs.rm(path.join(testDir, entry), { recursive: true, force: true });
    }
    backend = new FilesystemBackend({ rootDir: testDir });
  });

  describe("path traversal protection", () => {
    it("rejects paths with ..", async () => {
      await expect(backend.read("../../../etc/passwd")).rejects.toThrow(PathTraversalError);
    });

    it("treats absolute paths as relative to rootDir", async () => {
      // /etc/passwd is treated as rootDir/etc/passwd, not the system /etc/passwd
      // This should throw ENOENT since rootDir/etc/passwd doesn't exist
      await expect(backend.read("/etc/passwd")).rejects.toThrow(/ENOENT|no such file/i);
    });

    it("rejects paths with encoded traversal", async () => {
      await expect(backend.read("%2e%2e/secret")).rejects.toThrow();
    });

    it("allows paths within rootDir", async () => {
      await fs.writeFile(path.join(testDir, "safe.txt"), "Safe content");

      const content = await backend.read("/safe.txt");

      expect(content).toContain("Safe content");
    });

    it("allows nested paths within rootDir", async () => {
      await fs.mkdir(path.join(testDir, "nested", "deep"), { recursive: true });
      await fs.writeFile(path.join(testDir, "nested", "deep", "file.txt"), "Nested content");

      const content = await backend.read("/nested/deep/file.txt");

      expect(content).toContain("Nested content");
    });

    it("PathTraversalError contains path info", async () => {
      try {
        await backend.read("../secret.txt");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(PathTraversalError);
        expect((error as PathTraversalError).attemptedPath).toBe("../secret.txt");
        expect((error as PathTraversalError).rootDir).toBe(testDir);
      }
    });
  });

  describe("symlink protection", () => {
    it("rejects symlinks by default", async () => {
      const targetFile = path.join(testDir, "target.txt");
      const linkFile = path.join(testDir, "link.txt");

      await fs.writeFile(targetFile, "Target content");
      await fs.symlink(targetFile, linkFile);

      await expect(backend.read("/link.txt")).rejects.toThrow(SymlinkError);
    });

    it("rejects directory symlinks", async () => {
      const targetDir = path.join(testDir, "targetdir");
      const linkDir = path.join(testDir, "linkdir");

      await fs.mkdir(targetDir);
      await fs.writeFile(path.join(targetDir, "file.txt"), "Content");
      await fs.symlink(targetDir, linkDir, "dir");

      await expect(backend.read("/linkdir/file.txt")).rejects.toThrow(SymlinkError);
    });

    it("allows symlinks when followSymlinks is true", async () => {
      const symBackend = new FilesystemBackend({
        rootDir: testDir,
        followSymlinks: true,
      });

      const targetFile = path.join(testDir, "target.txt");
      const linkFile = path.join(testDir, "link.txt");

      await fs.writeFile(targetFile, "Target content");
      await fs.symlink(targetFile, linkFile);

      const content = await symBackend.read("/link.txt");

      expect(content).toContain("Target content");
    });

    it("skips symlinks in lsInfo by default", async () => {
      const targetFile = path.join(testDir, "target.txt");
      const linkFile = path.join(testDir, "link.txt");

      await fs.writeFile(targetFile, "Content");
      await fs.symlink(targetFile, linkFile);

      const entries = await backend.lsInfo("/");

      // Should only see target.txt, not link.txt
      expect(entries.some((e) => e.path === "/target.txt")).toBe(true);
      expect(entries.some((e) => e.path === "/link.txt")).toBe(false);
    });

    it("SymlinkError contains path info", async () => {
      const targetFile = path.join(testDir, "target.txt");
      const linkFile = path.join(testDir, "link.txt");

      await fs.writeFile(targetFile, "Content");
      await fs.symlink(targetFile, linkFile);

      try {
        await backend.read("/link.txt");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SymlinkError);
        expect((error as SymlinkError).path).toBe(linkFile);
      }
    });
  });

  describe("file size limits", () => {
    it("rejects files exceeding size limit", async () => {
      const smallBackend = new FilesystemBackend({
        rootDir: testDir,
        maxFileSizeMb: 0.001, // 1KB limit
      });

      // Create a file larger than 1KB
      const largeContent = "x".repeat(2000);
      await fs.writeFile(path.join(testDir, "large.txt"), largeContent);

      await expect(smallBackend.read("/large.txt")).rejects.toThrow(FileSizeLimitError);
    });

    it("allows files under size limit", async () => {
      const smallContent = "Small file";
      await fs.writeFile(path.join(testDir, "small.txt"), smallContent);

      const content = await backend.read("/small.txt");

      expect(content).toContain("Small file");
    });

    it("FileSizeLimitError contains size info", async () => {
      const smallBackend = new FilesystemBackend({
        rootDir: testDir,
        maxFileSizeMb: 0.001,
      });

      const largeContent = "x".repeat(2000);
      await fs.writeFile(path.join(testDir, "large.txt"), largeContent);

      try {
        await smallBackend.read("/large.txt");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(FileSizeLimitError);
        expect((error as FileSizeLimitError).limitMb).toBe(0.001);
        expect((error as FileSizeLimitError).sizeMb).toBeGreaterThan(0.001);
      }
    });
  });

  describe("allowed paths", () => {
    it("allows access to specified paths outside rootDir", async () => {
      const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-"));
      await fs.writeFile(path.join(externalDir, "external.txt"), "External content");

      const backendWithAllowed = new FilesystemBackend({
        rootDir: testDir,
        allowedPaths: [externalDir],
      });

      // Read using absolute path
      const content = await backendWithAllowed.read(path.join(externalDir, "external.txt"));

      expect(content).toContain("External content");

      // Clean up
      await fs.rm(externalDir, { recursive: true, force: true });
    });
  });
});

describe("createFilesystemBackend factory", () => {
  it("creates a FilesystemBackend", () => {
    const backend = createFilesystemBackend();

    expect(backend).toBeInstanceOf(FilesystemBackend);
  });

  it("passes options to constructor", async () => {
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "factory-test-"));

    try {
      const backend = createFilesystemBackend({
        rootDir: testDir,
        maxFileSizeMb: 5,
      });

      await fs.writeFile(path.join(testDir, "test.txt"), "Content");
      const content = await backend.read("/test.txt");

      expect(content).toContain("Content");
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("implements BackendProtocol", () => {
    const backend = createFilesystemBackend();

    expect(isBackend(backend)).toBe(true);
  });
});
