import type { ILedgerStore } from "./stores/ledger-store.js";
import type { CanonicalMessage, CompactionSummaryPart } from "./types.js";

/** Store interface for persistent compaction summaries. */
export interface CompactionStore {
  save(args: { threadId: string; runId: string; summary: CompactionSummaryPart }): Promise<void>;
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
 */
export function createLedgerCompactionStore(ledgerStore: ILedgerStore): CompactionStore {
  return {
    async save({ threadId, summary }) {
      const existing = await this.load({ threadId });
      if (existing.some((item) => item.summaryId === summary.summaryId)) {
        throw new Error(`Compaction summary already exists: ${summary.summaryId}`);
      }

      const run = await ledgerStore.beginRun({ threadId });
      await ledgerStore.activateRun(run.runId);

      const carrier: CanonicalMessage = {
        id: summary.summaryId,
        parentMessageId: summary.coveredRange.endMessageId,
        role: "system",
        parts: [summary],
        createdAt: summary.provenance.createdAt,
        metadata: {
          schemaVersion: 2,
          isCompactionCarrier: true,
        },
      };

      await ledgerStore.finalizeRun({ runId: run.runId, status: "committed", messages: [carrier] });
    },

    async load({ threadId }) {
      const transcript = await ledgerStore.getTranscript({ threadId, branch: "all" });
      return transcript
        .filter((message) => message.metadata.isCompactionCarrier === true)
        .flatMap((message) => message.parts)
        .filter((part): part is CompactionSummaryPart => part.type === "compaction-summary");
    },
  };
}
