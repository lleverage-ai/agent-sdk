/**
 * Filesystem tools for agent file operations.
 *
 * These tools wrap the BackendProtocol interface to provide file operations
 * to agents. Each tool is a factory function that takes a backend and returns
 * an AI SDK compatible tool.
 *
 * @packageDocumentation
 */

import { tool } from "ai";
import { z } from "zod";
import type { BackendProtocol, FileInfo, GrepMatch } from "../backend.js";

// =============================================================================
// Constants
// =============================================================================

/** Default number of lines to read from a file */
const DEFAULT_READ_LIMIT = 2000;

/** Character count threshold for warning (approximate tokens = chars / 4) */
const LARGE_CONTENT_WARNING_CHARS = 80_000; // ~20k tokens

// =============================================================================
// Read Tool
// =============================================================================

/**
 * Creates a tool for reading file contents.
 *
 * Reads files with line numbers and supports offset/limit for large files.
 * By default reads the first 2000 lines.
 *
 * @param backend - The backend to use for file operations
 * @returns An AI SDK compatible tool for reading files
 *
 * @example
 * ```typescript
 * import { createReadTool } from "@lleverage-ai/agent-sdk";
 *
 * const read = createReadTool(backend);
 * const agent = createAgent({
 *   model,
 *   tools: { read },
 * });
 * ```
 *
 * @category Tools
 */
export function createReadTool(backend: BackendProtocol) {
  return tool({
    description: `Read a file with line numbers. Default reads first ${DEFAULT_READ_LIMIT} lines. Use offset/limit for large files.`,
    inputSchema: z.object({
      file_path: z.string().describe("Absolute path to the file to read"),
      offset: z.number().optional().describe("Line number to start from (0-indexed)"),
      limit: z
        .number()
        .optional()
        .describe(`Maximum lines to read (default: ${DEFAULT_READ_LIMIT})`),
    }),
    execute: async ({
      file_path,
      offset,
      limit,
    }: {
      file_path: string;
      offset?: number;
      limit?: number;
    }) => {
      const effectiveLimit = limit ?? DEFAULT_READ_LIMIT;
      const content = await backend.read(file_path, offset, effectiveLimit);

      // Add warning for large content
      if (content.length > LARGE_CONTENT_WARNING_CHARS) {
        const estimatedTokens = Math.round(content.length / 4);
        return `[Warning: Large file content (~${estimatedTokens} tokens). Consider using offset/limit to read specific sections.]\n\n${content}`;
      }

      return content;
    },
  });
}

// =============================================================================
// Write Tool
// =============================================================================

/**
 * Creates a tool for writing/creating files.
 *
 * Creates new files or overwrites existing ones. Parent directories are
 * created automatically if they don't exist.
 *
 * @param backend - The backend to use for file operations
 * @returns An AI SDK compatible tool for writing files
 *
 * @example
 * ```typescript
 * import { createWriteTool } from "@lleverage-ai/agent-sdk";
 *
 * const write = createWriteTool(backend);
 * const agent = createAgent({
 *   model,
 *   tools: { write },
 * });
 * ```
 *
 * @category Tools
 */
export function createWriteTool(backend: BackendProtocol) {
  return tool({
    description:
      "Create or overwrite a file with the given content. Parent directories are created automatically.",
    inputSchema: z.object({
      file_path: z.string().describe("Absolute path for the file to write"),
      content: z.string().describe("Content to write to the file"),
    }),
    execute: async ({ file_path, content }: { file_path: string; content: string }) => {
      const result = await backend.write(file_path, content);

      if (!result.success) {
        return `Error: ${result.error}`;
      }

      const lines = content.split("\n").length;
      return `Successfully wrote ${lines} lines to ${file_path}`;
    },
  });
}

// =============================================================================
// Edit Tool
// =============================================================================

/**
 * Creates a tool for editing files via string replacement.
 *
 * Replaces text in a file. By default, the `old_string` must be unique
 * in the file to prevent accidental replacements. Use `replace_all: true`
 * to replace all occurrences.
 *
 * @param backend - The backend to use for file operations
 * @returns An AI SDK compatible tool for editing files
 *
 * @example
 * ```typescript
 * import { createEditTool } from "@lleverage-ai/agent-sdk";
 *
 * const edit = createEditTool(backend);
 * const agent = createAgent({
 *   model,
 *   tools: { edit },
 * });
 * ```
 *
 * @category Tools
 */
export function createEditTool(backend: BackendProtocol) {
  return tool({
    description:
      "Edit a file by replacing text. The old_string must be unique unless replace_all is true.",
    inputSchema: z.object({
      file_path: z.string().describe("Absolute path to the file to edit"),
      old_string: z.string().describe("Text to find and replace (must be unique in file)"),
      new_string: z.string().describe("Replacement text"),
      replace_all: z
        .boolean()
        .optional()
        .describe("If true, replace all occurrences. Default: false (unique match required)"),
    }),
    execute: async ({
      file_path,
      old_string,
      new_string,
      replace_all,
    }: {
      file_path: string;
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    }) => {
      const result = await backend.edit(file_path, old_string, new_string, replace_all);

      if (!result.success) {
        return `Error: ${result.error}`;
      }

      if (result.occurrences !== undefined && result.occurrences > 1) {
        return `Successfully replaced ${result.occurrences} occurrences in ${file_path}`;
      }

      return `Successfully edited ${file_path}`;
    },
  });
}

// =============================================================================
// Glob Tool
// =============================================================================

