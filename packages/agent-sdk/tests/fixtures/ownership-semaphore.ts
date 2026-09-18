// Test-only host queue, copied from lleverage 8b5c5c4. Admission/concurrency
// policy stays in the consumer; this is not a new SDK implementation/export.
const ABORT_ERROR_MESSAGE = "Sub-agent execution aborted";

/**
 * The abort reason to reject with, preserving the signal's own reason (and its
 * AbortError identity) so a cancellation stays distinguishable from a genuine
 * failure. Mirrors the `throwIfAborted` convention used by the sub-agent loop.
 * A reasonless abort defaults to an AbortError `DOMException`, matching what
 * `AbortSignal.throwIfAborted` throws.
 */
function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException(ABORT_ERROR_MESSAGE, "AbortError");
}

/**
 * FIFO counting semaphore for bounding concurrent sub-agent runs within a
 * session (LLE-11600, T5).
 *
 * Mirrors the established monorepo `Semaphore` pattern
 * (`packages/workflow-engine/src/concurrency-manager.ts`): a waiter queue of
 * `{ resolve, reject }`, a positive-integer limit validated at construction,
 * and an abort-aware `acquire`. A released slot is handed straight to the next
 * waiter (FIFO), so no holder can starve. `run` guarantees the slot is released
 * even when the guarded work throws, so a failing sub-agent never leaks a slot.
 */
export class Semaphore {
  private current = 0;
  private readonly queue: Array<{
    resolve: () => void;
    reject: (reason: unknown) => void;
  }> = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Concurrency limit must be a positive integer, received ${limit}`);
    }
  }

  /** Resolves once a slot is free; rejects if the optional signal aborts. */
  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      // Rethrow the signal's own reason (AbortError identity), consistent with
      // the sub-agent loop's between-iteration abort check.
      signal.throwIfAborted();
    }

    if (this.current < this.limit) {
      this.current++;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        reject: (reason: unknown) => {
          signal?.removeEventListener("abort", onAbort);
          reject(reason);
        },
      };

      const onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        waiter.reject(abortReason(signal));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  /** Frees a slot, waking the next waiter in FIFO order if there is one. */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Hand the slot straight to the waiter; `current` stays unchanged.
      next.resolve();
      return;
    }

    if (this.current > 0) {
      this.current--;
    }
  }

  /**
   * Acquires a slot, runs `fn`, and always releases the slot afterwards, even
   * if `fn` rejects. This is the release-safe entry point callers should prefer.
   */
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
