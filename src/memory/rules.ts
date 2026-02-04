/**
 * Path-based rule matching for memory documents.
 *
 * Memory documents can specify path patterns in their frontmatter to
 * control when they should be applied. This module provides matching
 * functionality for determining which memories are relevant.
 *
 * @example
 * ```typescript
 * import { filterMemoriesByPath, matchesPathPattern } from "@lleverage-ai/agent-sdk";
 *
 * // Check if a file matches a pattern
 * const matches = matchesPathPattern("src/api/users.ts", "src/api/**\/*.ts");
 * // matches = true
 *
 * // Filter memories by current file
 * const relevant = filterMemoriesByPath(memories, "src/api/users.ts");
 * ```
 *
 * @packageDocumentation
 */

import type { AdditionalMemoryFile } from "./loader.js";
import type { MemoryDocument } from "./store.js";

// =============================================================================
// Path Pattern Matching
// =============================================================================

/**
 * Check if a file path matches a glob pattern.
 *
 * Supports standard glob patterns:
 * - `*` - matches any characters except /
 * - `**` - matches any characters including /
 * - `?` - matches exactly one character except /
 * - `[abc]` - matches any character in the brackets
 * - `[!abc]` - matches any character not in the brackets
 *
 * @param filePath - The file path to test
 * @param pattern - The glob pattern to match against
 * @returns True if the path matches the pattern
 *
 * @example
 * ```typescript
 * matchesPathPattern("src/api/users.ts", "src/**\/*.ts");     // true
 * matchesPathPattern("src/api/users.ts", "src/api/*.ts");     // true
 * matchesPathPattern("src/api/users.ts", "tests/**\/*.ts");   // false
 * matchesPathPattern("src/api/users.ts", "**\/*.ts");         // true
 * matchesPathPattern("README.md", "*.md");                    // true
 * ```
 *
 * @category Memory
 */
export function matchesPathPattern(filePath: string, pattern: string): boolean {
  // Normalize paths to use forward slashes
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // Convert glob pattern to regex using placeholder approach
  // to avoid conflicts between different glob patterns
  const regexPattern = normalizedPattern
    // Escape special regex characters (except glob chars * and ?)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // Replace ** followed by / with a placeholder
    .replace(/\*\*\//g, "<<<GLOBSTAR_SLASH>>>")
    // Replace standalone ** with a placeholder
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    // Handle * (matches anything except /)
    .replace(/\*/g, "[^/]*")
    // Handle ? (matches exactly one char except /)
    .replace(/\?/g, "[^/]")
    // Now replace placeholders with actual regex
    // **/ matches zero or more directories (including none)
    .replace(/<<<GLOBSTAR_SLASH>>>/g, "(?:[^/]+/)*")
    // ** at end matches any remaining path
    .replace(/<<<GLOBSTAR>>>/g, ".*");

  // Anchor the pattern
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedPath);
}

/**
 * Check if a file path matches any of the given patterns.
 *
 * @param filePath - The file path to test
 * @param patterns - Array of glob patterns
 * @returns True if the path matches any pattern
 *
 * @example
 * ```typescript
 * const patterns = ["src/**\/*.ts", "tests/**\/*.ts"];
 * matchesAnyPathPattern("src/index.ts", patterns);   // true
 * matchesAnyPathPattern("README.md", patterns);      // false
 * ```
 *
 * @category Memory
 */
export function matchesAnyPathPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPathPattern(filePath, pattern));
}

// =============================================================================
// Memory Filtering
// =============================================================================

/**
 * Filter memory documents by path relevance.
 *
 * A memory document is considered relevant if:
 * 1. It has no `paths` metadata (applies to all files)
 * 2. The file path matches any of the patterns in `paths` metadata
 *
 * @param documents - Array of memory documents to filter
 * @param currentPath - The current file path to match against
 * @returns Array of relevant memory documents, sorted by priority
 *
 * @example
 * ```typescript
 * const memories: MemoryDocument[] = [
 *   {
 *     path: "/memory/api.md",
 *     metadata: { paths: ["src/api/**\/*.ts"], priority: 10 },
 *     content: "API rules...",
 *     modifiedAt: Date.now(),
 *   },
 *   {
 *     path: "/memory/general.md",
 *     metadata: {}, // No paths = applies to all
 *     content: "General rules...",
 *     modifiedAt: Date.now(),
 *   },
 * ];
 *
 * const relevant = filterMemoriesByPath(memories, "src/api/users.ts");
 * // Returns both, sorted by priority (api.md first)
 * ```
 *
 * @category Memory
 */
