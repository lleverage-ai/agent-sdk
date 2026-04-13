import { beforeEach, describe, expect, it } from "vitest";
import { serialiseFrontmatter } from "../src/frontmatter.js";
import { MemoryIndex } from "../src/memory-index.js";
import { createMemoryPath } from "../src/path.js";
import { createInMemoryStore } from "../src/store/in-memory.js";
import type { MemoryStore } from "../src/store/types.js";
import type { MemoryFrontmatter } from "../src/types.js";
import { extractWikilinks } from "../src/wikilink.js";

// ---------------------------------------------------------------------------
// extractWikilinks
// ---------------------------------------------------------------------------

describe("extractWikilinks", () => {
  it("extracts a simple [[topic]] reference", () => {
    const refs = extractWikilinks("See [[coding standards]] for details.");

    expect(refs).toHaveLength(1);
    expect(refs[0]!.raw).toBe("[[coding standards]]");
    expect(refs[0]!.topic).toBe("coding-standards");
    expect(refs[0]!.forceGlobal).toBe(false);
    expect(refs[0]!.displayText).toBeUndefined();
  });

  it("extracts a [[global:topic]] reference with forceGlobal", () => {
    const refs = extractWikilinks("Check [[global:preferences]].");

    expect(refs).toHaveLength(1);
    expect(refs[0]!.topic).toBe("preferences");
    expect(refs[0]!.forceGlobal).toBe(true);
  });

  it("extracts [[topic|Display Text]] with display text", () => {
    const refs = extractWikilinks("See [[coding standards|Our Standards]].");

    expect(refs).toHaveLength(1);
    expect(refs[0]!.topic).toBe("coding-standards");
    expect(refs[0]!.displayText).toBe("Our Standards");
    expect(refs[0]!.forceGlobal).toBe(false);
  });

  it("handles multiple wikilinks in one string", () => {
    const refs = extractWikilinks("See [[topic one]] and [[topic two]] and [[global:shared]].");

    expect(refs).toHaveLength(3);
    expect(refs[0]!.topic).toBe("topic-one");
    expect(refs[1]!.topic).toBe("topic-two");
    expect(refs[2]!.topic).toBe("shared");
    expect(refs[2]!.forceGlobal).toBe(true);
  });

  it("returns empty for no wikilinks", () => {
    const refs = extractWikilinks("No links here at all.");
    expect(refs).toHaveLength(0);
  });

  it("skips wikilinks with empty topic after kebab-casing", () => {
    const refs = extractWikilinks("Empty [[!!!]].");
    expect(refs).toHaveLength(0);
  });

  it("handles global prefix with display text", () => {
    const refs = extractWikilinks("[[global:api keys|API Keys]]");

    expect(refs).toHaveLength(1);
    expect(refs[0]!.topic).toBe("api-keys");
    expect(refs[0]!.displayText).toBe("API Keys");
    expect(refs[0]!.forceGlobal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MemoryIndex
// ---------------------------------------------------------------------------

function makeFrontmatter(name: string, description: string): MemoryFrontmatter {
  return {
    name,
    description,
    type: "user",
    scope: "global",
    tags: [],
    confidence: "medium",
    source: "manual",
    created: "2026-04-13T00:00:00Z",
    modified: "2026-04-13T00:00:00Z",
  };
}

function encodeFile(fm: MemoryFrontmatter, body: string): Uint8Array {
  return new TextEncoder().encode(serialiseFrontmatter(fm, body));
}

describe("MemoryIndex", () => {
  let store: MemoryStore;
  let index: MemoryIndex;

  beforeEach(() => {
    store = createInMemoryStore();
    index = new MemoryIndex(store);
  });

  describe("rebuild", () => {
    it("generates a correct MEMORY.md from memory files", async () => {
      const fmAlpha = makeFrontmatter("Alpha", "First entry");
      const fmBeta = makeFrontmatter("Beta", "Second entry");

      await store.write(
        createMemoryPath("memory/global/alpha.md"),
        encodeFile(fmAlpha, "Alpha content."),
      );
      await store.write(
        createMemoryPath("memory/global/beta.md"),
        encodeFile(fmBeta, "Beta content."),
      );

      await index.rebuild("global");

      const data = await store.read(createMemoryPath("memory/global/MEMORY.md"));
      expect(data).not.toBeNull();

      const text = new TextDecoder().decode(data!);
      expect(text).toContain("- [Alpha](alpha.md) - First entry");
      expect(text).toContain("- [Beta](beta.md) - Second entry");
    });

    it("sorts entries alphabetically by name", async () => {
      await store.write(
        createMemoryPath("memory/global/zebra.md"),
        encodeFile(makeFrontmatter("Zebra", "Last"), "Z."),
      );
      await store.write(
        createMemoryPath("memory/global/aardvark.md"),
        encodeFile(makeFrontmatter("Aardvark", "First"), "A."),
      );

      await index.rebuild("global");

      const data = await store.read(createMemoryPath("memory/global/MEMORY.md"));
      const text = new TextDecoder().decode(data!);
      const lines = text.split("\n").filter((l) => l.startsWith("- "));

      expect(lines[0]).toContain("Aardvark");
      expect(lines[1]).toContain("Zebra");
    });

    it("skips files without valid frontmatter", async () => {
      await store.write(
        createMemoryPath("memory/global/valid.md"),
        encodeFile(makeFrontmatter("Valid", "Has frontmatter"), "Content."),
      );
      await store.write(
        createMemoryPath("memory/global/invalid.md"),
        new TextEncoder().encode("No frontmatter here."),
      );

      await index.rebuild("global");

      const data = await store.read(createMemoryPath("memory/global/MEMORY.md"));
      const text = new TextDecoder().decode(data!);

      expect(text).toContain("Valid");
      expect(text).not.toContain("invalid.md");
    });
  });

  describe("upsert", () => {
    it("adds a new entry to the index", async () => {
      await index.upsert({
        path: "memory/global/new-topic.md",
        frontmatter: makeFrontmatter("New Topic", "A fresh entry"),
        content: "Body.",
        indexEntry: "- [New Topic](new-topic.md) - A fresh entry",
      });

      const items = await index.load("global");
      expect(items).toHaveLength(1);
      expect(items[0]!.name).toBe("New Topic");
      expect(items[0]!.filename).toBe("new-topic.md");
      expect(items[0]!.description).toBe("A fresh entry");
    });

    it("updates an existing entry with the same filename", async () => {
      await index.upsert({
        path: "memory/global/topic.md",
        frontmatter: makeFrontmatter("Topic v1", "Original"),
        content: "V1.",
        indexEntry: "- [Topic v1](topic.md) - Original",
      });

      await index.upsert({
        path: "memory/global/topic.md",
        frontmatter: makeFrontmatter("Topic v2", "Updated"),
        content: "V2.",
        indexEntry: "- [Topic v2](topic.md) - Updated",
      });

      const items = await index.load("global");
      expect(items).toHaveLength(1);
      expect(items[0]!.name).toBe("Topic v2");
      expect(items[0]!.description).toBe("Updated");
    });

    it("maintains alphabetical sort after upsert", async () => {
      await index.upsert({
        path: "memory/global/charlie.md",
        frontmatter: makeFrontmatter("Charlie", "Third"),
        content: "C.",
        indexEntry: "- [Charlie](charlie.md) - Third",
      });

      await index.upsert({
        path: "memory/global/alice.md",
        frontmatter: makeFrontmatter("Alice", "First"),
        content: "A.",
        indexEntry: "- [Alice](alice.md) - First",
      });

      const items = await index.load("global");
      expect(items[0]!.name).toBe("Alice");
      expect(items[1]!.name).toBe("Charlie");
    });
  });

  describe("remove", () => {
    it("removes an entry from the index", async () => {
      await index.upsert({
        path: "memory/global/to-remove.md",
        frontmatter: makeFrontmatter("To Remove", "Will be removed"),
        content: "Bye.",
        indexEntry: "- [To Remove](to-remove.md) - Will be removed",
      });

      const before = await index.load("global");
      expect(before).toHaveLength(1);

      await index.remove("memory/global/to-remove.md");

      const after = await index.load("global");
      expect(after).toHaveLength(0);
    });

    it("does nothing when the entry does not exist", async () => {
      await index.upsert({
        path: "memory/global/keep.md",
        frontmatter: makeFrontmatter("Keep", "Stays"),
        content: "K.",
        indexEntry: "- [Keep](keep.md) - Stays",
      });

      await index.remove("memory/global/nonexistent.md");

      const items = await index.load("global");
      expect(items).toHaveLength(1);
      expect(items[0]!.name).toBe("Keep");
    });

    it("only removes the targeted entry", async () => {
      await index.upsert({
        path: "memory/global/alpha.md",
        frontmatter: makeFrontmatter("Alpha", "First"),
        content: "A.",
        indexEntry: "- [Alpha](alpha.md) - First",
      });

      await index.upsert({
        path: "memory/global/beta.md",
        frontmatter: makeFrontmatter("Beta", "Second"),
        content: "B.",
        indexEntry: "- [Beta](beta.md) - Second",
      });

      await index.remove("memory/global/alpha.md");

      const items = await index.load("global");
      expect(items).toHaveLength(1);
      expect(items[0]!.name).toBe("Beta");
    });
  });

  describe("load", () => {
    it("returns an empty array when no index exists", async () => {
      const items = await index.load("global");
      expect(items).toEqual([]);
    });

    it("parses index lines correctly", async () => {
      const indexContent = [
        "- [Alpha](alpha.md) - First entry",
        "- [Beta](beta.md) - Second entry",
        "",
      ].join("\n");

      await store.write(
        createMemoryPath("memory/global/MEMORY.md"),
        new TextEncoder().encode(indexContent),
      );

      const items = await index.load("global");
      expect(items).toHaveLength(2);
      expect(items[0]!.name).toBe("Alpha");
      expect(items[0]!.filename).toBe("alpha.md");
      expect(items[0]!.description).toBe("First entry");
      expect(items[1]!.name).toBe("Beta");
    });

    it("skips blank lines and malformed lines", async () => {
      const indexContent = [
        "- [Valid](valid.md) - A valid line",
        "",
        "This is not a valid index line",
        "- [Another](another.md) - Also valid",
      ].join("\n");

      await store.write(
        createMemoryPath("memory/global/MEMORY.md"),
        new TextEncoder().encode(indexContent),
      );

      const items = await index.load("global");
      expect(items).toHaveLength(2);
    });

    it("loads project-scoped index", async () => {
      const indexContent = "- [Proj](proj.md) - Project memory\n";

      await store.write(
        createMemoryPath("memory/project/my-app/MEMORY.md"),
        new TextEncoder().encode(indexContent),
      );

      const items = await index.load("project", "my-app");
      expect(items).toHaveLength(1);
      expect(items[0]!.name).toBe("Proj");
    });
  });
});
