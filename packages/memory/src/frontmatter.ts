import { parse, stringify } from "yaml";
import type {
  MemoryConfidence,
  MemoryEntry,
  MemoryFrontmatter,
  MemoryScope,
  MemorySource,
  MemoryType,
} from "./types.js";

const FRONTMATTER_DELIMITER = "---";

const VALID_TYPES = new Set<MemoryType>(["user", "feedback", "project", "reference"]);
const VALID_SCOPES = new Set<MemoryScope>(["global", "project", "agent"]);
const VALID_CONFIDENCES = new Set<MemoryConfidence>(["high", "medium", "low"]);
const VALID_SOURCES = new Set<MemorySource>([
  "extraction",
  "reflection",
  "manual",
  "promotion",
  "consolidation",
]);

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/**
 * Parses YAML frontmatter from a raw memory file string.
 *
 * @param raw - The raw file content including `---` delimiters
 * @returns Parsed frontmatter and body content, or `null` if parsing fails
 */
export function parseFrontmatter(
  raw: string,
): { frontmatter: MemoryFrontmatter; content: string } | null {
  // Normalise CRLF to LF for consistent parsing
  const normalised = raw.includes("\r\n") ? raw.replace(/\r\n/g, "\n") : raw;

  if (!normalised.startsWith(FRONTMATTER_DELIMITER)) {
    return null;
  }

  const secondDelimiter = normalised.indexOf(
    `\n${FRONTMATTER_DELIMITER}`,
    FRONTMATTER_DELIMITER.length,
  );

  if (secondDelimiter === -1) {
    return null;
  }

  const yamlBlock = normalised.slice(FRONTMATTER_DELIMITER.length + 1, secondDelimiter);
  const content = normalised.slice(secondDelimiter + 1 + FRONTMATTER_DELIMITER.length + 1);

  let parsed: Record<string, unknown>;
  try {
    parsed = parse(yamlBlock, { maxAliasCount: 0 }) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object") {
    return null;
  }

  if (!isString(parsed.name) || parsed.name.length === 0) {
    return null;
  }

  if (!isString(parsed.description) || parsed.description.length === 0) {
    return null;
  }

  if (!isString(parsed.type) || !VALID_TYPES.has(parsed.type as MemoryType)) {
    return null;
  }

  if (!isString(parsed.created) || parsed.created.length === 0) {
    return null;
  }

  if (!isString(parsed.modified) || parsed.modified.length === 0) {
    return null;
  }

  const scope =
    isString(parsed.scope) && VALID_SCOPES.has(parsed.scope as MemoryScope)
      ? (parsed.scope as MemoryScope)
      : "global";

  const tags = isStringArray(parsed.tags) ? parsed.tags : [];

  const confidence =
    isString(parsed.confidence) && VALID_CONFIDENCES.has(parsed.confidence as MemoryConfidence)
      ? (parsed.confidence as MemoryConfidence)
      : "medium";

  const source =
    isString(parsed.source) && VALID_SOURCES.has(parsed.source as MemorySource)
      ? (parsed.source as MemorySource)
      : "manual";

  const frontmatter: MemoryFrontmatter = {
    name: parsed.name,
    description: parsed.description,
    type: parsed.type as MemoryType,
    scope,
    tags,
    confidence,
    source,
    created: parsed.created,
    modified: parsed.modified,
  };

  if (isString(parsed.supersedes) && parsed.supersedes.length > 0) {
    frontmatter.supersedes = parsed.supersedes;
  }

  return { frontmatter, content: content.trim() };
}

/**
 * Serialises a frontmatter object and body content into a markdown string.
 *
 * @param frontmatter - The memory metadata
 * @param content - The body content
 * @returns A complete markdown string with YAML frontmatter
 */
export function serialiseFrontmatter(frontmatter: MemoryFrontmatter, content: string): string {
  const data: Record<string, unknown> = {
    name: frontmatter.name,
    description: frontmatter.description,
    type: frontmatter.type,
    scope: frontmatter.scope,
    tags: frontmatter.tags,
    confidence: frontmatter.confidence,
    source: frontmatter.source,
    created: frontmatter.created,
    modified: frontmatter.modified,
  };

  if (frontmatter.supersedes !== undefined) {
    data.supersedes = frontmatter.supersedes;
  }

  const yaml = stringify(data, { lineWidth: 0 }).trimEnd();

  return `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}\n\n${content.trim()}\n`;
}

/**
 * Parses a memory file from its path and raw content, returning a full {@link MemoryEntry}.
 *
 * @param path - The file path (used for the entry's `path` and `indexEntry` fields)
 * @param raw - The raw file content
 * @returns A complete MemoryEntry, or `null` if the file cannot be parsed
 */
export function parseMemoryFile(path: string, raw: string): MemoryEntry | null {
  const result = parseFrontmatter(raw);
  if (result === null) {
    return null;
  }

  const segments = path.split("/");
  const filename = segments[segments.length - 1] ?? path;

  const indexEntry = `- [${result.frontmatter.name}](${filename}) - ${result.frontmatter.description}`;

  return {
    path,
    frontmatter: result.frontmatter,
    content: result.content,
    indexEntry,
  };
}
