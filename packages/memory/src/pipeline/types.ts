/**
 * Pipeline types for @lleverage-ai/memory.
 *
 * Provider interfaces are intentionally minimal so consumers can bring their
 * own LLM and embedding backends without coupling to any specific SDK.
 *
 * @module
 */

import type { MemoryStore } from "../store/types.js";
import type { MemoryConfidence, MemoryEntry, MemoryScope, MemoryType, Message } from "../types.js";

// ---------------------------------------------------------------------------
// Provider interfaces
// ---------------------------------------------------------------------------

/** Options for LLM generation calls. */
export interface GenerateOptions {
  /** Maximum tokens to generate. */
  maxTokens?: number;
  /** Sampling temperature (0-1). */
  temperature?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Minimal LLM provider interface.
 *
 * Maps naturally to Vercel AI SDK's `generateText` and `generateObject`, but
 * has zero dependency on it. Consumers provide an adapter.
 */
export interface MemoryLLMProvider {
  /** Generate free-form text from a prompt. */
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  /** Generate structured output validated against a Zod schema. */
  generateStructured<T>(prompt: string, schema: unknown, options?: GenerateOptions): Promise<T>;
}

/**
 * Minimal embedding provider interface.
 *
 * Accepts a batch of texts, returns a batch of embedding vectors.
 */
export interface MemoryEmbeddingProvider {
  /** Compute embeddings for a batch of texts. */
  embed(texts: string[]): Promise<number[][]>;
  /** Dimensionality of the embedding vectors. */
  dimensions: number;
  /** Model identifier, e.g. "bge-m3" or "text-embedding-3-small". */
  model: string;
}

// ---------------------------------------------------------------------------
// Extraction (post-turn)
// ---------------------------------------------------------------------------

/** Context passed to the extractor after each agent turn. */
export interface ExtractionContext {
  /** Recent conversation messages. */
  messages: Message[];
  /** Current memory state for deduplication. */
  existingMemories: MemoryEntry[];
  /** Active scope for new memories. */
  scope: MemoryScope;
  /** Project identifier when scope is "project". */
  projectSlug?: string;
  /** Agent identifier when scope is "agent". */
  agentId?: string;
  /** Current date in ISO 8601 for relative date conversion. */
  currentDate: string;
}

/** A single candidate memory proposed by extraction. */
export interface ExtractionCandidate {
  action: "create" | "update";
  filename: string;
  name: string;
  description: string;
  type: MemoryType;
  scope: MemoryScope;
  content: string;
  indexEntry: string;
  confidence: MemoryConfidence;
}

/** Result of an extraction pass. */
export interface ExtractionResult {
  candidates: ExtractionCandidate[];
  /** Project identifier captured at extraction time for path resolution. */
  projectSlug?: string;
  /** Agent identifier captured at extraction time for path resolution. */
  agentId?: string;
}

/** Extracts memories from conversation turns. */
export interface Extractor {
  extract(context: ExtractionContext): Promise<ExtractionResult>;
  apply(result: ExtractionResult, store: MemoryStore): Promise<void>;
}

// ---------------------------------------------------------------------------
// Recall (pre-turn)
// ---------------------------------------------------------------------------

/** Context for memory recall before an agent turn. */
export interface RecallContext {
  /** Current user message or query. */
  query: string;
  /** Active scope to search. */
  scope: MemoryScope;
  /** Project identifier when scope is "project". */
  projectSlug?: string;
  /** Agent identifier when scope is "agent". */
  agentId?: string;
  /** Operational mode affecting scope weighting. */
  mode?: "assistant" | "coding";
  /** Maximum memories to return. Default: 5. */
  maxResults?: number;
}

/** A memory surfaced by the recall pipeline with relevance metadata. */
export interface SurfacedMemory {
  entry: MemoryEntry;
  relevanceScore: number;
  /** How this memory was found. */
  source: "direct" | "wikilink";
}

/** Surfaces relevant memories for the current context. */
export interface Recaller {
  recall(context: RecallContext): Promise<SurfacedMemory[]>;
}

// ---------------------------------------------------------------------------
// Reflection (post-session)
// ---------------------------------------------------------------------------

/** Context for reflection after a session concludes. */
export interface ReflectionContext {
  /** Full session messages. */
  messages: Message[];
  /** Existing memories for context. */
  existingMemories: MemoryEntry[];
  /** Active scope. */
  scope: MemoryScope;
  /** Project identifier. */
  projectSlug?: string;
  /** Agent identifier. */
  agentId?: string;
}

/** A generalised heuristic extracted by reflection. */
export interface Heuristic {
  rule: string;
  context: string;
  confidence: MemoryConfidence;
  category: string;
  scope: MemoryScope;
  antiPattern?: string;
}

/** Result of a reflection pass. */
export interface ReflectionResult {
  heuristics: Heuristic[];
  /** Project identifier captured at reflection time for path resolution. */
  projectSlug?: string;
  /** Agent identifier captured at reflection time for path resolution. */
  agentId?: string;
}

/** Extracts generalisable heuristics from sessions. */
export interface Reflector {
  reflect(context: ReflectionContext): Promise<ReflectionResult>;
  apply(result: ReflectionResult, store: MemoryStore): Promise<void>;
}

// ---------------------------------------------------------------------------
// Consolidation (maintenance)
// ---------------------------------------------------------------------------

/** Options for consolidation runs. */
export interface ConsolidationOptions {
  /** Age threshold in days before a memory is considered stale. Default: 90. */
  stalenessThresholdDays?: number;
  /** Whether to use the LLM for deduplication verdicts. Default: true if provider available. */
  llmDedup?: boolean;
  /** Minimum cluster size for wiki promotion. Default: 5. */
  promotionClusterSize?: number;
}

/** Report from a consolidation run. */
export interface ConsolidationReport {
  indexRebuilt: boolean;
  staleMemories: string[];
  duplicatesResolved: number;
  heuristicsReinforced: number;
  promotedToKnowledge: number;
}

/** Runs maintenance operations on the memory store. */
export interface Consolidator {
  consolidate(store: MemoryStore, options?: ConsolidationOptions): Promise<ConsolidationReport>;
}
