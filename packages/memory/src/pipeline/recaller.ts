import { parseMemoryFile } from "../frontmatter.js";
import { createMemoryPath, scopeDirectory } from "../path.js";
import type { MemoryPath, MemoryStore } from "../store/types.js";
import type { MemoryEntry, MemoryScope } from "../types.js";
import { extractWikilinks, resolveWikilink } from "../wikilink.js";
import type { MemoryLLMProvider, RecallContext, Recaller, SurfacedMemory } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RESULTS = 5;
const MAX_SCAN_FILES = 200;
const MAX_WIKILINK_EXTRAS = 2;
const CONTENT_PREVIEW_LENGTH = 200;

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

function scopeSearchOrder(scope: MemoryScope): MemoryScope[] {
  switch (scope) {
    case "agent":
      return ["agent", "project", "global"];
    case "project":
      return ["project", "global"];
    case "global":
      return ["global"];
  }
}

// ---------------------------------------------------------------------------
// Candidate gathering
// ---------------------------------------------------------------------------

const decoder = new TextDecoder();

async function gatherCandidates(
  store: MemoryStore,
  context: RecallContext,
): Promise<MemoryEntry[]> {
  const scopes = scopeSearchOrder(context.scope);
  const candidates: MemoryEntry[] = [];

  for (const scope of scopes) {
    if (candidates.length >= MAX_SCAN_FILES) break;

    const dir = scopeDirectory(scope, context.projectSlug, context.agentId);
    let dirPath: MemoryPath;
    try {
      dirPath = createMemoryPath(dir);
    } catch {
      continue;
    }

    const exists = await store.exists(dirPath);
    if (!exists) continue;

    const files = await store.list(dirPath, { glob: "*.md" });

    for (const file of files) {
      if (candidates.length >= MAX_SCAN_FILES) break;
      if (file.isDirectory) continue;

      const data = await store.read(file.path);
      if (data === null) continue;

      const raw = decoder.decode(data);
      const entry = parseMemoryFile(file.path as string, raw);
      if (entry !== null) {
        candidates.push(entry);
      }
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// LLM-based scoring
// ---------------------------------------------------------------------------

type ScoredCandidate = {
  index: number;
  relevance: number;
};

function buildSelectorPrompt(
  candidates: MemoryEntry[],
  query: string,
  mode?: "assistant" | "coding",
): string {
  const manifest = candidates
    .map((c, i) => {
      const preview =
        c.content.length > CONTENT_PREVIEW_LENGTH
          ? `${c.content.slice(0, CONTENT_PREVIEW_LENGTH)}...`
          : c.content;
      const scope = c.frontmatter.scope;
      const tags = c.frontmatter.tags.length > 0 ? ` [${c.frontmatter.tags.join(", ")}]` : "";
      return `${i + 1}. [${scope}]${tags} ${c.frontmatter.name}: ${c.frontmatter.description}\n   ${preview}`;
    })
    .join("\n\n");

  let modeHint = "";
  if (mode === "assistant") {
    modeHint =
      "\n\nThe user is in assistant mode - a conversational session. Prefer global/personal memories over project-specific ones unless the query is clearly about a specific codebase.";
  } else if (mode === "coding") {
    modeHint =
      "\n\nThe user is in coding mode - an AI coding session. Prefer project-specific memories over global ones unless the query is clearly about general user preferences.";
  }

  return `You are selecting memories that will be useful to an AI assistant as it processes a user's query.

Return a JSON array of objects with "index" (1-based) and "relevance" (0.0-1.0) for the most relevant memories. Only include memories you are confident will be helpful.

Consider:
- Direct relevance to the query
- Recency (recently modified memories may be more relevant)
- Type appropriateness (feedback memories for preference queries, project memories for codebase queries)

If no memories are relevant, return an empty array.
Respond with ONLY a valid JSON array, no other text.

Example: [{"index": 1, "relevance": 0.9}, {"index": 3, "relevance": 0.7}]${modeHint}

Query: ${query}

Available memories:
${manifest}`;
}

function parseScoredCandidates(response: string, maxResults: number): ScoredCandidate[] {
  const trimmed = response.trim();

  // Find the JSON array in the response
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  const jsonStr = trimmed.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const results: ScoredCandidate[] = [];
  for (const item of parsed) {
    if (
      typeof item === "object" &&
      item !== null &&
      "index" in item &&
      "relevance" in item &&
      typeof (item as Record<string, unknown>).index === "number" &&
      typeof (item as Record<string, unknown>).relevance === "number"
    ) {
      results.push({
        index: (item as Record<string, unknown>).index as number,
        relevance: (item as Record<string, unknown>).relevance as number,
      });
    }
  }

  return results.sort((a, b) => b.relevance - a.relevance).slice(0, maxResults);
}

async function scoreWithLLM(
  provider: MemoryLLMProvider,
  candidates: MemoryEntry[],
  context: RecallContext,
): Promise<SurfacedMemory[]> {
  const maxResults = context.maxResults ?? DEFAULT_MAX_RESULTS;
  const prompt = buildSelectorPrompt(candidates, context.query, context.mode);

  let response: string;
  try {
    response = await provider.generate(prompt, {
      maxTokens: 256,
      temperature: 0,
    });
  } catch {
    // Fall back to heuristic scoring on LLM failure
    return scoreWithHeuristics(candidates, context);
  }

  const scored = parseScoredCandidates(response, maxResults);
  if (scored.length === 0) {
    return [];
  }

  const results: SurfacedMemory[] = [];
  for (const { index, relevance } of scored) {
    const candidate = candidates[index - 1];
    if (candidate === undefined) continue;

    results.push({
      entry: candidate,
      relevanceScore: relevance,
      source: "direct",
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Heuristic scoring (no LLM)
// ---------------------------------------------------------------------------

function scoreWithHeuristics(candidates: MemoryEntry[], context: RecallContext): SurfacedMemory[] {
  const maxResults = context.maxResults ?? DEFAULT_MAX_RESULTS;
  const now = Date.now();
  const queryWords = new Set(
    context.query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

  const scored = candidates.map((entry) => {
    let score = 0;

    // Recency score: more recent modifications score higher
    const modified = Date.parse(entry.frontmatter.modified);
    if (!Number.isNaN(modified)) {
      const ageMs = now - modified;
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      // Exponential decay: half-life of 30 days
      score += Math.exp(-ageDays / 30) * 0.5;
    }

    // Tag matching: boost if tags overlap with query words
    for (const tag of entry.frontmatter.tags) {
      if (queryWords.has(tag.toLowerCase())) {
        score += 0.3;
      }
    }

    // Name/description matching: boost if query words appear in name or description
    const nameWords = entry.frontmatter.name.toLowerCase();
    const descWords = entry.frontmatter.description.toLowerCase();
    for (const word of queryWords) {
      if (nameWords.includes(word)) {
        score += 0.2;
      }
      if (descWords.includes(word)) {
        score += 0.1;
      }
    }

    // Scope weighting based on mode
    if (context.mode === "assistant" && entry.frontmatter.scope === "global") {
      score *= 1.5;
    } else if (context.mode === "coding" && entry.frontmatter.scope !== "global") {
      score *= 1.5;
    }

    return { entry, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ entry, score }) => ({
      entry,
      relevanceScore: Math.min(score, 1),
      source: "direct" as const,
    }));
}

// ---------------------------------------------------------------------------
// Wikilink following
// ---------------------------------------------------------------------------

async function followWikilinks(
  store: MemoryStore,
  directResults: SurfacedMemory[],
  context: RecallContext,
): Promise<SurfacedMemory[]> {
  const loadedPaths = new Set(directResults.map((r) => r.entry.path));
  const linked: SurfacedMemory[] = [];

  for (const result of directResults) {
    if (linked.length >= MAX_WIKILINK_EXTRAS) break;

    const refs = extractWikilinks(result.entry.content);

    for (const ref of refs) {
      if (linked.length >= MAX_WIKILINK_EXTRAS) break;

      const resolved = await resolveWikilink(ref, store, {
        scope: context.scope,
        projectSlug: context.projectSlug,
        agentId: context.agentId,
      });

      if (resolved === null) continue;
      if (loadedPaths.has(resolved.path)) continue;

      loadedPaths.add(resolved.path);
      linked.push({
        entry: resolved,
        relevanceScore: result.relevanceScore * 0.8,
        source: "wikilink",
      });
    }
  }

  return linked;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a {@link Recaller} that gathers and ranks candidate memories for a query.
 *
 * Uses heuristic scoring by default, or LLM-based scoring when a provider is given.
 *
 * @param store - The memory store to search
 * @param provider - Optional LLM provider for relevance scoring
 * @returns A configured Recaller instance
 */
export function createRecaller(store: MemoryStore, provider?: MemoryLLMProvider): Recaller {
  return {
    async recall(context: RecallContext): Promise<SurfacedMemory[]> {
      const candidates = await gatherCandidates(store, context);
      if (candidates.length === 0) {
        return [];
      }

      // Phase 2: score and rank
      const directResults =
        provider !== undefined
          ? await scoreWithLLM(provider, candidates, context)
          : scoreWithHeuristics(candidates, context);

      if (directResults.length === 0) {
        return [];
      }

      // Phase 3: follow wikilinks
      const linked = await followWikilinks(store, directResults, context);

      // Merge and sort by relevance
      const all = [...directResults, ...linked];
      all.sort((a, b) => b.relevanceScore - a.relevanceScore);

      return all;
    },
  };
}
