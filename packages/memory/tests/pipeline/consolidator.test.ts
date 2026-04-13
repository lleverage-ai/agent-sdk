import { beforeEach, describe, expect, it } from "vitest";
import { serialiseFrontmatter } from "../../src/frontmatter.js";
import { createMemoryPath } from "../../src/path.js";
import { createConsolidator } from "../../src/pipeline/consolidator.js";
import { createInMemoryStore } from "../../src/store/in-memory.js";
import type { MemoryStore } from "../../src/store/types.js";
import type { MemoryFrontmatter } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeFrontmatter(overrides: Partial<MemoryFrontmatter> = {}): MemoryFrontmatter {
  return {
    name: "Test Memory",
    description: "A test memory",
    type: "user",
    scope: "global",
    tags: [],
    confidence: "high",
    source: "manual",
    created: "2026-04-01T00:00:00Z",
    modified: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

async function seedMemory(
  store: MemoryStore,
  path: string,
  frontmatter: MemoryFrontmatter,
  content: string,
): Promise<void> {
  const markdown = serialiseFrontmatter(frontmatter, content);
  await store.write(createMemoryPath(path), encoder.encode(markdown));
}

async function readFile(store: MemoryStore, path: string): Promise<string | null> {
  const data = await store.read(createMemoryPath(path));
  return data !== null ? decoder.decode(data) : null;
}

/**
 * The in-memory store treats paths as flat map keys, so `exists("memory/global")`
 * returns false unless there is an entry at that exact key. Write a zero-byte
 * marker at each directory path so discoverScopes() finds the scope.
 */
async function markDirectory(store: MemoryStore, dir: string): Promise<void> {
  await store.write(createMemoryPath(dir), encoder.encode(""));
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

// ---------------------------------------------------------------------------
// consolidate()
// ---------------------------------------------------------------------------

describe("consolidate()", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = createInMemoryStore();
  });

  it("rebuilds MEMORY.md index", async () => {
    await markDirectory(store, "memory/global");

    await seedMemory(
      store,
      "memory/global/user_preferences.md",
      makeFrontmatter({
        name: "User preferences",
        description: "General preferences",
      }),
      "The user prefers dark mode.",
    );

    await seedMemory(
      store,
      "memory/global/feedback_no-comments.md",
      makeFrontmatter({
        name: "No unnecessary comments",
        description: "Avoid excessive comments",
        type: "feedback",
      }),
      "Do not add unnecessary comments to code.",
    );

    const consolidator = createConsolidator();
    const report = await consolidator.consolidate(store);

    expect(report.indexRebuilt).toBe(true);

    const indexContent = await readFile(store, "memory/global/MEMORY.md");
    expect(indexContent).not.toBeNull();
    expect(indexContent).toContain("User preferences");
    expect(indexContent).toContain("No unnecessary comments");
  });

  it("detects stale memories", async () => {
    await markDirectory(store, "memory/global");

    const staleDate = daysAgo(120);
    const freshDate = daysAgo(10);

    await seedMemory(
      store,
      "memory/global/user_old-preference.md",
      makeFrontmatter({
        name: "Old preference",
        description: "An outdated preference",
        created: staleDate,
        modified: staleDate,
      }),
      "This is an old memory that should be flagged as stale.",
    );

    await seedMemory(
      store,
      "memory/global/user_recent.md",
      makeFrontmatter({
        name: "Recent memory",
        description: "A fresh memory",
        created: freshDate,
        modified: freshDate,
      }),
      "This is a recent memory.",
    );

    const consolidator = createConsolidator();
    const report = await consolidator.consolidate(store);

    expect(report.staleMemories).toHaveLength(1);
    expect(report.staleMemories[0]).toContain("old-preference");
  });

  it("reports stale memory paths", async () => {
    await markDirectory(store, "memory/global");

    const staleDate1 = daysAgo(100);
    const staleDate2 = daysAgo(200);
    const freshDate = daysAgo(5);

    await seedMemory(
      store,
      "memory/global/user_stale-one.md",
      makeFrontmatter({
        name: "Stale one",
        description: "First stale memory",
        created: staleDate1,
        modified: staleDate1,
      }),
      "First stale.",
    );

    await seedMemory(
      store,
      "memory/global/user_stale-two.md",
      makeFrontmatter({
        name: "Stale two",
        description: "Second stale memory",
        created: staleDate2,
        modified: staleDate2,
      }),
      "Second stale.",
    );

    await seedMemory(
      store,
      "memory/global/user_fresh.md",
      makeFrontmatter({
        name: "Fresh memory",
        description: "Not stale",
        created: freshDate,
        modified: freshDate,
      }),
      "Still relevant.",
    );

    const consolidator = createConsolidator();
    const report = await consolidator.consolidate(store);

    expect(report.staleMemories).toHaveLength(2);
    expect(report.staleMemories).toEqual(
      expect.arrayContaining([
        expect.stringContaining("stale-one"),
        expect.stringContaining("stale-two"),
      ]),
    );
  });

  it("returns a ConsolidationReport with all fields", async () => {
    await markDirectory(store, "memory/global");

    await seedMemory(
      store,
      "memory/global/user_test.md",
      makeFrontmatter({
        name: "Test",
        description: "A test memory",
      }),
      "Test content.",
    );

    const consolidator = createConsolidator();
    const report = await consolidator.consolidate(store);

    expect(report).toHaveProperty("indexRebuilt");
    expect(report).toHaveProperty("staleMemories");
    expect(report).toHaveProperty("duplicatesResolved");
    expect(report).toHaveProperty("heuristicsReinforced");
    expect(report).toHaveProperty("promotedToKnowledge");

    expect(typeof report.indexRebuilt).toBe("boolean");
    expect(Array.isArray(report.staleMemories)).toBe(true);
    expect(typeof report.duplicatesResolved).toBe("number");
    expect(typeof report.heuristicsReinforced).toBe("number");
    expect(typeof report.promotedToKnowledge).toBe("number");
  });

  it("respects custom staleness threshold", async () => {
    await markDirectory(store, "memory/global");

    const borderlineDate = daysAgo(45);

    await seedMemory(
      store,
      "memory/global/user_borderline.md",
      makeFrontmatter({
        name: "Borderline memory",
        description: "On the edge of staleness",
        created: borderlineDate,
        modified: borderlineDate,
      }),
      "Might be stale depending on threshold.",
    );

    const consolidator = createConsolidator();

    // With default 90-day threshold, this should not be stale
    const report90 = await consolidator.consolidate(store);
    expect(report90.staleMemories).toHaveLength(0);

    // With 30-day threshold, this should be stale
    const report30 = await consolidator.consolidate(store, {
      stalenessThresholdDays: 30,
    });
    expect(report30.staleMemories).toHaveLength(1);
    expect(report30.staleMemories[0]).toContain("borderline");
  });

  it("handles empty store gracefully", async () => {
    const consolidator = createConsolidator();
    const report = await consolidator.consolidate(store);

    expect(report.indexRebuilt).toBe(false);
    expect(report.staleMemories).toEqual([]);
    expect(report.duplicatesResolved).toBe(0);
    expect(report.heuristicsReinforced).toBe(0);
    expect(report.promotedToKnowledge).toBe(0);
  });

  it("discovers and consolidates across multiple scopes", async () => {
    await markDirectory(store, "memory/global");
    await markDirectory(store, "memory/project");
    await markDirectory(store, "memory/project/my-app");

    await seedMemory(
      store,
      "memory/global/user_global.md",
      makeFrontmatter({
        name: "Global memory",
        description: "A global memory",
        scope: "global",
      }),
      "Global content.",
    );

    await seedMemory(
      store,
      "memory/project/my-app/project_config.md",
      makeFrontmatter({
        name: "Project config",
        description: "Project-specific config",
        type: "project",
        scope: "project",
      }),
      "Project config content.",
    );

    const consolidator = createConsolidator();
    const report = await consolidator.consolidate(store);

    expect(report.indexRebuilt).toBe(true);

    // Both scopes should have their indices rebuilt
    const globalIndex = await readFile(store, "memory/global/MEMORY.md");
    const projectIndex = await readFile(store, "memory/project/my-app/MEMORY.md");

    expect(globalIndex).not.toBeNull();
    expect(globalIndex).toContain("Global memory");
    expect(projectIndex).not.toBeNull();
    expect(projectIndex).toContain("Project config");
  });
});
