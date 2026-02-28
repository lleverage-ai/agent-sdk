/**
 * Memory system for persistent agent memory.
 *
 * This module provides a two-tier memory architecture:
 * - **User-Level Memory**: Personal preferences stored at `~/.deepagents/{agentId}/`
 * - **Project-Level Memory**: Project conventions stored at `[git-root]/.deepagents/`
 *
 * Memory documents are markdown files with optional YAML frontmatter for metadata.
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   loadAllMemory,
 *   buildMemorySection,
 *   matchesPathPattern,
 * } from "@lleverage-ai/agent-sdk";
 *
 * // Load all agent memory
 * const memory = await loadAllMemory({
 *   agentId: "my-agent",
 *   workingDirectory: process.cwd(),
 * });
 *
 * // Use in system prompt
 * const systemPrompt = `You are a helpful assistant.\n\n${memory.memorySection}`;
 *
 * // Filter by current file
 * if (matchesPathPattern("src/api/users.ts", "src/api/**\/*.ts")) {
 *   // Apply API-specific rules
 * }
 * ```
 *
 * @packageDocumentation
 */

export type { FilesystemMemoryStoreOptions } from "./filesystem-store.js";
// Filesystem store implementation
export {
  createFilesystemMemoryStore,
  createInMemoryMemoryStore,
  FilesystemMemoryStore,
  InMemoryMemoryStore,
} from "./filesystem-store.js";
export type {
  AdditionalMemoryFile,
  BuildMemorySectionOptions,
  LoadAdditionalMemoryOptions,
  LoadAgentMemoryOptions,
  LoadAllMemoryOptions,
  LoadAllMemoryResult,
  MemoryAuditEvent,
} from "./loader.js";
// Memory loading functions
export {
  buildMemorySection,
  findGitRoot,
  getProjectMemoryPath,
  getUserAgentDir,
  getUserMemoryPath,
  loadAdditionalMemoryFiles,
  loadAgentMemory,
  loadAllMemory,
} from "./loader.js";
export type {
  FileMemoryPermissionStoreOptions,
  MemoryApproval,
  MemoryPermissionStore,
} from "./permissions.js";
// Permission store for approval persistence
export {
  computeContentHash,
  computeFileHash,
  createInMemoryPermissionStore,
  createMemoryPermissionStore,
  FileMemoryPermissionStore,
  InMemoryPermissionStore,
} from "./permissions.js";
export type {
  BuildPathMemoryContextOptions,
  PathMemoryContext,
} from "./rules.js";
// Path-based rule matching
export {
  buildPathMemoryContext,
  filterAdditionalFilesByPath,
  filterAutoLoadAdditionalFiles,
  filterAutoLoadMemories,
  filterMemoriesByAllTags,
  filterMemoriesByPath,
  filterMemoriesByTags,
  matchesAnyPathPattern,
  matchesPathPattern,
} from "./rules.js";
export type {
  MemoryDocument,
  MemoryMetadata,
  MemoryStore,
  ParsedMarkdown,
} from "./store.js";
// Store interface and types
export {
  parseMarkdownWithFrontmatter,
  parseSimpleYaml,
  serializeMarkdownWithFrontmatter,
} from "./store.js";
