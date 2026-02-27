import type { Logger } from "../stream/types.js";
import { defaultLogger } from "../stream/types.js";
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
 * Result of recovering all stale runs, including both successes and failures.
 *
 * @category Reconciliation
 */
export interface RecoverAllResult {
  /** Runs that were successfully recovered */
  succeeded: RecoverResult[];
  /** Runs that failed to recover */
  failed: Array<{ runId: string; error: unknown }>;
}

/**
 * Recover all stale runs by forcing them to a terminal status.
 *
 * @param store - The ledger store
 * @param action - Recovery action to apply to all stale runs
 * @param options - Detection options for finding stale runs
 * @returns Recovery results including both successes and failures
 *
 * @category Reconciliation
 */
export async function recoverAllStaleRuns(
  store: ILedgerStore,
  action: "fail" | "cancel",
  options?: ListStaleRunsOptions & { logger?: Logger },
): Promise<RecoverAllResult> {
  const logger = options?.logger ?? defaultLogger;
  const staleRuns = await listStaleRuns(store, options);
  const succeeded: RecoverResult[] = [];
  const failed: Array<{ runId: string; error: unknown }> = [];

  for (const staleRun of staleRuns) {
    try {
      const result = await store.recoverRun({
        runId: staleRun.run.runId,
        action,
      });
      succeeded.push(result);
    } catch (error) {
      logger.error("[agent-threads] Failed to recover stale run", {
        runId: staleRun.run.runId,
        error,
      });
      failed.push({ runId: staleRun.run.runId, error });
    }
  }

  return { succeeded, failed };
}
