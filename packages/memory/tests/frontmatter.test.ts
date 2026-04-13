import { describe, expect, it } from "vitest";
import { parseFrontmatter, parseMemoryFile, serialiseFrontmatter } from "../src/frontmatter.js";
import type { MemoryFrontmatter } from "../src/types.js";

const FULL_FRONTMATTER: MemoryFrontmatter = {
  name: "Test Memory",
  description: "A test memory entry",
  type: "user",
  scope: "global",
  tags: ["testing", "unit"],
  confidence: "high",
  source: "manual",
  created: "2026-04-13T00:00:00Z",
  modified: "2026-04-13T00:00:00Z",
};

function buildRaw(fields: Record<string, unknown>, body = "Some content here."): string {
  const lines = Object.entries(fields).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map((v) => `  - ${v}`).join("\n")}`;
    }
    return `${key}: ${value}`;
  });
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

const ALL_FIELDS = {
  name: "Test Memory",
  description: "A test memory entry",
  type: "user",
  scope: "global",
  tags: ["testing", "unit"],
  confidence: "high",
  source: "manual",
  created: "2026-04-13T00:00:00Z",
  modified: "2026-04-13T00:00:00Z",
};

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with all fields", () => {
    const raw = buildRaw(ALL_FIELDS);
    const result = parseFrontmatter(raw);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe("Test Memory");
    expect(result!.frontmatter.description).toBe("A test memory entry");
    expect(result!.frontmatter.type).toBe("user");
    expect(result!.frontmatter.scope).toBe("global");
    expect(result!.frontmatter.tags).toEqual(["testing", "unit"]);
    expect(result!.frontmatter.confidence).toBe("high");
    expect(result!.frontmatter.source).toBe("manual");
    expect(result!.frontmatter.created).toBe("2026-04-13T00:00:00Z");
    expect(result!.frontmatter.modified).toBe("2026-04-13T00:00:00Z");
    expect(result!.content).toBe("Some content here.");
  });

  it("defaults scope to global when missing", () => {
    const { scope: _, ...withoutScope } = ALL_FIELDS;
    const raw = buildRaw(withoutScope);
    const result = parseFrontmatter(raw);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.scope).toBe("global");
  });

  it("defaults confidence to medium when missing", () => {
    const { confidence: _, ...withoutConfidence } = ALL_FIELDS;
    const raw = buildRaw(withoutConfidence);
    const result = parseFrontmatter(raw);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.confidence).toBe("medium");
  });

  it("defaults source to manual when missing", () => {
    const { source: _, ...withoutSource } = ALL_FIELDS;
    const raw = buildRaw(withoutSource);
    const result = parseFrontmatter(raw);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.source).toBe("manual");
  });

  it("defaults tags to empty array when missing", () => {
    const { tags: _, ...withoutTags } = ALL_FIELDS;
    const raw = buildRaw(withoutTags);
    const result = parseFrontmatter(raw);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.tags).toEqual([]);
  });

  it("returns null when there are no frontmatter markers", () => {
    const raw = "Just some plain text content.";
    expect(parseFrontmatter(raw)).toBeNull();
  });

  it("returns null when the closing delimiter is missing", () => {
    const raw = "---\nname: Test\ndescription: Missing close\n";
    expect(parseFrontmatter(raw)).toBeNull();
  });

  it("returns null when name is missing", () => {
    const { name: _, ...withoutName } = ALL_FIELDS;
    const raw = buildRaw(withoutName);
    expect(parseFrontmatter(raw)).toBeNull();
  });

  it("returns null when description is missing", () => {
    const { description: _, ...withoutDesc } = ALL_FIELDS;
    const raw = buildRaw(withoutDesc);
    expect(parseFrontmatter(raw)).toBeNull();
  });

  it("returns null when type is missing", () => {
    const { type: _, ...withoutType } = ALL_FIELDS;
    const raw = buildRaw(withoutType);
    expect(parseFrontmatter(raw)).toBeNull();
  });

  it("returns null when created is missing", () => {
    const { created: _, ...withoutCreated } = ALL_FIELDS;
    const raw = buildRaw(withoutCreated);
    expect(parseFrontmatter(raw)).toBeNull();
  });

  it("returns null when modified is missing", () => {
    const { modified: _, ...withoutModified } = ALL_FIELDS;
    const raw = buildRaw(withoutModified);
    expect(parseFrontmatter(raw)).toBeNull();
  });

  it("returns null for an invalid type value", () => {
    const raw = buildRaw({ ...ALL_FIELDS, type: "invalid" });
    expect(parseFrontmatter(raw)).toBeNull();
  });

  it("parses supersedes when present", () => {
    const raw = buildRaw({ ...ALL_FIELDS, supersedes: "old-memory.md" });
    const result = parseFrontmatter(raw);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.supersedes).toBe("old-memory.md");
  });
});

describe("serialiseFrontmatter", () => {
  it("produces a string that starts and ends correctly", () => {
    const output = serialiseFrontmatter(FULL_FRONTMATTER, "Body text.");

    expect(output.startsWith("---\n")).toBe(true);
    expect(output).toContain("\n---\n");
    expect(output.trimEnd().endsWith("Body text.")).toBe(true);
  });

  it("includes all frontmatter fields", () => {
    const output = serialiseFrontmatter(FULL_FRONTMATTER, "Body.");

    expect(output).toContain("name: Test Memory");
    expect(output).toContain("description: A test memory entry");
    expect(output).toContain("type: user");
    expect(output).toContain("scope: global");
    expect(output).toContain("confidence: high");
    expect(output).toContain("source: manual");
  });

  it("includes supersedes when set", () => {
    const fm: MemoryFrontmatter = { ...FULL_FRONTMATTER, supersedes: "old.md" };
    const output = serialiseFrontmatter(fm, "Body.");

    expect(output).toContain("supersedes: old.md");
  });
});

describe("serialiseFrontmatter round-trip", () => {
  it("produces equivalent frontmatter after serialise then parse", () => {
    const serialised = serialiseFrontmatter(FULL_FRONTMATTER, "Round trip body.");
    const result = parseFrontmatter(serialised);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe(FULL_FRONTMATTER.name);
    expect(result!.frontmatter.description).toBe(FULL_FRONTMATTER.description);
    expect(result!.frontmatter.type).toBe(FULL_FRONTMATTER.type);
    expect(result!.frontmatter.scope).toBe(FULL_FRONTMATTER.scope);
    expect(result!.frontmatter.tags).toEqual(FULL_FRONTMATTER.tags);
    expect(result!.frontmatter.confidence).toBe(FULL_FRONTMATTER.confidence);
    expect(result!.frontmatter.source).toBe(FULL_FRONTMATTER.source);
    expect(result!.frontmatter.created).toBe(FULL_FRONTMATTER.created);
    expect(result!.frontmatter.modified).toBe(FULL_FRONTMATTER.modified);
    expect(result!.content).toBe("Round trip body.");
  });

  it("round-trips with supersedes", () => {
    const fm: MemoryFrontmatter = { ...FULL_FRONTMATTER, supersedes: "legacy.md" };
    const serialised = serialiseFrontmatter(fm, "Content.");
    const result = parseFrontmatter(serialised);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.supersedes).toBe("legacy.md");
  });
});

describe("parseMemoryFile", () => {
  it("generates the correct indexEntry", () => {
    const raw = serialiseFrontmatter(FULL_FRONTMATTER, "Some body text.");
    const entry = parseMemoryFile("memory/global/test-memory.md", raw);

    expect(entry).not.toBeNull();
    expect(entry!.indexEntry).toBe("- [Test Memory](test-memory.md) - A test memory entry");
  });

  it("uses the filename from the last path segment", () => {
    const raw = serialiseFrontmatter(FULL_FRONTMATTER, "Body.");
    const entry = parseMemoryFile("a/b/c/deep-file.md", raw);

    expect(entry).not.toBeNull();
    expect(entry!.indexEntry).toContain("(deep-file.md)");
  });

  it("returns the parsed content", () => {
    const raw = serialiseFrontmatter(FULL_FRONTMATTER, "My content.");
    const entry = parseMemoryFile("memory/global/test.md", raw);

    expect(entry).not.toBeNull();
    expect(entry!.content).toBe("My content.");
  });

  it("sets the path on the entry", () => {
    const raw = serialiseFrontmatter(FULL_FRONTMATTER, "Body.");
    const entry = parseMemoryFile("memory/global/test.md", raw);

    expect(entry).not.toBeNull();
    expect(entry!.path).toBe("memory/global/test.md");
  });

  it("returns null for content without frontmatter", () => {
    expect(parseMemoryFile("test.md", "Just plain text.")).toBeNull();
  });
});
