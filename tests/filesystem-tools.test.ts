/**
 * Tests for filesystem tools.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { AgentState } from "../src/backends/state.js";
import { createAgentState, StateBackend } from "../src/backends/state.js";
import {
  createEditTool,
  createFilesystemTools,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createWriteTool,
} from "../src/tools/filesystem.js";

describe("Filesystem Tools", () => {
  let state: AgentState;
  let backend: StateBackend;

  beforeEach(() => {
    state = createAgentState();
    backend = new StateBackend(state);

    // Set up test files
    backend.write("/src/index.ts", 'export const hello = "world";');
    backend.write(
      "/src/utils.ts",
      "export function add(a: number, b: number) {\n  return a + b;\n}",
    );
    backend.write("/src/types.ts", "export interface User {\n  name: string;\n  email: string;\n}");
    backend.write(
      "/test/index.test.ts",
      'import { hello } from "../src/index.js";\n\ntest("hello", () => {\n  expect(hello).toBe("world");\n});',
    );
    backend.write("/README.md", "# Test Project\n\nA test project for filesystem tools.");
  });

  describe("createReadTool", () => {
    it("should read file contents with line numbers", async () => {
      const read = createReadTool(backend);
      const result = await read.execute({ file_path: "/src/utils.ts" }, {} as any);

      expect(result).toContain("export function add");
      expect(result).toContain("return a + b");
    });

    it("should support offset parameter", async () => {
      const read = createReadTool(backend);

      // Write a file with multiple lines
      backend.write("/multiline.txt", "line1\nline2\nline3\nline4\nline5");

      const result = await read.execute(
        {
          file_path: "/multiline.txt",
          offset: 2, // Start from line 3 (0-indexed)
        },
        {} as any,
      );

      expect(result).toContain("line3");
      expect(result).toContain("line4");
      expect(result).toContain("line5");
      expect(result).not.toContain("line1");
      expect(result).not.toContain("line2");
    });

    it("should support limit parameter", async () => {
      const read = createReadTool(backend);

      backend.write("/multiline.txt", "line1\nline2\nline3\nline4\nline5");

      const result = await read.execute(
        {
          file_path: "/multiline.txt",
          limit: 2,
        },
        {} as any,
      );

      expect(result).toContain("line1");
      expect(result).toContain("line2");
      expect(result).not.toContain("line3");
    });

    it("should warn for large files", async () => {
      const read = createReadTool(backend);

      // Create a large file (>80k characters = ~20k tokens)
      const largeContent = "x".repeat(100_000);
      backend.write("/large.txt", largeContent);

      const result = await read.execute({ file_path: "/large.txt" }, {} as any);

      expect(result).toContain("[Warning: Large file content");
      expect(result).toContain("tokens");
    });
  });

  describe("createWriteTool", () => {
    it("should write new files", async () => {
      const write = createWriteTool(backend);
      const result = await write.execute(
        {
          file_path: "/new-file.ts",
          content: "export const x = 1;",
        },
        {} as any,
      );

      expect(result).toContain("Successfully wrote");
      expect(result).toContain("1 lines");
      expect(result).toContain("new-file.ts");

      // Verify file was written
      const content = backend.read("/new-file.ts");
      expect(content).toContain("export const x = 1;");
    });

    it("should overwrite existing files", async () => {
      const write = createWriteTool(backend);
      await write.execute(
        {
          file_path: "/src/index.ts",
          content: "export const updated = true;",
        },
        {} as any,
      );

      const content = backend.read("/src/index.ts");
      expect(content).toContain("export const updated = true;");
      expect(content).not.toContain("hello");
    });

    it("should report line count correctly", async () => {
      const write = createWriteTool(backend);
      const result = await write.execute(
        {
          file_path: "/multi.ts",
          content: "line1\nline2\nline3",
        },
        {} as any,
      );

      expect(result).toContain("3 lines");
    });
  });

  describe("createEditTool", () => {
    it("should replace unique text", async () => {
      const edit = createEditTool(backend);
      const result = await edit.execute(
        {
          file_path: "/src/index.ts",
          old_string: '"world"',
          new_string: '"universe"',
        },
        {} as any,
      );

      expect(result).toContain("Successfully edited");

      const content = backend.read("/src/index.ts");
      expect(content).toContain('"universe"');
      expect(content).not.toContain('"world"');
    });

    it("should fail on non-unique text without replace_all", async () => {
      // Create file with duplicate text
      backend.write("/dupe.ts", "const a = 1;\nconst b = 1;");

      const edit = createEditTool(backend);
      const result = await edit.execute(
        {
          file_path: "/dupe.ts",
          old_string: "1",
          new_string: "2",
        },
        {} as any,
      );

      expect(result).toContain("Error");
    });

    it("should replace all occurrences with replace_all", async () => {
      backend.write("/dupe.ts", "const a = 1;\nconst b = 1;");

      const edit = createEditTool(backend);
      const result = await edit.execute(
        {
          file_path: "/dupe.ts",
          old_string: "1",
          new_string: "2",
          replace_all: true,
        },
        {} as any,
      );

      expect(result).toContain("Successfully replaced");
      expect(result).toContain("2 occurrences");

      const content = backend.read("/dupe.ts");
      expect(content).toContain("const a = 2");
      expect(content).toContain("const b = 2");
    });

    it("should fail if old_string not found", async () => {
      const edit = createEditTool(backend);
      const result = await edit.execute(
        {
          file_path: "/src/index.ts",
          old_string: "not_found_string",
          new_string: "replacement",
        },
        {} as any,
      );

      expect(result).toContain("Error");
    });
  });

  describe("createGlobTool", () => {
    it("should find files matching pattern", async () => {
      const glob = createGlobTool(backend);
      const result = await glob.execute({ pattern: "**/*.ts" }, {} as any);

      expect(result).toContain("index.ts");
      expect(result).toContain("utils.ts");
      expect(result).toContain("types.ts");
      expect(result).toContain("index.test.ts");
    });

    it("should filter by path", async () => {
      const glob = createGlobTool(backend);
      const result = await glob.execute(
        {
          pattern: "*.ts",
          path: "/src",
        },
        {} as any,
      );

      expect(result).toContain("index.ts");
      expect(result).not.toContain("index.test.ts");
    });

    it("should find test files", async () => {
      const glob = createGlobTool(backend);
      const result = await glob.execute({ pattern: "**/*.test.ts" }, {} as any);

      expect(result).toContain("index.test.ts");
      expect(result).not.toContain("utils.ts");
    });

    it("should report no matches", async () => {
      const glob = createGlobTool(backend);
      const result = await glob.execute({ pattern: "**/*.xyz" }, {} as any);

      expect(result).toBe("No files found matching the pattern.");
    });

    it("should show file count", async () => {
      const glob = createGlobTool(backend);
      const result = await glob.execute({ pattern: "**/*.ts" }, {} as any);

      expect(result).toContain("Found 4 file(s):");
    });
  });

  describe("createGrepTool", () => {
    it("should search for pattern in files", async () => {
      const grep = createGrepTool(backend);
      const result = await grep.execute({ pattern: "export" }, {} as any);

      expect(result).toContain("index.ts");
      expect(result).toContain("utils.ts");
      expect(result).toContain("types.ts");
      expect(result).toContain("export");
    });

    it("should filter by glob pattern", async () => {
      const grep = createGrepTool(backend);
      const result = await grep.execute(
        {
          pattern: "export",
          glob: "*.test.ts",
        },
        {} as any,
      );

      // Should only search in test files
      expect(result).not.toContain("utils.ts");
    });

    it("should filter by path", async () => {
      const grep = createGrepTool(backend);
      const result = await grep.execute(
        {
          pattern: "export",
          path: "/src",
        },
        {} as any,
      );

      expect(result).toContain("index.ts");
      expect(result).not.toContain("index.test.ts");
    });

    it("should show line numbers", async () => {
      const grep = createGrepTool(backend);
      const result = await grep.execute({ pattern: "function" }, {} as any);

      // Format is: path:line: text
      expect(result).toMatch(/utils\.ts:\d+:/);
    });

    it("should report no matches", async () => {
      const grep = createGrepTool(backend);
      const result = await grep.execute({ pattern: "xyznotfound" }, {} as any);

      expect(result).toBe("No matches found.");
    });

    it("should show match count", async () => {
      const grep = createGrepTool(backend);
      const result = await grep.execute({ pattern: "export" }, {} as any);

      expect(result).toContain("Found");
      expect(result).toContain("match(es):");
    });
  });

  describe("createFilesystemTools", () => {
    it("should create all tools by default", () => {
      const tools = createFilesystemTools({ backend });

      expect(tools.read).toBeDefined();
      expect(tools.write).toBeDefined();
      expect(tools.edit).toBeDefined();
      expect(tools.glob).toBeDefined();
      expect(tools.grep).toBeDefined();
    });

    it("should exclude write tool when includeWrite is false", () => {
      const tools = createFilesystemTools({
        backend,
        includeWrite: false,
      });

      expect(tools.read).toBeDefined();
      expect(tools.write).toBeUndefined();
      expect(tools.edit).toBeDefined();
      expect(tools.glob).toBeDefined();
      expect(tools.grep).toBeDefined();
    });

    it("should exclude edit tool when includeEdit is false", () => {
      const tools = createFilesystemTools({
        backend,
        includeEdit: false,
      });

      expect(tools.read).toBeDefined();
      expect(tools.write).toBeDefined();
      expect(tools.edit).toBeUndefined();
      expect(tools.glob).toBeDefined();
      expect(tools.grep).toBeDefined();
    });

    it("should create read-only tools", () => {
      const tools = createFilesystemTools({
        backend,
        includeWrite: false,
        includeEdit: false,
      });

      expect(tools.read).toBeDefined();
      expect(tools.write).toBeUndefined();
      expect(tools.edit).toBeUndefined();
      expect(tools.glob).toBeDefined();
      expect(tools.grep).toBeDefined();
    });

    it("should work with all tools together", async () => {
      const tools = createFilesystemTools({ backend });

      // Read file
      const readResult = await tools.read.execute(
        {
          file_path: "/src/index.ts",
        },
        {} as any,
      );
      expect(readResult).toContain("hello");

      // Write file
      const writeResult = await tools.write!.execute(
        {
          file_path: "/new.ts",
          content: "export const x = 1;",
        },
        {} as any,
      );
      expect(writeResult).toContain("Successfully wrote");

      // Edit file
      const editResult = await tools.edit!.execute(
        {
          file_path: "/new.ts",
          old_string: "1",
          new_string: "2",
        },
        {} as any,
      );
      expect(editResult).toContain("Successfully edited");

      // Glob
      const globResult = await tools.glob.execute({ pattern: "**/*.ts" }, {} as any);
      expect(globResult).toContain("new.ts");

      // Grep
      const grepResult = await tools.grep.execute({ pattern: "export" }, {} as any);
      expect(grepResult).toContain("new.ts");
    });
  });

  describe("Tool schemas", () => {
    it("read tool should have correct input schema", () => {
      const read = createReadTool(backend);
      expect((read as any).inputSchema || (read as any).parameters).toBeDefined();
    });

    it("write tool should have correct input schema", () => {
      const write = createWriteTool(backend);
      expect((write as any).inputSchema || (write as any).parameters).toBeDefined();
    });

    it("edit tool should have correct input schema", () => {
      const edit = createEditTool(backend);
      expect((edit as any).inputSchema || (edit as any).parameters).toBeDefined();
    });

    it("glob tool should have correct input schema", () => {
      const glob = createGlobTool(backend);
      expect((glob as any).inputSchema || (glob as any).parameters).toBeDefined();
    });

    it("grep tool should have correct input schema", () => {
      const grep = createGrepTool(backend);
      expect((grep as any).inputSchema || (grep as any).parameters).toBeDefined();
    });
  });

  describe("Tool descriptions", () => {
    it("all tools should have descriptions", () => {
      const tools = createFilesystemTools({ backend });

      expect(tools.read.description).toBeDefined();
      expect(tools.write!.description).toBeDefined();
      expect(tools.edit!.description).toBeDefined();
      expect(tools.glob.description).toBeDefined();
      expect(tools.grep.description).toBeDefined();
    });
  });
});
