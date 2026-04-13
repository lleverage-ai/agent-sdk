import { describe, expect, it } from "vitest";
import { buildSearchTerms, parseQuery } from "../../src/search/query-parser.js";

// ---------------------------------------------------------------------------
// parseQuery
// ---------------------------------------------------------------------------

describe("parseQuery", () => {
  it("simple words become word terms", () => {
    const result = parseQuery("kubernetes deployment");
    const words = result.terms.filter((t) => t.type === "word");
    expect(words.length).toBe(2);
    expect(words[0]!.value).toBe("kubernetes");
    expect(words[1]!.value).toBe("deployment");
  });

  it("stop words are removed", () => {
    const result = parseQuery("the quick brown fox");
    const values = result.terms.map((t) => t.value);
    expect(values).not.toContain("the");
    expect(values).toContain("quick");
    expect(values).toContain("brown");
    expect(values).toContain("fox");
  });

  it("quoted phrases are preserved", () => {
    const result = parseQuery('"error handling" patterns');
    const phrases = result.terms.filter((t) => t.type === "phrase");
    expect(phrases.length).toBe(1);
    expect(phrases[0]!.value).toBe("error handling");
    expect(phrases[0]!.negated).toBe(false);
  });

  it("prefix wildcards detected (word*)", () => {
    const result = parseQuery("deploy*");
    expect(result.terms.length).toBe(1);
    expect(result.terms[0]!.type).toBe("prefix");
    expect(result.terms[0]!.value).toBe("deploy");
  });

  it("NOT negation detected", () => {
    const result = parseQuery("NOT kubernetes");
    expect(result.terms.length).toBe(1);
    expect(result.terms[0]!.value).toBe("kubernetes");
    expect(result.terms[0]!.negated).toBe(true);
  });

  it("dash negation detected (-word)", () => {
    const result = parseQuery("-deprecated");
    expect(result.terms.length).toBe(1);
    expect(result.terms[0]!.value).toBe("deprecated");
    expect(result.terms[0]!.negated).toBe(true);
  });

  it("case insensitive", () => {
    const result = parseQuery("Kubernetes DEPLOYMENT");
    const values = result.terms.map((t) => t.value);
    expect(values).toContain("kubernetes");
    expect(values).toContain("deployment");
  });

  it("original query preserved", () => {
    const raw = "  Kubernetes deployment  ";
    const result = parseQuery(raw);
    expect(result.original).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// buildSearchTerms
// ---------------------------------------------------------------------------

describe("buildSearchTerms", () => {
  it("returns stemmed terms", () => {
    const parsed = parseQuery("deploying services");
    const terms = buildSearchTerms(parsed);
    expect(terms.length).toBe(2);
    // "deploying" stems to "deploi", "services" stems to "servic"
    expect(terms).toContain("deploi");
    expect(terms).toContain("servic");
  });

  it("excludes negated terms", () => {
    const parsed = parseQuery("kubernetes -deprecated");
    const terms = buildSearchTerms(parsed);
    expect(terms).not.toContain("deprec");
    expect(terms.length).toBe(1);
  });

  it("splits phrases into words", () => {
    const parsed = parseQuery('"error handling"');
    const terms = buildSearchTerms(parsed);
    expect(terms.length).toBe(2);
    // "error" stems to "error", "handling" stems to "handl"
    expect(terms).toContain("error");
    expect(terms).toContain("handl");
  });

  it("keeps prefix terms", () => {
    const parsed = parseQuery("deploy*");
    const terms = buildSearchTerms(parsed);
    expect(terms.length).toBe(1);
    expect(terms[0]).toBe("deploy");
  });
});
