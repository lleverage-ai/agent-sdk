/**
 * @lleverage-ai/memory
 *
 * Persistent memory system for AI agents - extraction, recall, retrieval,
 * and consolidation. Inspired by Jeff's brain architecture.
 *
 * @packageDocumentation
 */

// Core types
export type {
  MemoryType,
  MemoryScope,
  MemoryConfidence,
  MemorySource,
  MemoryFrontmatter,
  MemoryEntry,
  Message,
  MessageRole,
} from "./types.js";

// Store
export type {
  MemoryPath,
  FileInfo,
  ListOptions,
  BatchOptions,
  MemoryBatch,
  MemoryStore,
  EventType,
  StoreEvent,
  EventSink,
} from "./store/types.js";

export {
  MemoryNotFoundError,
  MemoryConflictError,
  InvalidPathError,
} from "./store/types.js";

export { createMemoryPath, isValidPath, joinPaths, parentPath, basename } from "./path.js";

// Store implementations
export { createFilesystemStore } from "./store/filesystem.js";
export { createInMemoryStore } from "./store/in-memory.js";
export { createGitStore } from "./store/git.js";
export type { GitStoreOptions } from "./store/git.js";
export { createAutodetectedStore } from "./store/autodetect.js";
export type { AutodetectOptions } from "./store/autodetect.js";

// Frontmatter
export { parseFrontmatter, serialiseFrontmatter, parseMemoryFile } from "./frontmatter.js";

// Wikilinks
export { resolveWikilink, extractWikilinks } from "./wikilink.js";

// Memory index
export { MemoryIndex } from "./memory-index.js";

// Slug
export { deriveProjectSlug } from "./slug.js";

// Pipeline types
export type {
  MemoryLLMProvider,
  MemoryEmbeddingProvider,
  GenerateOptions,
  ExtractionContext,
  ExtractionCandidate,
  ExtractionResult,
  Extractor,
  RecallContext,
  SurfacedMemory,
  Recaller,
  ReflectionContext,
  ReflectionResult,
  Heuristic,
  Reflector,
  ConsolidationOptions,
  ConsolidationReport,
  Consolidator,
} from "./pipeline/types.js";

// Pipeline implementations
export { createExtractor } from "./pipeline/extractor.js";
export { createRecaller } from "./pipeline/recaller.js";
export { createReflector } from "./pipeline/reflector.js";
export { createConsolidator } from "./pipeline/consolidator.js";

// Plugin
export { createMemoryPlugin } from "./plugin/index.js";
export type {
  MemoryPluginOptions,
  MemoryPlugin,
  MemoryPromptContext,
  BeforeGenerateContext,
  AfterGenerateContext,
  SessionEndContext,
} from "./plugin/index.js";
export type { MemoryTool } from "./plugin/tools.js";
export { formatMemorySection, formatMemoryPolicy } from "./plugin/prompt-components.js";
export { createMemoryTools } from "./plugin/tools.js";

// Search (re-exported from ./search subpath for convenience)
export { createBM25Index } from "./search/bm25.js";
export { createInMemoryVectorIndex } from "./search/vector.js";
export { createHybridSearch } from "./search/hybrid.js";
export { createTrigramIndex } from "./search/trigram.js";
export { parseQuery, buildSearchTerms } from "./search/query-parser.js";
