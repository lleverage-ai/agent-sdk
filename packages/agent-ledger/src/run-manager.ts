import type { IEventStore, StoredEvent, StreamEvent } from "@lleverage-ai/agent-stream";

import { accumulateEvents } from "./accumulator.js";
import type { ILedgerStore } from "./stores/ledger-store.js";
import type { BeginRunOptions, FinalizeResult, RunRecord } from "./types.js";

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
   * Begin a new run, creating both the run record and the event stream.
   *
   * @param options - Run creation options
   * @returns The newly created run record
   */
  async beginRun(options: BeginRunOptions): Promise<RunRecord> {
    const run = await this.ledgerStore.beginRun(options);
    await this.ledgerStore.activateRun(run.runId);
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

    const storedEvents = await this.eventStore.replay(run.streamId);
    const messages = status === "committed" ? accumulateEvents(storedEvents) : undefined;

    return this.ledgerStore.finalizeRun({
      runId,
      status,
      messages,
    });
  }
}
