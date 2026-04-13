/**
 * Search and retrieval types for @lleverage-ai/memory.
 *
 * @module
 */

import type { MemoryPath } from "../store/types.js";
import type { MemoryScope, MemoryType } from "../types.js";

// ---------------------------------------------------------------------------
// Search index
// ---------------------------------------------------------------------------

/** An entry to be indexed for search. */
export interface IndexEntry {
  path: MemoryPath;
  title: string;
  description: string;
  tags: string[];
  content: string;
  scope: MemoryScope;
  projectSlug?: string;
  agentId?: string;
}

/** Options for search queries. */
export interface SearchOptions {
  /** Search mode. Default: "hybrid" if embedder available, "bm25" otherwise. */
  mode?: "bm25" | "vector" | "hybrid";
  /** Maximum results. Default: 20. */
  limit?: number;
  /** Filter by scope. */
  scope?: MemoryScope;
  /** Filter by project. */
  projectSlug?: string;
  /** Filter by agent. */
  agentId?: string;
  /** Filter by memory types. */
  types?: MemoryType[];
}

/** A single search result. */
export interface SearchResult {
  path: MemoryPath;
  score: number;
  title: string;
  description: string;
  highlights?: string[];
}

/**
 * Full-text search index over memory entries.
 *
 * The default implementation uses in-process BM25. Production deployments
 * can swap in PostgreSQL full-text search or other backends.
 */
export interface SearchIndex {
  /** Index a batch of entries. Replaces existing entries at the same paths. */
  index(entries: IndexEntry[]): Promise<void>;
  /** Remove entries by path. */
  remove(paths: MemoryPath[]): Promise<void>;
  /** Search for entries matching a query. */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  /** Rebuild the entire index from scratch. */
  rebuild(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Vector index
// ---------------------------------------------------------------------------

/** Options for vector similarity search. */
export interface VectorSearchOptions {
  /** Maximum results. Default: 20. */
  limit?: number;
  /** Minimum similarity threshold (0-1). Default: 0. */
  minScore?: number;
  /** Filter by scope. */
  scope?: MemoryScope;
  /** Filter by project. */
  projectSlug?: string;
  /** Filter by agent. */
  agentId?: string;
}

/** A single vector search result. */
export interface VectorSearchResult {
  path: MemoryPath;
  score: number;
  title: string;
  description: string;
}

/**
 * Vector similarity index over memory embeddings.
 *
 * The default implementation uses in-memory float32 cosine similarity.
 * Production deployments can use pgvector, Milvus, or other backends.
 */
export interface VectorIndex {
  /** Insert or update an embedding. */
  upsert(
    path: MemoryPath,
    embedding: number[],
    metadata?: {
      title?: string;
      description?: string;
      scope?: MemoryScope;
      projectSlug?: string;
      agentId?: string;
    },
  ): Promise<void>;
  /** Remove embeddings by path. */
  remove(paths: MemoryPath[]): Promise<void>;
  /** Search for similar entries. */
  search(queryEmbedding: number[], options?: VectorSearchOptions): Promise<VectorSearchResult[]>;
}

// ---------------------------------------------------------------------------
// Hybrid search
// ---------------------------------------------------------------------------

/** Trace of a hybrid search for debugging and observability. */
export interface HybridSearchTrace {
  bm25Results: SearchResult[];
  vectorResults: VectorSearchResult[];
  fusedResults: SearchResult[];
  rerankedResults?: SearchResult[];
  bm25DurationMs: number;
  vectorDurationMs: number;
  fusionDurationMs: number;
  rerankDurationMs?: number;
  rerankSkipped: boolean;
  totalDurationMs: number;
}
