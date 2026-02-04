import { describe, expect, it } from "vitest";
import {
  type BackendProtocol,
  type EditResult,
  type ExecuteResponse,
  type FileData,
  type FileInfo,
  type GrepMatch,
  isBackend,
  isSandboxBackend,
  type SandboxBackendProtocol,
  type WriteResult,
} from "../src/backend.js";

describe("Backend Type Guards", () => {
  describe("isBackend", () => {
    it("returns false for null", () => {
      expect(isBackend(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isBackend(undefined)).toBe(false);
    });

    it("returns false for primitives", () => {
      expect(isBackend(42)).toBe(false);
      expect(isBackend("string")).toBe(false);
      expect(isBackend(true)).toBe(false);
    });

    it("returns false for empty object", () => {
      expect(isBackend({})).toBe(false);
    });

    it("returns false for object with partial methods", () => {
      expect(
        isBackend({
          lsInfo: () => [],
          read: () => "",
          // Missing other methods
        }),
      ).toBe(false);
    });

    it("returns true for object with all BackendProtocol methods", () => {
      const mockBackend: BackendProtocol = {
        lsInfo: () => [],
        read: () => "",
        readRaw: () => ({ content: [], created_at: "", modified_at: "" }),
        grepRaw: () => [],
        globInfo: () => [],
        write: () => ({ success: true }),
        edit: () => ({ success: true }),
      };

      expect(isBackend(mockBackend)).toBe(true);
    });

    it("returns true for async methods", () => {
      const asyncBackend: BackendProtocol = {
        lsInfo: async () => [],
        read: async () => "",
        readRaw: async () => ({ content: [], created_at: "", modified_at: "" }),
        grepRaw: async () => [],
        globInfo: async () => [],
        write: async () => ({ success: true }),
        edit: async () => ({ success: true }),
      };

      expect(isBackend(asyncBackend)).toBe(true);
    });
  });

  describe("isSandboxBackend", () => {
    it("returns false for non-backend objects", () => {
      expect(isSandboxBackend(null)).toBe(false);
      expect(isSandboxBackend({})).toBe(false);
    });

    it("returns false for basic BackendProtocol without sandbox methods", () => {
      const mockBackend: BackendProtocol = {
        lsInfo: () => [],
        read: () => "",
        readRaw: () => ({ content: [], created_at: "", modified_at: "" }),
        grepRaw: () => [],
        globInfo: () => [],
        write: () => ({ success: true }),
        edit: () => ({ success: true }),
      };

      expect(isSandboxBackend(mockBackend)).toBe(false);
    });

    it("returns true for object with all SandboxBackendProtocol properties", () => {
      const mockSandbox: SandboxBackendProtocol = {
        id: "sandbox-123",
        lsInfo: () => [],
        read: () => "",
        readRaw: () => ({ content: [], created_at: "", modified_at: "" }),
        grepRaw: () => [],
        globInfo: () => [],
        write: () => ({ success: true }),
        edit: () => ({ success: true }),
        execute: async () => ({ output: "", exitCode: 0, truncated: false }),
        uploadFiles: async () => [],
        downloadFiles: async () => [],
      };

      expect(isSandboxBackend(mockSandbox)).toBe(true);
    });

    it("returns false if id is not a string", () => {
      const invalidSandbox = {
        id: 123, // Should be string
        lsInfo: () => [],
        read: () => "",
        readRaw: () => ({ content: [], created_at: "", modified_at: "" }),
        grepRaw: () => [],
        globInfo: () => [],
        write: () => ({ success: true }),
        edit: () => ({ success: true }),
        execute: async () => ({ output: "", exitCode: 0, truncated: false }),
        uploadFiles: async () => [],
        downloadFiles: async () => [],
      };

      expect(isSandboxBackend(invalidSandbox)).toBe(false);
    });
  });
});

describe("Backend Types", () => {
  describe("FileInfo", () => {
    it("can represent a file", () => {
      const file: FileInfo = {
        path: "/src/index.ts",
        is_dir: false,
        size: 1024,
        modified_at: "2026-01-30T10:00:00Z",
      };

      expect(file.path).toBe("/src/index.ts");
      expect(file.is_dir).toBe(false);
      expect(file.size).toBe(1024);
    });

    it("can represent a directory", () => {
      const dir: FileInfo = {
        path: "/src",
        is_dir: true,
      };

      expect(dir.path).toBe("/src");
      expect(dir.is_dir).toBe(true);
      expect(dir.size).toBeUndefined();
    });

    it("allows minimal info", () => {
      const minimal: FileInfo = {
        path: "/file.txt",
      };

      expect(minimal.path).toBe("/file.txt");
    });
  });

  describe("FileData", () => {
    it("stores content as lines with timestamps", () => {
      const data: FileData = {
        content: ["line 1", "line 2", "line 3"],
        created_at: "2026-01-29T00:00:00Z",
        modified_at: "2026-01-30T10:00:00Z",
      };

      expect(data.content).toHaveLength(3);
      expect(data.content[0]).toBe("line 1");
      expect(data.created_at).toBe("2026-01-29T00:00:00Z");
    });
  });

  describe("GrepMatch", () => {
    it("stores match information", () => {
      const match: GrepMatch = {
        path: "/src/index.ts",
        line: 42,
        text: "export function main() {",
      };

      expect(match.path).toBe("/src/index.ts");
      expect(match.line).toBe(42);
      expect(match.text).toBe("export function main() {");
    });
  });

  describe("WriteResult", () => {
    it("can represent success", () => {
      const result: WriteResult = {
        success: true,
        path: "/src/new-file.ts",
      };

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("can represent failure", () => {
      const result: WriteResult = {
        success: false,
        error: "Permission denied",
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe("Permission denied");
    });
  });

  describe("EditResult", () => {
    it("can represent success with occurrence count", () => {
      const result: EditResult = {
        success: true,
        path: "/src/config.ts",
        occurrences: 3,
      };

      expect(result.success).toBe(true);
      expect(result.occurrences).toBe(3);
    });

    it("can represent failure due to non-unique match", () => {
      const result: EditResult = {
        success: false,
        error: "Multiple occurrences found. Use replace_all=true to replace all.",
      };

      expect(result.success).toBe(false);
      expect(result.error).toContain("Multiple occurrences");
    });
  });

  describe("ExecuteResponse", () => {
    it("stores command output", () => {
      const response: ExecuteResponse = {
        output: "Hello, World!\n",
        exitCode: 0,
        truncated: false,
      };

      expect(response.output).toBe("Hello, World!\n");
      expect(response.exitCode).toBe(0);
      expect(response.truncated).toBe(false);
    });

    it("handles truncated output", () => {
      const response: ExecuteResponse = {
        output: "...[truncated]",
        exitCode: 0,
        truncated: true,
      };

      expect(response.truncated).toBe(true);
    });

    it("handles null exit code for terminated processes", () => {
      const response: ExecuteResponse = {
        output: "",
        exitCode: null,
        truncated: false,
      };

      expect(response.exitCode).toBeNull();
    });
  });
});
