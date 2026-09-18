import type { TaskManager, TaskResources } from "./task-manager.js";
import type { BackgroundTask } from "./task-store/types.js";

/** Identity of an in-process delegation owned by a host run/attempt. @category Subagents */
export interface OwnedTaskIdentity {
  /** Task identifier. */
  id: string;
  /** Host run identifier, if a scope was supplied. */
  runId?: string;
  /** Host attempt identifier, if a scope was supplied. */
  attemptId?: string;
}

/** Opt-in lifetime, cancellation and replay limits for delegations. @category Subagents */
export interface OwnedTaskPolicy {
  /** Optional wall-clock lifetime, including factory, ready and hooks. No default timer. */
  delegationTimeoutMs?: number;
  /** Optional background-drain deadline. No default timer. */
  drainTimeoutMs?: number;
  /** Required positive finite grace in milliseconds to prove cancellation settled. */
  cancellationGraceMs: number;
  /** Reject new admissions at the budget; never evict completed-call fencing. */
  replayBudget?: {
    /** Maximum retained call entries; positive integer when supplied. */
    maxEntries?: number;
    /** Payload byte threshold for subsequent admission; positive integer when supplied. */
    maxBytes?: number;
  };
}

/** Host-provided identity and cancellation for one attempt. @category Subagents */
export interface OwnedTaskScope {
  /** Stable across attempts in the same run. */
  runId: string;
  /** Identifies this attempt. */
  attemptId: string;
  /** Cancels all delegations in this scope. */
  signal?: AbortSignal;
}

/** Report of work which did not settle within its cancellation grace. @category Subagents */
export interface OwnedTaskUnresolvedReport {
  /** Why settlement was requested. */
  reason: string;
  /** Unsettled task identities; no prompts or results. */
  tasks: OwnedTaskIdentity[];
  /** ISO time of the earliest cancellation in this report. */
  firstCancelledAt: string;
  /** Number of quarantined records in this loaded SDK module. */
  unresolvedCount: number;
}

/** Host admission and unresolved-work reporting, not a recovery policy. @category Subagents */
export interface OwnedTaskCallbacks {
  /** Reserve synchronously before factory creation; release only on actual settlement. */
  admit?: (task: OwnedTaskIdentity) => (() => void) | undefined;
  /** Called once per failed scope, without awaiting. Errors/rejections cannot erase ownership. The host owns readiness and recovery. */
  onUnresolved?: (report: OwnedTaskUnresolvedReport) => void | Promise<void>;
}

interface CleanupError extends Error {
  code: "subagent_cleanup_unresolved";
  tasks: OwnedTaskIdentity[];
  reason: string;
}

interface OwnedRecord extends OwnedTaskIdentity {
  controller: AbortController;
  settled: boolean;
  terminal?: boolean;
  release?: () => void;
  cancel: (reason: unknown) => void;
  disposeScheduling: () => void;
  promise?: Promise<string>;
  cancelAt?: number;
}

type Delivery =
  | { taskId: string; status: "running" | "completed" | "failed"; message: string }
  | { success: true; taskId: string; text: string }
  | { error: true; taskId: string; message: string };

// Module-local live owners survive manager/result cleanup. Cancellation is not settlement.
const quarantine = new Set<OwnedRecord>();
const terminal = (task: BackgroundTask | undefined): task is BackgroundTask =>
  !!task && !["pending", "running"].includes(task.status);

function cleanupError(records: OwnedRecord[], reason: string): CleanupError {
  return Object.assign(new Error("subagent_cleanup_unresolved"), {
    code: "subagent_cleanup_unresolved" as const,
    tasks: records.map(({ id, runId, attemptId }) => ({ id, runId, attemptId })),
    reason,
  });
}

/** Process-local lifecycle implementation; not durable workflow tasks. @internal */
export class OwnedTasks {
  readonly records = new Map<string, OwnedRecord>();
  private foreground = new Set<string>();
  private ids = new Set<string>();
  private deliveries = new Map<string, Promise<Delivery>>();
  private closed = false;
  private drainStartedAt?: number;
  private replayBytes = 0;
  private scope?: OwnedTaskScope;
  private failure?: CleanupError;
  private callbacks: OwnedTaskCallbacks;

