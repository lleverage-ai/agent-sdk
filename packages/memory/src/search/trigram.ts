import type { MemoryPath } from "../store/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TrigramResult = {
  path: MemoryPath;
  title: string;
  score: number;
};

export type TrigramIndex = {
  index(entries: { path: MemoryPath; title: string }[]): void;
  search(query: string, options?: { limit?: number; minScore?: number }): TrigramResult[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIN_SCORE = 0.3;
const DEFAULT_LIMIT = 10;
const BOUNDARY = "$";

// ---------------------------------------------------------------------------
// Trigram computation
// ---------------------------------------------------------------------------

export function computeTrigrams(text: string): Set<string> {
  const padded = `${BOUNDARY}${BOUNDARY}${text.toLowerCase()}${BOUNDARY}`;
  const trigrams = new Set<string>();

  for (let i = 0; i <= padded.length - 3; i++) {
    trigrams.add(padded.slice(i, i + 3));
  }

  return trigrams;
}

// ---------------------------------------------------------------------------
// Set operations
// ---------------------------------------------------------------------------

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;

  for (const item of smaller) {
    if (larger.has(item)) {
      count++;
    }
  }

  return count;
}

function unionSize(a: Set<string>, b: Set<string>): number {
  const larger = a.size >= b.size ? a : b;
  const smaller = a.size >= b.size ? b : a;
  let size = larger.size;

  for (const item of smaller) {
    if (!larger.has(item)) {
      size++;
    }
  }

  return size;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

type IndexedEntry = {
  path: MemoryPath;
  title: string;
  trigrams: Set<string>;
};

export function createTrigramIndex(): TrigramIndex {
  let entries: IndexedEntry[] = [];

  return {
    index(input: { path: MemoryPath; title: string }[]): void {
      entries = input.map((entry) => ({
        path: entry.path,
        title: entry.title,
        trigrams: computeTrigrams(entry.title),
      }));
    },

    search(query: string, options?: { limit?: number; minScore?: number }): TrigramResult[] {
      const limit = options?.limit ?? DEFAULT_LIMIT;
      const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
      const queryTrigrams = computeTrigrams(query);

      if (queryTrigrams.size === 0) {
        return [];
      }

      const scored: TrigramResult[] = [];

      for (const entry of entries) {
        if (entry.trigrams.size === 0) {
          continue;
        }

        const intersection = intersectionSize(queryTrigrams, entry.trigrams);
        const union = unionSize(queryTrigrams, entry.trigrams);

        if (union === 0) {
          continue;
        }

        const score = intersection / union;

        if (score >= minScore) {
          scored.push({
            path: entry.path,
            title: entry.title,
            score,
          });
        }
      }

      scored.sort((a, b) => b.score - a.score);

      return scored.slice(0, limit);
    },
  };
}
