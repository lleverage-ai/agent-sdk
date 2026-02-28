/**
 * Memory store for persistent markdown-based memory.
 *
 * The memory system provides a two-tier architecture:
 * - **User-Level Memory**: `~/.deepagents/{agentId}/agent.md` - Personal preferences and cross-project patterns
 * - **Project-Level Memory**: `[git-root]/.deepagents/agent.md` - Project conventions and architecture decisions
 *
 * Memory documents support YAML frontmatter for metadata (path rules, tags, etc.)
 * and markdown content for human-readable instructions.
 *
 * @example
 * ```typescript
 * import { FilesystemMemoryStore } from "@lleverage-ai/agent-sdk";
 *
 * // Create filesystem-backed memory store
 * const store = new FilesystemMemoryStore();
 *
 * // Read a memory document
 * const doc = await store.read("~/.deepagents/my-agent/agent.md");
 * console.log(doc?.content);
 *
 * // Write a memory document
 * await store.write("/project/.deepagents/agent.md", {
 *   path: "/project/.deepagents/agent.md",
 *   metadata: { paths: ["src/**\/*.ts"] },
 *   content: "# Project Rules\n\nAlways use TypeScript strict mode.",
 *   modifiedAt: Date.now(),
 * });
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Memory Document Types
// =============================================================================

/**
 * YAML frontmatter metadata for a memory document.
 *
 * Frontmatter is optional and appears at the top of markdown files between `---` markers.
 *
 * @example
 * ```yaml
 * ---
 * paths:
 *   - "src/api/**\/*.ts"
 *   - "src/routes/**\/*.ts"
 * tags:
 *   - api
 *   - backend
 * ---
 * ```
 *
 * @category Memory
 */
export interface MemoryMetadata {
  /**
   * Path patterns this memory applies to (glob patterns).
   *
   * When set, the memory content will only be injected when working
   * with files matching these patterns.
   */
  paths?: string[];

  /**
   * Tags for categorizing and filtering memory.
   */
  tags?: string[];

  /**
   * Priority for ordering when multiple memories match (higher = first).
   * @defaultValue 0
   */
  priority?: number;

  /**
   * Whether this memory should be auto-loaded at start.
   * @defaultValue true
   */
  autoLoad?: boolean;

  /**
   * Any additional custom metadata fields.
   */
  [key: string]: unknown;
}

/**
 * A memory document with metadata and content.
 *
 * Memory documents are markdown files with optional YAML frontmatter.
 * They store persistent instructions, conventions, and preferences
 * that agents can use across conversations.
 *
 * @example
 * ```typescript
 * const doc: MemoryDocument = {
 *   path: "/home/user/.deepagents/coding-agent/agent.md",
 *   metadata: {
 *     paths: ["**\/*.ts"],
 *     tags: ["typescript", "coding"],
 *   },
 *   content: "# Coding Preferences\n\nAlways use strict TypeScript.",
 *   modifiedAt: Date.now(),
 * };
 * ```
 *
 * @category Memory
 */
export interface MemoryDocument {
  /**
   * Full path to the memory document.
   */
  path: string;

  /**
   * Parsed YAML frontmatter metadata.
   *
   * Empty object if no frontmatter is present.
   */
  metadata: MemoryMetadata;

  /**
   * The markdown content (without frontmatter).
   */
  content: string;

  /**
   * Timestamp when the document was last modified (Unix ms).
   */
  modifiedAt: number;
}

// =============================================================================
// Memory Store Interface
// =============================================================================

/**
 * Interface for storing and retrieving memory documents.
 *
 * Implement this interface to create custom storage backends.
 * The default implementation uses the filesystem.
 *
 * @example
 * ```typescript
 * class CustomMemoryStore implements MemoryStore {
 *   async read(path: string): Promise<MemoryDocument | undefined> {
 *     // Custom read implementation
 *   }
 *
 *   async write(path: string, document: MemoryDocument): Promise<void> {
 *     // Custom write implementation
 *   }
 *
 *   async delete(path: string): Promise<boolean> {
 *     // Custom delete implementation
 *   }
 *
 *   async list(pattern?: string): Promise<string[]> {
 *     // Custom list implementation
 *   }
 * }
 * ```
 *
 * @category Memory
 */
export interface MemoryStore {
  /**
   * Read a memory document by path.
   *
   * @param path - The path to the memory document
   * @returns The memory document if found, undefined otherwise
   */
  read(path: string): Promise<MemoryDocument | undefined>;

  /**
   * Write a memory document to the store.
   *
   * If the document exists, it will be overwritten.
   *
   * @param path - The path to write to
   * @param document - The document to write
   */
  write(path: string, document: MemoryDocument): Promise<void>;

  /**
   * Delete a memory document.
   *
   * @param path - The path to the document to delete
   * @returns True if the document was deleted, false if it didn't exist
   */
  delete(path: string): Promise<boolean>;

  /**
   * List all memory document paths matching a pattern.
   *
   * @param pattern - Optional glob pattern to filter (defaults to all .md files)
   * @returns Array of paths to matching documents
   */
  list(pattern?: string): Promise<string[]>;

  /**
   * Check if a document exists at the given path.
   *
   * @param path - The path to check
   * @returns True if the document exists
   */
  exists(path: string): Promise<boolean>;
}

// =============================================================================
// YAML Frontmatter Parsing
// =============================================================================

/**
 * Result from parsing a markdown file with frontmatter.
 *
 * @category Memory
 */
export interface ParsedMarkdown {
  /**
   * Parsed YAML frontmatter metadata.
   */
  metadata: MemoryMetadata;

  /**
   * The markdown content without frontmatter.
   */
  content: string;
}

