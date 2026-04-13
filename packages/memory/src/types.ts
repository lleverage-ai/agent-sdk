/**
 * Core memory types for @lleverage-ai/memory.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Memory classification
// ---------------------------------------------------------------------------

/** Semantic category of a memory entry. */
export type MemoryType = "user" | "feedback" | "project" | "reference";

/** Isolation scope for memory entries. */
export type MemoryScope = "global" | "project" | "agent";

/** Confidence level assigned during extraction or reinforced during consolidation. */
export type MemoryConfidence = "high" | "medium" | "low";

/** Origin of a memory entry. */
export type MemorySource = "extraction" | "reflection" | "manual" | "promotion" | "consolidation";

// ---------------------------------------------------------------------------
// Memory entry
// ---------------------------------------------------------------------------

/** YAML frontmatter stored at the top of every memory markdown file. */
export interface MemoryFrontmatter {
  name: string;
  description: string;
  type: MemoryType;
  scope: MemoryScope;
  tags: string[];
  confidence: MemoryConfidence;
  source: MemorySource;
  created: string;
  modified: string;
  /** Path to the memory this entry replaced, if any. */
  supersedes?: string;
}

/** A fully-parsed memory entry ready for use. */
export interface MemoryEntry {
  path: string;
  frontmatter: MemoryFrontmatter;
  content: string;
  /** One-line summary for the MEMORY.md index file. */
  indexEntry: string;
}

// ---------------------------------------------------------------------------
// Minimal message type for pipeline context
// ---------------------------------------------------------------------------

/** Role of a conversation message. */
export type MessageRole = "user" | "assistant" | "system";

/** Lightweight message representation consumed by the pipeline. */
export interface Message {
  role: MessageRole;
  content: string;
}
