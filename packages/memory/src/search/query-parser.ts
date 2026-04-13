/**
 * Query parsing and expansion for the search layer.
 *
 * Handles quoted phrases, prefix wildcards, negation, stop word removal,
 * and Porter stemming identical to the BM25 index tokeniser.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryTerm = {
  value: string;
  type: "word" | "phrase" | "prefix";
  negated: boolean;
};

export type ParsedQuery = {
  terms: QueryTerm[];
  original: string;
};

// ---------------------------------------------------------------------------
// Stop words (identical to BM25 index)
// ---------------------------------------------------------------------------

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

// Structural operators stripped from the term list
const OPERATORS = new Set(["AND", "OR"]);

// ---------------------------------------------------------------------------
// Porter stemmer (identical to BM25 index)
// ---------------------------------------------------------------------------

function measure(s: string): number {
  const vowels = /[aeiou]/;
  const consonant = /[^aeiou]/;
  let m = 0;
  let i = 0;
  const len = s.length;

  while (i < len && consonant.test(s[i]!)) i++;

  while (i < len) {
    while (i < len && vowels.test(s[i]!)) i++;
    if (i >= len) break;
    while (i < len && consonant.test(s[i]!)) i++;
    m++;
  }
  return m;
}

function hasVowel(s: string): boolean {
  return /[aeiou]/.test(s);
}

function endsWithDouble(s: string): boolean {
  if (s.length < 2) return false;
  const last = s[s.length - 1]!;
  return last === s[s.length - 2] && /[^aeiou]/.test(last);
}

function cvc(s: string): boolean {
  if (s.length < 3) return false;
  const c1 = s[s.length - 3]!;
  const v = s[s.length - 2]!;
  const c2 = s[s.length - 1]!;
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
    const s = word.slice(0, -3);
    if (measure(s) > 0) return `${s}ee`;
    return word;
  }

  let stemmed = "";
  let matched = false;

  if (word.endsWith("ed")) {
    const s = word.slice(0, -2);
    if (hasVowel(s)) {
      stemmed = s;
      matched = true;
    }
  } else if (word.endsWith("ing")) {
    const s = word.slice(0, -3);
    if (hasVowel(s)) {
      stemmed = s;
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
      const s = word.slice(0, -suffix.length);
      if (measure(s) > 0) return s + replacement;
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
      const s = word.slice(0, -suffix.length);
      if (measure(s) > 0) return s + replacement;
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
      const s = word.slice(0, -suffix.length);
      if (suffix === "ion") {
        if (measure(s) > 1 && (s.endsWith("s") || s.endsWith("t"))) {
          return s;
        }
      } else if (measure(s) > 1) {
        return s;
      }
    }
  }
  return word;
}

function step5a(word: string): string {
  if (word.endsWith("e")) {
    const s = word.slice(0, -1);
    if (measure(s) > 1) return s;
    if (measure(s) === 1 && !cvc(s)) return s;
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
// parseQuery
// ---------------------------------------------------------------------------

export function parseQuery(raw: string): ParsedQuery {
  const terms: QueryTerm[] = [];
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { terms, original: raw };
  }

  const tokens: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (ch === '"') {
      if (inQuote) {
        tokens.push(`"${current}"`);
        current = "";
        inQuote = false;
      } else {
        if (current.length > 0) {
          tokens.push(current);
          current = "";
        }
        inQuote = true;
      }
    } else if (ch === " " && !inQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  // Handle trailing content
  if (current.length > 0) {
    if (inQuote) {
      // Unterminated quote - treat as plain tokens
      for (const word of current.split(/\s+/)) {
        if (word.length > 0) tokens.push(word);
      }
    } else {
      tokens.push(current);
    }
  }

  let nextNegated = false;

  for (const token of tokens) {
    // Skip structural operators
    if (OPERATORS.has(token)) {
      continue;
    }

    // "NOT" sets negation for the next term
    if (token === "NOT") {
      nextNegated = true;
      continue;
    }

    // Quoted phrase
    if (token.startsWith('"') && token.endsWith('"') && token.length > 2) {
      const phrase = token.slice(1, -1).toLowerCase();
      terms.push({ value: phrase, type: "phrase", negated: nextNegated });
      nextNegated = false;
      continue;
    }

    // Negation via dash prefix
    let negated = nextNegated;
    let value = token;
    if (value.startsWith("-") && value.length > 1) {
      negated = true;
      value = value.slice(1);
    }
    nextNegated = false;

    // Prefix wildcard
    if (value.endsWith("*") && value.length > 1) {
      terms.push({
        value: value.slice(0, -1).toLowerCase(),
        type: "prefix",
        negated,
      });
      continue;
    }

    // Regular word
    const lower = value.toLowerCase();

    // Strip stop words from non-negated, non-phrase terms
    if (!negated && STOP_WORDS.has(lower)) {
      continue;
    }

    terms.push({ value: lower, type: "word", negated });
  }

  return { terms, original: raw };
}

// ---------------------------------------------------------------------------
// buildSearchTerms
// ---------------------------------------------------------------------------

export function buildSearchTerms(parsed: ParsedQuery): string[] {
  const result: string[] = [];

  for (const term of parsed.terms) {
    // Exclude negated terms
    if (term.negated) {
      continue;
    }

    switch (term.type) {
      case "word": {
        result.push(porterStem(term.value));
        break;
      }

      case "phrase": {
        // Split phrase into individual stemmed words
        const words = term.value.split(/\s+/).filter((w) => w.length > 0);
        for (const word of words) {
          result.push(porterStem(word));
        }
        break;
      }

      case "prefix": {
        // Keep prefix as-is for prefix matching
        result.push(term.value);
        break;
      }
    }
  }

  return result;
}