/**
 * Parse YAML frontmatter from a markdown string.
 *
 * Frontmatter must be at the very beginning of the file,
 * surrounded by `---` delimiters.
 *
 * @param markdown - The full markdown string including frontmatter
 * @returns Parsed metadata and content
 *
 * @example
 * ```typescript
 * const markdown = `---
 * paths:
 *   - "src/**\/*.ts"
 * tags:
 *   - typescript
 * ---
 *
 * # My Rules
 *
 * Content here...`;
 *
 * const { metadata, content } = parseMarkdownWithFrontmatter(markdown);
 * // metadata = { paths: ["src/**\/*.ts"], tags: ["typescript"] }
 * // content = "# My Rules\n\nContent here..."
 * ```
 *
 * @category Memory
 */
export function parseMarkdownWithFrontmatter(markdown: string): ParsedMarkdown {
  // Check for frontmatter delimiter
  if (!markdown.startsWith("---")) {
    return { metadata: {}, content: markdown };
  }

  // Find the closing delimiter
  const endIndex = markdown.indexOf("\n---", 3);
  if (endIndex === -1) {
    // No closing delimiter, treat whole thing as content
    return { metadata: {}, content: markdown };
  }

  // Extract frontmatter and content
  const frontmatter = markdown.slice(4, endIndex).trim();
  const content = markdown.slice(endIndex + 4).trimStart();

  // Parse YAML frontmatter
  const metadata = parseSimpleYaml(frontmatter);

  return { metadata, content };
}

/**
 * Simple YAML parser for frontmatter.
 *
 * Supports:
 * - Key-value pairs (key: value)
 * - String values (bare or quoted)
 * - Number values
 * - Boolean values (true/false, yes/no)
 * - Arrays (list format with - prefix)
 * - Nested objects (indentation-based)
 *
 * Does NOT support:
 * - Inline arrays [a, b, c]
 * - Inline objects {a: 1, b: 2}
 * - Multi-line strings (|, >)
 * - Anchors and aliases
 * - Complex YAML features
 *
 * @param yaml - The YAML string to parse
 * @returns Parsed metadata object
 *
 * @category Memory
 * @internal
 */
export function parseSimpleYaml(yaml: string): MemoryMetadata {
  const result: MemoryMetadata = {};
  const lines = yaml.split("\n");

  let _currentKey: string | null = null;
  let currentArray: unknown[] | null = null;
  let currentIndent = 0;

  for (const line of lines) {
    // Skip empty lines and comments
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // Calculate indentation level
    const indent = line.length - line.trimStart().length;

    // Check if this is an array item
    if (trimmed.startsWith("- ")) {
      const value = parseYamlValue(trimmed.slice(2).trim());
      if (currentArray !== null) {
        currentArray.push(value);
      }
      continue;
    }

    // Check if this is a key-value pair
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      const valueStr = trimmed.slice(colonIndex + 1).trim();

      // Reset array tracking if we're at root level
      if (indent <= currentIndent) {
        currentArray = null;
      }

      // If value is empty, this might be the start of an array or nested object
      if (valueStr === "") {
        _currentKey = key;
        currentIndent = indent;
        currentArray = [];
        result[key] = currentArray;
      } else {
        // Simple key-value
        result[key] = parseYamlValue(valueStr);
        _currentKey = null;
        currentArray = null;
      }
    }
  }

  return result;
}

/**
 * Parse a YAML value string.
 *
 * @param value - The value string to parse
 * @returns The parsed value
 *
 * @internal
 */
function parseYamlValue(value: string): unknown {
  // Handle quoted strings
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Handle booleans
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "yes") return true;
  if (lower === "false" || lower === "no") return false;

  // Handle null
  if (lower === "null" || lower === "~") return null;

  // Handle numbers
  const num = Number(value);
  if (!Number.isNaN(num) && value !== "") return num;

  // Default to string
  return value;
}

/**
 * Serialize metadata and content back to markdown with frontmatter.
 *
 * @param document - The document to serialize
 * @returns Markdown string with YAML frontmatter
 *
 * @example
 * ```typescript
 * const markdown = serializeMarkdownWithFrontmatter({
 *   path: "/path/to/file.md",
 *   metadata: { paths: ["src/**"] },
 *   content: "# Title\n\nContent",
 *   modifiedAt: Date.now(),
 * });
 * // Returns:
 * // ---
 * // paths:
 * //   - "src/**"
 * // ---
 * // # Title
 * //
 * // Content
 * ```
 *
 * @category Memory
 */
export function serializeMarkdownWithFrontmatter(
  document: Omit<MemoryDocument, "path" | "modifiedAt">,
): string {
  const { metadata, content } = document;

  // Check if we have any metadata to serialize
  const hasMetadata = Object.keys(metadata).length > 0;

  if (!hasMetadata) {
    return content;
  }

  // Serialize metadata to YAML
  const yamlLines: string[] = ["---"];

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      yamlLines.push(`${key}:`);
      for (const item of value) {
        yamlLines.push(`  - ${serializeYamlValue(item)}`);
      }
    } else {
      yamlLines.push(`${key}: ${serializeYamlValue(value)}`);
    }
  }

  yamlLines.push("---");
  yamlLines.push("");

  return yamlLines.join("\n") + content;
}

/**
 * Serialize a value to YAML format.
 *
 * @param value - The value to serialize
 * @returns YAML string representation
 *
 * @internal
 */
function serializeYamlValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    // Quote strings that contain special characters
    if (
      value.includes(":") ||
      value.includes("#") ||
      value.includes("\n") ||
      value.startsWith(" ") ||
      value.endsWith(" ")
    ) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  // For complex objects, just stringify
  return JSON.stringify(value);
}