  constructor(
    private manager: TaskManager,
    private policy: OwnedTaskPolicy,
    callbacks: OwnedTaskCallbacks | undefined,
    private store: { tasks: Map<string, BackgroundTask>; resources: Map<string, TaskResources> },
  ) {
    for (const [name, value] of Object.entries(policy)) {
      if (value === undefined || name === "replayBudget") continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
        throw new Error(`Owned task policy ${name} must be positive finite milliseconds`);
    }
    for (const [name, value] of Object.entries(policy.replayBudget ?? {})) {
      if (value === undefined) continue;
      if (!Number.isInteger(value) || value <= 0)
        throw new Error(`Owned task replay budget ${name} must be a positive integer`);
    }
    if (policy.cancellationGraceMs === undefined)
      throw new Error("Owned task policy cancellationGraceMs is required");
    this.callbacks = callbacks ?? {};
  }

  get outstanding() {
    return {
      records: this.records.size,
      replayEntries: this.deliveries.size,
      replayBytes: this.replayBytes,
    };
  }

  begin({ runId, attemptId, signal }: OwnedTaskScope): void {
    if (this.failure) throw this.failure;
    if (this.records.size) throw cleanupError([...this.records.values()], "replacement attempt");
    if (this.scope && this.scope.runId !== runId) this.releaseResults();
    this.scope = { runId, attemptId, signal };
    this.closed = false;
    this.drainStartedAt = undefined;
  }

  isBackground(id: string): boolean {
    return !this.foreground.has(id);
  }

  consume(id: string): BackgroundTask | undefined {
    const task = this.manager.getTask(id);
    if (!terminal(task) || !this.isBackground(id)) return undefined;
    // Synchronous shared consume decision; live ownership stays even for killed tasks.
    this.store.tasks.delete(id);
    this.ids.delete(id);
    if (!this.records.has(id)) this.store.resources.delete(id);
    return task;
  }

