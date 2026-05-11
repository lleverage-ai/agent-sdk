import type { ILedgerStore } from "./stores/ledger-store.js";
import {
  CANONICAL_MESSAGE_SCHEMA_VERSION,
  type CanonicalMessage,
  type CompactionSummaryPart,
} from "./types.js";

/**
 * Store interface for persistent compaction summaries.
 *
 * @category Backend
 */
export interface CompactionStore {
  /**
   * Persist a compaction summary.
   *
   * @param args - Save arguments
   * @param args.threadId - Thread identifier the summary belongs to
   * @param args.runId - Run identifier associated with the compaction
   * @param args.summary - The summary part to persist
   * @returns A promise that resolves when the summary has been saved
   * @throws {Error} If the summary already exists or the backing store fails
   *
   * @example
   * ```typescript
   * await store.save({ threadId, runId, summary });
   * ```
   */
  save(args: { threadId: string; runId: string; summary: CompactionSummaryPart }): Promise<void>;

  /**
   * Load all compaction summaries for a thread.
   *
   * @param args - Load arguments
   * @param args.threadId - Thread identifier to load summaries for
   * @returns Compaction summaries persisted for the thread
   * @throws {Error} If the backing store fails to load the transcript
   *
   * @example
   * ```typescript
   * const summaries = await store.load({ threadId });
   * ```
   */
  load(args: { threadId: string }): Promise<readonly CompactionSummaryPart[]>;
}

/**
 * Creates a compaction store backed by an {@link ILedgerStore}.
 *
 * Summaries are persisted as system-role carrier messages tagged with
 * `metadata.isCompactionCarrier = true`. The carrier message id is the
 * `summaryId`, which makes uniqueness and lookup trivial. Carriers are
 * attached to `summary.coveredRange.endMessageId` as annotations: branch
 * resolution treats `isCompactionCarrier` messages as siblings of the
 * conversation rather than alternative branches, so async compaction lands
 * cleanly without disturbing the active branch.
 *
 * Concurrent `save()` calls for the same `summaryId` race the dedupe check;
 * the design assumes a single writer per thread (typically the run executor
 * that owns compaction). The underlying message id uniqueness — enforced by
 * the SQLite store via PRIMARY KEY — backstops the check at storage level.
 *
 * @param ledgerStore - Ledger store used to persist carrier messages and read summaries
 * @returns A {@link CompactionStore} backed by the ledger
 * @throws {Error} If ledger operations fail while saving or loading summaries
 *
 * @example
 * ```typescript
 * const compactionStore = createLedgerCompactionStore(ledgerStore);
 * await compactionStore.save({ threadId, runId, summary });
 * ```
 *
 * @category Backend
 */
export function createLedgerCompactionStore(ledgerStore: ILedgerStore): CompactionStore {
  const load: CompactionStore["load"] = async ({ threadId }) => {
    const transcript = await ledgerStore.getTranscript({ threadId, branch: "all" });
    return transcript
      .filter((message) => message.metadata.isCompactionCarrier === true)
      .flatMap((message) => message.parts)
      .filter((part): part is CompactionSummaryPart => part.type === "compaction-summary");
  };

  return {
    async save({ threadId, runId: _runId, summary }) {
      const existing = await load({ threadId });
      if (existing.some((item) => item.summaryId === summary.summaryId)) {
        throw new Error(`Compaction summary already exists: ${summary.summaryId}`);
      }

      const run = await ledgerStore.beginRun({ threadId });

      try {
        await ledgerStore.activateRun(run.runId);

        const carrier: CanonicalMessage = {
          id: summary.summaryId,
          parentMessageId: summary.coveredRange.endMessageId,
          role: "system",
          parts: [summary],
          createdAt: summary.provenance.createdAt,
          metadata: {
            schemaVersion: CANONICAL_MESSAGE_SCHEMA_VERSION,
            isCompactionCarrier: true,
          },
        };

        await ledgerStore.finalizeRun({
          runId: run.runId,
          status: "committed",
          messages: [carrier],
        });
      } catch (error) {
        // Best-effort: mark the helper run failed so reconciliation does not
        // have to clean it up later. Swallow secondary failures so the original
        // error always surfaces to the caller.
        await ledgerStore
          .finalizeRun({ runId: run.runId, status: "failed" })
          .catch(() => undefined);
        throw error;
      }
    },

    load,
  };
}