/**
 * Creates a tool for finding files matching glob patterns.
 *
 * Supports glob patterns like `**\/*.ts`, `src/**\/*.test.ts`, etc.
 *
 * @param backend - The backend to use for file operations
 * @returns An AI SDK compatible tool for glob searching
 *
 * @example
 * ```typescript
 * import { createGlobTool } from "@lleverage-ai/agent-sdk";
 *
 * const glob = createGlobTool(backend);
 * const agent = createAgent({
 *   model,
 *   tools: { glob },
 * });
 * ```
 *
 * @category Tools
 */
export function createGlobTool(backend: BackendProtocol) {
  return tool({
    description:
      'Find files matching a glob pattern. Supports patterns like "**/*.ts", "src/**/*.test.ts".',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern to match files (e.g., "**/*.ts")'),
      path: z.string().optional().describe("Base directory to search from (default: root)"),
    }),
    execute: async ({ pattern, path }: { pattern: string; path?: string }) => {
      const files = await backend.globInfo(pattern, path);
      return formatGlobOutput(files);
    },
  });
}

/**
 * Format glob output for display.
 * @internal
 */
function formatGlobOutput(files: FileInfo[]): string {
  if (files.length === 0) {
    return "No files found matching the pattern.";
  }

  const paths = files.map((f) => f.path);
  const header = `Found ${files.length} file(s):`;
  return `${header}\n${paths.join("\n")}`;
}

// =============================================================================
// Grep Tool
// =============================================================================

/**
 * Creates a tool for searching file contents with regex.
 *
 * Searches for pattern matches across files, with optional glob filtering.
 *
 * @param backend - The backend to use for file operations
 * @returns An AI SDK compatible tool for grep searching
 *
 * @example
 * ```typescript
 * import { createGrepTool } from "@lleverage-ai/agent-sdk";
 *
 * const grep = createGrepTool(backend);
 * const agent = createAgent({
 *   model,
 *   tools: { grep },
 * });
 * ```
 *
 * @category Tools
 */
export function createGrepTool(backend: BackendProtocol) {
  return tool({
    description:
      "Search for pattern matches in files using regex. Returns matching lines with file paths and line numbers.",
    inputSchema: z.object({
      pattern: z.string().describe("Regular expression pattern to search for"),
      path: z.string().optional().describe("Directory to search in (default: root)"),
      glob: z.string().optional().describe('Glob pattern to filter files (e.g., "*.ts")'),
    }),
    execute: async ({ pattern, path, glob }: { pattern: string; path?: string; glob?: string }) => {
      const result = await backend.grepRaw(pattern, path, glob);

      // Handle string result (some backends may return formatted string)
      if (typeof result === "string") {
        return result;
      }

      return formatGrepOutput(result);
    },
  });
}

/**
 * Format grep output for display.
 * @internal
 */
function formatGrepOutput(matches: GrepMatch[]): string {
  if (matches.length === 0) {
    return "No matches found.";
  }

  const lines = matches.map((m) => `${m.path}:${m.line}: ${m.text}`);
  const header = `Found ${matches.length} match(es):`;
  return `${header}\n${lines.join("\n")}`;
}

// =============================================================================
// Filesystem Tools Factory
// =============================================================================

/**
 * Options for creating filesystem tools.
 *
 * @category Tools
 */
export interface FilesystemToolsOptions {
  /** The backend to use for file operations */
  backend: BackendProtocol;

  /**
   * Whether to include the write tool.
   * @defaultValue true
   */
  includeWrite?: boolean;

  /**
   * Whether to include the edit tool.
   * @defaultValue true
   */
  includeEdit?: boolean;
}

/**
 * Result from createFilesystemTools containing all filesystem tools.
 *
 * @category Tools
 */
export interface FilesystemTools {
  /** Read file contents */
  read: ReturnType<typeof createReadTool>;
  /** Write/create files (optional) */
  write?: ReturnType<typeof createWriteTool>;
  /** Edit files via replacement (optional) */
  edit?: ReturnType<typeof createEditTool>;
  /** Find files by glob pattern */
  glob: ReturnType<typeof createGlobTool>;
  /** Search file contents */
  grep: ReturnType<typeof createGrepTool>;
}

/**
 * Creates all filesystem tools from a backend.
 *
 * This is a convenience factory that creates all filesystem tools at once.
 * For read-only access, set `includeWrite` and `includeEdit` to false.
 *
 * @param options - Configuration options
 * @returns Object containing all filesystem tools
 *
 * @example
 * ```typescript
 * import { createFilesystemTools, FilesystemBackend } from "@lleverage-ai/agent-sdk";
 *
 * const backend = new FilesystemBackend({ rootDir: process.cwd() });
 * const fsTools = createFilesystemTools({ backend });
 *
 * const agent = createAgent({
 *   model,
 *   tools: fsTools,
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Read-only mode
 * const fsTools = createFilesystemTools({
 *   backend,
 *   includeWrite: false,
 *   includeEdit: false,
 * });
 * ```
 *
 * @category Tools
 */
export function createFilesystemTools(options: FilesystemToolsOptions): FilesystemTools {
  const { backend, includeWrite = true, includeEdit = true } = options;

  const tools: FilesystemTools = {
    read: createReadTool(backend),
    glob: createGlobTool(backend),
    grep: createGrepTool(backend),
  };

  if (includeWrite) {
    tools.write = createWriteTool(backend);
  }

  if (includeEdit) {
    tools.edit = createEditTool(backend);
  }

  return tools;
}
