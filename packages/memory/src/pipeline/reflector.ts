import { parseMemoryFile, serialiseFrontmatter } from "../frontmatter.js";
import { MemoryIndex } from "../memory-index.js";
import { basename, createMemoryPath, scopeDirectory } from "../path.js";
import type { MemoryPath, MemoryStore } from "../store/types.js";
import type { MemoryFrontmatter, MemoryScope } from "../types.js";
import { confidenceFromObservations, countSections } from "./heuristics.js";
import type {
  Heuristic,
  MemoryLLMProvider,
  ReflectionContext,
  ReflectionResult,
  Reflector,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGE_CONTENT_LENGTH = 2000;
const MAX_RECENT_MESSAGES = 60;
const JACCARD_MATCH_THRESHOLD = 0.5;

const VALID_CONFIDENCES = new Set(["high", "medium", "low"]);
const VALID_SCOPES = new Set(["global", "project", "agent"]);
const VALID_CATEGORIES = new Set([
  "approach",
  "debugging",
  "architecture",
  "testing",
  "communication",
  "tooling",
  "workflow",
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Stop words for significant-word extraction
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "in",
  "on",
  "for",
  "to",
  "of",
  "with",
  "when",
  "and",
  "or",
  "but",
  "is",
  "are",
  "was",
  "were",
  "be",
  "not",
  "do",
  "that",
  "this",
  "it",
  "by",
  "at",
  "from",
  "as",
  "if",
  "has",
  "have",
]);

// ---------------------------------------------------------------------------
// Reflection schema for structured generation
// ---------------------------------------------------------------------------

const reflectionSchema = {
  type: "object",
  properties: {
    heuristics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule: { type: "string" },
          context: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          category: {
            type: "string",
            enum: [
              "approach",
              "debugging",
              "architecture",
              "testing",
              "communication",
              "tooling",
              "workflow",
            ],
          },
          scope: { type: "string", enum: ["global", "project", "agent"] },
          antiPattern: { type: "string" },
        },
        required: ["rule", "context", "confidence", "category", "scope"],
      },
    },
  },
  required: ["heuristics"],
} as const;

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildReflectionPrompt(context: ReflectionContext): string {
  const { messages, existingMemories, scope, projectSlug, agentId } = context;

  const recent =
    messages.length > MAX_RECENT_MESSAGES ? messages.slice(-MAX_RECENT_MESSAGES) : messages;

  let prompt = "## Session context\n\n";
  prompt += `- Default scope: ${scope}\n`;
  if (projectSlug) {
    prompt += `- Project: ${projectSlug}\n`;
  }
  if (agentId) {
    prompt += `- Agent: ${agentId}\n`;
  }
  prompt += "\n";

  if (existingMemories.length > 0) {
    prompt += "## Existing heuristics\n\n";
    prompt += "These already exist. Only produce NEW heuristics or updates to existing ones:\n\n";
    for (const mem of existingMemories) {
      if (mem.frontmatter.source === "reflection") {
        prompt += `- **${mem.frontmatter.name}** (${mem.frontmatter.confidence}): ${mem.frontmatter.description}\n`;
      }
    }
    prompt += "\n";
  }

  prompt += "## Conversation transcript\n\n";
  for (const msg of recent) {
    let content = msg.content;
    if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
      content = `${content.slice(0, MAX_MESSAGE_CONTENT_LENGTH)}\n[...truncated]`;
    }
    prompt += `[${msg.role}]: ${content}\n\n`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateHeuristic(
  raw: Record<string, unknown>,
  projectSlug?: string,
  agentId?: string,
): Heuristic | null {
  const rule = typeof raw.rule === "string" ? raw.rule.trim() : "";
  if (rule.length === 0) {
    return null;
  }

  const context = typeof raw.context === "string" ? raw.context.trim() : "";
  if (context.length === 0) {
    return null;
  }

  const confidence =
    typeof raw.confidence === "string" && VALID_CONFIDENCES.has(raw.confidence)
      ? (raw.confidence as Heuristic["confidence"])
      : "medium";

  const category =
    typeof raw.category === "string" && VALID_CATEGORIES.has(raw.category)
      ? raw.category
      : "approach";

  let scope =
    typeof raw.scope === "string" && VALID_SCOPES.has(raw.scope)
      ? (raw.scope as MemoryScope)
      : "global";

  // Downgrade scope when the required identifier is missing
  if (scope === "agent" && !agentId) {
    scope = projectSlug ? "project" : "global";
  }
  if (scope === "project" && !projectSlug) {
    scope = "global";
  }

  const antiPattern =
    typeof raw.antiPattern === "string" && raw.antiPattern.trim().length > 0
      ? raw.antiPattern.trim()
      : undefined;

  // Also handle snake_case variant from LLMs
  const antiPatternFallback =
    typeof raw.anti_pattern === "string" && (raw.anti_pattern as string).trim().length > 0
      ? (raw.anti_pattern as string).trim()
      : undefined;

  return {
    rule,
    context,
    confidence,
    category,
    scope,
    antiPattern: antiPattern ?? antiPatternFallback,
  };
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

const NON_ALPHA_NUM = /[^a-z0-9 ]/g;

function significantWords(text: string): string[] {
  const cleaned = text.toLowerCase().replace(NON_ALPHA_NUM, " ");
  return cleaned.split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function toKebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function heuristicFilename(h: Heuristic): string {
  const words = significantWords(h.rule);
  const category = toKebabCase(h.category || "general");

  const slugWords = words.slice(0, 2);
  const parts = ["heuristic", category, ...slugWords];

  return `${parts.join("-")}.md`;
}

function firstNWords(text: string, n: number): string {
  const words = text.split(/\s+/);
  return words.slice(0, n).join(" ");
}

// ---------------------------------------------------------------------------
// Jaccard similarity
// ---------------------------------------------------------------------------

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) {
    return 1.0;
  }

  const setA = new Set(a);
  const setB = new Set(b);

  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) {
      intersection++;
    }
  }

  let union = setA.size;
  for (const w of setB) {
    if (!setA.has(w)) {
      union++;
    }
  }

  if (union === 0) {
    return 0;
  }
  return intersection / union;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a {@link Reflector} that extracts behavioural heuristics from conversation patterns.
 *
 * Analyses message history post-session to identify recurring preferences,
 * corrections, and workflow patterns worth preserving.
 *
 * @param provider - The LLM provider for heuristic extraction
 * @returns A configured Reflector instance
 */
