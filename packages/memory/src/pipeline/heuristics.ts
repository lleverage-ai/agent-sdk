import type { MemoryConfidence } from "../types.js";

/**
 * Counts the number of `## ` level-2 headings in a memory body.
 *
 * @param body - The markdown body text
 * @returns The number of sections found
 */
export function countSections(body: string): number {
  let count = 0;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("## ")) {
      count++;
    }
  }
  return count;
}

/**
 * Derives a confidence level from the number of observations in a heuristic.
 *
 * @param count - Number of observations (sections)
 * @returns The confidence level
 */
export function confidenceFromObservations(count: number): MemoryConfidence {
  if (count >= 5) return "high";
  if (count >= 3) return "medium";
  return "low";
}
