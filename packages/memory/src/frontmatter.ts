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

export function parseFrontmatter(
  raw: string,
): { frontmatter: MemoryFrontmatter; content: string } | null {
  if (!raw.startsWith(FRONTMATTER_DELIMITER)) {
    return null;
  }

  const secondDelimiter = raw.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length);

  if (secondDelimiter === -1) {
    return null;
  }

  const yamlBlock = raw.slice(FRONTMATTER_DELIMITER.length + 1, secondDelimiter);
  const content = raw.slice(secondDelimiter + 1 + FRONTMATTER_DELIMITER.length + 1);

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