export function filterMemoriesByPath(
  documents: MemoryDocument[],
  currentPath: string,
): MemoryDocument[] {
  const relevant = documents.filter((doc) => {
    const paths = doc.metadata.paths;

    // No paths metadata = applies to all files
    if (!paths || paths.length === 0) {
      return true;
    }

    // Check if current path matches any pattern
    return matchesAnyPathPattern(currentPath, paths);
  });

  // Sort by priority (higher first), then by path
  return relevant.sort((a, b) => {
    const priorityA = a.metadata.priority ?? 0;
    const priorityB = b.metadata.priority ?? 0;

    if (priorityB !== priorityA) {
      return priorityB - priorityA;
    }

    return a.path.localeCompare(b.path);
  });
}

/**
 * Filter additional memory files by path relevance.
 *
 * @param files - Array of additional memory files
 * @param currentPath - The current file path to match against
 * @returns Array of relevant files, sorted by priority
 *
 * @category Memory
 */
export function filterAdditionalFilesByPath(
  files: AdditionalMemoryFile[],
  currentPath: string,
): AdditionalMemoryFile[] {
  const relevant = files.filter((file) => {
    const paths = file.metadata.paths;

    // No paths metadata = applies to all files
    if (!paths || paths.length === 0) {
      return true;
    }

    return matchesAnyPathPattern(currentPath, paths);
  });

  // Sort by priority (higher first), then by filename
  return relevant.sort((a, b) => {
    const priorityA = a.metadata.priority ?? 0;
    const priorityB = b.metadata.priority ?? 0;

    if (priorityB !== priorityA) {
      return priorityB - priorityA;
    }

    return a.filename.localeCompare(b.filename);
  });
}

// =============================================================================
// Memory Context Building
// =============================================================================

/**
 * Options for building path-specific memory context.
 *
 * @category Memory
 */
export interface BuildPathMemoryContextOptions {
  /**
   * User memory document.
   */
  userMemory?: MemoryDocument;

  /**
   * Project memory document.
   */
  projectMemory?: MemoryDocument;

  /**
   * Additional memory files.
   */
  additionalFiles?: AdditionalMemoryFile[];

  /**
   * Current file path for filtering.
   */
  currentPath?: string;

  /**
   * Include memories without path restrictions.
   * @defaultValue true
   */
  includeGeneral?: boolean;

  /**
   * Include file names as subheaders for additional files.
   * @defaultValue true
   */
  includeFilenames?: boolean;
}

/**
 * Result from building path-specific memory context.
 *
 * @category Memory
 */
export interface PathMemoryContext {
  /**
   * Whether user memory applies to current path.
   */
  userMemoryApplies: boolean;

  /**
   * Whether project memory applies to current path.
   */
  projectMemoryApplies: boolean;

  /**
   * Filtered additional files that apply to current path.
   */
  relevantAdditionalFiles: AdditionalMemoryFile[];

  /**
   * Combined memory content formatted for prompt injection.
   */
  combinedContent: string;

  /**
   * Paths from all applicable memories (for debugging).
   */
  appliedPatterns: string[];
}

/**
 * Build memory context filtered by current file path.
 *
 * This function filters all memory sources based on their path patterns
 * and the current file being worked on. Useful for providing context-aware
 * memory injection.
 *
 * @param options - Context building options
 * @returns Path-filtered memory context
 *
 * @example
 * ```typescript
 * const context = buildPathMemoryContext({
 *   userMemory,
 *   projectMemory,
 *   additionalFiles,
 *   currentPath: "src/api/users.ts",
 * });
 *
 * if (context.combinedContent) {
 *   systemPrompt += `\n\n## Relevant Context\n\n${context.combinedContent}`;
 * }
 * ```
 *
 * @category Memory
 */
