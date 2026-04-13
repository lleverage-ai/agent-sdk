import { describe, expect, it } from "vitest";
import { globToRegex } from "../../src/store/glob.js";

describe("globToRegex", () => {
  describe("single star (*)", () => {
    it("matches any non-slash characters", () => {
      const re = globToRegex("*.md");
      expect(re.test("file.md")).toBe(true);
      expect(re.test("another-file.md")).toBe(true);
      expect(re.test(".md")).toBe(true);
    });

    it("does not match paths with slashes", () => {
      const re = globToRegex("*.md");
      expect(re.test("dir/file.md")).toBe(false);
    });

    it("matches in the middle of a pattern", () => {
      const re = globToRegex("user_*.md");
      expect(re.test("user_alex.md")).toBe(true);
      expect(re.test("user_.md")).toBe(true);
      expect(re.test("feedback_alex.md")).toBe(false);
    });
  });

  describe("double star (**)", () => {
    it("matches any characters including slashes", () => {
      const re = globToRegex("**/*.md");
      expect(re.test("file.md")).toBe(true);
      expect(re.test("dir/file.md")).toBe(true);
      expect(re.test("deep/nested/dir/file.md")).toBe(true);
    });

    it("matches at the end of a pattern", () => {
      const re = globToRegex("src/**");
      expect(re.test("src/file.ts")).toBe(true);
      expect(re.test("src/deep/file.ts")).toBe(true);
    });
  });

  describe("question mark (?)", () => {
    it("matches a single non-slash character", () => {
      const re = globToRegex("file?.md");
      expect(re.test("file1.md")).toBe(true);
      expect(re.test("fileA.md")).toBe(true);
    });

    it("does not match slash", () => {
      const re = globToRegex("file?md");
      expect(re.test("file/md")).toBe(false);
    });

    it("does not match empty", () => {
      const re = globToRegex("file?.md");
      expect(re.test("file.md")).toBe(false);
    });
  });

  describe("literal matching", () => {
    it("matches exact filenames", () => {
      const re = globToRegex("MEMORY.md");
      expect(re.test("MEMORY.md")).toBe(true);
      expect(re.test("memory.md")).toBe(false);
    });

    it("escapes regex special characters", () => {
      const re = globToRegex("file[0].md");
      expect(re.test("file[0].md")).toBe(true);
      expect(re.test("file0.md")).toBe(false);
    });

    it("escapes dots", () => {
      const re = globToRegex("file.test.md");
      expect(re.test("file.test.md")).toBe(true);
      expect(re.test("fileXtestXmd")).toBe(false);
    });
  });

  describe("anchoring", () => {
    it("matches the full string, not a substring", () => {
      const re = globToRegex("*.md");
      expect(re.test("file.md.bak")).toBe(false);
      expect(re.test("prefix-file.md")).toBe(true);
    });
  });
});
