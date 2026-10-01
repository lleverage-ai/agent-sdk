// Offline evaluation of MCPManager.searchTools() ranking.
//
// A catalogue snapshot is registered through the real MCPManager, each
// labelled query is searched, and the rank of the expected tool is recorded.
// The harness is shared by the regression test in this directory and by
// run.ts, which scores any fixture directory (including private ones that
// cannot be committed to this repository).

import { jsonSchema, type ToolSet, tool } from "ai";
import { MCPManager } from "../../src/mcp/manager.js";

/** One tool in a catalogue snapshot. */
export interface EvalTool {
  /** Plugin (or MCP server) name; the qualified name is `<source>__<tool>`. */
  source: string;
  /** Tool name within its source. */
  tool: string;
  description: string;
  /** Top-level parameter keys, as the search index sees them. */
  params: Array<{ name: string; required: boolean }>;
}

/** One labelled query. */
export interface EvalCase {
  query: string;
  /** Qualified name of the tool the query should find, or null for a query that should find nothing. */
  label: string | null;
  /** Restrict the catalogue to these sources, as a permissions-filtered agent would see it. */
  sources?: string[];
  /** Restrict the catalogue to these qualified names (applied after `sources`). */
  tools?: string[];
  /** Free-form tags used to report subsets, e.g. "multi-tool" or "fresh". */
  tags?: string[];
}

/** Rank of each case's label, 1-based; null when the label was not returned. */
export interface CaseResult {
  testCase: EvalCase;
  rank: number | null;
  results: string[];
}

/** Aggregate metrics over a set of cases with a label. */
export interface EvalMetrics {
  /** Cases with a label that is present in the case's catalogue. */
  n: number;
  /** Cases whose label is not in the case's catalogue (excluded from n). */
  labelMissing: number;
  recallAt: Record<number, number>;
  /** Mean reciprocal rank, counting a label outside the result limit as 0. */
  mrr: number;
  /** Mean number of results returned at the result limit. */
  meanResults: number;
}

export const DEFAULT_KS = [1, 3, 5, 10] as const;

/** Build an MCPManager holding the given catalogue. */
export function buildManager(catalogue: EvalTool[]): MCPManager {
  const bySource = new Map<string, ToolSet>();
  for (const entry of catalogue) {
    const toolSet = bySource.get(entry.source) ?? {};
    toolSet[entry.tool] = tool({
      description: entry.description,
      inputSchema: jsonSchema({
        type: "object",
        properties: Object.fromEntries(entry.params.map((param) => [param.name, {}])),
        required: entry.params.filter((param) => param.required).map((param) => param.name),
      }),
      execute: async () => "ok",
    });
    bySource.set(entry.source, toolSet);
  }

  const manager = new MCPManager();
  for (const [source, toolSet] of bySource) {
    manager.registerPluginTools(source, toolSet);
  }
  return manager;
}

/** Qualified name of a catalogue entry. */
export function qualifiedName(entry: EvalTool): string {
  return `${entry.source}__${entry.tool}`;
}

/** Search every case and record where its label ranked. */
export function runCases(
  catalogue: EvalTool[],
  cases: EvalCase[],
  options: { limit?: number } = {},
): CaseResult[] {
  const limit = options.limit ?? 10;
  const managers = new Map<string, MCPManager>();

  return cases.map((testCase) => {
    const sourceSet = testCase.sources ? new Set(testCase.sources) : null;
    const toolSet = testCase.tools ? new Set(testCase.tools) : null;
    const visible = catalogue.filter(
      (entry) =>
        (!sourceSet || sourceSet.has(entry.source)) &&
        (!toolSet || toolSet.has(qualifiedName(entry))),
    );
    const key = visible.map(qualifiedName).join("\n");
    let manager = managers.get(key);
    if (!manager) {
      manager = buildManager(visible);
      managers.set(key, manager);
    }

    const results = manager.searchTools(testCase.query, limit).map((metadata) => metadata.name);
    const index = testCase.label === null ? -1 : results.indexOf(testCase.label);
    return { testCase, rank: index >= 0 ? index + 1 : null, results };
  });
}

/** Aggregate recall@k and MRR over the cases that have a label in their catalogue. */
export function summarise(
  catalogue: EvalTool[],
  results: CaseResult[],
  ks: readonly number[] = DEFAULT_KS,
): EvalMetrics {
  const names = new Set(catalogue.map(qualifiedName));
  const labelled = results.filter((result) => result.testCase.label !== null);
  const scored = labelled.filter((result) => names.has(result.testCase.label as string));
  const n = scored.length;

  const recallAt: Record<number, number> = {};
  for (const k of ks) {
    const hits = scored.filter((result) => result.rank !== null && result.rank <= k).length;
    recallAt[k] = n === 0 ? 0 : hits / n;
  }
  const mrr =
    n === 0 ? 0 : scored.reduce((sum, result) => sum + (result.rank ? 1 / result.rank : 0), 0) / n;
  const meanResults =
    results.length === 0
      ? 0
      : results.reduce((sum, result) => sum + result.results.length, 0) / results.length;

  return { n, labelMissing: labelled.length - n, recallAt, mrr, meanResults };
}
