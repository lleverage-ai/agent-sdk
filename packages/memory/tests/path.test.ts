import { describe, expect, it } from "vitest";
import { basename, createMemoryPath, isValidPath, joinPaths, parentPath } from "../src/path.js";
import { InvalidPathError } from "../src/store/types.js";

describe("createMemoryPath", () => {
  it("accepts a nested path", () => {
    expect(createMemoryPath("memory/global/topic.md")).toBe("memory/global/topic.md");
  });

  it("accepts a root-level filename", () => {
    expect(createMemoryPath("MEMORY.md")).toBe("MEMORY.md");
  });

  it("accepts a deeply nested path", () => {
    expect(createMemoryPath("a/b/c.md")).toBe("a/b/c.md");
  });

  it("trims whitespace before validating", () => {
    expect(createMemoryPath("  a/b.md  ")).toBe("a/b.md");
  });

  it("throws on an empty string", () => {
    expect(() => createMemoryPath("")).toThrow(InvalidPathError);
  });

  it("throws on a leading slash", () => {
    expect(() => createMemoryPath("/foo/bar.md")).toThrow(InvalidPathError);
  });

  it("throws on a '..' segment", () => {
    expect(() => createMemoryPath("foo/../bar.md")).toThrow(InvalidPathError);
  });

  it("throws on backslashes", () => {
    expect(() => createMemoryPath("foo\\bar.md")).toThrow(InvalidPathError);
  });

  it("throws on double slashes", () => {
    expect(() => createMemoryPath("foo//bar.md")).toThrow(InvalidPathError);
  });

  it("throws on a dot-prefixed path", () => {
    expect(() => createMemoryPath(".hidden/file.md")).toThrow(InvalidPathError);
  });

  it("throws on a trailing slash", () => {
    expect(() => createMemoryPath("foo/bar/")).toThrow(InvalidPathError);
  });
});

describe("isValidPath", () => {
  it("returns true for a valid path", () => {
    expect(isValidPath("memory/global/topic.md")).toBe(true);
  });

  it("returns true for a root-level filename", () => {
    expect(isValidPath("MEMORY.md")).toBe(true);
  });

  it("returns false for an empty string", () => {
    expect(isValidPath("")).toBe(false);
  });

  it("returns false for a path with '..'", () => {
    expect(isValidPath("a/../b.md")).toBe(false);
  });

  it("returns false for a dot-prefixed path", () => {
    expect(isValidPath(".secret")).toBe(false);
  });
});

describe("joinPaths", () => {
  it("joins two segments", () => {
    expect(joinPaths("memory", "global")).toBe("memory/global");
  });

  it("joins three segments", () => {
    expect(joinPaths("memory", "global", "topic.md")).toBe("memory/global/topic.md");
  });

  it("trims whitespace from segments", () => {
    expect(joinPaths("  memory ", " global ")).toBe("memory/global");
  });

  it("filters out empty segments", () => {
    expect(joinPaths("memory", "", "global")).toBe("memory/global");
  });

  it("throws when the result would be invalid", () => {
    expect(() => joinPaths(".hidden", "file.md")).toThrow(InvalidPathError);
  });
});

describe("parentPath", () => {
  it("returns the parent directory", () => {
    const path = createMemoryPath("memory/global/topic.md");
    expect(parentPath(path)).toBe("memory/global");
  });

  it("returns the grandparent for a two-segment path", () => {
    const path = createMemoryPath("memory/global");
    expect(parentPath(path)).toBe("memory");
  });

  it("returns null for a root-level path", () => {
    const path = createMemoryPath("MEMORY.md");
    expect(parentPath(path)).toBeNull();
  });
});

describe("basename", () => {
  it("returns the filename from a nested path", () => {
    const path = createMemoryPath("memory/global/topic.md");
    expect(basename(path)).toBe("topic.md");
  });

  it("returns the path itself when there is no slash", () => {
    const path = createMemoryPath("MEMORY.md");
    expect(basename(path)).toBe("MEMORY.md");
  });

  it("returns the last segment of a deep path", () => {
    const path = createMemoryPath("a/b/c/d.md");
    expect(basename(path)).toBe("d.md");
  });
});