export function createReflector(provider: MemoryLLMProvider): Reflector {
  return {
    async reflect(context: ReflectionContext): Promise<ReflectionResult> {
      const prompt = buildReflectionPrompt(context);

      const raw = await provider.generateStructured<{
        heuristics: Record<string, unknown>[];
      }>(prompt, reflectionSchema, { maxTokens: 4096, temperature: 0.3 });

      const heuristics: Heuristic[] = [];

      if (Array.isArray(raw.heuristics)) {
        for (const entry of raw.heuristics) {
          const validated = validateHeuristic(entry, context.projectSlug, context.agentId);
          if (validated !== null) {
            heuristics.push(validated);
          }
        }
      }

      return { heuristics, projectSlug: context.projectSlug, agentId: context.agentId };
    },

    async apply(result: ReflectionResult, store: MemoryStore): Promise<void> {
      if (result.heuristics.length === 0) {
        return;
      }

      const projectSlug = result.projectSlug;
      const agentId = result.agentId;

      await store.batch(
        {
          reason: "reflect",
          message: `Reflect: ${result.heuristics.length} ${result.heuristics.length === 1 ? "heuristic" : "heuristics"} from session`,
        },
        async (batch) => {
          const now = new Date().toISOString();
          const index = new MemoryIndex(store);

          for (const heuristic of result.heuristics) {
            const dir = scopeDirectory(heuristic.scope, projectSlug, agentId);
            const filename = heuristicFilename(heuristic);
            const path = createMemoryPath(`${dir}/${filename}`);

            const existing = await findExistingHeuristic(store, heuristic, dir);

            if (existing !== null) {
              // Merge: update confidence, append context
              const merged = mergeHeuristic(existing.content, heuristic, now);
              await batch.write(existing.path, encoder.encode(merged.markdown));

              await index.upsert({
                path: existing.path as string,
                frontmatter: merged.frontmatter,
                content: merged.body,
                indexEntry: `- [${merged.frontmatter.name}](${basename(existing.path)}) - ${merged.frontmatter.description}`,
              });
            } else {
              // Create new heuristic file
              const heading = firstNWords(heuristic.rule, 5);
              const category =
                heuristic.category.charAt(0).toUpperCase() + heuristic.category.slice(1);

              const frontmatter: MemoryFrontmatter = {
                name: `${category}: ${heading}`,
                description: truncate(heuristic.rule, 100),
                type: "feedback",
                scope: heuristic.scope,
                tags: ["heuristic", heuristic.category],
                confidence: heuristic.confidence,
                source: "reflection",
                created: now,
                modified: now,
              };

              let body = `${heuristic.rule}\n\n**Why:** ${heuristic.context}\n**How to apply:** ${deriveApplication(heuristic.rule)}`;

              if (heuristic.antiPattern !== undefined) {
                body += `\n\n**Anti-pattern:** ${heuristic.antiPattern}`;
              }

              const markdown = serialiseFrontmatter(frontmatter, body);
              await batch.write(path, encoder.encode(markdown));

              await index.upsert({
                path: path as string,
                frontmatter,
                content: body,
                indexEntry: `- [${frontmatter.name}](${filename}) - ${frontmatter.description}`,
              });
            }
          }
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Existing heuristic matching
// ---------------------------------------------------------------------------

type ExistingHeuristic = {
  path: MemoryPath;
  content: string;
};

async function findExistingHeuristic(
  store: MemoryStore,
  heuristic: Heuristic,
  dir: string,
): Promise<ExistingHeuristic | null> {
  let dirPath: MemoryPath;
  try {
    dirPath = createMemoryPath(dir);
  } catch {
    return null;
  }

  const exists = await store.exists(dirPath);
  if (!exists) {
    return null;
  }

  const files = await store.list(dirPath, { glob: "*.md" });
  const candidateWords = significantWords(heuristicFilename(heuristic));

  for (const file of files) {
    if (file.isDirectory) continue;

    const filename = basename(file.path);
    if (filename === "MEMORY.md") continue;

    const data = await store.read(file.path);
    if (data === null) continue;

    const raw = decoder.decode(data);
    const entry = parseMemoryFile(file.path as string, raw);
    if (entry === null) continue;

    // Must be a reflection-sourced heuristic
    if (entry.frontmatter.source !== "reflection") continue;
    if (!entry.frontmatter.tags.includes("heuristic")) continue;

    // Must match category
    if (!entry.frontmatter.tags.includes(heuristic.category)) continue;

    // Check filename similarity
    const existingWords = significantWords(filename);
    if (jaccardSimilarity(candidateWords, existingWords) > JACCARD_MATCH_THRESHOLD) {
      return { path: file.path, content: raw };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

type MergedHeuristic = {
  frontmatter: MemoryFrontmatter;
  body: string;
  markdown: string;
};

function mergeHeuristic(
  existingContent: string,
  heuristic: Heuristic,
  now: string,
): MergedHeuristic {
  const parsed = parseMemoryFile("merge-temp.md", existingContent);

  if (parsed === null) {
    // Fallback: treat as new
    const heading = firstNWords(heuristic.rule, 5);
    const category = heuristic.category.charAt(0).toUpperCase() + heuristic.category.slice(1);

    const frontmatter: MemoryFrontmatter = {
      name: `${category}: ${heading}`,
      description: truncate(heuristic.rule, 100),
      type: "feedback",
      scope: heuristic.scope,
      tags: ["heuristic", heuristic.category],
      confidence: heuristic.confidence,
      source: "reflection",
      created: now,
      modified: now,
    };

    let body = `${heuristic.rule}\n\n**Why:** ${heuristic.context}\n**How to apply:** ${deriveApplication(heuristic.rule)}`;
    if (heuristic.antiPattern !== undefined) {
      body += `\n\n**Anti-pattern:** ${heuristic.antiPattern}`;
    }

    return {
      frontmatter,
      body,
      markdown: serialiseFrontmatter(frontmatter, body),
    };
  }

  const existingBody = parsed.content;
  const observations = countSections(existingBody) + 1;
  const newConfidence = confidenceFromObservations(observations);

  const frontmatter: MemoryFrontmatter = {
    ...parsed.frontmatter,
    confidence: newConfidence,
    modified: now,
  };

  const heading = firstNWords(heuristic.rule, 5);
  let section = `\n\n## ${heading}\n\n${heuristic.rule}\n\n**Why:** ${heuristic.context}`;
  if (heuristic.antiPattern !== undefined) {
    section += `\n\n**Anti-pattern:** ${heuristic.antiPattern}`;
  }
  section += `\n\n**Confidence:** ${newConfidence} (${observations} observations)`;

  const body = existingBody.trimEnd() + section;

  return {
    frontmatter,
    body,
    markdown: serialiseFrontmatter(frontmatter, body),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  if (maxLen < 4) {
    return text.slice(0, maxLen);
  }
  return `${text.slice(0, maxLen - 3)}...`;
}

function deriveApplication(rule: string): string {
  const lower = rule.toLowerCase();

  if (lower.startsWith("when ")) {
    return `Apply this ${rule.slice(5)}`;
  }
  if (lower.startsWith("always ")) {
    return rule;
  }
  if (lower.startsWith("never ") || lower.startsWith("avoid ")) {
    return rule;
  }
  if (lower.startsWith("check ") || lower.startsWith("verify ")) {
    return `Before proceeding, ${rule.charAt(0).toLowerCase()}${rule.slice(1)}`;
  }

  return `Follow this rule: ${rule.charAt(0).toLowerCase()}${rule.slice(1)}`;
}
