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
  TerminalRunStatus,
} from "../types.js";
import { isActiveRunStatus, isTerminalRunStatus } from "../types.js";
import { ulid } from "../ulid.js";
import type { ILedgerStore } from "./ledger-store.js";

/**
 * In-memory ledger store backed by Maps.
 *
 * Suitable for testing, development, and short-lived processes.
 * All data is lost when the process exits.
 *
 * @category Stores
 */
export class InMemoryLedgerStore implements ILedgerStore {
  private runs = new Map<string, RunRecord>();
  private runsByThread = new Map<string, string[]>();
  private messages = new Map<string, CanonicalMessage[]>();

  async beginRun(options: BeginRunOptions): Promise<RunRecord> {
    const runId = ulid();
    const run: RunRecord = {
      runId,
      threadId: options.threadId,
      streamId: `run:${runId}`,
      forkFromMessageId: options.forkFromMessageId ?? null,
      status: "created",
      createdAt: new Date().toISOString(),
      finishedAt: null,
      messageCount: 0,
    };
    this.runs.set(runId, run);

    const threadRuns = this.runsByThread.get(options.threadId) ?? [];
    threadRuns.push(runId);
    this.runsByThread.set(options.threadId, threadRuns);

    return run;
  }

  async activateRun(runId: string): Promise<RunRecord> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== "created") {
      throw new Error(`Cannot activate run in status "${run.status}", expected "created"`);
    }
    const updated: RunRecord = { ...run, status: "streaming" };
    this.runs.set(runId, updated);
    return updated;
  }

  async finalizeRun(options: FinalizeRunOptions): Promise<FinalizeResult> {
    const run = this.runs.get(options.runId);
    if (!run) throw new Error(`Run not found: ${options.runId}`);

    // Idempotency: if already in the requested terminal status, no-op
    if (run.status === options.status) {
      return { committed: true, supersededRunIds: [] };
    }

    // Cannot finalize an already-terminal run with a different status
    if (isTerminalRunStatus(run.status)) {
      return { committed: false, supersededRunIds: [] };
    }

    const supersededRunIds: string[] = [];
    const finishedAt = new Date().toISOString();

    // Handle supersession for committed runs
    if (options.status === "committed") {
      // Store messages in the thread
      const existing = this.messages.get(run.threadId) ?? [];

      if (run.forkFromMessageId) {
        // Remove messages after the fork point from prior committed runs
        const forkIdx = existing.findIndex((m) => m.id === run.forkFromMessageId);
        if (forkIdx >= 0) {
          this.messages.set(run.threadId, existing.slice(0, forkIdx + 1));
        }

        // Supersede other committed runs at the same fork point
        const threadRuns = this.runsByThread.get(run.threadId) ?? [];
        for (const rid of threadRuns) {
          const other = this.runs.get(rid);
          if (
            other &&
            other.runId !== run.runId &&
            other.status === "committed" &&
            other.forkFromMessageId === run.forkFromMessageId
          ) {
            this.runs.set(rid, { ...other, status: "superseded", finishedAt });
            supersededRunIds.push(rid);
          }
        }
      }

      const current = this.messages.get(run.threadId) ?? [];
      current.push(...options.messages);
      this.messages.set(run.threadId, current);
    }

    const updated: RunRecord = {
      ...run,
      status: options.status,
      finishedAt,
      messageCount: options.status === "committed" ? options.messages.length : run.messageCount,
    };
    this.runs.set(options.runId, updated);

    return { committed: true, supersededRunIds };
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  async listRuns(threadId: string): Promise<RunRecord[]> {
    const runIds = this.runsByThread.get(threadId) ?? [];
    const runs: RunRecord[] = [];
    for (const id of runIds) {
      const run = this.runs.get(id);
      if (run) runs.push(run);
    }
    return runs;
  }

  async getTranscript(options: GetTranscriptOptions): Promise<CanonicalMessage[]> {
    const messages = this.messages.get(options.threadId) ?? [];
    const branch = options.branch ?? "active";

    if (typeof branch === "object") {
      throw new Error("Branch path resolution is not yet implemented");
    }

    // "active" and "all" currently return the same result — the active
    // transcript already reflects supersession from finalizeRun().
    return [...messages];
  }

  async listStaleRuns(options: {
    threadId?: string;
    olderThanMs: number;
  }): Promise<StaleRunInfo[]> {
    const now = Date.now();
    const results: StaleRunInfo[] = [];

    for (const run of this.runs.values()) {
      if (options.threadId && run.threadId !== options.threadId) continue;
      if (!isActiveRunStatus(run.status)) continue;

      const createdAt = new Date(run.createdAt).getTime();
      const staleDurationMs = now - createdAt;

      if (staleDurationMs >= options.olderThanMs) {
        results.push({ run, staleDurationMs });
      }
    }

    return results;
  }

  async recoverRun(options: RecoverRunOptions): Promise<RecoverResult> {
    const run = this.runs.get(options.runId);
    if (!run) throw new Error(`Run not found: ${options.runId}`);

    const previousStatus = run.status;
    if (!isActiveRunStatus(previousStatus)) {
      throw new Error(`Cannot recover run in status "${previousStatus}"`);
    }

    const newStatus: TerminalRunStatus = options.action === "fail" ? "failed" : "cancelled";
    const updated: RunRecord = {
      ...run,
      status: newStatus,
      finishedAt: new Date().toISOString(),
    };
    this.runs.set(options.runId, updated);

    return { runId: options.runId, previousStatus, newStatus };
  }

  async deleteThread(threadId: string): Promise<void> {
    const runIds = this.runsByThread.get(threadId) ?? [];
    for (const id of runIds) {
      this.runs.delete(id);
    }
    this.runsByThread.delete(threadId);
    this.messages.delete(threadId);
  }
}
