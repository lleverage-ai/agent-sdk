import type { MemoryPath } from "../store/types.js";
import { porterStem, STOP_WORDS } from "./stemmer.js";
import type { IndexEntry, SearchIndex, SearchOptions, SearchResult } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 20;
const K1 = 1.5;
const B = 0.75;

const FIELD_WEIGHTS = {
  title: 10,
  description: 5,
  tags: 4,
  content: 1,
} as const;

type Field = keyof typeof FIELD_WEIGHTS;

const FIELDS: Field[] = ["title", "description", "tags", "content"];

// ---------------------------------------------------------------------------
// Tokenisation
// ---------------------------------------------------------------------------

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t))
    .map(porterStem);
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type FieldFreqs = Record<Field, number>;

type PostingEntry = {
  fieldFreqs: FieldFreqs;
};

type DocMeta = {
  entry: IndexEntry;
  fieldLengths: Record<Field, number>;
  terms: Set<string>;
};

// ---------------------------------------------------------------------------
// BM25 index
// ---------------------------------------------------------------------------

export function createBM25Index(): SearchIndex {
  const docs = new Map<string, DocMeta>();
  const invertedIndex = new Map<string, Map<string, PostingEntry>>();
  const totalFieldLengths: Record<Field, number> = {
    title: 0,
    description: 0,
    tags: 0,
    content: 0,
  };

  function fieldText(entry: IndexEntry, field: Field): string {
    if (field === "tags") return entry.tags.join(" ");
    return entry[field];
  }

  function addDoc(entry: IndexEntry): void {
    const path = entry.path as string;

    // Remove existing entry at this path first
    if (docs.has(path)) {
      removeDoc(path);
    }

    const fieldLengths: Record<Field, number> = {
      title: 0,
      description: 0,
      tags: 0,
      content: 0,
    };

    const fieldTokens: Record<Field, string[]> = {
      title: tokenise(fieldText(entry, "title")),
      description: tokenise(fieldText(entry, "description")),
      tags: tokenise(fieldText(entry, "tags")),
      content: tokenise(fieldText(entry, "content")),
    };

    const docTerms = new Set<string>();

    for (const field of FIELDS) {
      const tokens = fieldTokens[field];
      fieldLengths[field] = tokens.length;
      totalFieldLengths[field] += tokens.length;

      const termFreqs = new Map<string, number>();
      for (const token of tokens) {
        termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
      }

      for (const [term, freq] of termFreqs) {
        docTerms.add(term);

        let postings = invertedIndex.get(term);
        if (!postings) {
          postings = new Map<string, PostingEntry>();
          invertedIndex.set(term, postings);
        }
        let posting = postings.get(path);
        if (!posting) {
          posting = {
            fieldFreqs: { title: 0, description: 0, tags: 0, content: 0 },
          };
          postings.set(path, posting);
        }
        posting.fieldFreqs[field] = freq;
      }
    }

    docs.set(path, { entry, fieldLengths, terms: docTerms });
  }

  function removeDoc(path: string): void {
    const meta = docs.get(path);
    if (!meta) return;

    for (const field of FIELDS) {
      totalFieldLengths[field] -= meta.fieldLengths[field];
    }

    for (const term of meta.terms) {
      const postings = invertedIndex.get(term);
      if (postings) {
        postings.delete(path);
        if (postings.size === 0) {
          invertedIndex.delete(term);
        }
      }
    }

    docs.delete(path);
  }

  function matchesFilters(meta: DocMeta, options?: SearchOptions): boolean {
    if (!options) return true;

    if (options.scope !== undefined && meta.entry.scope !== options.scope) {
      return false;
    }

    if (options.projectSlug !== undefined && meta.entry.projectSlug !== options.projectSlug) {
      return false;
    }

    if (options.agentId !== undefined && meta.entry.agentId !== options.agentId) {
      return false;
    }

    if (options.types !== undefined && options.types.length > 0) {
      const pathStr = meta.entry.path as string;
      const matchesType = options.types.some(
        (t) => pathStr.includes(`/${t}/`) || pathStr.startsWith(`${t}/`),
      );
      if (!matchesType) return false;
    }

    return true;
  }

  function computeBM25(queryTerms: string[], options?: SearchOptions): SearchResult[] {
    const docCount = docs.size;
    if (docCount === 0) return [];

    const avgFieldLengths: Record<Field, number> = {
      title: totalFieldLengths.title / docCount,
      description: totalFieldLengths.description / docCount,
      tags: totalFieldLengths.tags / docCount,
      content: totalFieldLengths.content / docCount,
    };

    const scores = new Map<string, number>();

    for (const term of queryTerms) {
      const postings = invertedIndex.get(term);
      if (!postings) continue;

      // Document frequency for this term
      const df = postings.size;
      // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);

      for (const [path, posting] of postings) {
        const meta = docs.get(path);
        if (!meta) continue;

        let fieldScore = 0;
        for (const field of FIELDS) {
          const tf = posting.fieldFreqs[field];
          if (tf === 0) continue;

          const dl = meta.fieldLengths[field];
          const avgdl = avgFieldLengths[field] || 1;
          const weight = FIELD_WEIGHTS[field];

          // BM25 per-field score
          const numerator = tf * (K1 + 1);
          const denominator = tf + K1 * (1 - B + B * (dl / avgdl));
          fieldScore += weight * idf * (numerator / denominator);
        }

        scores.set(path, (scores.get(path) ?? 0) + fieldScore);
      }
    }

    const limit = options?.limit ?? DEFAULT_LIMIT;

    const results: SearchResult[] = [];
    for (const [path, score] of scores) {
      if (score <= 0) continue;

      const meta = docs.get(path);
      if (!meta) continue;
      if (!matchesFilters(meta, options)) continue;

      results.push({
        path: path as MemoryPath,
        score,
        title: meta.entry.title,
        description: meta.entry.description,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  const index: SearchIndex = {
    async index(entries: IndexEntry[]): Promise<void> {
      for (const entry of entries) {
        addDoc(entry);
      }
    },

    async remove(paths: MemoryPath[]): Promise<void> {
      for (const path of paths) {
        removeDoc(path as string);
      }
    },

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      const queryTerms = tokenise(query);
      if (queryTerms.length === 0) return [];
      return computeBM25(queryTerms, options);
    },

    async rebuild(): Promise<void> {
      // No-op: the in-memory index is always consistent.
    },
  };

  return index;
}
