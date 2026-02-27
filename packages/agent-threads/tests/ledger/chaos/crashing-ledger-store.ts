import type { ILedgerStore } from "../../../src/ledger/stores/ledger-store.js";
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
} from "../../../src/ledger/types.js";

export type CrashPoint = "before-finalize" | "after-commit";

export class CrashSimulationError extends Error {
  constructor(public readonly crashPoint: string) {
    super(`Simulated crash at: ${crashPoint}`);
    this.name = "CrashSimulationError";
  }
}

export class CrashingLedgerStore implements ILedgerStore {
  private armedCrashPoint: CrashPoint | null = null;
  private armedCount = 0;
  private _crashesTriggered = 0;

  constructor(private inner: ILedgerStore) {}

  arm(crashPoint: CrashPoint, count = Infinity): void {
    this.armedCrashPoint = crashPoint;
    this.armedCount = count;
  }

  disarm(): void {
    this.armedCrashPoint = null;
    this.armedCount = 0;
  }

  get crashesTriggered(): number {
    return this._crashesTriggered;
  }

  private shouldCrash(point: CrashPoint): boolean {
    if (this.armedCrashPoint === point && this.armedCount > 0) {
      this.armedCount--;
      this._crashesTriggered++;
      return true;
    }
    return false;
  }

  async finalizeRun(options: FinalizeRunOptions): Promise<FinalizeResult> {
    if (this.shouldCrash("before-finalize")) {
      throw new CrashSimulationError("before-finalize");
    }

    const result = await this.inner.finalizeRun(options);

    if (this.shouldCrash("after-commit")) {
      throw new CrashSimulationError("after-commit");
    }

    return result;
  }

  // Pass-through methods
  beginRun(options: BeginRunOptions): Promise<RunRecord> {
    return this.inner.beginRun(options);
  }

  activateRun(runId: string): Promise<RunRecord> {
    return this.inner.activateRun(runId);
  }

  getRun(runId: string): Promise<RunRecord | null> {
    return this.inner.getRun(runId);
  }

  listRuns(threadId: string): Promise<RunRecord[]> {
    return this.inner.listRuns(threadId);
  }

  getTranscript(options: GetTranscriptOptions): Promise<CanonicalMessage[]> {
    return this.inner.getTranscript(options);
  }

  listStaleRuns(options: { threadId?: string; olderThanMs: number }): Promise<StaleRunInfo[]> {
    return this.inner.listStaleRuns(options);
  }

  recoverRun(options: RecoverRunOptions): Promise<RecoverResult> {
    return this.inner.recoverRun(options);
  }

  deleteThread(threadId: string): Promise<void> {
    return this.inner.deleteThread(threadId);
  }
}
