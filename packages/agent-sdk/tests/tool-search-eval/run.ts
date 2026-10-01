// Score a tool-search fixture directory with the current MCPManager build.
//
//   bun packages/agent-sdk/tests/tool-search-eval/run.ts [fixture-dir] [--json]
//
// A fixture directory holds catalogue.json (EvalTool[]) and cases.json
// (EvalCase[]). Without an argument this scores the committed synthetic
// fixture. Metrics are reported for all labelled cases and per tag.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type EvalCase, type EvalTool, runCases, summarise } from "./harness.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const dir =
  args.find((arg) => !arg.startsWith("--")) ??
  join(dirname(fileURLToPath(import.meta.url)), "fixture");

const catalogue = JSON.parse(readFileSync(join(dir, "catalogue.json"), "utf8")) as EvalTool[];
const cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8")) as EvalCase[];

const results = runCases(catalogue, cases);
const tags = Array.from(new Set(cases.flatMap((testCase) => testCase.tags ?? []))).sort();
const groups: Array<[string, typeof results]> = [
  ["all", results],
  ...tags.map(
    (tag) =>
      [tag, results.filter((result) => result.testCase.tags?.includes(tag))] as [
        string,
        typeof results,
      ],
  ),
];

const report = groups.map(([group, groupResults]) => ({
  group,
  ...summarise(catalogue, groupResults),
}));

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  console.log("group\tn\tmissing\tR@1\tR@3\tR@5\tR@10\tMRR\tmean results");
  for (const row of report) {
    console.log(
      [
        row.group,
        row.n,
        row.labelMissing,
        pct(row.recallAt[1] ?? 0),
        pct(row.recallAt[3] ?? 0),
        pct(row.recallAt[5] ?? 0),
        pct(row.recallAt[10] ?? 0),
        row.mrr.toFixed(3),
        row.meanResults.toFixed(2),
      ].join("\t"),
    );
  }
}
