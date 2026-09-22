/**
 * Checkpoint runtime.
 *
 * Owns the per-thread checkpoint cache and every write to the configured
 * {@link BaseCheckpointSaver}. Generation modes and the resume path go
 * through this module rather than touching the saver directly, so the cache
 * can never disagree with what was last persisted.
 *
 * Responsibilities:
 *
 * - `load` / `save`: the run-boundary operations. `load` restores
 *   agent state (`todos`, `files`) from the checkpoint; `save` snapshots it.
 * - `commit`: persist an already-built checkpoint and update the cache. Used
 *   when the caller has to shape the checkpoint itself (resume, emergency
 *   compaction).
 * - `markPendingInterrupt`: stamp a pending interrupt (and the run id) on the
 *   thread's current checkpoint. Every generation mode does this the same way
 *   when a tool interrupts.
 * - `resolveRunId`: continue the run id of a pending interrupt when a
 *   generation resumes a thread, otherwise mint a new one.
 *
 * Everything here is a no-op returning `undefined` when no checkpointer is
 * configured, so call sites do not need their own guards for the
 * runtime's own methods.
 *
 * @packageDocumentation
 * @internal
 */

import type { ModelMessage } from "ai";
import type { AgentState } from "../backends/state.js";
import type { BaseCheckpointSaver, Checkpoint, Interrupt } from "../checkpointer/types.js";
import { createCheckpoint, updateCheckpoint } from "../checkpointer/types.js";
import { CheckpointError } from "../errors/index.js";
import { createRunId } from "../observability/execution-metadata.js";
import type { GenerateOptions } from "../types.js";

/** @internal */
export function getCheckpointRunId(checkpoint: Checkpoint | undefined): string | undefined {
  return typeof checkpoint?.metadata?.runId === "string" ? checkpoint.metadata.runId : undefined;
}

/** @internal */
export function withCheckpointRunId(
  checkpoint: Checkpoint,
  runId: string | undefined,
  updates?: Partial<Omit<Checkpoint, "threadId" | "createdAt">>,
): Checkpoint {
  return updateCheckpoint(checkpoint, {
    ...(updates ?? {}),
    metadata: {
      ...(checkpoint.metadata ?? {}),
      ...(updates?.metadata ?? {}),
      ...(runId ? { runId } : {}),
    },
  });
}

/**
 * Dependencies for {@link createCheckpointRuntime}.
 *
 * @internal
 */
export interface CheckpointRuntimeDeps {
  /** The configured saver, or `undefined` when checkpointing is disabled. */
  checkpointer: BaseCheckpointSaver | undefined;
  /** Live agent state; restored on load and snapshotted on save. */
  state: AgentState;
  /**
   * Called each time the saver returns a checkpoint, i.e. on every load that
   * misses this runtime's cache. Cached re-reads do not re-notify; concurrent
   * loads of the same uncached thread each notify. Must not throw; the runtime
   * does not contain listener failures.
   */
  onLoaded?: (checkpoint: Checkpoint, threadId: string) => Promise<void>;
}

/**
 * The checkpoint runtime for one agent.
 *
 * @internal
 */
export interface CheckpointRuntime {
  /**
   * Load the checkpoint for a thread, restoring agent state from it. Cached
   * per thread after the first load.
   */
  load(threadId: string): Promise<Checkpoint | undefined>;

  /**
   * Save the thread's transcript and step count, snapshotting agent state.
   * Updates the existing checkpoint when one is cached, otherwise creates one.
   */
  save(
    threadId: string,
    messages: ModelMessage[],
    step: number,
    runId?: string,
  ): Promise<Checkpoint | undefined>;

  /**
   * Persist a checkpoint the caller has already shaped and make it the
   * thread's cached checkpoint.
   */
  commit(threadId: string, checkpoint: Checkpoint): Promise<void>;

  /**
   * Stamp `interrupt` as the pending interrupt on the thread's current
   * checkpoint and persist it.
   *
   * `base` defaults to the cached checkpoint for the thread (normally the one
   * `save()` just wrote). Returns `undefined` when there is nothing to stamp.
   */
  markPendingInterrupt(
    threadId: string,
    interrupt: Interrupt,
    runId: string | undefined,
    base?: Checkpoint,
  ): Promise<Checkpoint | undefined>;

  /**
   * Resolve the run id for a generation. Uses `_runId` when set; otherwise,
   * when the thread has a pending interrupt, continues that interrupt's run
   * id; otherwise mints a new one. Forked sessions always mint a new id.
   */
  resolveRunId(genOptions: GenerateOptions): Promise<string>;
}

