import { describe, expect, it } from "vitest";
import { confidenceFromObservations, countSections } from "../../src/pipeline/heuristics.js";

describe("countSections", () => {
  it("returns 0 for body with no headings", () => {
    expect(countSections("Just a plain body\nwith multiple lines")).toBe(0);
  });

  it("counts level-2 headings", () => {
    expect(countSections("## First\ncontent\n## Second\nmore")).toBe(2);
  });

  it("ignores level-1 and level-3 headings", () => {
    expect(countSections("# Title\n### Sub\n## Real section")).toBe(1);
  });

  it("counts headings with leading whitespace", () => {
    expect(countSections("  ## Indented heading")).toBe(1);
  });

  it("handles empty body", () => {
    expect(countSections("")).toBe(0);
  });

  it("counts multiple sections in a heuristic body", () => {
    const body = `Initial rule text

**Why:** context

## Observation 1

First reinforcement

## Observation 2

Second reinforcement

## Observation 3

Third reinforcement`;
    expect(countSections(body)).toBe(3);
  });
});

describe("confidenceFromObservations", () => {
  it("returns low for 0 observations", () => {
    expect(confidenceFromObservations(0)).toBe("low");
  });

  it("returns low for 1 observation", () => {
    expect(confidenceFromObservations(1)).toBe("low");
  });

  it("returns low for 2 observations", () => {
    expect(confidenceFromObservations(2)).toBe("low");
  });

  it("returns medium at exactly 3 observations", () => {
    expect(confidenceFromObservations(3)).toBe("medium");
  });

  it("returns medium for 4 observations", () => {
    expect(confidenceFromObservations(4)).toBe("medium");
  });

  it("returns high at exactly 5 observations", () => {
    expect(confidenceFromObservations(5)).toBe("high");
  });

  it("returns high for large counts", () => {
    expect(confidenceFromObservations(100)).toBe("high");
  });
});
