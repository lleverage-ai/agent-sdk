import type { StreamEvent } from "../stream/stream-event.js";
import type { IEventStore, StoredEvent } from "../stream/types.js";

import { accumulateEvents } from "./accumulator.js";
import type { ILedgerStore } from "./stores/ledger-store.js";
import type { BeginRunOptions, FinalizeResult, RunRecord } from "./types.js";
import { isActiveRunStatus } from "./types.js";

/**
 * Orchestrates the full run lifecycle: event store + ledger store + accumulator.
 *
 * The RunManager coordinates between:
 * - `IEventStore<StreamEvent>` for raw event append/replay
 * - `ILedgerStore` for run records and canonical messages
 * - The accumulator for transforming events into messages
 *
 * @category RunManager
 */
export class RunManager {
  private ledgerStore: ILedgerStore;
  private eventStore: IEventStore<StreamEvent>;

  constructor(ledgerStore: ILedgerStore, eventStore: IEventStore<StreamEvent>) {
    this.ledgerStore = ledgerStore;
    this.eventStore = eventStore;
  }

  /**
   * Begin a new run: creates the run record in the ledger store and
   * transitions it to "streaming" status. The event stream is created
   * implicitly on the first call to {@link appendEvents}.
   *
   * @param options - Run creation options
   * @returns The newly created run record
   */
  async beginRun(options: BeginRunOptions): Promise<RunRecord> {
    const run = await this.ledgerStore.beginRun(options);
    try {
      await this.ledgerStore.activateRun(run.runId);
    } catch (error) {
      // Clean up the orphaned "created" run so it doesn't linger.
      // If recovery also fails, stale-run reconciliation will catch it.
      try {
        await this.ledgerStore.recoverRun({ runId: run.runId, action: "fail" });
      } catch {
        // Recovery failed — stale-run reconciliation will handle it
      }
      throw error;
    }
    return { ...run, status: "streaming" };
  }

  /**
   * Append stream events to a run's event stream.
   *
   * @param runId - The run to append events to
   * @param events - Stream events to append
   * @returns The stored events with assigned sequence numbers
   */
  async appendEvents(runId: string, events: StreamEvent[]): Promise<StoredEvent<StreamEvent>[]> {
    const run = await this.ledgerStore.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (!isActiveRunStatus(run.status)) {
      throw new Error(`Cannot append events to run in status "${run.status}"`);
    }
    return this.eventStore.append(run.streamId, events);
  }

  /**
   * Finalize a run: replay events, accumulate into messages, commit to ledger.
   *
   * 1. Replays all events from the run's stream
   * 2. Feeds through the accumulator to produce CanonicalMessages
   * 3. Calls `ILedgerStore.finalizeRun()` with the messages
   * 4. Atomic supersession of old runs is handled by the store
   *
   * @param runId - The run to finalize
   * @param status - Terminal status
   * @returns Finalization result
   */
  async finalizeRun(
    runId: string,
    status: "committed" | "failed" | "cancelled",
  ): Promise<FinalizeResult> {
    const run = await this.ledgerStore.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    if (status === "committed") {
      const storedEvents = await this.eventStore.replay(run.streamId);
      const messages = accumulateEvents(storedEvents);
      return this.ledgerStore.finalizeRun({
        runId,
        status,
        messages,
      });
    }

    return this.ledgerStore.finalizeRun({
      runId,
      status,
    });
  }
}
