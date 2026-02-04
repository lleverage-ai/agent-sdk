/**
 * Tests for the memory system.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AdditionalMemoryFile,
  buildMemorySection,
  buildPathMemoryContext,
  createFilesystemMemoryStore,
  createInMemoryMemoryStore,
  // Stores
  FilesystemMemoryStore,
  filterAdditionalFilesByPath,
  filterAutoLoadAdditionalFiles,
  filterAutoLoadMemories,
  filterMemoriesByAllTags,
  filterMemoriesByPath,
  filterMemoriesByTags,
  getUserAgentDir,
  getUserMemoryPath,
  InMemoryMemoryStore,
  loadAdditionalMemoryFiles,
  // Loading
  loadAgentMemory,
  // Types
  type MemoryDocument,
  matchesAnyPathPattern,
  // Path rules
  matchesPathPattern,
  // Store and parsing
  parseMarkdownWithFrontmatter,
  parseSimpleYaml,
  serializeMarkdownWithFrontmatter,
} from "../src/index.js";

// =============================================================================
// YAML Parsing Tests
// =============================================================================

describe("parseSimpleYaml", () => {
  it("parses simple key-value pairs", () => {
    const yaml = `
name: test
version: 1
    `.trim();

    const result = parseSimpleYaml(yaml);

    expect(result).toEqual({
      name: "test",
      version: 1,
    });
  });

  it("parses boolean values", () => {
    const yaml = `
enabled: true
disabled: false
yes_value: yes
no_value: no
    `.trim();

    const result = parseSimpleYaml(yaml);

    expect(result).toEqual({
      enabled: true,
      disabled: false,
      yes_value: true,
      no_value: false,
    });
  });

  it("parses null values", () => {
    const yaml = `
value1: null
value2: ~
    `.trim();

    const result = parseSimpleYaml(yaml);

    expect(result).toEqual({
      value1: null,
      value2: null,
    });
  });

  it("parses quoted strings", () => {
    const yaml = `
double: "hello world"
single: 'hello world'
    `.trim();

    const result = parseSimpleYaml(yaml);

    expect(result).toEqual({
      double: "hello world",
      single: "hello world",
    });
  });

  it("parses arrays", () => {
    const yaml = `
paths:
  - src/**/*.ts
  - tests/**/*.ts
tags:
  - typescript
  - testing
    `.trim();

    const result = parseSimpleYaml(yaml);

    expect(result).toEqual({
      paths: ["src/**/*.ts", "tests/**/*.ts"],
      tags: ["typescript", "testing"],
    });
  });

  it("ignores comments", () => {
    const yaml = `
# This is a comment
name: test
# Another comment
version: 1
    `.trim();

    const result = parseSimpleYaml(yaml);

    expect(result).toEqual({
      name: "test",
      version: 1,
    });
  });

  it("handles empty input", () => {
    const result = parseSimpleYaml("");
    expect(result).toEqual({});
  });
});

// =============================================================================
// Markdown Frontmatter Tests
// =============================================================================

describe("parseMarkdownWithFrontmatter", () => {
  it("parses frontmatter and content", () => {
    const markdown = `---
paths:
  - src/**/*.ts
priority: 10
---

# Title

Content here.`;

    const { metadata, content } = parseMarkdownWithFrontmatter(markdown);

    expect(metadata).toEqual({
      paths: ["src/**/*.ts"],
      priority: 10,
    });
    expect(content).toBe("# Title\n\nContent here.");
  });

  it("handles markdown without frontmatter", () => {
    const markdown = "# Title\n\nContent here.";

    const { metadata, content } = parseMarkdownWithFrontmatter(markdown);

    expect(metadata).toEqual({});
    expect(content).toBe(markdown);
  });

  it("handles empty content after frontmatter", () => {
    const markdown = `---
