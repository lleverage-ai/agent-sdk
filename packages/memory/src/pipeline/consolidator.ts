import { parseMemoryFile, serialiseFrontmatter } from "../frontmatter.js";
import { MemoryIndex } from "../memory-index.js";
import { basename, createMemoryPath } from "../path.js";
import type { MemoryPath, MemoryStore } from "../store/types.js";
import type { MemoryConfidence, MemoryEntry, MemoryFrontmatter, MemoryScope } from "../types.js";
import type {
  ConsolidationOptions,
  ConsolidationReport,
  Consolidator,
  MemoryLLMProvider,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_STALENESS_THRESHOLD_DAYS = 90;
const TRIGRAM_SIMILARITY_THRESHOLD = 0.6;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

function scopeDirectory(scope: MemoryScope, projectSlug?: string, agentId?: string): string {
  switch (scope) {
    case "global":
      return "memory/global";
    case "project":
      return `memory/project/${projectSlug}`;
    case "agent":
      return `memory/agent/${agentId}`;
  }
}

type ScopeDescriptor = {
  scope: MemoryScope;
  projectSlug?: string;
  agentId?: string;
  dir: string;
};

async function discoverScopes(store: MemoryStore): Promise<ScopeDescriptor[]> {
  const descriptors: ScopeDescriptor[] = [];

  // Always include global
  const globalDir = scopeDirectory("global");
  try {
    const globalPath = createMemoryPath(globalDir);
    if (await store.exists(globalPath)) {
      descriptors.push({ scope: "global", dir: globalDir });
    }
  } catch {
    // Invalid path, skip
  }

  // Discover project scopes
  try {
    const projectsPath = createMemoryPath("memory/project");
    if (await store.exists(projectsPath)) {
      const projectDirs = await store.list(projectsPath);
      for (const entry of projectDirs) {
        if (entry.isDirectory) {
          const slug = basename(entry.path);
          descriptors.push({
            scope: "project",
            projectSlug: slug,
            dir: `memory/project/${slug}`,
          });
        }
      }
    }
  } catch {
    // No projects directory, skip
  }

  // Discover agent scopes
  try {
    const agentsPath = createMemoryPath("memory/agent");
    if (await store.exists(agentsPath)) {
      const agentDirs = await store.list(agentsPath);
      for (const entry of agentDirs) {
        if (entry.isDirectory) {
          const id = basename(entry.path);
          descriptors.push({
            scope: "agent",
            agentId: id,
            dir: `memory/agent/${id}`,
          });
        }
      }
    }
  } catch {
    // No agents directory, skip
  }

  return descriptors;
}

// ---------------------------------------------------------------------------
// Trigram similarity
// ---------------------------------------------------------------------------

function trigrams(text: string): Set<string> {
  const padded = `  ${text.toLowerCase()}  `;
  const result = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
}

function trigramJaccard(a: string, b: string): number {
  const triA = trigrams(a);
  const triB = trigrams(b);

  if (triA.size === 0 && triB.size === 0) {
    return 1.0;
  }

  let intersection = 0;
  for (const t of triA) {
    if (triB.has(t)) {
      intersection++;
    }
  }

  let union = triA.size;
  for (const t of triB) {
    if (!triA.has(t)) {
      union++;
    }
  }

  if (union === 0) {
    return 0;
  }
  return intersection / union;
}

// ---------------------------------------------------------------------------
// Memory loading helpers
// ---------------------------------------------------------------------------

async function loadAllMemories(store: MemoryStore, dir: string): Promise<MemoryEntry[]> {
  let dirPath: MemoryPath;
  try {
    dirPath = createMemoryPath(dir);
  } catch {
    return [];
  }

  const exists = await store.exists(dirPath);
  if (!exists) {
    return [];
  }

  const files = await store.list(dirPath, { glob: "*.md" });
  const entries: MemoryEntry[] = [];

  for (const file of files) {
    if (file.isDirectory) continue;

    const filename = basename(file.path);
    if (filename === "MEMORY.md") continue;

    const data = await store.read(file.path);
    if (data === null) continue;

    const raw = decoder.decode(data);
    const entry = parseMemoryFile(file.path as string, raw);
    if (entry !== null) {
      entries.push(entry);
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

const DEDUP_SYSTEM_PROMPT = `You are analysing two memory files for overlap. Determine whether they cover the same topic or are distinct.

Respond with ONLY a JSON object:
{
  "verdict": "keep_first" | "keep_second" | "merge" | "distinct",
  "reason": "brief explanation",
  "mergedContent": "only present when verdict is merge - the combined content"
}

- "distinct": files cover different topics, keep both
- "keep_first": files overlap, the first is more complete - delete the second
- "keep_second": files overlap, the second is more complete - delete the first
- "merge": files have complementary information - combine into one, provide mergedContent

Respond with ONLY valid JSON, no other text.`;

const dedupSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["keep_first", "keep_second", "merge", "distinct"] },
    reason: { type: "string" },
    mergedContent: { type: "string" },
  },
  required: ["verdict", "reason"],
} as const;

type DedupVerdict = {
  verdict: "keep_first" | "keep_second" | "merge" | "distinct";
  reason: string;
  mergedContent?: string;
};

async function resolveDuplicate(
  provider: MemoryLLMProvider,
  entryA: MemoryEntry,
  entryB: MemoryEntry,
): Promise<DedupVerdict> {
  const filenameA = basename(createMemoryPath(entryA.path));
  const filenameB = basename(createMemoryPath(entryB.path));

  const prompt = `## File 1: ${filenameA}\n\n${entryA.content}\n\n---\n\n## File 2: ${filenameB}\n\n${entryB.content}`;

  try {
    const result = await provider.generateStructured<DedupVerdict>(
      `${DEDUP_SYSTEM_PROMPT}\n\n${prompt}`,
      dedupSchema,
      { maxTokens: 2048, temperature: 0 },
    );

    const validVerdicts = new Set(["keep_first", "keep_second", "merge", "distinct"]);
    if (!validVerdicts.has(result.verdict)) {
      return { verdict: "distinct", reason: "Invalid verdict from LLM" };
    }

    return result;
  } catch {
    return { verdict: "distinct", reason: "LLM call failed" };
  }
}

// ---------------------------------------------------------------------------
// Heuristic reinforcement
// ---------------------------------------------------------------------------

function confidenceFromObservations(count: number): MemoryConfidence {
  if (count >= 5) return "high";
  if (count >= 3) return "medium";
  return "low";
}

function countSections(body: string): number {
  let count = 0;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("## ")) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createConsolidator(provider?: MemoryLLMProvider): Consolidator {
  return {
    async consolidate(
      store: MemoryStore,
      options?: ConsolidationOptions,
    ): Promise<ConsolidationReport> {
      const stalenessThresholdDays =
        options?.stalenessThresholdDays ?? DEFAULT_STALENESS_THRESHOLD_DAYS;
      const llmDedup = options?.llmDedup ?? provider !== undefined;

      const report: ConsolidationReport = {
        indexRebuilt: false,
        staleMemories: [],
        duplicatesResolved: 0,
        heuristicsReinforced: 0,
        promotedToKnowledge: 0,
      };

      const scopes = await discoverScopes(store);

      // 1. Index rebuild
      const index = new MemoryIndex(store);
      for (const desc of scopes) {
        await index.rebuild(desc.scope, desc.projectSlug, desc.agentId);
      }
      report.indexRebuilt = scopes.length > 0;

      // 2. Staleness detection
      const staleThreshold = new Date();
      staleThreshold.setDate(staleThreshold.getDate() - stalenessThresholdDays);

      for (const desc of scopes) {
        const entries = await loadAllMemories(store, desc.dir);

        for (const entry of entries) {
          const modified = entry.frontmatter.modified;
          if (modified.length === 0) continue;

          const modifiedDate = new Date(modified);
          if (Number.isNaN(modifiedDate.getTime())) continue;

          if (modifiedDate < staleThreshold) {
            report.staleMemories.push(entry.path);
          }
        }
      }

      // 3. Deduplication
      for (const desc of scopes) {
        const entries = await loadAllMemories(store, desc.dir);
        if (entries.length < 2) continue;

        // Find candidate pairs using trigram similarity on filenames
        const pairs: Array<[number, number]> = [];
        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const filenameA = basename(createMemoryPath(entries[i]!.path));
            const filenameB = basename(createMemoryPath(entries[j]!.path));

            if (trigramJaccard(filenameA, filenameB) > TRIGRAM_SIMILARITY_THRESHOLD) {
              pairs.push([i, j]);
            }
          }
        }

        if (pairs.length === 0) continue;

        if (!llmDedup || provider === undefined) {
          // Without LLM, just report candidates without resolving
          continue;
        }

        // Resolve with LLM inside a batch
        const deletedPaths = new Set<string>();

        await store.batch(
          {
            reason: "consolidate",
            message: `Consolidate: resolve ${pairs.length} duplicate ${pairs.length === 1 ? "pair" : "pairs"} in ${desc.dir}`,
          },
          async (batch) => {
            for (const [idxA, idxB] of pairs) {
              const entryA = entries[idxA]!;
              const entryB = entries[idxB]!;

              // Skip if either was already deleted in this batch
              if (deletedPaths.has(entryA.path) || deletedPaths.has(entryB.path)) {
                continue;
              }

              const verdict = await resolveDuplicate(provider, entryA, entryB);

              switch (verdict.verdict) {
                case "keep_first": {
                  const pathB = createMemoryPath(entryB.path);
                  await batch.delete(pathB);
                  deletedPaths.add(entryB.path);
                  report.duplicatesResolved++;
                  break;
                }

                case "keep_second": {
                  const pathA = createMemoryPath(entryA.path);
                  await batch.delete(pathA);
                  deletedPaths.add(entryA.path);
                  report.duplicatesResolved++;
                  break;
                }

                case "merge": {
                  // Keep the more recently modified entry, merge content
                  const modA = new Date(entryA.frontmatter.modified);
                  const modB = new Date(entryB.frontmatter.modified);
                  const keeper = modA >= modB ? entryA : entryB;
                  const donor = modA >= modB ? entryB : entryA;

                  const mergedContent =
                    verdict.mergedContent ?? `${keeper.content}\n\n---\n\n${donor.content}`;

                  const now = new Date().toISOString();
                  const frontmatter: MemoryFrontmatter = {
                    ...keeper.frontmatter,
                    modified: now,
                    supersedes: basename(createMemoryPath(donor.path)),
                  };

                  const markdown = serialiseFrontmatter(frontmatter, mergedContent);
                  const keeperPath = createMemoryPath(keeper.path);
                  const donorPath = createMemoryPath(donor.path);

                  await batch.write(keeperPath, encoder.encode(markdown));
                  await batch.delete(donorPath);
                  deletedPaths.add(donor.path);
                  report.duplicatesResolved++;
                  break;
                }

                case "distinct":
                  // No action needed
                  break;
              }
            }
          },
        );

        // Rebuild index after deduplication if changes were made
        if (deletedPaths.size > 0) {
          await index.rebuild(desc.scope, desc.projectSlug, desc.agentId);
        }
      }

      // 4. Heuristic reinforcement
      for (const desc of scopes) {
        const entries = await loadAllMemories(store, desc.dir);

        // Find reflection-sourced feedback memories
        const heuristics = entries.filter(
          (e) =>
            e.frontmatter.type === "feedback" &&
            e.frontmatter.source === "reflection" &&
            e.frontmatter.tags.includes("heuristic"),
        );

        // Group by category (second tag after "heuristic")
        const byCategory = new Map<string, MemoryEntry[]>();
        for (const h of heuristics) {
          const categoryTag = h.frontmatter.tags.find((t) => t !== "heuristic") ?? "general";
          const existing = byCategory.get(categoryTag) ?? [];
          existing.push(h);
          byCategory.set(categoryTag, existing);
        }

        // Check each heuristic's observation count and reinforce confidence
        let scopeUpdated = false;

        await store.batch(
          {
            reason: "consolidate",
            message: `Consolidate: reinforce heuristics in ${desc.dir}`,
          },
          async (batch) => {
            for (const h of heuristics) {
              const observations = countSections(h.content);
              const expectedConfidence = confidenceFromObservations(observations);

              if (expectedConfidence === h.frontmatter.confidence) {
                continue;
              }

              const now = new Date().toISOString();
              const updatedFrontmatter: MemoryFrontmatter = {
                ...h.frontmatter,
                confidence: expectedConfidence,
                modified: now,
              };

              const markdown = serialiseFrontmatter(updatedFrontmatter, h.content);
              const path = createMemoryPath(h.path);
              await batch.write(path, encoder.encode(markdown));

              report.heuristicsReinforced++;
              scopeUpdated = true;
            }
          },
        );

        if (scopeUpdated) {
          await index.rebuild(desc.scope, desc.projectSlug, desc.agentId);
        }
      }

      return report;
    },
  };
}
