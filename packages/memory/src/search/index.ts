export type {
  IndexEntry,
  SearchOptions,
  SearchResult,
  SearchIndex,
  VectorSearchOptions,
  VectorSearchResult,
  VectorIndex,
  HybridSearchTrace,
} from "./types.js";

export { createBM25Index } from "./bm25.js";
export { createInMemoryVectorIndex } from "./vector.js";
export { parseQuery, buildSearchTerms } from "./query-parser.js";
export type { ParsedQuery, QueryTerm } from "./query-parser.js";
export { createHybridSearch } from "./hybrid.js";
export type { HybridSearchOptions, HybridSearch } from "./hybrid.js";
export { createTrigramIndex } from "./trigram.js";
export type { TrigramIndex, TrigramResult } from "./trigram.js";
