import type { CompactionSummaryPart } from "./canonical.js";

/**
 * Stores persistent compaction summaries for a thread.
 *
 * @category Context
 */
export interface CompactionStore {
  /**
   * Persist a compaction summary.
   *
   * @param args - Save arguments
   * @param args.threadId - Thread identifier the summary belongs to
   * @param args.runId - Run identifier associated with the compaction
   * @param args.summary - The compaction summary to persist
   * @returns A promise that resolves when the summary is persisted
   */
  save(args: { threadId: string; runId: string; summary: CompactionSummaryPart }): Promise<void>;

  /**
   * Load all compaction summaries for a thread.
   *
   * @param args - Load arguments
   * @param args.threadId - Thread identifier to load summaries for
   * @returns Compaction summaries persisted for the thread
   */
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
    async save({ threadId, runId: _runId, summary }) {
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