  async run(
    task: BackgroundTask,
    background: boolean,
    callerSignal: AbortSignal | undefined,
    execute: (signal: AbortSignal) => Promise<string>,
    toolCallId?: string,
  ): Promise<Delivery> {
    if (this.failure) throw this.failure;
    const replay = toolCallId ? this.deliveries.get(toolCallId) : undefined;
    if (replay) return replay;
    if (quarantine.size) throw cleanupError([...quarantine], "delegation admission closed");
    if (this.closed)
      throw Object.assign(new Error("Sub-agent delegation admission is closed"), {
        code: "subagent_admission_closed",
      });
    if (!this.manager.isAccepting()) throw new Error("TaskManager is not accepting new tasks");
    const budget = this.policy.replayBudget;
    if (
      budget &&
      ((budget.maxEntries !== undefined && this.deliveries.size >= budget.maxEntries) ||
        (budget.maxBytes !== undefined && this.replayBytes >= budget.maxBytes))
    )
      throw Object.assign(new Error("Sub-agent replay cache budget exhausted for this run"), {
        code: "subagent_replay_budget_exhausted",
      });
    const scope = this.scope;
    const release = this.callbacks.admit?.({
      id: task.id,
      runId: scope?.runId,
      attemptId: scope?.attemptId,
    });
    const controller = new AbortController();
    const record: OwnedRecord = {
      id: task.id,
      runId: scope?.runId,
      attemptId: scope?.attemptId,
      controller,
      settled: false,
      release,
      cancel: () => {},
      disposeScheduling: () => {},
    };
    this.records.set(task.id, record);
    this.ids.add(task.id);
    if (!background) this.foreground.add(task.id);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const detach: (() => void)[] = [];
    const cancel = (reason: unknown) => {
      if (record.settled || record.terminal || controller.signal.aborted) return;
      record.terminal = true;
      controller.abort(reason);
      this.manager.updateTask(task.id, { status: "killed", completedAt: new Date().toISOString() });
    };
    record.cancel = cancel;
    record.disposeScheduling = () => {
      clearTimeout(deadline);
      for (const dispose of detach.splice(0)) dispose();
    };
    record.promise = Promise.resolve()
      .then(async () => {
        controller.signal.throwIfAborted();
        this.manager.updateTask(task.id, { status: "running" });
        const text = await execute(controller.signal);
        controller.signal.throwIfAborted();
        record.terminal = true;
        this.manager.updateTask(task.id, {
          status: "completed",
          result: text,
          completedAt: new Date().toISOString(),
        });
        if (background && toolCallId)
          this.remember(
            toolCallId,
            Promise.resolve({
              taskId: task.id,
              status: "completed",
              message: "Existing task; completion is delivered once.",
            }),
          );
        else if (toolCallId)
          this.replayBytes += typeof text === "string" ? Buffer.byteLength(text, "utf8") : 0;
        return text;
      })
      .catch((error: unknown) => {
        // Cancelled work can be retried only after actual settlement.
        if (controller.signal.aborted && toolCallId) this.deliveries.delete(toolCallId);
        if (!controller.signal.aborted) {
          record.terminal = true;
          const message = error instanceof Error ? error.message : String(error);
          this.manager.updateTask(task.id, {
            status: "failed",
            error: message,
            completedAt: new Date().toISOString(),
          });
          if (background && toolCallId)
            this.remember(
              toolCallId,
              Promise.resolve({
                taskId: task.id,
                status: "failed",
                message: "Existing task; failure is delivered once.",
              }),
            );
          else if (toolCallId) this.replayBytes += Buffer.byteLength(message, "utf8");
        }
        throw error;
      })
      .finally(() => {
        record.settled = true;
        record.disposeScheduling();
        quarantine.delete(record);
        this.records.delete(task.id);
        this.store.resources.delete(task.id);
        try {
          void Promise.resolve(record.release?.()).catch(() => {});
        } catch {
          /* Release failures cannot change settlement. */
        }
      });
    let abortListener: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abortListener = () => {
        void this.settle([record], controller.signal.reason).then(
          () => reject(controller.signal.reason),
          reject,
        );
      };
      controller.signal.addEventListener("abort", abortListener, { once: true });
      if (controller.signal.aborted) abortListener();
    });
    const delivered = Promise.race([record.promise, cancelled]).finally(() => {
      controller.signal.removeEventListener("abort", abortListener);
      if (!background) {
        this.store.tasks.delete(task.id);
        this.foreground.delete(task.id);
        this.ids.delete(task.id);
      }
    });
    // Observe before publishing registration: a synchronous taskCreated listener
    // may cancel or throw. Real execution remains queued until this stack ends.
    void delivered.catch(() => {});
    try {
      this.manager.registerTask(task, { abortController: controller });
    } catch (error) {
      controller.abort(error);
      this.store.tasks.delete(task.id);
      this.ids.delete(task.id);
      // The queued execution sees cancellation before factory work. Wait for
      // its finally to release the admission permit, rather than orphaning it.
      await record.promise.catch(() => {});
      throw error;
    }
    for (const signal of new Set([callerSignal, scope?.signal])) {
      if (!signal) continue;
      const abort = () => cancel(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      detach.push(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    }
    if (this.policy.delegationTimeoutMs !== undefined)
      deadline = setTimeout(
        () => cancel(new Error("Sub-agent delegation deadline exceeded")),
        this.policy.delegationTimeoutMs,
      );

    if (background) {
      const started: Delivery = {
        taskId: task.id,
        status: "running",
        message: "Task started in background.",
      };
      if (toolCallId) this.remember(toolCallId, Promise.resolve(started));
      return started;
    }
    const response = delivered.then<Delivery, Delivery>(
      (text) => ({ success: true, taskId: task.id, text }),
      (error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "subagent_cleanup_unresolved"
        )
          throw error;
        return {
          error: true,
          taskId: task.id,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    );
    if (toolCallId) this.remember(toolCallId, response);
    return response;
  }

  private remember(toolCallId: string, delivery: Promise<Delivery>): void {
    this.deliveries.set(toolCallId, delivery);
  }

  private async settle(records: OwnedRecord[], reason: unknown): Promise<void> {
    const live = records.filter((record) => !record.settled);
    if (!live.length) return;
    const now = Date.now();
    for (const record of live) record.cancelAt ??= now;
    const waiting = live.filter((r) => (r.cancelAt ?? now) + this.policy.cancellationGraceMs > now);
    const remaining = Math.max(
      0,
      ...waiting.map((r) => (r.cancelAt ?? now) + this.policy.cancellationGraceMs - now),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (remaining > 0) {
      try {
        await Promise.race([
          Promise.allSettled(waiting.map((record) => record.promise)),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, remaining);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    const unresolved = live.filter((record) => !record.settled);
    if (!unresolved.length) return;
    this.closed = true;
    for (const record of unresolved) {
      record.disposeScheduling();
      quarantine.add(record);
    }
    const failure = cleanupError(
      unresolved,
      reason instanceof Error ? reason.message : String(reason),
    );
    const firstFailure = !this.failure;
    if (this.failure)
      this.failure.tasks = [
        ...new Map(
          [...this.failure.tasks, ...failure.tasks].map((task) => [task.id, task]),
        ).values(),
      ];
    else this.failure = failure;
    if (firstFailure && this.callbacks.onUnresolved) {
      try {
        void Promise.resolve(
          this.callbacks.onUnresolved({
            reason: failure.reason,
            tasks: failure.tasks,
            firstCancelledAt: new Date(
              Math.min(...unresolved.map((record) => record.cancelAt ?? now)),
            ).toISOString(),
            unresolvedCount: quarantine.size,
          }),
        ).catch(() => {});
      } catch {
        /* Host failure must not erase ownership. */
      }
    }
    throw this.failure;
  }

  async kill(id: string) {
    const record = this.records.get(id);
    if (!record || (!record.controller.signal.aborted && record.terminal))
      return { killed: false, reason: "Task already finished" };
    record.cancel(new Error("Sub-agent task killed"));
    try {
      await this.settle([record], "kill_task");
      return { killed: true };
    } catch (error) {
      return { killed: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async close(reason: string, reopen = false): Promise<void> {
    this.closed = true;
    const records = [...this.records.values()];
    for (const record of records) record.cancel(new Error(reason));
    await this.settle(records, reason);
    if (this.failure) throw this.failure;
    if (reopen && !this.scope?.signal?.aborted && !quarantine.size) this.closed = false;
  }

  releaseResults(): void {
    // Live promises remain owned/quarantined even when normal registrations go away.
    for (const id of new Set([...this.ids, ...this.records.keys()])) {
      this.store.tasks.delete(id);
      this.store.resources.delete(id);
    }
    this.ids.clear();
    this.deliveries.clear();
    this.replayBytes = 0;
    this.scope = undefined;
  }

  async nextCompletion(): Promise<BackgroundTask> {
    this.drainStartedAt ??= Date.now();
    const remaining =
      this.policy.drainTimeoutMs === undefined
        ? undefined
        : this.policy.drainTimeoutMs - (Date.now() - this.drainStartedAt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const signal = this.scope?.signal;
    let onTerminal: (task: BackgroundTask) => void = () => {};
    let onAbort: () => void = () => {};
    try {
      return await new Promise<BackgroundTask>((resolve, reject) => {
        onTerminal = (task) => {
          if (this.isBackground(task.id)) resolve(task);
        };
        onAbort = () => reject(signal?.reason);
        for (const event of ["taskCompleted", "taskFailed", "taskKilled"] as const)
          this.manager.on(event, onTerminal);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (remaining !== undefined)
          timer = setTimeout(
            () => reject(new Error("Sub-agent background drain deadline exceeded")),
            Math.max(0, remaining),
          );
        const ready = this.manager
          .getAllTasks()
          .find((task) => terminal(task) && this.isBackground(task.id));
        if (signal?.aborted) onAbort();
        else if (remaining !== undefined && remaining <= 0)
          reject(new Error("Sub-agent background drain deadline exceeded"));
        else if (ready) resolve(ready);
      });
    } catch (error) {
      await this.close(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      clearTimeout(timer);
      for (const event of ["taskCompleted", "taskFailed", "taskKilled"] as const)
        this.manager.off(event, onTerminal);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