/**
 * Create the checkpoint runtime for an agent.
 *
 * @internal
 */
export function createCheckpointRuntime(deps: CheckpointRuntimeDeps): CheckpointRuntime {
  const { checkpointer, state, onLoaded } = deps;

  // Track current checkpoint state per thread
  const threadCheckpoints = new Map<string, Checkpoint>();

  /**
   * Load checkpoint for a thread if checkpointer is configured.
   * Returns the loaded checkpoint or undefined.
   */
  async function loadCheckpoint(threadId: string): Promise<Checkpoint | undefined> {
    if (!checkpointer) {
      return undefined;
    }

    // Check if we already have it cached
    const cached = threadCheckpoints.get(threadId);
    if (cached) {
      return cached;
    }

    let checkpoint: Checkpoint | undefined;
    try {
      // Load from checkpointer
      checkpoint = await checkpointer.load(threadId);
      if (checkpoint) {
        threadCheckpoints.set(threadId, checkpoint);

        // Restore agent state from checkpoint
        state.todos = [...checkpoint.state.todos];
        state.files = { ...checkpoint.state.files };
      }
    } catch (error) {
      // Wrap checkpoint load errors with CheckpointError
      throw new CheckpointError(`Failed to load checkpoint for thread ${threadId}`, {
        operation: "load",
        threadId,
        cause: error instanceof Error ? error : undefined,
        metadata: { threadId },
      });
    }

    // Notify after the cache and state are settled so a listener observes the
    // same checkpoint the generation will use. Outside the try so a listener
    // failure is never misreported as a load failure.
    if (checkpoint && onLoaded) {
      await onLoaded(checkpoint, threadId);
    }

    return checkpoint;
  }

  /**
   * Save checkpoint for a thread if checkpointer is configured.
   */
  async function saveCheckpoint(
    threadId: string,
    messages: ModelMessage[],
    step: number,
    runId?: string,
  ): Promise<Checkpoint | undefined> {
    if (!checkpointer) {
      return undefined;
    }

    const existingCheckpoint = threadCheckpoints.get(threadId);
    let checkpoint: Checkpoint;

    if (existingCheckpoint) {
      // Update existing checkpoint
      checkpoint = updateCheckpoint(existingCheckpoint, {
        messages,
        step,
        state: {
          todos: [...state.todos],
          files: { ...state.files },
        },
        metadata: {
          ...(existingCheckpoint.metadata ?? {}),
          ...(runId ? { runId } : {}),
        },
      });
    } else {
      // Create new checkpoint
      checkpoint = createCheckpoint({
        threadId,
        messages,
        step,
        state: {
          todos: [...state.todos],
          files: { ...state.files },
        },
        metadata: runId ? { runId } : undefined,
      });
    }

    try {
      // Save to checkpointer
      await checkpointer.save(checkpoint);
      threadCheckpoints.set(threadId, checkpoint);

      return checkpoint;
    } catch (error) {
      // Wrap checkpoint save errors with CheckpointError
      throw new CheckpointError(`Failed to save checkpoint for thread ${threadId}`, {
        operation: "save",
        threadId,
        cause: error instanceof Error ? error : undefined,
        metadata: { threadId, step },
      });
    }
  }

  async function commit(threadId: string, checkpoint: Checkpoint): Promise<void> {
    if (!checkpointer) {
      return;
    }
    await checkpointer.save(checkpoint);
    threadCheckpoints.set(threadId, checkpoint);
  }

  async function markPendingInterrupt(
    threadId: string,
    interrupt: Interrupt,
    runId: string | undefined,
    base?: Checkpoint,
  ): Promise<Checkpoint | undefined> {
    if (!checkpointer) {
      return undefined;
    }
    const current = base ?? threadCheckpoints.get(threadId);
    if (!current) {
      return undefined;
    }
    const withInterrupt = withCheckpointRunId(current, runId, {
      pendingInterrupt: interrupt,
    });
    await commit(threadId, withInterrupt);
    return withInterrupt;
  }

  async function resolveRunId(genOptions: GenerateOptions): Promise<string> {
    let runId = genOptions._runId;
    if (!runId && genOptions.threadId) {
      const existingCheckpoint = await loadCheckpoint(genOptions.threadId);
      if (existingCheckpoint?.pendingInterrupt) {
        runId = getCheckpointRunId(existingCheckpoint);
      }
    }
    return runId ?? createRunId();
  }

  return {
    load: loadCheckpoint,
    save: saveCheckpoint,
    commit,
    markPendingInterrupt,
    resolveRunId,
  };
}
