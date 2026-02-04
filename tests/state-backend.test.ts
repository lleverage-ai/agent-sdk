import { beforeEach, describe, expect, it } from "vitest";
import { isBackend } from "../src/backend.js";
import {
  type AgentState,
  createAgentState,
  createStateBackend,
  StateBackend,
  type TodoItem,
} from "../src/backends/state.js";

describe("StateBackend", () => {
  let state: AgentState;
  let backend: StateBackend;

  beforeEach(() => {
    state = createAgentState();
    backend = new StateBackend(state);
  });

  describe("constructor", () => {
    it("creates a backend from AgentState", () => {
      expect(backend).toBeInstanceOf(StateBackend);
    });

    it("implements BackendProtocol", () => {
      expect(isBackend(backend)).toBe(true);
    });
  });

  describe("write", () => {
    it("creates a new file", () => {
      const result = backend.write("/test.txt", "Hello, World!");

      expect(result.success).toBe(true);
      expect(result.path).toBe("/test.txt");
      expect(state.files["/test.txt"]).toBeDefined();
      expect(state.files["/test.txt"].content).toEqual(["Hello, World!"]);
    });

    it("creates multiline files", () => {
      const result = backend.write("/multi.txt", "Line 1\nLine 2\nLine 3");

      expect(result.success).toBe(true);
      expect(state.files["/multi.txt"].content).toEqual(["Line 1", "Line 2", "Line 3"]);
    });

    it("overwrites existing files", () => {
      backend.write("/test.txt", "Original");
      const originalCreatedAt = state.files["/test.txt"].created_at;

      backend.write("/test.txt", "Updated");

      expect(state.files["/test.txt"].content).toEqual(["Updated"]);
      expect(state.files["/test.txt"].created_at).toBe(originalCreatedAt);
    });

    it("normalizes paths without leading slash", () => {
      const result = backend.write("test.txt", "Content");

      expect(result.path).toBe("/test.txt");
      expect(state.files["/test.txt"]).toBeDefined();
    });

    it("sets timestamps", () => {
      backend.write("/test.txt", "Content");

      const file = state.files["/test.txt"];
      expect(file.created_at).toBeDefined();
      expect(file.modified_at).toBeDefined();
      expect(new Date(file.created_at).getTime()).not.toBeNaN();
    });
  });

  describe("read", () => {
    it("reads file content with line numbers", () => {
      backend.write("/test.txt", "Line 1\nLine 2\nLine 3");

      const content = backend.read("/test.txt");

      expect(content).toContain("1→Line 1");
      expect(content).toContain("2→Line 2");
      expect(content).toContain("3→Line 3");
    });

    it("throws for non-existent files", () => {
      expect(() => backend.read("/missing.txt")).toThrow("File not found");
    });

    it("supports offset parameter", () => {
      backend.write("/test.txt", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const content = backend.read("/test.txt", 2);

      expect(content).not.toContain("Line 1");
      expect(content).not.toContain("Line 2");
      expect(content).toContain("3→Line 3");
      expect(content).toContain("4→Line 4");
    });

    it("supports limit parameter", () => {
      backend.write("/test.txt", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const content = backend.read("/test.txt", 0, 2);

      expect(content).toContain("1→Line 1");
      expect(content).toContain("2→Line 2");
      expect(content).not.toContain("Line 3");
    });

    it("supports offset and limit together", () => {
      backend.write("/test.txt", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const content = backend.read("/test.txt", 1, 2);

      expect(content).not.toContain("Line 1");
      expect(content).toContain("2→Line 2");
      expect(content).toContain("3→Line 3");
      expect(content).not.toContain("Line 4");
    });

    it("normalizes paths", () => {
      backend.write("/test.txt", "Content");

      const content = backend.read("test.txt");

      expect(content).toContain("Content");
    });
  });

  describe("readRaw", () => {
    it("returns FileData structure", () => {
      backend.write("/test.txt", "Line 1\nLine 2");

      const data = backend.readRaw("/test.txt");

      expect(data.content).toEqual(["Line 1", "Line 2"]);
      expect(data.created_at).toBeDefined();
      expect(data.modified_at).toBeDefined();
    });

    it("throws for non-existent files", () => {
      expect(() => backend.readRaw("/missing.txt")).toThrow("File not found");
    });

    it("returns a copy of the data", () => {
      backend.write("/test.txt", "Original");

      const data = backend.readRaw("/test.txt");
      data.content.push("Modified");

      expect(state.files["/test.txt"].content).toEqual(["Original"]);
    });
  });

  describe("edit", () => {
    it("replaces text in a file", () => {
      backend.write("/test.txt", "Hello, World!");

      const result = backend.edit("/test.txt", "World", "TypeScript");

      expect(result.success).toBe(true);
      expect(result.occurrences).toBe(1);
      expect(state.files["/test.txt"].content).toEqual(["Hello, TypeScript!"]);
    });

    it("fails when string not found", () => {
      backend.write("/test.txt", "Hello, World!");

      const result = backend.edit("/test.txt", "Python", "TypeScript");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("fails for non-existent files", () => {
      const result = backend.edit("/missing.txt", "old", "new");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("fails when multiple occurrences without replaceAll", () => {
      backend.write("/test.txt", "foo foo foo");

      const result = backend.edit("/test.txt", "foo", "bar");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Multiple occurrences");
      expect(result.occurrences).toBe(3);
    });

    it("replaces all occurrences with replaceAll=true", () => {
      backend.write("/test.txt", "foo foo foo");

      const result = backend.edit("/test.txt", "foo", "bar", true);

      expect(result.success).toBe(true);
      expect(result.occurrences).toBe(3);
      expect(state.files["/test.txt"].content).toEqual(["bar bar bar"]);
    });

    it("handles multiline replacements", () => {
      backend.write("/test.txt", "Line 1\nLine 2\nLine 3");

      const result = backend.edit("/test.txt", "Line 2\nLine 3", "New Content");

      expect(result.success).toBe(true);
      expect(state.files["/test.txt"].content).toEqual(["Line 1", "New Content"]);
    });

    it("updates modified timestamp", () => {
      // Manually set an old timestamp
      backend.write("/test.txt", "Original");
      state.files["/test.txt"].modified_at = "2020-01-01T00:00:00.000Z";
      const originalModified = state.files["/test.txt"].modified_at;

      backend.edit("/test.txt", "Original", "Modified");

      expect(state.files["/test.txt"].modified_at).not.toBe(originalModified);
    });
  });

  describe("lsInfo", () => {
    it("lists files in a directory", () => {
      backend.write("/src/index.ts", "export {}");
      backend.write("/src/types.ts", "interface Foo {}");

      const files = backend.lsInfo("/src");

      expect(files).toHaveLength(2);
      expect(files.some((f) => f.path === "/src/index.ts")).toBe(true);
      expect(files.some((f) => f.path === "/src/types.ts")).toBe(true);
    });

    it("lists subdirectories", () => {
      backend.write("/src/index.ts", "export {}");
      backend.write("/src/utils/helpers.ts", "export {}");

      const entries = backend.lsInfo("/src");

      expect(entries.some((e) => e.path === "/src/index.ts")).toBe(true);
      expect(entries.some((e) => e.path === "/src/utils" && e.is_dir)).toBe(true);
    });

    it("returns empty array for empty directory", () => {
      const files = backend.lsInfo("/empty");

      expect(files).toEqual([]);
    });

    it("includes file size", () => {
      backend.write("/test.txt", "Hello!");

      const files = backend.lsInfo("/");

      const testFile = files.find((f) => f.path === "/test.txt");
      expect(testFile).toBeDefined();
      expect(testFile?.size).toBe(6); // "Hello!".length
    });

    it("includes modified timestamp", () => {
      backend.write("/test.txt", "Content");

      const files = backend.lsInfo("/");

      const testFile = files.find((f) => f.path === "/test.txt");
      expect(testFile?.modified_at).toBeDefined();
    });

    it("normalizes path", () => {
      backend.write("/src/index.ts", "export {}");

      const filesWithSlash = backend.lsInfo("/src/");
      const filesWithoutSlash = backend.lsInfo("src");

      expect(filesWithSlash).toEqual(filesWithoutSlash);
    });
  });

  describe("globInfo", () => {
    beforeEach(() => {
      backend.write("/src/index.ts", "export {}");
      backend.write("/src/types.ts", "export type {}");
      backend.write("/src/utils/helpers.ts", "export {}");
      backend.write("/tests/index.test.ts", "test()");
      backend.write("/README.md", "# Readme");
    });

    it("matches simple wildcard patterns", () => {
      const matches = backend.globInfo("*.ts", "/src");

      expect(matches).toHaveLength(2);
      expect(matches.some((m) => m.path === "/src/index.ts")).toBe(true);
      expect(matches.some((m) => m.path === "/src/types.ts")).toBe(true);
    });

    it("matches globstar patterns", () => {
      const matches = backend.globInfo("**/*.ts");

      expect(matches).toHaveLength(4);
      expect(matches.some((m) => m.path === "/src/index.ts")).toBe(true);
      expect(matches.some((m) => m.path === "/src/utils/helpers.ts")).toBe(true);
      expect(matches.some((m) => m.path === "/tests/index.test.ts")).toBe(true);
    });

    it("matches specific extensions", () => {
      const matches = backend.globInfo("**/*.md");

      expect(matches).toHaveLength(1);
      expect(matches[0].path).toBe("/README.md");
    });

    it("respects base path", () => {
      const matches = backend.globInfo("**/*.ts", "/tests");

      expect(matches).toHaveLength(1);
      expect(matches[0].path).toBe("/tests/index.test.ts");
    });

    it("returns empty array when no matches", () => {
      const matches = backend.globInfo("**/*.py");

      expect(matches).toEqual([]);
    });

    it("matches single character wildcard", () => {
      backend.write("/a1.txt", "");
      backend.write("/a2.txt", "");
      backend.write("/ab.txt", "");
      backend.write("/abc.txt", ""); // Should NOT match (3 chars after 'a')

      const matches = backend.globInfo("a?.txt");

      expect(matches).toHaveLength(3); // a1, a2, ab all match (single char after 'a')
      expect(matches.some((m) => m.path === "/a1.txt")).toBe(true);
      expect(matches.some((m) => m.path === "/a2.txt")).toBe(true);
      expect(matches.some((m) => m.path === "/ab.txt")).toBe(true);
      expect(matches.some((m) => m.path === "/abc.txt")).toBe(false);
    });
  });

  describe("grepRaw", () => {
    beforeEach(() => {
      backend.write(
        "/src/index.ts",
        "// TODO: implement\nexport function hello() {\n  return 'hello';\n}",
      );
      backend.write("/src/types.ts", "// Types file\nexport interface Foo {\n  bar: string;\n}");
      backend.write("/tests/index.test.ts", "// TODO: add more tests\ntest('hello', () => {});");
    });

    it("finds pattern matches", () => {
      const matches = backend.grepRaw("TODO:");

      expect(matches).toHaveLength(2);
      expect(matches.some((m) => m.path === "/src/index.ts")).toBe(true);
      expect(matches.some((m) => m.path === "/tests/index.test.ts")).toBe(true);
    });

    it("returns line numbers (1-indexed)", () => {
      const matches = backend.grepRaw("TODO:");

      const srcMatch = matches.find((m) => m.path === "/src/index.ts");
      expect(srcMatch?.line).toBe(1);
    });

    it("returns matching line text", () => {
      const matches = backend.grepRaw("TODO:");

      expect(matches.some((m) => m.text.includes("TODO: implement"))).toBe(true);
    });

    it("respects path filter", () => {
      const matches = backend.grepRaw("TODO:", "/src");

      expect(matches).toHaveLength(1);
      expect(matches[0].path).toBe("/src/index.ts");
    });

    it("respects glob filter", () => {
      const matches = backend.grepRaw("export", null, "*.ts");

      // Should find matches in .ts files at root level only
      // Our files are in subdirectories, so *.ts shouldn't match
      expect(matches).toHaveLength(0);
    });

    it("supports regex patterns", () => {
      const matches = backend.grepRaw("export (function|interface)");

      expect(matches).toHaveLength(2);
    });

    it("returns empty array when no matches", () => {
      const matches = backend.grepRaw("nonexistent pattern");

      expect(matches).toEqual([]);
    });
  });
});

describe("createStateBackend factory", () => {
  it("returns a factory function", () => {
    const factory = createStateBackend();

    expect(typeof factory).toBe("function");
  });

  it("factory creates StateBackend from state", () => {
    const factory = createStateBackend();
    const state = createAgentState();

    const backend = factory(state);

    expect(backend).toBeInstanceOf(StateBackend);
    expect(isBackend(backend)).toBe(true);
  });

  it("factory shares state with backend", () => {
    const factory = createStateBackend();
    const state = createAgentState();

    const backend = factory(state);
    backend.write("/test.txt", "Content");

    expect(state.files["/test.txt"]).toBeDefined();
  });
});

describe("createAgentState", () => {
  it("creates empty state", () => {
    const state = createAgentState();

    expect(state.todos).toEqual([]);
    expect(state.files).toEqual({});
  });

  it("creates independent state objects", () => {
    const state1 = createAgentState();
    const state2 = createAgentState();

    state1.todos.push({
      id: "1",
      content: "Test",
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    expect(state2.todos).toEqual([]);
  });
});

describe("TodoItem type", () => {
  it("supports all status values", () => {
    const statuses: Array<TodoItem["status"]> = [
      "pending",
      "in_progress",
      "completed",
      "cancelled",
    ];

    for (const status of statuses) {
      const todo: TodoItem = {
        id: "1",
        content: "Test",
        status,
        createdAt: new Date().toISOString(),
      };
      expect(todo.status).toBe(status);
    }
  });

  it("supports completedAt for completed todos", () => {
    const todo: TodoItem = {
      id: "1",
      content: "Test",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    expect(todo.completedAt).toBeDefined();
  });
});
