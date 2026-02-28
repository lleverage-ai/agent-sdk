import type {
  BeginRunOptions,
  CanonicalMessage,
  FinalizeResult,
  FinalizeRunOptions,
  GetTranscriptOptions,
  RecoverResult,
  RecoverRunOptions,
  RunRecord,
  StaleRunInfo,
  ThreadTree,
} from "../types.js";

/**
 * Interface for durable ledger stores that manage runs and transcripts.
 *
 * Unlike `IEventStore` (append-only, stream-level), `ILedgerStore` operates
 * at the run and message level with side effects (supersession),
 * idempotency guards, and transactional semantics.
 *
 * @category Stores
 */
export interface ILedgerStore {
  /**
   * Begin a new run in a thread.
   *
   * @param options - Run creation options
   * @returns The newly created run record with status "created"
   */
  beginRun(options: BeginRunOptions): Promise<RunRecord>;

  /**
   * Transition a run from "created" to "streaming".
   *
   * @param runId - The run to activate
   * @returns The updated run record
   */
  activateRun(runId: string): Promise<RunRecord>;

  /**
   * Finalize a run with a terminal status.
   *
   * For "committed" status, messages are stored and any prior committed
   * runs at the same fork point are superseded atomically.
   *
   * Idempotent: calling with the same runId and matching status returns
   * `{ committed: true, supersededRunIds: [] }` without side effects.
   * Calling on an already-terminal run with a *different* status returns
   * `{ committed: false, supersededRunIds: [] }`.
   *
   * @param options - Finalization options including messages
   * @returns Result indicating success and any superseded runs
   */
  finalizeRun(options: FinalizeRunOptions): Promise<FinalizeResult>;

  /**
   * Get a run record by ID.
   *
   * @param runId - The run to retrieve
   * @returns The run record, or null if not found
   */
  getRun(runId: string): Promise<RunRecord | null>;

  /**
   * List all runs in a thread.
   *
   * @param threadId - The thread to list runs for
   * @returns All run records in the thread, ordered by creation time
   */
  listRuns(threadId: string): Promise<RunRecord[]>;

  /**
   * Get the transcript (committed messages) for a thread.
   *
   * @param options - Transcript retrieval options including branch resolution
   * @returns Ordered canonical messages
   */
  getTranscript(options: GetTranscriptOptions): Promise<CanonicalMessage[]>;

  /**
   * Get lightweight tree metadata for branch navigation.
   *
   * @param threadId - Thread to inspect
   * @returns Thread tree nodes and fork points
   */
  getThreadTree(threadId: string): Promise<ThreadTree>;

  /**
   * List runs that may have been abandoned (still in created/streaming status).
   *
   * @param options - Staleness criteria
   * @returns Stale run information
   */
  listStaleRuns(options: { threadId?: string; olderThanMs: number }): Promise<StaleRunInfo[]>;

  /**
   * Recover a stale run by forcing it to a terminal status.
   *
   * @param options - Recovery options
   * @returns Recovery result
   */
  recoverRun(options: RecoverRunOptions): Promise<RecoverResult>;

  /**
   * Delete all data associated with a thread (runs, messages).
   *
   * @param threadId - The thread to delete
   */
  deleteThread(threadId: string): Promise<void>;
}
