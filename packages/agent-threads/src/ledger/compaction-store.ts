import type { ILedgerStore } from "./stores/ledger-store.js";
import type { CanonicalMessage, CompactionSummaryPart } from "./types.js";
import { ulid } from "./ulid.js";

/** Store interface for persistent compaction summaries. */
export interface CompactionStore {
  save(args: { threadId: string; runId: string; summary: CompactionSummaryPart }): Promise<void>;
  load(args: { threadId: string }): Promise<readonly CompactionSummaryPart[]>;
}

/**
 * Creates a compaction store backed by an {@link ILedgerStore}.
 *
 * Summaries are persisted as system-role carrier messages with a single
 * `compaction-summary` part. Loading returns all summary parts present in the
 * thread; branch validity is handled by `SummaryAwareContextBuilder`.
 */
export function createLedgerCompactionStore(ledgerStore: ILedgerStore): CompactionStore {
  return {
    async save({ threadId, summary }) {
      const existing = await this.load({ threadId });
      if (existing.some((item) => item.summaryId === summary.summaryId)) {
        throw new Error(`Compaction summary already exists: ${summary.summaryId}`);
      }

      const run = await ledgerStore.beginRun({
        threadId,
        forkFromMessageId: summary.coveredRange.endMessageId,
      });
      await ledgerStore.activateRun(run.runId);

      const carrier: CanonicalMessage = {
        id: ulid(),
        parentMessageId: summary.coveredRange.endMessageId,
        role: "system",
        parts: [summary],
        createdAt: summary.provenance.createdAt,
        metadata: {
          schemaVersion: 2,
          isCompactionCarrier: true,
          summaryId: summary.summaryId,
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
