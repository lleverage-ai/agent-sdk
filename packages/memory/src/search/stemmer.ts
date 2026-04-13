/**
 * Porter stemmer and stop words shared by the BM25 index and query parser.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Stop words
// ---------------------------------------------------------------------------

/** Common English stop words removed during tokenisation. */
export const STOP_WORDS = new Set([
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

/** Apply the Porter stemming algorithm to a single word. */
export function porterStem(word: string): string {
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