name: test
---
`;

    const { metadata, content } = parseMarkdownWithFrontmatter(markdown);

    expect(metadata).toEqual({ name: "test" });
    expect(content).toBe("");
  });

  it("handles unclosed frontmatter", () => {
    const markdown = "---\nname: test\n# Title";

    const { metadata, content } = parseMarkdownWithFrontmatter(markdown);

    expect(metadata).toEqual({});
    expect(content).toBe(markdown);
  });
});

describe("serializeMarkdownWithFrontmatter", () => {
  it("serializes metadata and content", () => {
    const result = serializeMarkdownWithFrontmatter({
      metadata: {
        paths: ["src/**/*.ts"],
        priority: 10,
      },
      content: "# Title\n\nContent here.",
    });

    expect(result).toContain("---");
    expect(result).toContain("paths:");
    expect(result).toContain("  - src/**/*.ts");
    expect(result).toContain("priority: 10");
    expect(result).toContain("# Title");
    expect(result).toContain("Content here.");
  });

  it("omits frontmatter when no metadata", () => {
    const result = serializeMarkdownWithFrontmatter({
      metadata: {},
      content: "# Title",
    });

    expect(result).toBe("# Title");
    expect(result).not.toContain("---");
  });

  it("handles special characters in strings", () => {
    const result = serializeMarkdownWithFrontmatter({
      metadata: {
        description: "Contains: special characters",
      },
      content: "Content",
    });

    expect(result).toContain('"Contains: special characters"');
  });
});

// =============================================================================
// InMemoryMemoryStore Tests
// =============================================================================

describe("InMemoryMemoryStore", () => {
  let store: InMemoryMemoryStore;

  beforeEach(() => {
    store = new InMemoryMemoryStore();
  });

  it("writes and reads documents", async () => {
    const doc: MemoryDocument = {
      path: "/test/doc.md",
      metadata: { priority: 5 },
      content: "# Test",
      modifiedAt: Date.now(),
    };

    await store.write("/test/doc.md", doc);
    const result = await store.read("/test/doc.md");

    expect(result).toBeDefined();
    expect(result?.content).toBe("# Test");
    expect(result?.metadata.priority).toBe(5);
  });

  it("returns undefined for non-existent documents", async () => {
    const result = await store.read("/nonexistent.md");
    expect(result).toBeUndefined();
  });

  it("deletes documents", async () => {
    const doc: MemoryDocument = {
      path: "/test/doc.md",
      metadata: {},
      content: "Content",
      modifiedAt: Date.now(),
    };

    await store.write("/test/doc.md", doc);
    const deleted = await store.delete("/test/doc.md");

    expect(deleted).toBe(true);
    expect(await store.read("/test/doc.md")).toBeUndefined();
  });

  it("returns false when deleting non-existent document", async () => {
    const deleted = await store.delete("/nonexistent.md");
    expect(deleted).toBe(false);
  });

  it("lists all documents", async () => {
    await store.write("/a.md", { path: "/a.md", metadata: {}, content: "A", modifiedAt: 0 });
    await store.write("/b.md", { path: "/b.md", metadata: {}, content: "B", modifiedAt: 0 });

    const paths = await store.list();

    expect(paths).toHaveLength(2);
    expect(paths).toContain("/a.md");
    expect(paths).toContain("/b.md");
  });

  it("lists documents matching prefix", async () => {
    await store.write("/test/a.md", {
      path: "/test/a.md",
      metadata: {},
      content: "A",
      modifiedAt: 0,
    });
    await store.write("/test/b.md", {
      path: "/test/b.md",
      metadata: {},
      content: "B",
      modifiedAt: 0,
    });
    await store.write("/other/c.md", {
      path: "/other/c.md",
      metadata: {},
      content: "C",
      modifiedAt: 0,
    });

    const paths = await store.list("/test/");

    expect(paths).toHaveLength(2);
    expect(paths).toContain("/test/a.md");
    expect(paths).toContain("/test/b.md");
  });

  it("checks document existence", async () => {
    await store.write("/test.md", { path: "/test.md", metadata: {}, content: "", modifiedAt: 0 });

    expect(await store.exists("/test.md")).toBe(true);
    expect(await store.exists("/nonexistent.md")).toBe(false);
  });

  it("clears all documents", async () => {
    await store.write("/a.md", { path: "/a.md", metadata: {}, content: "", modifiedAt: 0 });
    await store.write("/b.md", { path: "/b.md", metadata: {}, content: "", modifiedAt: 0 });

    store.clear();

    expect(store.size).toBe(0);
    expect(await store.list()).toHaveLength(0);
  });

  it("prevents mutation of stored documents", async () => {
    const doc: MemoryDocument = {
      path: "/test.md",
      metadata: { priority: 5 },
      content: "Original",
      modifiedAt: 0,
    };

    await store.write("/test.md", doc);
    doc.content = "Modified"; // Try to mutate

    const result = await store.read("/test.md");
    expect(result?.content).toBe("Original"); // Should be unchanged
  });
});

// =============================================================================
// Path Pattern Matching Tests
// =============================================================================

describe("matchesPathPattern", () => {
  it("matches exact paths", () => {
    expect(matchesPathPattern("src/index.ts", "src/index.ts")).toBe(true);
    expect(matchesPathPattern("src/index.ts", "src/main.ts")).toBe(false);
  });

  it("matches * wildcard (single segment)", () => {
    expect(matchesPathPattern("src/index.ts", "src/*.ts")).toBe(true);
    expect(matchesPathPattern("src/api/index.ts", "src/*.ts")).toBe(false);
    expect(matchesPathPattern("README.md", "*.md")).toBe(true);
  });

  it("matches ** wildcard (multiple segments)", () => {
    expect(matchesPathPattern("src/api/users.ts", "src/**/*.ts")).toBe(true);
    expect(matchesPathPattern("src/index.ts", "src/**/*.ts")).toBe(true);
    expect(matchesPathPattern("tests/api.test.ts", "src/**/*.ts")).toBe(false);
  });

  it("matches ? wildcard (single character)", () => {
    expect(matchesPathPattern("file1.ts", "file?.ts")).toBe(true);
    expect(matchesPathPattern("file12.ts", "file?.ts")).toBe(false);
  });

  it("handles edge cases", () => {
    expect(matchesPathPattern("src/index.ts", "**/*.ts")).toBe(true);
    expect(matchesPathPattern("index.ts", "**/*.ts")).toBe(true);
    expect(matchesPathPattern("src/api/deep/nested/file.ts", "**/*.ts")).toBe(true);
  });

  it("normalizes backslashes", () => {
    expect(matchesPathPattern("src\\api\\users.ts", "src/**/*.ts")).toBe(true);
    expect(matchesPathPattern("src/api/users.ts", "src\\**\\*.ts")).toBe(true);
  });
});

describe("matchesAnyPathPattern", () => {
  it("matches if any pattern matches", () => {
    const patterns = ["src/**/*.ts", "tests/**/*.ts"];

    expect(matchesAnyPathPattern("src/index.ts", patterns)).toBe(true);
    expect(matchesAnyPathPattern("tests/index.test.ts", patterns)).toBe(true);
    expect(matchesAnyPathPattern("README.md", patterns)).toBe(false);
  });

  it("handles empty patterns array", () => {
    expect(matchesAnyPathPattern("src/index.ts", [])).toBe(false);
  });
});

// =============================================================================
// Memory Filtering Tests
// =============================================================================

describe("filterMemoriesByPath", () => {
  const memories: MemoryDocument[] = [
    {
      path: "/memory/api.md",
      metadata: { paths: ["src/api/**/*.ts"], priority: 10 },
      content: "API rules",
      modifiedAt: 0,
    },
    {
      path: "/memory/general.md",
      metadata: {}, // No paths = applies to all
      content: "General rules",
      modifiedAt: 0,
    },
    {
      path: "/memory/tests.md",
      metadata: { paths: ["tests/**/*.ts"], priority: 5 },
      content: "Test rules",
      modifiedAt: 0,
    },
  ];

  it("returns memories matching the path", () => {
    const result = filterMemoriesByPath(memories, "src/api/users.ts");

    expect(result).toHaveLength(2);
    expect(result[0]?.path).toBe("/memory/api.md"); // Higher priority
    expect(result[1]?.path).toBe("/memory/general.md"); // No paths = matches all
  });

  it("returns memories without path restrictions", () => {
    const result = filterMemoriesByPath(memories, "some/random/file.md");

    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe("/memory/general.md");
  });

  it("sorts by priority (higher first)", () => {
    const result = filterMemoriesByPath(memories, "src/api/users.ts");

    expect(result[0]?.metadata.priority).toBe(10);
    expect(result[1]?.metadata.priority).toBeUndefined();
  });
});

describe("filterAdditionalFilesByPath", () => {
  const files: AdditionalMemoryFile[] = [
    {
      filename: "api.md",
      content: "API content",
      metadata: { paths: ["src/api/**/*.ts"] },
    },
    {
      filename: "general.md",
      content: "General content",
      metadata: {},
    },
  ];

  it("filters files by path", () => {
    const result = filterAdditionalFilesByPath(files, "src/api/users.ts");

    expect(result).toHaveLength(2);
    expect(result.map((f) => f.filename)).toContain("api.md");
    expect(result.map((f) => f.filename)).toContain("general.md");
  });

  it("includes files without path restrictions", () => {
    const result = filterAdditionalFilesByPath(files, "random/file.ts");

    expect(result).toHaveLength(1);
    expect(result[0]?.filename).toBe("general.md");
  });
});

// =============================================================================
// Tag Filtering Tests
// =============================================================================

describe("filterMemoriesByTags", () => {
  const memories: MemoryDocument[] = [
    {
      path: "/memory/api.md",
      metadata: { tags: ["api", "typescript"] },
      content: "",
      modifiedAt: 0,
    },
    {
      path: "/memory/security.md",
      metadata: { tags: ["security"] },
      content: "",
      modifiedAt: 0,
    },
    {
      path: "/memory/general.md",
      metadata: {},
      content: "",
      modifiedAt: 0,
    },
  ];

  it("filters by matching tags (any)", () => {
    const result = filterMemoriesByTags(memories, ["api"]);

    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe("/memory/api.md");
  });

  it("returns empty for no tag matches", () => {
    const result = filterMemoriesByTags(memories, ["nonexistent"]);
    expect(result).toHaveLength(0);
  });

  it("returns all when empty tags array", () => {
    const result = filterMemoriesByTags(memories, []);
    expect(result).toHaveLength(3);
  });
});

describe("filterMemoriesByAllTags", () => {
  const memories: MemoryDocument[] = [
    {
      path: "/memory/api.md",
      metadata: { tags: ["api", "typescript", "backend"] },
      content: "",
      modifiedAt: 0,
    },
    {
      path: "/memory/frontend.md",
      metadata: { tags: ["frontend", "typescript"] },
      content: "",
      modifiedAt: 0,
    },
  ];

  it("filters by all required tags", () => {
    const result = filterMemoriesByAllTags(memories, ["api", "typescript"]);

    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe("/memory/api.md");
  });

  it("returns empty when not all tags match", () => {
    const result = filterMemoriesByAllTags(memories, ["api", "frontend"]);
    expect(result).toHaveLength(0);
  });
});

// =============================================================================
// Auto-Load Filtering Tests
// =============================================================================

describe("filterAutoLoadMemories", () => {
  const memories: MemoryDocument[] = [
    {
      path: "/memory/auto.md",
      metadata: {}, // Default = true
      content: "",
      modifiedAt: 0,
    },
    {
      path: "/memory/explicit.md",
      metadata: { autoLoad: true },
      content: "",
      modifiedAt: 0,
    },
    {
      path: "/memory/manual.md",
      metadata: { autoLoad: false },
      content: "",
      modifiedAt: 0,
    },
  ];

  it("includes memories without autoLoad or with autoLoad: true", () => {
    const result = filterAutoLoadMemories(memories);

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.path)).toContain("/memory/auto.md");
    expect(result.map((m) => m.path)).toContain("/memory/explicit.md");
  });

  it("excludes memories with autoLoad: false", () => {
    const result = filterAutoLoadMemories(memories);
    expect(result.map((m) => m.path)).not.toContain("/memory/manual.md");
  });
});

describe("filterAutoLoadAdditionalFiles", () => {
  const files: AdditionalMemoryFile[] = [
    { filename: "auto.md", content: "", metadata: {} },
    { filename: "manual.md", content: "", metadata: { autoLoad: false } },
  ];

  it("filters files by autoLoad setting", () => {
    const result = filterAutoLoadAdditionalFiles(files);

    expect(result).toHaveLength(1);
    expect(result[0]?.filename).toBe("auto.md");
  });
});

// =============================================================================
// Build Memory Section Tests
// =============================================================================

describe("buildMemorySection", () => {
  it("builds section with all memory types", () => {
    const userMemory: MemoryDocument = {
      path: "/user/agent.md",
      metadata: {},
      content: "User preferences",
      modifiedAt: 0,
    };

    const projectMemory: MemoryDocument = {
      path: "/project/.deepagents/agent.md",
      metadata: {},
      content: "Project rules",
      modifiedAt: 0,
    };

    const additional: AdditionalMemoryFile[] = [
      { filename: "extra.md", content: "Extra context", metadata: {} },
    ];

    const result = buildMemorySection(userMemory, projectMemory, additional);

    expect(result).toContain("# User Memory");
    expect(result).toContain("User preferences");
    expect(result).toContain("# Project Memory");
    expect(result).toContain("Project rules");
    expect(result).toContain("# Additional Context");
    expect(result).toContain("## extra.md");
    expect(result).toContain("Extra context");
  });

  it("handles missing user memory", () => {
    const projectMemory: MemoryDocument = {
      path: "/project/agent.md",
      metadata: {},
      content: "Project rules",
      modifiedAt: 0,
    };

    const result = buildMemorySection(undefined, projectMemory, []);

    expect(result).not.toContain("# User Memory");
    expect(result).toContain("# Project Memory");
  });

  it("handles missing project memory", () => {
    const userMemory: MemoryDocument = {
      path: "/user/agent.md",
      metadata: {},
      content: "User preferences",
      modifiedAt: 0,
    };

    const result = buildMemorySection(userMemory, undefined, []);

    expect(result).toContain("# User Memory");
    expect(result).not.toContain("# Project Memory");
  });

  it("handles empty additional files", () => {
    const result = buildMemorySection(undefined, undefined, []);
    expect(result).toBe("");
  });

  it("supports custom headers", () => {
    const userMemory: MemoryDocument = {
      path: "/user/agent.md",
      metadata: {},
      content: "Content",
      modifiedAt: 0,
    };

    const result = buildMemorySection(userMemory, undefined, [], {
      userHeader: "# My Custom Header",
    });

    expect(result).toContain("# My Custom Header");
    expect(result).not.toContain("# User Memory");
  });

  it("can exclude filenames from additional files", () => {
    const additional: AdditionalMemoryFile[] = [
      { filename: "extra.md", content: "Extra content", metadata: {} },
    ];

    const result = buildMemorySection(undefined, undefined, additional, {
      includeFilenames: false,
    });

    expect(result).not.toContain("## extra.md");
    expect(result).toContain("Extra content");
  });
});

// =============================================================================
// Build Path Memory Context Tests
// =============================================================================

describe("buildPathMemoryContext", () => {
  it("filters memories by current path", () => {
    const userMemory: MemoryDocument = {
      path: "/user/agent.md",
      metadata: { paths: ["src/**/*.ts"] },
      content: "User content",
      modifiedAt: 0,
    };

    const projectMemory: MemoryDocument = {
      path: "/project/agent.md",
      metadata: { paths: ["tests/**/*.ts"] },
      content: "Project content",
      modifiedAt: 0,
    };

    const result = buildPathMemoryContext({
      userMemory,
      projectMemory,
      currentPath: "src/index.ts",
    });

    expect(result.userMemoryApplies).toBe(true);
    expect(result.projectMemoryApplies).toBe(false);
    expect(result.combinedContent).toContain("User content");
    expect(result.combinedContent).not.toContain("Project content");
  });

  it("includes memories without path restrictions when includeGeneral is true", () => {
    const userMemory: MemoryDocument = {
      path: "/user/agent.md",
      metadata: {},
      content: "User content",
      modifiedAt: 0,
    };

    const result = buildPathMemoryContext({
      userMemory,
      currentPath: "any/file.ts",
      includeGeneral: true,
    });

    expect(result.userMemoryApplies).toBe(true);
    expect(result.combinedContent).toContain("User content");
  });

  it("tracks applied patterns", () => {
    const userMemory: MemoryDocument = {
      path: "/user/agent.md",
      metadata: { paths: ["src/**/*.ts", "lib/**/*.ts"] },
      content: "",
      modifiedAt: 0,
    };

    const result = buildPathMemoryContext({
      userMemory,
      currentPath: "src/index.ts",
    });

    expect(result.appliedPatterns).toContain("src/**/*.ts");
    expect(result.appliedPatterns).toContain("lib/**/*.ts");
  });

  it("includes filenames for additional files by default", () => {
    const additionalFiles: AdditionalMemoryFile[] = [
      { filename: "extra.md", content: "Extra content", metadata: {} },
      { filename: "rules.md", content: "Rules content", metadata: {} },
    ];

    const result = buildPathMemoryContext({
      additionalFiles,
      currentPath: "any/file.ts",
    });

    expect(result.combinedContent).toContain("## extra.md");
    expect(result.combinedContent).toContain("## rules.md");
    expect(result.combinedContent).toContain("Extra content");
    expect(result.combinedContent).toContain("Rules content");
  });

  it("excludes filenames for additional files when includeFilenames is false", () => {
    const additionalFiles: AdditionalMemoryFile[] = [
      { filename: "extra.md", content: "Extra content", metadata: {} },
      { filename: "rules.md", content: "Rules content", metadata: {} },
    ];

    const result = buildPathMemoryContext({
      additionalFiles,
      currentPath: "any/file.ts",
      includeFilenames: false,
    });

    expect(result.combinedContent).not.toContain("## extra.md");
    expect(result.combinedContent).not.toContain("## rules.md");
    expect(result.combinedContent).toContain("Extra content");
    expect(result.combinedContent).toContain("Rules content");
  });

  it("respects includeFilenames: true explicitly", () => {
    const additionalFiles: AdditionalMemoryFile[] = [
      { filename: "context.md", content: "Context content", metadata: {} },
    ];

    const result = buildPathMemoryContext({
      additionalFiles,
      currentPath: "any/file.ts",
      includeFilenames: true,
    });

    expect(result.combinedContent).toContain("## context.md");
    expect(result.combinedContent).toContain("Context content");
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createFilesystemMemoryStore", () => {
  it("creates a FilesystemMemoryStore instance", () => {
    const store = createFilesystemMemoryStore();
    expect(store).toBeInstanceOf(FilesystemMemoryStore);
  });

  it("accepts options", () => {
    const store = createFilesystemMemoryStore({ homeDir: "/custom/home" });
    expect(store).toBeInstanceOf(FilesystemMemoryStore);
  });
});

describe("createInMemoryMemoryStore", () => {
  it("creates an InMemoryMemoryStore instance", () => {
    const store = createInMemoryMemoryStore();
    expect(store).toBeInstanceOf(InMemoryMemoryStore);
  });
});

// =============================================================================
// Path Helper Tests
// =============================================================================

describe("getUserMemoryPath", () => {
  it("returns correct path for agent", () => {
    const result = getUserMemoryPath("my-agent", "/home/user");
    expect(result).toBe("/home/user/.deepagents/my-agent/agent.md");
  });

  it("handles different home directories", () => {
    const result = getUserMemoryPath("test-agent", "/custom/home");
    expect(result).toBe("/custom/home/.deepagents/test-agent/agent.md");
  });
});

describe("getUserAgentDir", () => {
  it("returns correct directory for agent", () => {
    const result = getUserAgentDir("my-agent", "/home/user");
    expect(result).toBe("/home/user/.deepagents/my-agent");
  });
});

// =============================================================================
// FilesystemMemoryStore Integration Tests
// =============================================================================

describe("FilesystemMemoryStore", () => {
  let testDir: string;
  let store: FilesystemMemoryStore;

  beforeEach(async () => {
    // Create a temporary directory for testing
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
    store = new FilesystemMemoryStore({ homeDir: testDir });
  });

  afterEach(async () => {
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("writes and reads documents with frontmatter", async () => {
    const filePath = path.join(testDir, "test.md");

    await store.write(filePath, {
      path: filePath,
      metadata: { priority: 5, tags: ["test"] },
      content: "# Test Document\n\nContent here.",
      modifiedAt: Date.now(),
    });

    const result = await store.read(filePath);

    expect(result).toBeDefined();
    expect(result?.metadata.priority).toBe(5);
    expect(result?.metadata.tags).toEqual(["test"]);
    expect(result?.content).toBe("# Test Document\n\nContent here.");
  });

  it("handles tilde expansion", async () => {
    // Write to ~/test.md should expand to testDir/test.md
    const doc: MemoryDocument = {
      path: "~/test.md",
      metadata: {},
      content: "Content",
      modifiedAt: Date.now(),
    };

    await store.write("~/test.md", doc);
    const result = await store.read("~/test.md");

    expect(result).toBeDefined();
    expect(result?.content).toBe("Content");
  });

  it("returns undefined for non-existent files", async () => {
    const result = await store.read(path.join(testDir, "nonexistent.md"));
    expect(result).toBeUndefined();
  });

  it("deletes documents", async () => {
    const filePath = path.join(testDir, "to-delete.md");

    await store.write(filePath, {
      path: filePath,
      metadata: {},
      content: "Delete me",
      modifiedAt: Date.now(),
    });

    const deleted = await store.delete(filePath);
    expect(deleted).toBe(true);

    const result = await store.read(filePath);
    expect(result).toBeUndefined();
  });

  it("returns false when deleting non-existent file", async () => {
    const deleted = await store.delete(path.join(testDir, "nonexistent.md"));
    expect(deleted).toBe(false);
  });

  it("lists documents in directory", async () => {
    const subDir = path.join(testDir, "subdir");
    await fs.mkdir(subDir, { recursive: true });

    await store.write(path.join(subDir, "a.md"), {
      path: path.join(subDir, "a.md"),
      metadata: {},
      content: "A",
      modifiedAt: Date.now(),
    });

    await store.write(path.join(subDir, "b.md"), {
      path: path.join(subDir, "b.md"),
      metadata: {},
      content: "B",
      modifiedAt: Date.now(),
    });

    const paths = await store.list(subDir);

    expect(paths).toHaveLength(2);
    expect(paths.some((p) => p.endsWith("a.md"))).toBe(true);
    expect(paths.some((p) => p.endsWith("b.md"))).toBe(true);
  });

  it("checks document existence", async () => {
    const filePath = path.join(testDir, "exists.md");

    await store.write(filePath, {
      path: filePath,
      metadata: {},
      content: "",
      modifiedAt: Date.now(),
    });

    expect(await store.exists(filePath)).toBe(true);
    expect(await store.exists(path.join(testDir, "nonexistent.md"))).toBe(false);
  });

  it("creates parent directories when writing", async () => {
    const deepPath = path.join(testDir, "deep", "nested", "dir", "file.md");

    await store.write(deepPath, {
      path: deepPath,
      metadata: {},
      content: "Deep content",
      modifiedAt: Date.now(),
    });

    const result = await store.read(deepPath);
    expect(result?.content).toBe("Deep content");
  });
});

// =============================================================================
// loadAgentMemory Tests
// =============================================================================

describe("loadAgentMemory", () => {
  let store: InMemoryMemoryStore;

  beforeEach(() => {
    store = new InMemoryMemoryStore();
  });

  it("loads memory document from store", async () => {
    await store.write("/test/agent.md", {
      path: "/test/agent.md",
      metadata: { priority: 10 },
      content: "Test content",
      modifiedAt: Date.now(),
    });

    const result = await loadAgentMemory("/test/agent.md", { store });

    expect(result).toBeDefined();
    expect(result?.content).toBe("Test content");
    expect(result?.metadata.priority).toBe(10);
  });

  it("returns undefined for non-existent file", async () => {
    const result = await loadAgentMemory("/nonexistent.md", { store });
    expect(result).toBeUndefined();
  });
});

// =============================================================================
// loadAdditionalMemoryFiles Tests
// =============================================================================

describe("loadAdditionalMemoryFiles", () => {
  let store: InMemoryMemoryStore;

  beforeEach(() => {
    store = new InMemoryMemoryStore();
  });

  it("loads all .md files except agent.md", async () => {
    await store.write("/test/agent.md", {
      path: "/test/agent.md",
      metadata: {},
      content: "Main agent",
      modifiedAt: Date.now(),
    });

    await store.write("/test/extra.md", {
      path: "/test/extra.md",
      metadata: { tags: ["extra"] },
      content: "Extra content",
      modifiedAt: Date.now(),
    });

    await store.write("/test/rules.md", {
      path: "/test/rules.md",
      metadata: {},
      content: "Rules content",
      modifiedAt: Date.now(),
    });

    const result = await loadAdditionalMemoryFiles("/test/", { store });

    expect(result).toHaveLength(2);
    expect(result.map((f) => f.filename)).toContain("extra.md");
    expect(result.map((f) => f.filename)).toContain("rules.md");
    expect(result.map((f) => f.filename)).not.toContain("agent.md");
  });

  it("supports custom exclude list", async () => {
    await store.write("/test/skip.md", {
      path: "/test/skip.md",
      metadata: {},
      content: "Skip me",
      modifiedAt: Date.now(),
    });

    await store.write("/test/include.md", {
      path: "/test/include.md",
      metadata: {},
      content: "Include me",
      modifiedAt: Date.now(),
    });

    const result = await loadAdditionalMemoryFiles("/test/", {
      store,
      exclude: ["skip.md"],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.filename).toBe("include.md");
  });

  it("returns empty array for non-existent directory", async () => {
    const result = await loadAdditionalMemoryFiles("/nonexistent/", { store });
    expect(result).toEqual([]);
  });
});
