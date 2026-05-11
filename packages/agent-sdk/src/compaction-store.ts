import type { CompactionSummaryPart } from "./canonical.js";

/**
 * Stores persistent compaction summaries for a thread.
 *
 * @category Context
 */
export interface CompactionStore {
  /** Persist a compaction summary. */
  save(args: { threadId: string; runId: string; summary: CompactionSummaryPart }): Promise<void>;

  /** Load all compaction summaries for a thread. */
  load(args: { threadId: string }): Promise<readonly CompactionSummaryPart[]>;
}

/**
 * Creates an in-memory compaction summary store.
 *
 * @category Context
 */
export function createInMemoryCompactionStore(): CompactionStore {
  const summariesByThread = new Map<string, Map<string, CompactionSummaryPart>>();

  return {
    async save({ threadId, summary }) {
      let summaries = summariesByThread.get(threadId);
      if (!summaries) {
        summaries = new Map();
        summariesByThread.set(threadId, summaries);
      }
      if (summaries.has(summary.summaryId)) {
        throw new Error(`Compaction summary already exists: ${summary.summaryId}`);
      }
      summaries.set(summary.summaryId, summary);
    },
    async load({ threadId }) {
      return [...(summariesByThread.get(threadId)?.values() ?? [])];
    },
  };
}
