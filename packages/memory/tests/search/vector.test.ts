import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryPath } from "../../src/path.js";
import type { VectorIndex } from "../../src/search/types.js";
import { createInMemoryVectorIndex } from "../../src/search/vector.js";
import type { MemoryPath } from "../../src/store/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mp(raw: string): MemoryPath {
  return createMemoryPath(raw);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createInMemoryVectorIndex", () => {
  let index: VectorIndex;

  beforeEach(() => {
    index = createInMemoryVectorIndex();
  });

  it("upsert and search returns results", async () => {
    await index.upsert(mp("memory/global/alpha.md"), [1, 0, 0], {
      title: "Alpha",
      description: "First entry",
    });
    await index.upsert(mp("memory/global/beta.md"), [0, 1, 0], {
      title: "Beta",
      description: "Second entry",
    });

    const results = await index.search([1, 0, 0]);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe("memory/global/alpha.md");
  });

  it("cosine similarity: identical vectors score 1.0", async () => {
    await index.upsert(mp("memory/global/same.md"), [0.6, 0.8, 0], {
      title: "Same",
      description: "Identical vector",
    });

    const results = await index.search([0.6, 0.8, 0]);
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBeCloseTo(1.0, 5);
  });

  it("cosine similarity: orthogonal vectors score ~0.0", async () => {
    await index.upsert(mp("memory/global/ortho.md"), [1, 0, 0], {
      title: "Orthogonal",
      description: "Perpendicular vector",
    });

    const results = await index.search([0, 1, 0], { minScore: -0.01 });
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBeCloseTo(0.0, 5);
  });

  it("similar vectors score higher than dissimilar", async () => {
    await index.upsert(mp("memory/global/similar.md"), [0.9, 0.1, 0], {
      title: "Similar",
      description: "Nearly aligned",
    });
    await index.upsert(mp("memory/global/different.md"), [0, 0, 1], {
      title: "Different",
      description: "Completely different direction",
    });

    const results = await index.search([1, 0, 0], { minScore: -1 });
    expect(results.length).toBe(2);
    expect(results[0]!.path).toBe("memory/global/similar.md");
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("respects limit option", async () => {
    await index.upsert(mp("memory/global/a.md"), [1, 0, 0], {
      title: "A",
      description: "Entry A",
    });
    await index.upsert(mp("memory/global/b.md"), [0.9, 0.1, 0], {
      title: "B",
      description: "Entry B",
    });
    await index.upsert(mp("memory/global/c.md"), [0.8, 0.2, 0], {
      title: "C",
      description: "Entry C",
    });

    const results = await index.search([1, 0, 0], { limit: 2, minScore: -1 });
    expect(results.length).toBe(2);
  });

  it("respects minScore option", async () => {
    await index.upsert(mp("memory/global/close.md"), [0.95, 0.05, 0], {
      title: "Close",
      description: "Very close",
    });
    await index.upsert(mp("memory/global/far.md"), [0, 0, 1], {
      title: "Far",
      description: "Perpendicular",
    });

    const results = await index.search([1, 0, 0], { minScore: 0.5 });
    expect(results.length).toBe(1);
    expect(results[0]!.path).toBe("memory/global/close.md");
  });

  it("filters by scope", async () => {
    await index.upsert(mp("memory/global/g1.md"), [1, 0, 0], {
      title: "Global One",
      description: "Global scope",
      scope: "global",
    });
    await index.upsert(mp("memory/project/p1.md"), [0.9, 0.1, 0], {
      title: "Project One",
      description: "Project scope",
      scope: "project",
    });

    const results = await index.search([1, 0, 0], {
      scope: "project",
      minScore: -1,
    });
    expect(results.length).toBe(1);
    expect(results[0]!.path).toBe("memory/project/p1.md");
  });

  it("removes entries", async () => {
    const path = mp("memory/global/removable.md");
    await index.upsert(path, [1, 0, 0], {
      title: "Removable",
      description: "Will be removed",
    });

    const beforeResults = await index.search([1, 0, 0]);
    expect(beforeResults.length).toBe(1);

    await index.remove([path]);

    const afterResults = await index.search([1, 0, 0]);
    expect(afterResults.length).toBe(0);
  });

  it("upsert replaces existing entries", async () => {
    const path = mp("memory/global/mutable.md");

    await index.upsert(path, [1, 0, 0], {
      title: "Original",
      description: "Original entry",
    });

    await index.upsert(path, [0, 1, 0], {
      title: "Updated",
      description: "Updated entry",
    });

    const xResults = await index.search([1, 0, 0], { minScore: 0.5 });
    expect(xResults.find((r) => r.path === (path as string))).toBeUndefined();

    const yResults = await index.search([0, 1, 0]);
    expect(yResults.length).toBe(1);
    expect(yResults[0]!.title).toBe("Updated");
    expect(yResults[0]!.score).toBeCloseTo(1.0, 5);
  });
});
