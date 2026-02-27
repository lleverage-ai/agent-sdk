import type { ILedgerStore } from "./stores/ledger-store.js";
import type { RecoverResult, StaleRunInfo } from "./types.js";

/**
 * Default threshold for considering a run stale (5 minutes).
 *
 * @category Reconciliation
 */
export const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Options for stale run detection.
 *
 * @category Reconciliation
 */
export interface ListStaleRunsOptions {
  /** Filter to a specific thread */
  threadId?: string;
  /** Threshold in ms for considering a run stale */
  olderThanMs?: number;
}

/**
 * List stale runs from a ledger store.
 *
 * A run is considered stale if it has been in "created" or "streaming"
 * status for longer than the threshold.
 *
 * @param store - The ledger store to query
 * @param options - Detection options
 * @returns Stale run information
 *
 * @category Reconciliation
 */
export async function listStaleRuns(
  store: ILedgerStore,
  options?: ListStaleRunsOptions,
): Promise<StaleRunInfo[]> {
  return store.listStaleRuns({
    threadId: options?.threadId,
    olderThanMs: options?.olderThanMs ?? DEFAULT_STALE_THRESHOLD_MS,
  });
}

/**
 * Recover all stale runs by forcing them to a terminal status.
 *
 * @param store - The ledger store
 * @param action - Recovery action to apply to all stale runs
 * @param options - Detection options for finding stale runs
 * @returns Recovery results for each stale run
 *
 * @category Reconciliation
 */
export async function recoverAllStaleRuns(
  store: ILedgerStore,
  action: "fail" | "cancel",
  options?: ListStaleRunsOptions,
): Promise<RecoverResult[]> {
  const staleRuns = await listStaleRuns(store, options);
  const results: RecoverResult[] = [];

  for (const staleRun of staleRuns) {
    try {
      const result = await store.recoverRun({
        runId: staleRun.run.runId,
        action,
      });
      results.push(result);
    } catch (error) {
      console.error("[agent-ledger] Failed to recover stale run", {
        runId: staleRun.run.runId,
        error,
      });
    }
  }

  return results;
}
