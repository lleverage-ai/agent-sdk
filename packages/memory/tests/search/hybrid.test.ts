import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryPath } from "../../src/path.js";
import { createBM25Index } from "../../src/search/bm25.js";
import { createHybridSearch } from "../../src/search/hybrid.js";
import type { IndexEntry, SearchIndex, VectorIndex } from "../../src/search/types.js";
import { createInMemoryVectorIndex } from "../../src/search/vector.js";
import type { MemoryPath } from "../../src/store/types.js";
import {
  createMockEmbeddingProvider,
  createMockLLMProvider,
} from "../../src/testing/mock-providers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mp(raw: string): MemoryPath {
  return createMemoryPath(raw);
}

function makeEntry(overrides: Partial<IndexEntry> & { path: string }): IndexEntry {
  return {
    path: createMemoryPath(overrides.path),
    title: overrides.title ?? "",
    description: overrides.description ?? "",
    tags: overrides.tags ?? [],
    content: overrides.content ?? "",
    scope: overrides.scope ?? "global",
    projectSlug: overrides.projectSlug,
    agentId: overrides.agentId,
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ENTRIES: IndexEntry[] = [
  makeEntry({
    path: "memory/global/kubernetes.md",
    title: "Kubernetes Deployment",
    description: "How to deploy to Kubernetes clusters",
    tags: ["kubernetes", "deployment"],
    content: "Use kubectl apply to deploy. Configure readiness probes.",
  }),
  makeEntry({
    path: "memory/global/terraform.md",
    title: "Terraform Modules",
    description: "Reusable Terraform module patterns",
    tags: ["terraform", "infrastructure"],
    content: "Organise modules by domain. Pin provider versions.",
  }),
  makeEntry({
    path: "memory/global/typescript.md",
    title: "TypeScript Best Practices",
    description: "Coding standards for TypeScript projects",
    tags: ["typescript", "standards"],
    content: "Use strict mode. Avoid any types. Prefer discriminated unions.",
  }),
];

// Pre-computed embeddings: 3-dimensional for simplicity.
// Kubernetes ~ [1, 0, 0], Terraform ~ [0, 1, 0], TypeScript ~ [0, 0, 1]
const EMBEDDINGS: Record<string, number[]> = {
  "memory/global/kubernetes.md": [1, 0, 0],
  "memory/global/terraform.md": [0, 1, 0],
  "memory/global/typescript.md": [0, 0, 1],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createHybridSearch", () => {
  let bm25: SearchIndex;
  let vectorIndex: VectorIndex;

  beforeEach(async () => {
    bm25 = createBM25Index();
    await bm25.index(ENTRIES);

    vectorIndex = createInMemoryVectorIndex();
    for (const [path, embedding] of Object.entries(EMBEDDINGS)) {
      const entry = ENTRIES.find((e) => (e.path as string) === path)!;
      await vectorIndex.upsert(mp(path), embedding, {
        title: entry.title,
        description: entry.description,
        scope: entry.scope,
      });
    }
  });

  it("BM25-only mode when no vector index provided", async () => {
    const search = createHybridSearch({ bm25 });
    const results = await search.search("Kubernetes");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe("memory/global/kubernetes.md");
  });

  it("hybrid mode fuses BM25 and vector results via RRF", async () => {
    const embedder = createMockEmbeddingProvider(3);

    // Override the embedder to return a known query vector pointing at kubernetes
    const hybridEmbedder = {
      ...embedder,
      async embed(_texts: string[]): Promise<number[][]> {
        return [[0.9, 0.1, 0]];
      },
    };

    const search = createHybridSearch({
      bm25,
      vector: vectorIndex,
      embedder: hybridEmbedder,
    });

    const results = await search.search("Kubernetes deployment", {
      mode: "hybrid",
    });

    expect(results.length).toBeGreaterThan(0);
    // Kubernetes entry should rank first since both BM25 and vector agree
    expect(results[0]!.path).toBe("memory/global/kubernetes.md");
  });

  it("searchWithTrace captures timing information", async () => {
    const search = createHybridSearch({ bm25 });
    const { results, trace } = await search.searchWithTrace("Kubernetes");

    expect(results.length).toBeGreaterThan(0);
    expect(trace.bm25DurationMs).toBeGreaterThanOrEqual(0);
    expect(trace.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(trace.bm25Results.length).toBeGreaterThan(0);
    expect(Array.isArray(trace.fusedResults)).toBe(true);
  });

  it("RRF scores: result in both legs scores higher than result in one leg", async () => {
    const hybridEmbedder = {
      dimensions: 3,
      model: "mock",
      async embed(_texts: string[]): Promise<number[][]> {
        // Query vector close to kubernetes
        return [[0.95, 0.05, 0]];
      },
    };

    const search = createHybridSearch({
      bm25,
      vector: vectorIndex,
      embedder: hybridEmbedder,
    });

    const { trace } = await search.searchWithTrace("Kubernetes", {
      mode: "hybrid",
    });

    // Kubernetes should appear in both BM25 and vector results
    const kubeBM25 = trace.bm25Results.find((r) => r.path === "memory/global/kubernetes.md");
    const kubeVector = trace.vectorResults.find((r) => r.path === "memory/global/kubernetes.md");
    expect(kubeBM25).toBeDefined();
    expect(kubeVector).toBeDefined();

    // The fused result for kubernetes should score higher than one that only
    // appears in one leg (e.g. typescript only in vector via low similarity)
    const fusedKube = trace.fusedResults.find((r) => r.path === "memory/global/kubernetes.md");
    const fusedTypescript = trace.fusedResults.find(
      (r) => r.path === "memory/global/typescript.md",
    );
    expect(fusedKube).toBeDefined();
    expect(fusedTypescript).toBeDefined();
    expect(fusedKube!.score).toBeGreaterThan(fusedTypescript!.score);
  });

  it("reranking with mock LLM provider", async () => {
    const hybridEmbedder = {
      dimensions: 3,
      model: "mock",
      async embed(_texts: string[]): Promise<number[][]> {
        // Points strongly at typescript - disagrees with BM25 for "infrastructure"
        return [[0, 0, 1]];
      },
    };

    // Build a vector index where BM25 and vector fully disagree on ranking
    // BM25 for "infrastructure" => terraform first (tag match)
    // Vector for [0,0,1] => typescript first
    const divergentVector = createInMemoryVectorIndex();
    await divergentVector.upsert(mp("memory/global/kubernetes.md"), [1, 0, 0], {
      title: "Kubernetes Deployment",
      description: "How to deploy to Kubernetes clusters",
    });
    await divergentVector.upsert(mp("memory/global/terraform.md"), [0, 1, 0], {
      title: "Terraform Modules",
      description: "Reusable Terraform module patterns",
    });
    await divergentVector.upsert(mp("memory/global/typescript.md"), [0, 0, 1], {
      title: "TypeScript Best Practices",
      description: "Coding standards for TypeScript projects",
    });

    // First run without reranker to discover the fused order
    const preSearch = createHybridSearch({
      bm25,
      vector: divergentVector,
      embedder: hybridEmbedder,
    });
    const { trace: preTrace } = await preSearch.searchWithTrace("infrastructure", {
      mode: "hybrid",
    });

    // Now build a reranker that assigns the highest score to whatever was
    // second in the fused list, so we can verify reranking reorders results
    const fusedPaths = preTrace.fusedResults.map((r) => r.path);
    expect(fusedPaths.length).toBeGreaterThanOrEqual(2);

    const rerankScores = fusedPaths.map((_, i) => ({
      index: i + 1,
      score: i === 1 ? 0.99 : 0.1,
    }));

    const reranker = createMockLLMProvider([{ text: JSON.stringify(rerankScores) }]);

    const search = createHybridSearch({
      bm25,
      vector: divergentVector,
      embedder: hybridEmbedder,
      reranker,
    });

    const { results, trace } = await search.searchWithTrace("infrastructure", {
      mode: "hybrid",
    });

    expect(trace.rerankSkipped).toBe(false);
    expect(results.length).toBeGreaterThan(0);
    // After reranking, whatever was second in fused results should now be first
    expect(results[0]!.path).toBe(fusedPaths[1]);
  });

  it("unanimity shortcut: skip rerank when top results agree", async () => {
    // Use 3 entries. Both BM25 and vector must agree on the same ordering
    // for the top 3 so we get >= 2 positional matches.
    // Title carries 10x weight in BM25, so putting "deploy" in titles
    // at different prominence levels controls the BM25 ranking.
    // Vector embeddings mirror the same order.

    const unanimousEntries: IndexEntry[] = [
      makeEntry({
        path: "memory/global/alpha.md",
        title: "Deploy Alpha",
        description: "Deploy deploy deploy",
        tags: ["deploy"],
        content: "Deploy deploy deploy.",
      }),
      makeEntry({
        path: "memory/global/beta.md",
        title: "Deploy Beta",
        description: "Deploy",
        tags: ["deploy"],
        content: "Deploy.",
      }),
      makeEntry({
        path: "memory/global/gamma.md",
        title: "Gamma Notes",
        description: "Some notes",
        tags: ["notes"],
        content: "Deploy once.",
      }),
    ];

    const alignedBM25 = createBM25Index();
    await alignedBM25.index(unanimousEntries);

    const alignedVector = createInMemoryVectorIndex();
    await alignedVector.upsert(mp("memory/global/alpha.md"), [1, 0, 0], {
      title: "Deploy Alpha",
      description: "Deploy deploy deploy",
    });
    await alignedVector.upsert(mp("memory/global/beta.md"), [0.9, 0.1, 0], {
      title: "Deploy Beta",
      description: "Deploy",
    });
    await alignedVector.upsert(mp("memory/global/gamma.md"), [0.8, 0.2, 0], {
      title: "Gamma Notes",
      description: "Some notes",
    });

    const unanimousEmbedder = {
      dimensions: 3,
      model: "mock",
      async embed(_texts: string[]): Promise<number[][]> {
        return [[1, 0, 0]];
      },
    };

    const reranker = createMockLLMProvider([{ text: "should not be called" }]);

    const search = createHybridSearch({
      bm25: alignedBM25,
      vector: alignedVector,
      embedder: unanimousEmbedder,
      reranker,
    });

    // Verify BM25 and vector independently produce the same ordering first
    const bm25Check = await alignedBM25.search("deploy");
    const vectorCheck = await alignedVector.search([1, 0, 0], { minScore: -1 });
    // Both should have alpha first
    expect(bm25Check[0]!.path).toBe("memory/global/alpha.md");
    expect(vectorCheck[0]!.path).toBe("memory/global/alpha.md");

    const { trace } = await search.searchWithTrace("deploy", {
      mode: "hybrid",
    });

    expect(trace.rerankSkipped).toBe(true);
    expect(trace.rerankDurationMs).toBeUndefined();
    expect(trace.rerankedResults).toBeUndefined();
  });
});
