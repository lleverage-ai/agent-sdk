import type { MemoryPath } from "../store/types.js";
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

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "can",
  "could",
  "and",
  "but",
  "or",
  "nor",
  "for",
  "so",
  "yet",
  "both",
  "either",
  "neither",
  "not",
  "only",
  "own",
  "same",
  "than",
  "too",
  "very",
  "just",
  "about",
  "above",
  "after",
  "again",
  "all",
  "also",
  "any",
  "because",
  "before",
  "between",
  "by",
  "each",
  "few",
  "from",
  "further",
  "get",
  "got",
  "here",
  "how",
  "if",
  "in",
  "into",
  "it",
  "its",
  "more",
  "most",
  "much",
  "no",
  "of",
  "off",
  "on",
  "once",
  "other",
  "our",
  "out",
  "over",
  "some",
  "such",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "under",
  "until",
  "up",
  "upon",
  "us",
  "we",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "with",
  "you",
  "your",
]);

// ---------------------------------------------------------------------------
// Porter stemmer (minimal)
// ---------------------------------------------------------------------------

function measure(stem: string): number {
  const vowels = /[aeiou]/;
  const consonant = /[^aeiou]/;
  let m = 0;
  let i = 0;
  const len = stem.length;

  // Skip leading consonants
  while (i < len && consonant.test(stem[i]!)) i++;

  while (i < len) {
    // Count vowel sequence
    while (i < len && vowels.test(stem[i]!)) i++;
    if (i >= len) break;
    // Count consonant sequence
    while (i < len && consonant.test(stem[i]!)) i++;
    m++;
  }
  return m;
}

function hasVowel(stem: string): boolean {
  return /[aeiou]/.test(stem);
}

function endsWithDouble(stem: string): boolean {
  if (stem.length < 2) return false;
  const last = stem[stem.length - 1]!;
  return last === stem[stem.length - 2] && /[^aeiou]/.test(last);
}

function cvc(stem: string): boolean {
  if (stem.length < 3) return false;
  const c1 = stem[stem.length - 3]!;
  const v = stem[stem.length - 2]!;
  const c2 = stem[stem.length - 1]!;
  return /[^aeiou]/.test(c1) && /[aeiou]/.test(v) && /[^aeiou]/.test(c2) && !/[wxy]/.test(c2);
}

function step1a(word: string): string {
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("ies")) return word.slice(0, -2);
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function step1b(word: string): string {
  if (word.endsWith("eed")) {
    const stem = word.slice(0, -3);
    if (measure(stem) > 0) return `${stem}ee`;
    return word;
  }

  let stemmed = "";
  let matched = false;

  if (word.endsWith("ed")) {
    const stem = word.slice(0, -2);
    if (hasVowel(stem)) {
      stemmed = stem;
      matched = true;
    }
  } else if (word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    if (hasVowel(stem)) {
      stemmed = stem;
      matched = true;
    }
  }

  if (!matched) return word;

  if (stemmed.endsWith("at") || stemmed.endsWith("bl") || stemmed.endsWith("iz")) {
    return `${stemmed}e`;
  }
  if (endsWithDouble(stemmed) && !/[lsz]$/.test(stemmed)) {
    return stemmed.slice(0, -1);
  }
  if (measure(stemmed) === 1 && cvc(stemmed)) {
    return `${stemmed}e`;
  }
  return stemmed;
}

function step1c(word: string): string {
  if (word.endsWith("y") && hasVowel(word.slice(0, -1))) {
    return `${word.slice(0, -1)}i`;
  }
  return word;
}

const STEP2_SUFFIXES: [string, string][] = [
  ["ational", "ate"],
  ["tional", "tion"],
  ["enci", "ence"],
  ["anci", "ance"],
  ["izer", "ize"],
  ["abli", "able"],
  ["alli", "al"],
  ["entli", "ent"],
  ["eli", "e"],
  ["ousli", "ous"],
  ["ization", "ize"],
  ["ation", "ate"],
  ["ator", "ate"],
  ["alism", "al"],
  ["iveness", "ive"],
  ["fulness", "ful"],
  ["ousness", "ous"],
  ["aliti", "al"],
  ["iviti", "ive"],
  ["biliti", "ble"],
];

function step2(word: string): string {
  for (const [suffix, replacement] of STEP2_SUFFIXES) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) return stem + replacement;
      return word;
    }
  }
  return word;
}

const STEP3_SUFFIXES: [string, string][] = [
  ["icate", "ic"],
  ["ative", ""],
  ["alize", "al"],
  ["iciti", "ic"],
  ["ical", "ic"],
  ["ful", ""],
  ["ness", ""],
];

function step3(word: string): string {
  for (const [suffix, replacement] of STEP3_SUFFIXES) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) return stem + replacement;
      return word;
    }
  }
  return word;
}

const STEP4_SUFFIXES = [
  "al",
  "ance",
  "ence",
  "er",
  "ic",
  "able",
  "ible",
  "ant",
  "ement",
  "ment",
  "ent",
  "ion",
  "ou",
  "ism",
  "ate",
  "iti",
  "ous",
  "ive",
  "ize",
];

function step4(word: string): string {
  for (const suffix of STEP4_SUFFIXES) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (suffix === "ion") {
        if (measure(stem) > 1 && (stem.endsWith("s") || stem.endsWith("t"))) {
          return stem;
        }
      } else if (measure(stem) > 1) {
        return stem;
      }
    }
  }
  return word;
}

function step5a(word: string): string {
  if (word.endsWith("e")) {
    const stem = word.slice(0, -1);
    if (measure(stem) > 1) return stem;
    if (measure(stem) === 1 && !cvc(stem)) return stem;
  }
  return word;
}

function step5b(word: string): string {
  if (measure(word) > 1 && endsWithDouble(word) && word.endsWith("l")) {
    return word.slice(0, -1);
  }
  return word;
}

function porterStem(word: string): string {
  if (word.length <= 2) return word;
  let result = step1a(word);
  result = step1b(result);
  result = step1c(result);
  result = step2(result);
  result = step3(result);
  result = step4(result);
  result = step5a(result);
  result = step5b(result);
  return result;
}

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

    for (const field of FIELDS) {
      const tokens = fieldTokens[field];
      fieldLengths[field] = tokens.length;
      totalFieldLengths[field] += tokens.length;

      const termFreqs = new Map<string, number>();
      for (const token of tokens) {
        termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
      }

      for (const [term, freq] of termFreqs) {
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

    docs.set(path, { entry, fieldLengths });
  }

  function removeDoc(path: string): void {
    const meta = docs.get(path);
    if (!meta) return;

    for (const field of FIELDS) {
      totalFieldLengths[field] -= meta.fieldLengths[field];
    }

    for (const [, postings] of invertedIndex) {
      postings.delete(path);
    }

    // Clean up empty posting lists
    for (const [term, postings] of invertedIndex) {
      if (postings.size === 0) {
        invertedIndex.delete(term);
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