export function buildPathMemoryContext(options: BuildPathMemoryContextOptions): PathMemoryContext {
  const {
    userMemory,
    projectMemory,
    additionalFiles = [],
    currentPath,
    includeGeneral = true,
    includeFilenames = true,
  } = options;

  const appliedPatterns: string[] = [];
  const contentParts: string[] = [];

  // Check user memory
  let userMemoryApplies = false;
  if (userMemory) {
    const paths = userMemory.metadata.paths;
    if (!paths || paths.length === 0) {
      userMemoryApplies = includeGeneral;
    } else if (currentPath) {
      userMemoryApplies = matchesAnyPathPattern(currentPath, paths);
      if (userMemoryApplies) {
        appliedPatterns.push(...paths);
      }
    }

    if (userMemoryApplies && userMemory.content) {
      contentParts.push(userMemory.content);
    }
  }

  // Check project memory
  let projectMemoryApplies = false;
  if (projectMemory) {
    const paths = projectMemory.metadata.paths;
    if (!paths || paths.length === 0) {
      projectMemoryApplies = includeGeneral;
    } else if (currentPath) {
      projectMemoryApplies = matchesAnyPathPattern(currentPath, paths);
      if (projectMemoryApplies) {
        appliedPatterns.push(...paths);
      }
    }

    if (projectMemoryApplies && projectMemory.content) {
      contentParts.push(projectMemory.content);
    }
  }

  // Filter additional files
  let relevantAdditionalFiles: AdditionalMemoryFile[] = [];
  if (currentPath) {
    relevantAdditionalFiles = filterAdditionalFilesByPath(additionalFiles, currentPath);
  } else if (includeGeneral) {
    // Include files without path restrictions
    relevantAdditionalFiles = additionalFiles.filter(
      (f) => !f.metadata.paths || f.metadata.paths.length === 0,
    );
  }

  // Add additional file content
  for (const file of relevantAdditionalFiles) {
    if (file.content) {
      if (includeFilenames) {
        contentParts.push(`## ${file.filename}\n\n${file.content}`);
      } else {
        contentParts.push(file.content);
      }
    }
    if (file.metadata.paths) {
      appliedPatterns.push(...file.metadata.paths);
    }
  }

  return {
    userMemoryApplies,
    projectMemoryApplies,
    relevantAdditionalFiles,
    combinedContent: contentParts.join("\n\n---\n\n"),
    appliedPatterns: [...new Set(appliedPatterns)], // Deduplicate
  };
}

// =============================================================================
// Tag-Based Filtering
// =============================================================================

/**
 * Filter memory documents by tags.
 *
 * @param documents - Array of memory documents
 * @param tags - Tags to filter by (document must have at least one)
 * @returns Filtered array of documents
 *
 * @example
 * ```typescript
 * const docs = filterMemoriesByTags(memories, ["api", "security"]);
 * // Returns documents that have either "api" or "security" tag
 * ```
 *
 * @category Memory
 */
export function filterMemoriesByTags(
  documents: MemoryDocument[],
  tags: string[],
): MemoryDocument[] {
  if (tags.length === 0) {
    return documents;
  }

  return documents.filter((doc) => {
    const docTags = doc.metadata.tags;
    if (!docTags || docTags.length === 0) {
      return false;
    }

    return tags.some((tag) => docTags.includes(tag));
  });
}

/**
 * Filter memory documents by all required tags.
 *
 * @param documents - Array of memory documents
 * @param tags - Tags to filter by (document must have all)
 * @returns Filtered array of documents
 *
 * @example
 * ```typescript
 * const docs = filterMemoriesByAllTags(memories, ["api", "security"]);
 * // Returns documents that have both "api" AND "security" tags
 * ```
 *
 * @category Memory
 */
export function filterMemoriesByAllTags(
  documents: MemoryDocument[],
  tags: string[],
): MemoryDocument[] {
  if (tags.length === 0) {
    return documents;
  }

  return documents.filter((doc) => {
    const docTags = doc.metadata.tags;
    if (!docTags || docTags.length === 0) {
      return false;
    }

    return tags.every((tag) => docTags.includes(tag));
  });
}

// =============================================================================
// Auto-Load Filtering
// =============================================================================

/**
 * Filter memory documents by auto-load setting.
 *
 * @param documents - Array of memory documents
 * @returns Documents that should be auto-loaded
 *
 * @category Memory
 */
export function filterAutoLoadMemories(documents: MemoryDocument[]): MemoryDocument[] {
  return documents.filter((doc) => {
    // Default to true if not specified
    return doc.metadata.autoLoad !== false;
  });
}

/**
 * Filter additional files by auto-load setting.
 *
 * @param files - Array of additional memory files
 * @returns Files that should be auto-loaded
 *
 * @category Memory
 */
export function filterAutoLoadAdditionalFiles(
  files: AdditionalMemoryFile[],
): AdditionalMemoryFile[] {
  return files.filter((file) => {
    return file.metadata.autoLoad !== false;
  });
}
