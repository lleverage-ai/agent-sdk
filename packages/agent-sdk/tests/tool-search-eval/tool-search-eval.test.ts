import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type EvalCase, type EvalTool, runCases, summarise } from "./harness.js";

// A synthetic regression set for MCPManager.searchTools(): multi-tool queries,
// plurals, rare tools, a typo, permissions-filtered catalogues and queries
// that should match nothing. It guards known ranking behaviour; it is not a
// held-out measure of ranking quality. Score other fixture directories with
// `bun run eval:tool-search <dir>`.
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixture");
const catalogue = JSON.parse(
  readFileSync(join(fixtureDir, "catalogue.json"), "utf8"),
) as EvalTool[];
const cases = JSON.parse(readFileSync(join(fixtureDir, "cases.json"), "utf8")) as EvalCase[];

describe("tool search evaluation fixture", () => {
  const results = runCases(catalogue, cases);

  it("ranks every expected tool in the top three", () => {
    const misses = results
      .filter((result) => result.testCase.label !== null)
      .filter((result) => result.rank === null || result.rank > 3)
      .map((result) => `${result.testCase.query} -> ${result.testCase.label} (${result.rank})`);

    expect(misses).toEqual([]);
    expect(summarise(catalogue, results).recallAt[3]).toBe(1);
  });

  it("returns nothing for queries that match no tool", () => {
    const empty = results.filter((result) => result.testCase.tags?.includes("empty"));

    expect(empty.length).toBeGreaterThan(0);
    for (const result of empty) {
      expect(result.results).toEqual([]);
    }
  });

  it("only returns tools from the sources a case can see", () => {
    const filtered = results.filter((result) => result.testCase.sources);

    expect(filtered.length).toBeGreaterThan(0);
    for (const result of filtered) {
      const sources = new Set(result.testCase.sources);
      for (const name of result.results) {
        expect(sources.has(name.split("__")[0] ?? "")).toBe(true);
      }
    }
  });
});
