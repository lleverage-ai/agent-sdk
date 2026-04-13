/**
 * Query parsing and expansion for the search layer.
 *
 * Handles quoted phrases, prefix wildcards, negation, stop word removal,
 * and Porter stemming identical to the BM25 index tokeniser.
 *
 * @module
 */

import { porterStem, STOP_WORDS } from "./stemmer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryTerm {
  value: string;
  type: "word" | "phrase" | "prefix";
  negated: boolean;
}

export interface ParsedQuery {
  terms: QueryTerm[];
  original: string;
}

// Structural operators stripped from the term list
const OPERATORS = new Set(["AND", "OR"]);

// ---------------------------------------------------------------------------
// parseQuery
// ---------------------------------------------------------------------------

/**
 * Parses a raw search query string into structured terms.
 *
 * Supports quoted phrases, prefix wildcards (`term*`), negation (`-term`),
 * and stop word removal with Porter stemming.
 *
 * @param raw - The raw query string
 * @returns A {@link ParsedQuery} with structured terms and the original input
 */
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

/**
 * Extracts positive search terms from a parsed query for index lookup.
 *
 * Excludes negated terms and returns stemmed values for word/prefix terms,
 * raw values for phrase terms.
 *
 * @param parsed - The parsed query from {@link parseQuery}
 * @returns An array of search terms suitable for index queries
 */
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
