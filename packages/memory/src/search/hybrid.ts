import type { MemoryEmbeddingProvider, MemoryLLMProvider } from "../pipeline/types.js";
import type { MemoryPath } from "../store/types.js";
import type {
  HybridSearchTrace,
  SearchIndex,
  SearchOptions,
  SearchResult,
  VectorIndex,
  VectorSearchResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HybridSearchOptions {
  bm25: SearchIndex;
  vector?: VectorIndex;
  embedder?: MemoryEmbeddingProvider;
  reranker?: MemoryLLMProvider;
}

export interface HybridSearch {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  searchWithTrace(
    query: string,
    options?: SearchOptions,
  ): Promise<{ results: SearchResult[]; trace: HybridSearchTrace }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RRF_K = 60;
const RERANK_CANDIDATE_LIMIT = 20;
const RERANK_UNANIMITY_THRESHOLD = 2;
const RERANK_TOP_N = 3;

// ---------------------------------------------------------------------------
// RRF fusion
// ---------------------------------------------------------------------------

type FusedEntry = {
  path: MemoryPath;
  rrfScore: number;
  title: string;
  description: string;
  highlights?: string[];
};

function fuseResults(
  bm25Results: SearchResult[],
  vectorResults: VectorSearchResult[],
): SearchResult[] {
  const scores = new Map<string, FusedEntry>();

  for (let rank = 0; rank < bm25Results.length; rank++) {
    const result = bm25Results[rank]!;
    const existing = scores.get(result.path);
    const contribution = 1 / (RRF_K + rank + 1);

    if (existing) {
      existing.rrfScore += contribution;
    } else {
      scores.set(result.path, {
        path: result.path,
        rrfScore: contribution,
        title: result.title,
        description: result.description,
        highlights: result.highlights,
      });
    }
  }

  for (let rank = 0; rank < vectorResults.length; rank++) {
    const result = vectorResults[rank]!;
    const existing = scores.get(result.path);
    const contribution = 1 / (RRF_K + rank + 1);

    if (existing) {
      existing.rrfScore += contribution;
    } else {
      scores.set(result.path, {
        path: result.path,
        rrfScore: contribution,
        title: result.title,
        description: result.description,
      });
    }
  }

  const fused = Array.from(scores.values());
  fused.sort((a, b) => b.rrfScore - a.rrfScore);

  return fused.map(({ path, rrfScore, title, description, highlights }) => ({
    path,
    score: rrfScore,
    title,
    description,
    highlights,
  }));
}

// ---------------------------------------------------------------------------
// Unanimity check
// ---------------------------------------------------------------------------

function shouldSkipRerank(
  bm25Results: SearchResult[],
  vectorResults: VectorSearchResult[],
): boolean {
  const bm25Top = bm25Results.slice(0, RERANK_TOP_N);
  const vectorTop = vectorResults.slice(0, RERANK_TOP_N);

  let agreements = 0;
  const limit = Math.min(bm25Top.length, vectorTop.length);

  for (let i = 0; i < limit; i++) {
    if (bm25Top[i]!.path === vectorTop[i]!.path) {
      agreements++;
    }
  }

  return agreements >= RERANK_UNANIMITY_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Reranking
// ---------------------------------------------------------------------------

function buildRerankPrompt(query: string, candidates: SearchResult[]): string {
  const manifest = candidates.map((c, i) => `${i + 1}. "${c.title}" - ${c.description}`).join("\n");

  return `You are scoring search results for relevance to a query.

For each result, assign a relevance score from 0.0 (completely irrelevant) to 1.0 (perfectly relevant).

Respond with ONLY a JSON array of objects with "index" (1-based) and "score" (0.0-1.0).
Example: [{"index": 1, "score": 0.9}, {"index": 2, "score": 0.3}]

Query: ${query}

Results:
${manifest}`;
}

type RerankScore = {
  index: number;
  score: number;
};

function parseRerankResponse(response: string): RerankScore[] {
  const trimmed = response.trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");

  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const results: RerankScore[] = [];
  for (const item of parsed) {
    if (
      typeof item === "object" &&
      item !== null &&
      "index" in item &&
      "score" in item &&
      typeof (item as Record<string, unknown>).index === "number" &&
      typeof (item as Record<string, unknown>).score === "number"
    ) {
      const score = (item as Record<string, unknown>).score as number;
      results.push({
        index: (item as Record<string, unknown>).index as number,
        score: Math.max(0, Math.min(1, score)),
      });
    }
  }

  return results;
}

async function rerank(
  reranker: MemoryLLMProvider,
  query: string,
  candidates: SearchResult[],
): Promise<SearchResult[]> {
  const toRerank = candidates.slice(0, RERANK_CANDIDATE_LIMIT);
  const remainder = candidates.slice(RERANK_CANDIDATE_LIMIT);

  const prompt = buildRerankPrompt(query, toRerank);

  let response: string;
  try {
    response = await reranker.generate(prompt, {
      maxTokens: 512,
      temperature: 0,
    });
  } catch {
    return candidates;
  }

  const scores = parseRerankResponse(response);
  if (scores.length === 0) {
    return candidates;
  }

  const scoreMap = new Map<number, number>();
  for (const { index, score } of scores) {
    scoreMap.set(index, score);
  }

  const reranked = toRerank.map((result, i) => ({
    ...result,
    score: scoreMap.get(i + 1) ?? result.score,
  }));

  reranked.sort((a, b) => b.score - a.score);

  return [...reranked, ...remainder];
}

// ---------------------------------------------------------------------------
// Timing helper
// ---------------------------------------------------------------------------

function nowMs(): number {
  return performance.now();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a hybrid search combining BM25 keyword search with optional vector similarity.
 *
 * Uses Reciprocal Rank Fusion (RRF) to merge results when both BM25 and vector
 * indices are available, with optional LLM-based reranking.
 *
 * @param options - Configuration including search indices and optional reranker
 * @returns A configured {@link HybridSearch}
 */
export function createHybridSearch(options: HybridSearchOptions): HybridSearch {
  const { bm25, vector, embedder, reranker: rerankerProvider } = options;
  const isHybridCapable = vector !== undefined && embedder !== undefined;

  async function executeSearch(
    query: string,
    searchOptions?: SearchOptions,
  ): Promise<{ results: SearchResult[]; trace: HybridSearchTrace }> {
    const totalStart = nowMs();
    const mode = searchOptions?.mode ?? (isHybridCapable ? "hybrid" : "bm25");
    const limit = searchOptions?.limit ?? 20;

    let bm25Results: SearchResult[] = [];
    let vectorResults: VectorSearchResult[] = [];
    let fusedResults: SearchResult[];
    let rerankedResults: SearchResult[] | undefined;
    let bm25DurationMs = 0;
    let vectorDurationMs = 0;
    let fusionDurationMs = 0;
    let rerankDurationMs: number | undefined;
    let rerankSkipped = true;

    if (mode === "hybrid" && isHybridCapable) {
      const parallelStart = nowMs();

      const [bm25Batch, queryEmbedding] = await Promise.all([
        bm25.search(query, searchOptions),
        embedder!.embed([query]),
      ]);

      bm25Results = bm25Batch;
      // Both ran in parallel, so individual timings aren't meaningful.
      // Record the parallel phase duration as bm25DurationMs for observability.
      bm25DurationMs = nowMs() - parallelStart;

      const vectorSearchStart = nowMs();
      vectorResults = await vector!.search(queryEmbedding[0]!, {
        limit: searchOptions?.limit,
        scope: searchOptions?.scope,
        projectSlug: searchOptions?.projectSlug,
        agentId: searchOptions?.agentId,
      });
      vectorDurationMs = nowMs() - vectorSearchStart;

      const fusionStart = nowMs();
      fusedResults = fuseResults(bm25Results, vectorResults);
      fusionDurationMs = nowMs() - fusionStart;

      if (rerankerProvider !== undefined) {
        if (shouldSkipRerank(bm25Results, vectorResults)) {
          rerankSkipped = true;
        } else {
          rerankSkipped = false;
          const rerankStart = nowMs();
          rerankedResults = await rerank(rerankerProvider, query, fusedResults);
          rerankDurationMs = nowMs() - rerankStart;
          fusedResults = rerankedResults;
        }
      }
    } else {
      const bm25Start = nowMs();
      bm25Results = await bm25.search(query, searchOptions);
      bm25DurationMs = nowMs() - bm25Start;
      fusedResults = bm25Results;
    }

    const finalResults = fusedResults.slice(0, limit);
    const totalDurationMs = nowMs() - totalStart;

    return {
      results: finalResults,
      trace: {
        bm25Results,
        vectorResults,
        fusedResults,
        rerankedResults,
        bm25DurationMs,
        vectorDurationMs,
        fusionDurationMs,
        rerankDurationMs,
        rerankSkipped,
        totalDurationMs,
      },
    };
  }

  return {
    async search(query: string, searchOptions?: SearchOptions): Promise<SearchResult[]> {
      const { results } = await executeSearch(query, searchOptions);
      return results;
    },

    async searchWithTrace(
      query: string,
      searchOptions?: SearchOptions,
    ): Promise<{ results: SearchResult[]; trace: HybridSearchTrace }> {
      return executeSearch(query, searchOptions);
    },
  };
}
